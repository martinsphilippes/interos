import "server-only";
/**
 * Varreduras do circuito de receita (D8), chamadas pelo motor de automações (src/server/automations/sweeps.ts):
 *
 * - `sweepAllOpenBillings`: roda `sweepOverdue` em TODAS as cobranças em aberto (antes, as vencidas só eram
 *   detectadas quando alguém abria uma tela do Financeiro). A troca de status é transacional e emite
 *   payment.overdue uma única vez por cobrança.
 * - `contractAlerts`: contratos parados, com prazos do setting "financeiro_alertas":
 *   1. aguardando assinatura há mais de N dias → tarefa de follow-up para o vendedor;
 *   2. pago e não liberado há mais de N horas → tarefa (e aviso) para o gestor financeiro;
 *   3. liberado com projeto de implantação "aguardando início" há mais de N dias → aviso ao responsável e ao
 *      gestor de implantação.
 *   Tudo idempotente: tarefa por processo (contrato) + título; aviso uma única vez por projeto.
 */
import { getManyByIds, list } from "@/server/db";
import { notify } from "@/server/notifications";
import { createTaskInternal } from "@/server/tasks/service";
import { getDepartmentManager } from "@/server/workflow/service";
import { getSetting } from "@/server/admin/queries";
import { SETTING_DEFAULTS, type FinanceiroAlertasConfig } from "@/server/admin/schemas";
import { billingProviderConnected, getBillingProvider } from "@/server/integrations/billing-provider";
import { dateKey, formatDate, formatDateTime } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type Contract, type DomainEvent, type ImplementationProject, type Notification, type Opportunity, type Task, type User } from "@/domain/types";
import { SYSTEM_ACTOR, sweepOverdue } from "./billing";
import { PAYMENT_METHODS } from "./schemas";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export async function getFinanceAlertSettings(): Promise<FinanceiroAlertasConfig> {
  const value = await getSetting<FinanceiroAlertasConfig>("financeiro_alertas", SETTING_DEFAULTS.financeiro_alertas);
  const pick = (key: keyof FinanceiroAlertasConfig) => (Number(value[key]) > 0 ? Number(value[key]) : SETTING_DEFAULTS.financeiro_alertas[key]);
  return { diasSemAssinatura: pick("diasSemAssinatura"), horasPagoSemLiberacao: pick("horasPagoSemLiberacao"), diasLiberadoSemInicio: pick("diasLiberadoSemInicio"), horizonteCobrancasMeses: pick("horizonteCobrancasMeses") };
}

// ---------------------------------------------------------------------------
// cobrancas_vencidas
// ---------------------------------------------------------------------------

export async function sweepAllOpenBillings(): Promise<{ open: number; flipped: number }> {
  const open = await list<Billing>(COLLECTIONS.billing, { where: [["status", "==", "aberta"]] });
  const swept = await sweepOverdue(open);
  const flipped = swept.filter((b) => b.status === "vencida").length;
  return { open: open.length, flipped };
}

// ---------------------------------------------------------------------------
// conciliacao_bancaria (D21): só age com provedor de cobrança conectado — nunca inventa pagamento
// ---------------------------------------------------------------------------

export interface BankReconciliationResult {
  /** Varredura ignorada (provedor não conectado). */
  skipped: boolean;
  reason?: string;
  checked: number;
  paid: number;
  alreadyProcessed: number;
  partial: number;
  errors: string[];
}

/**
 * Para cada cobrança aberta/vencida emitida no provedor (`externalId`), consulta o status lá e dá baixa pelo
 * caminho único `registerPayment(source: "conciliacao")` (deduplicada em `payment_events`). Sem provedor
 * conectado devolve `skipped` — o resultado "ignorada: provedor de cobrança não conectado" fica visível em
 * /admin/automacoes.
 */
export async function reconcileBankPayments(now: Date = new Date()): Promise<BankReconciliationResult> {
  const result: BankReconciliationResult = { skipped: false, checked: 0, paid: 0, alreadyProcessed: 0, partial: 0, errors: [] };
  if (!billingProviderConnected()) return { ...result, skipped: true, reason: "provedor de cobrança não conectado" };
  const provider = getBillingProvider();
  const { registerPayment } = await import("./service");
  const open = (await list<Billing>(COLLECTIONS.billing)).filter((b) => (b.status === "aberta" || b.status === "vencida") && b.externalId);
  for (const b of open) {
    result.checked += 1;
    try {
      const detail = provider.getChargeDetail ? await provider.getChargeDetail(b) : { status: await provider.getChargeStatus(b) };
      if (detail.status !== "pago") continue;
      const paidAt = detail.paidAt ? dateKey(detail.paidAt) : dateKey(now);
      const externalPaymentId = detail.externalPaymentId ?? b.externalId!;
      const method = (PAYMENT_METHODS as readonly string[]).includes(b.method ?? "") ? (b.method as (typeof PAYMENT_METHODS)[number]) : "boleto";
      const r = await registerPayment(
        { billingId: b.id, paidAt, amount: detail.paidAmount ?? b.amount, method, source: "conciliacao", externalPaymentId, providerEventId: `conc_${b.externalId}_${externalPaymentId}`, provider: provider.name },
        SYSTEM_ACTOR,
      );
      if (r.alreadyProcessed) result.alreadyProcessed += 1;
      else if (r.partial) result.partial += 1;
      else result.paid += 1;
    } catch (error) {
      result.errors.push(`${b.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// cobrancas_recorrentes (D24b): horizonte rolante das mensalidades
// ---------------------------------------------------------------------------

export interface RecurringBillingsResult {
  /** Contratos com horizonte rolante (renovação automática ou prazo indeterminado) avaliados. */
  contracts: number;
  extended: number;
  created: number;
  horizonMonths: number;
  errors: string[];
}

/**
 * Contratos liberados/pagos com renovação automática ou prazo indeterminado sem mensalidade gerada para os próximos
 * N meses (`financeiro_alertas.horizonteCobrancasMeses`) recebem as parcelas que faltam via `generateNextBillings`
 * (ids determinísticos: rodar duas vezes não duplica). Contratos de prazo fixo não entram: o plano inteiro já foi
 * gerado na assinatura e a renovação (aditivo) é quem estende.
 */
export async function ensureRecurringBillings(now: Date = new Date()): Promise<RecurringBillingsResult> {
  const settings = await getFinanceAlertSettings();
  const { generateNextBillings } = await import("./service");
  const { hasRollingBilling, isContractExpired, pendingRecurringInstallments } = await import("./billing");
  const today = dateKey(now);
  const contracts = (await list<Contract>(COLLECTIONS.contracts)).filter((c) => (c.status === "liberado" || c.status === "pago") && c.recurrence !== "unico" && c.monthlyTotal > 0 && hasRollingBilling(c) && !isContractExpired(c, today));
  const result: RecurringBillingsResult = { contracts: contracts.length, extended: 0, created: 0, horizonMonths: settings.horizonteCobrancasMeses, errors: [] };
  if (contracts.length === 0) return result;
  const billings = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "in", contracts.map((c) => c.id)]] });
  for (const c of contracts) {
    const own = billings.filter((b) => b.contractId === c.id);
    if (pendingRecurringInstallments(c, own, { horizonMonths: settings.horizonteCobrancasMeses, today }).length === 0) continue;
    try {
      const r = await generateNextBillings(c.id, SYSTEM_ACTOR, { horizonMonths: settings.horizonteCobrancasMeses, source: "horizonte", reason: `Horizonte de ${settings.horizonteCobrancasMeses} mês(es) da cobrança recorrente` });
      if (r.created.length > 0) {
        result.extended += 1;
        result.created += r.created.length;
      }
    } catch (error) {
      result.errors.push(`${c.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// contratos_alertas
// ---------------------------------------------------------------------------

export interface ContractAlertsResult {
  awaitingSignature: number;
  followupTasks: number;
  paidNotReleased: number;
  releaseTasks: number;
  releasedNotStarted: number;
  implementationNotices: number;
}

/** Cria a tarefa só se ainda não existe uma (não cancelada) com o mesmo título no processo do contrato. */
async function ensureContractTask(existing: Task[], input: Parameters<typeof createTaskInternal>[0]): Promise<boolean> {
  if (existing.some((t) => t.processId === input.processId && t.title === input.title && t.status !== "cancelada")) return false;
  const task = await createTaskInternal(input, SYSTEM_ACTOR);
  existing.push(task);
  return true;
}

export async function contractAlerts(now: Date = new Date()): Promise<ContractAlertsResult> {
  const settings = await getFinanceAlertSettings();
  const contracts = (await list<Contract>(COLLECTIONS.contracts)).filter((c) => c.status === "aguardando_assinatura" || c.status === "pago" || c.status === "liberado");
  const result: ContractAlertsResult = { awaitingSignature: 0, followupTasks: 0, paidNotReleased: 0, releaseTasks: 0, releasedNotStarted: 0, implementationNotices: 0 };
  if (contracts.length === 0) return result;

  const awaiting = contracts.filter((c) => c.status === "aguardando_assinatura");
  const paid = contracts.filter((c) => c.status === "pago");
  const released = contracts.filter((c) => c.status === "liberado");
  const [clients, opps, sentEvents, contractTasks, paidBillings, projects, users] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, contracts.map((c) => c.clientId)),
    getManyByIds<Opportunity>(COLLECTIONS.opportunities, contracts.map((c) => c.opportunityId ?? "")),
    awaiting.length > 0 ? list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "contract.sent_for_signature"]] }) : Promise.resolve([] as DomainEvent[]),
    list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", "contract"]] }),
    paid.length > 0 ? list<Billing>(COLLECTIONS.billing, { where: [["contractId", "in", paid.map((c) => c.id)]] }) : Promise.resolve([] as Billing[]),
    released.length > 0 ? list<ImplementationProject>(COLLECTIONS.implementationProjects, { where: [["status", "==", "aguardando_inicio"]] }) : Promise.resolve([] as ImplementationProject[]),
    list<User>(COLLECTIONS.users),
  ]);
  const activeUser = (id: string | undefined) => (id && users.find((u) => u.id === id && u.active !== false) ? id : undefined);
  const name = (c: Contract) => clients.get(c.clientId)?.tradeName ?? c.number;

  // 1. Aguardando assinatura há mais de N dias → follow-up do vendedor.
  const lastSent = new Map<string, string>();
  for (const e of sentEvents) if (e.entityId && e.occurredAt > (lastSent.get(e.entityId) ?? "")) lastSent.set(e.entityId, e.occurredAt);
  const signatureLimit = new Date(now.getTime() - settings.diasSemAssinatura * DAY_MS).toISOString();
  const salesManager = awaiting.length > 0 ? await getDepartmentManager("vendas") : null;
  for (const c of awaiting) {
    const since = lastSent.get(c.id) ?? c.updatedAt;
    if (since > signatureLimit) continue;
    result.awaitingSignature += 1;
    const sellerId = activeUser(c.sellerId) ?? activeUser(c.opportunityId ? opps.get(c.opportunityId)?.ownerId : undefined) ?? activeUser(clients.get(c.clientId)?.ownerSalesId) ?? salesManager?.id;
    const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
    const pendingSigners = c.signers.filter((s) => s.status !== "assinado").map((s) => s.name);
    const created = await ensureContractTask(contractTasks, {
      title: `Follow-up de assinatura: ${name(c)} (${c.number})`,
      description: `Contrato ${c.number} aguarda assinatura há ${days} dia(s) (documento gerado em ${formatDate(since)}). Pendentes: ${pendingSigners.join(", ") || "—"}. Fale com o cliente e registre o retorno; o Financeiro registra a assinatura com a evidência.`,
      clientId: c.clientId,
      assigneeId: sellerId,
      departmentId: "vendas",
      priority: "alta",
      dueAt: new Date(now.getTime() + 8 * HOUR_MS).toISOString(),
      processType: "contract",
      processId: c.id,
      origin: "automacao",
      tags: ["contrato", "assinatura", "follow-up"],
    });
    if (created) result.followupTasks += 1;
  }

  // 2. Pago e não liberado há mais de N horas → gestor financeiro.
  const paidLimit = new Date(now.getTime() - settings.horasPagoSemLiberacao * HOUR_MS).toISOString();
  const financeManager = paid.length > 0 ? await getDepartmentManager("financeiro") : null;
  for (const c of paid) {
    const paidAt = paidBillings
      .filter((b) => b.contractId === c.id && b.status === "paga")
      .map((b) => b.updatedAt)
      .sort()
      .pop();
    const since = paidAt ?? c.updatedAt;
    if (since > paidLimit) continue;
    result.paidNotReleased += 1;
    const assigneeId = financeManager?.id ?? activeUser(c.ownerId);
    const hours = Math.floor((now.getTime() - new Date(since).getTime()) / HOUR_MS);
    const title = `Liberar contrato pago: ${name(c)} (${c.number})`;
    const created = await ensureContractTask(contractTasks, {
      title,
      description: `Pagamento exigido registrado em ${formatDateTime(since)} (há ${hours}h) e o contrato ainda não foi liberado para a implantação. Confira o gate e libere.`,
      clientId: c.clientId,
      assigneeId,
      departmentId: "financeiro",
      priority: "alta",
      dueAt: new Date(now.getTime() + 4 * HOUR_MS).toISOString(),
      processType: "contract",
      processId: c.id,
      origin: "automacao",
      tags: ["contrato", "liberacao"],
    });
    if (created) {
      result.releaseTasks += 1;
      if (assigneeId) {
        await notify({ userIds: [assigneeId], kind: "atencao", title: `Contrato pago sem liberação: ${name(c)}`, body: `${c.number} · pago há ${hours}h`, href: `/financeiro/contratos/${c.id}`, entity: { type: "contract", id: c.id } });
      }
    }
  }

  // 3. Liberado com implantação ainda não iniciada há mais de N dias → responsável e gestor de implantação.
  const startLimit = new Date(now.getTime() - settings.diasLiberadoSemInicio * DAY_MS).toISOString();
  const byContract = new Map(projects.filter((p) => p.contractId).map((p) => [p.contractId!, p]));
  const implManager = released.length > 0 ? await getDepartmentManager("implantacao") : null;
  const prefix = "Implantação não iniciada";
  for (const c of released) {
    const project = byContract.get(c.id);
    if (!project) continue;
    const since = c.releasedAt ?? project.createdAt;
    if (since > startLimit) continue;
    result.releasedNotStarted += 1;
    const already = await list<Notification>(COLLECTIONS.notifications, { where: [["entityId", "==", project.id]] });
    const targets = [activeUser(project.ownerId), implManager?.id].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i && !already.some((n) => n.userId === id && n.title.startsWith(prefix)));
    if (targets.length === 0) continue;
    const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
    await notify({
      userIds: targets,
      kind: "atencao",
      title: `${prefix}: ${name(c)}`,
      body: `Contrato ${c.number} liberado em ${formatDate(since)} (há ${days} dia(s)) e o projeto segue aguardando início. Agende o kickoff.`,
      href: `/implantacao/${project.id}`,
      entity: { type: "project", id: project.id },
    });
    result.implementationNotices += targets.length;
  }
  return result;
}

