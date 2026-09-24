import "server-only";
/**
 * Serviço de Vendas: regras de negócio SEM validação de sessão. Usado pelas Server Actions (que
 * validam sessão e entrada), pelos handlers de evento (opportunity.won, proposal.accepted) e pela
 * varredura de follow-up.
 *
 * Toda mutação relevante emite evento (timeline, notificações, KPIs). Erros de regra são lançados
 * como Error com mensagem em português (as actions devolvem a mensagem ao usuário).
 */
import { FieldValue } from "firebase-admin/firestore";
import { col, create, getById, getManyByIds, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerSalesHandlers } from "@/server/events/handlers/sales";
import { notify } from "@/server/notifications";
import { addBusinessHours, getHolidays } from "@/server/sla";
import { createTaskInternal } from "@/server/tasks/service";
import { getDepartmentManager } from "@/server/workflow/service";
import { dateKey, formatCurrency, formatDateTime } from "@/lib/format";
import {
  COLLECTIONS,
  type Address,
  type Client,
  type ClientProduct,
  type CollectionName,
  type Contact,
  type Contract,
  type DomainEvent,
  type Lead,
  type Opportunity,
  type OpportunityProduct,
  type Proposal,
  type ProposalItem,
  type Settings,
  type Task,
  type User,
  type UserRef,
  type Visit,
} from "@/domain/types";
import { CLIENT_STATUS_LABELS, type Priority } from "@/domain/constants";
import { VISIT_KIND_LABELS, type VisitKind, type VisitRecord } from "@/domain/sales-extra";
import { MANUAL, recordCommunication } from "@/server/integrations/communications";
import { OPPORTUNITY_STAGE_LABELS, effectiveProposalStatus, netItem, productTotals, proposalTotals } from "@/components/sales/model";
import { calculateCommissionsForOpportunity, SYSTEM_ACTOR } from "./commissions";
import { geocode } from "./maps";
import { LOSS_REASON_LABELS, OPEN_STAGES, STAGE_PROBABILITY, type LossReason, type OpenStage, type ProposalTransition } from "./schemas";

// Registro idempotente dos handlers de Vendas (ver src/server/events/handlers/sales.ts).
registerSalesHandlers(registerHandler);

export { SYSTEM_ACTOR };

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const OPEN_TASK_STATUS = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

export async function loadOpportunity(id: string): Promise<Opportunity> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, id);
  if (!opp) throw new Error("Oportunidade não encontrada");
  return opp;
}

async function loadClientOf(opp: Pick<Opportunity, "clientId">): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, opp.clientId);
  if (!client) throw new Error("Cliente da oportunidade não encontrado");
  return client;
}

export function isClosed(opp: Pick<Opportunity, "stage">): boolean {
  return opp.stage === "ganho" || opp.stage === "perdido";
}

function stageIndex(stage: Opportunity["stage"]): number {
  return (OPEN_STAGES as readonly string[]).indexOf(stage);
}

/** Remove campos do documento (o `update` de db.ts ignora `undefined`). */
async function clearFields(name: CollectionName, id: string, fields: string[]): Promise<void> {
  if (fields.length === 0) return;
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const f of fields) patch[f] = FieldValue.delete();
  await col(name).doc(id).update(patch);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeLines(lines: OpportunityProduct[]): OpportunityProduct[] {
  return lines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    quantity: l.quantity,
    setupValue: round2(l.setupValue),
    monthlyValue: round2(l.monthlyValue),
    hardwareValue: round2(l.hardwareValue),
  }));
}

/** Próximo número sequencial "<PREFIXO>-AAAA-NNNN" no ano corrente (fuso da operação). */
async function nextSequence(name: CollectionName, prefix: string): Promise<string> {
  const year = dateKey(new Date()).slice(0, 4);
  const docs = await list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; number?: string }>(name);
  const head = `${prefix}-${year}-`;
  let max = 0;
  for (const d of docs) {
    if (!d.number?.startsWith(head)) continue;
    const seq = Number(d.number.slice(head.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${head}${String(max + 1).padStart(4, "0")}`;
}

/** Grava (cria ou substitui o valor de) uma configuração em `settings` com id determinístico. */
async function saveSetting(key: string, value: Record<string, unknown>, description: string): Promise<void> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  if (docs[0]) {
    await col(COLLECTIONS.settings).doc(docs[0].id).update({ value, updatedAt: nowIso() });
    return;
  }
  await create<Settings>(COLLECTIONS.settings, { key, value, description }, `setting_${key}`);
}

async function readSetting<T extends Record<string, unknown>>(key: string): Promise<T | null> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  return (docs[0]?.value as T | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Configurações do módulo
// ---------------------------------------------------------------------------

export interface OpportunitySettings {
  diasSemMovimentoParaParada: number;
  horasSemInteracaoFollowup: number;
}

export async function getOpportunitySettings(): Promise<OpportunitySettings> {
  const value = await readSetting<Partial<OpportunitySettings>>("oportunidade");
  return {
    diasSemMovimentoParaParada: Number(value?.diasSemMovimentoParaParada) || 7,
    horasSemInteracaoFollowup: Number(value?.horasSemInteracaoFollowup) || 48,
  };
}

export interface PipelineStage {
  key: OpenStage;
  label: string;
}

export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = OPEN_STAGES.map((key) => ({ key, label: OPPORTUNITY_STAGE_LABELS[key] }));

/**
 * Colunas do pipeline lidas do setting "pipeline_stages" ({ stages: [{ key, label }] }). Na primeira
 * leitura o setting é criado com as etapas padrão, para o admin editar rótulos e ordem em
 * /admin/configuracoes. Chaves desconhecidas são ignoradas (o tipo OpportunityStage é fixo).
 */
export async function getPipelineStages(): Promise<PipelineStage[]> {
  const value = await readSetting<{ stages?: { key?: string; label?: string }[] }>("pipeline_stages");
  if (!value) {
    await saveSetting("pipeline_stages", { stages: DEFAULT_PIPELINE_STAGES }, "Colunas do pipeline de vendas (ordem e rótulos). Chaves válidas: qualificacao, diagnostico, proposta, negociacao, fechamento.");
    return DEFAULT_PIPELINE_STAGES;
  }
  const seen = new Set<string>();
  const stages: PipelineStage[] = [];
  for (const s of value.stages ?? []) {
    if (!s.key || !(OPEN_STAGES as readonly string[]).includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    stages.push({ key: s.key as OpenStage, label: s.label?.trim() || OPPORTUNITY_STAGE_LABELS[s.key as OpenStage] });
  }
  return stages.length > 0 ? stages : DEFAULT_PIPELINE_STAGES;
}

// ---------------------------------------------------------------------------
// Oportunidade: criação, etapa, edição, próxima ação, contato
// ---------------------------------------------------------------------------

export interface CreateOpportunityData {
  clientId: string;
  title: string;
  kind: Opportunity["kind"];
  ownerId: string;
  temperature: Opportunity["temperature"];
  products: OpportunityProduct[];
  need?: string;
  nextAction: string;
  nextActionAt: string;
}

export async function createOpportunity(data: CreateOpportunityData, actor: UserRef & { departmentId?: User["departmentId"] }): Promise<Opportunity> {
  const client = await getById<Client>(COLLECTIONS.clients, data.clientId);
  if (!client) throw new Error("Cliente não encontrado");
  const owner = await getById<User>(COLLECTIONS.users, data.ownerId);
  if (!owner || owner.active === false) throw new Error("Vendedor não encontrado ou inativo");
  const products = normalizeLines(data.products);
  const now = nowIso();
  const opp = await create<Opportunity>(COLLECTIONS.opportunities, {
    clientId: client.id,
    leadId: client.leadId,
    title: data.title,
    stage: "qualificacao",
    stageChangedAt: now,
    ownerId: owner.id,
    temperature: data.temperature,
    probability: STAGE_PROBABILITY.qualificacao,
    products,
    ...productTotals(products),
    need: data.need,
    nextAction: data.nextAction,
    nextActionAt: data.nextActionAt,
    lastActivityAt: now,
    originDepartment: actor.departmentId,
    originUserId: actor.id,
    kind: data.kind,
    createdBy: actor.id,
  });
  if (!client.ownerSalesId) await update<Client>(COLLECTIONS.clients, client.id, { ownerSalesId: owner.id });
  await emitEvent({
    type: "opportunity.created",
    actor,
    clientId: client.id,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade criada: ${opp.title}`,
    description: [`Vendedor: ${owner.name}`, opp.monthlyTotal > 0 ? `${formatCurrency(opp.monthlyTotal)}/mês` : null, opp.setupTotal > 0 ? `adesão ${formatCurrency(opp.setupTotal)}` : null].filter(Boolean).join(" · "),
    department: "vendas",
    payload: { ownerId: owner.id, kind: opp.kind, monthlyTotal: opp.monthlyTotal, setupTotal: opp.setupTotal },
  });
  return opp;
}

/** Move a oportunidade entre etapas abertas (kanban). */
export async function changeStage(opportunityId: string, stage: OpenStage, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(opportunityId);
  if (isClosed(opp)) throw new Error("Oportunidade encerrada: reabra antes de mover de etapa");
  if (opp.stage === stage) return opp;
  const now = nowIso();
  const patch: Partial<Opportunity> = { stage, stageChangedAt: now, lastActivityAt: now, probability: STAGE_PROBABILITY[stage] };
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, patch);
  await emitEvent({
    type: "opportunity.stage_changed",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade em ${OPPORTUNITY_STAGE_LABELS[stage]}: ${opp.title}`,
    description: `${OPPORTUNITY_STAGE_LABELS[opp.stage]} → ${OPPORTUNITY_STAGE_LABELS[stage]}`,
    department: "vendas",
    payload: { from: opp.stage, to: stage, ownerId: opp.ownerId },
  });
  return { ...opp, ...patch };
}

/** Avança a etapa somente se a oportunidade estiver antes dela (usado por propostas). */
async function advanceStageTo(opp: Opportunity, stage: OpenStage, actor: UserRef): Promise<void> {
  if (isClosed(opp) || stageIndex(opp.stage) >= stageIndex(stage)) return;
  await changeStage(opp.id, stage, actor);
}

export interface UpdateOpportunityData {
  opportunityId: string;
  diagnosis?: string;
  need?: string;
  objections?: string;
  temperature: Opportunity["temperature"];
  probability: number;
  products: OpportunityProduct[];
  billingData: { legalName?: string; document?: string; email?: string; paymentCondition?: string };
  nextAction?: string;
  nextActionAt?: string;
  noNextAction: boolean;
}

/** Salva o resumo (diagnóstico, produtos, faturamento, próxima ação). Totais sempre recalculados. */
export async function updateOpportunityData(data: UpdateOpportunityData, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(data.opportunityId);
  if (isClosed(opp)) throw new Error("Oportunidade encerrada: reabra para editar");
  const products = normalizeLines(data.products);
  const now = nowIso();
  const patch: Partial<Opportunity> = {
    diagnosis: data.diagnosis,
    need: data.need,
    objections: data.objections,
    temperature: data.temperature,
    probability: data.probability,
    products,
    ...productTotals(products),
    billingData: { ...(opp.billingData ?? {}), ...data.billingData },
    lastActivityAt: now,
  };
  const clear: string[] = [];
  for (const key of ["diagnosis", "need", "objections"] as const) if (!data[key] && opp[key]) clear.push(key);
  if (data.noNextAction) {
    clear.push("nextAction", "nextActionAt");
  } else {
    patch.nextAction = data.nextAction;
    patch.nextActionAt = data.nextActionAt ? new Date(data.nextActionAt).toISOString() : undefined;
  }
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, patch);
  await clearFields(COLLECTIONS.opportunities, opp.id, clear);

  if (!data.noNextAction && patch.nextActionAt && (patch.nextActionAt !== opp.nextActionAt || patch.nextAction !== opp.nextAction)) {
    await emitEvent({
      type: "opportunity.followup_scheduled",
      actor,
      clientId: opp.clientId,
      entity: { type: "opportunity", id: opp.id },
      title: `Próxima ação: ${patch.nextAction}`,
      description: `${opp.title} · ${formatDateTime(patch.nextActionAt)}`,
      department: "vendas",
      payload: { ownerId: opp.ownerId, nextActionAt: patch.nextActionAt, nextAction: patch.nextAction },
    });
  }
  return { ...opp, ...patch };
}

export async function scheduleNextAction(opportunityId: string, nextAction: string, nextActionAt: string, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(opportunityId);
  if (isClosed(opp)) throw new Error("Oportunidade encerrada");
  const at = new Date(nextActionAt).toISOString();
  const patch: Partial<Opportunity> = { nextAction, nextActionAt: at, lastActivityAt: nowIso() };
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, patch);
  await emitEvent({
    type: "opportunity.followup_scheduled",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Próxima ação: ${nextAction}`,
    description: `${opp.title} · ${formatDateTime(at)}`,
    department: "vendas",
    payload: { ownerId: opp.ownerId, nextActionAt: at, nextAction },
  });
  return { ...opp, ...patch };
}

/** Registra contato (WhatsApp, ligação ou nota) na oportunidade e na timeline do cliente. */
export async function registerOpportunityContact(
  input: { opportunityId: string; channel: "whatsapp" | "ligacao" | "nota"; outcome?: "atendeu" | "nao_atendeu" | "mensagem_enviada"; notes?: string },
  actor: UserRef,
): Promise<DomainEvent> {
  const opp = await loadOpportunity(input.opportunityId);
  const contacts = await list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", opp.clientId]] });
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const client = await loadClientOf(opp);
  const who = primary?.name ?? client.tradeName;

  // Sem integração conectada: o contato feito pelo app/discador do usuário fica como registro manual.
  const communication =
    input.channel !== "nota"
      ? await recordCommunication({
          clientId: opp.clientId,
          contactId: primary?.id,
          channel: input.channel === "ligacao" ? "voip" : "whatsapp",
          direction: "saida",
          userId: actor.id,
          entityType: "opportunity",
          entityId: opp.id,
          body: input.notes,
          createdBy: actor.id,
          ...MANUAL,
        })
      : null;
  const outcome = input.outcome === "nao_atendeu" ? "não atendeu" : input.outcome === "mensagem_enviada" ? "mensagem enviada" : input.outcome === "atendeu" ? "atendeu" : null;
  const event = await emitEvent({
    type: input.channel === "ligacao" ? "call.completed" : input.channel === "whatsapp" ? "whatsapp.message.sent" : "note.added",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title:
      input.channel === "ligacao"
        ? `Ligação para ${who}${outcome ? ` (${outcome})` : ""}`
        : input.channel === "whatsapp"
          ? `WhatsApp para ${who}`
          : `Nota na oportunidade: ${opp.title}`,
    description: input.notes,
    department: "vendas",
    payload: { opportunityId: opp.id, channel: input.channel, outcome: input.outcome, contactId: primary?.id, communicationId: communication?.id, manual: input.channel !== "nota" },
  });
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { lastActivityAt: event.occurredAt });
  return event;
}

export async function createOpportunityTask(input: { opportunityId: string; title: string; dueAt: string; priority: Priority }, actor: UserRef): Promise<Task> {
  const opp = await loadOpportunity(input.opportunityId);
  const task = await createTaskInternal(
    {
      title: input.title,
      clientId: opp.clientId,
      assigneeId: opp.ownerId,
      departmentId: "vendas",
      priority: input.priority,
      dueAt: new Date(input.dueAt).toISOString(),
      processType: "opportunity",
      processId: opp.id,
      origin: "manual",
    },
    actor,
  );
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { lastActivityAt: nowIso() });
  return task;
}

// ---------------------------------------------------------------------------
// Ganho, perda e reabertura
// ---------------------------------------------------------------------------

export interface MarkWonData {
  opportunityId: string;
  products: OpportunityProduct[];
  billingData: { legalName: string; document: string; email: string; paymentCondition: string };
}

/**
 * Marca como ganha e emite opportunity.won. Os handlers fazem o resto: workflow avança a etapa
 * Vendas; o handler de vendas cria contrato, client_products, tarefa do financeiro e comissões.
 */
export async function markOpportunityWon(data: MarkWonData, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(data.opportunityId);
  if (opp.stage === "ganho") throw new Error("Oportunidade já está ganha");
  if (opp.stage === "perdido") throw new Error("Oportunidade perdida: reabra antes de marcar como ganha");
  const products = normalizeLines(data.products);
  const totals = productTotals(products);
  if (totals.setupTotal + totals.monthlyTotal + totals.hardwareTotal <= 0) throw new Error("Informe os valores dos produtos (adesão, mensalidade ou hardware)");
  const client = await loadClientOf(opp);
  const now = nowIso();
  const patch: Partial<Opportunity> = {
    products,
    ...totals,
    billingData: { ...(opp.billingData ?? {}), ...data.billingData, address: opp.billingData?.address ?? client.address },
    stage: "ganho",
    stageChangedAt: now,
    wonAt: now,
    probability: 100,
    lastActivityAt: now,
  };
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, patch);
  await clearFields(COLLECTIONS.opportunities, opp.id, ["nextAction", "nextActionAt", "lostAt", "lossReason", "lossCompetitor", "lossNotes"]);

  await emitEvent({
    type: "opportunity.won",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Negócio ganho: ${opp.title}`,
    description: [totals.monthlyTotal > 0 ? `${formatCurrency(totals.monthlyTotal)}/mês` : null, totals.setupTotal > 0 ? `adesão ${formatCurrency(totals.setupTotal)}` : null, totals.hardwareTotal > 0 ? `hardware ${formatCurrency(totals.hardwareTotal)}` : null]
      .filter(Boolean)
      .join(" · "),
    department: "vendas",
    payload: { ownerId: opp.ownerId, ...totals, productIds: products.map((p) => p.productId), proposalId: opp.proposalId, paymentCondition: data.billingData.paymentCondition },
  });
  return loadOpportunity(opp.id);
}

export interface MarkLostData {
  opportunityId: string;
  reason: LossReason;
  competitor?: string;
  notes?: string;
}

export async function markOpportunityLost(data: MarkLostData, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(data.opportunityId);
  if (opp.stage === "ganho") throw new Error("Oportunidade ganha não pode ser marcada como perdida");
  if (opp.stage === "perdido") throw new Error("Oportunidade já está perdida");
  const now = nowIso();
  const patch: Partial<Opportunity> = {
    stage: "perdido",
    stageChangedAt: now,
    lostAt: now,
    lossReason: data.reason,
    lossCompetitor: data.reason === "concorrente" ? data.competitor : undefined,
    lossNotes: data.notes,
    probability: 0,
    lastActivityAt: now,
  };
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, patch);
  await clearFields(COLLECTIONS.opportunities, opp.id, ["nextAction", "nextActionAt", ...(data.reason !== "concorrente" ? ["lossCompetitor"] : []), ...(data.notes ? [] : ["lossNotes"])]);
  const reasonText = `${LOSS_REASON_LABELS[data.reason]}${data.reason === "concorrente" && data.competitor ? ` (${data.competitor})` : ""}`;

  await emitEvent({
    type: "opportunity.lost",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade perdida: ${opp.title}`,
    description: [reasonText, data.notes].filter(Boolean).join(" · "),
    department: "vendas",
    payload: { ownerId: opp.ownerId, reason: data.reason, competitor: data.competitor, leadId: opp.leadId, monthlyTotal: opp.monthlyTotal },
  });

  // Devolve o motivo ao Marketing no lead de origem (qualidade do lead / campanha).
  if (opp.leadId) {
    const lead = await getById<Lead>(COLLECTIONS.leads, opp.leadId);
    if (lead) {
      await update<Lead>(COLLECTIONS.leads, lead.id, { disqualificationReason: `Venda perdida: ${reasonText}${data.notes ? ` — ${data.notes}` : ""}` });
      await emitEvent({
        type: "lead.updated",
        actor,
        clientId: opp.clientId,
        entity: { type: "lead", id: lead.id },
        title: `Lead ${lead.name}: venda perdida (${LOSS_REASON_LABELS[data.reason]})`,
        department: "marketing",
        payload: { lossReason: data.reason, competitor: data.competitor, opportunityId: opp.id, ownerId: lead.ownerId },
        timeline: false,
      });
    }
  }
  return { ...opp, ...patch };
}

/** Reabre uma oportunidade perdida (volta para negociação quando havia proposta, senão qualificação). */
export async function reopenOpportunity(opportunityId: string, actor: UserRef): Promise<Opportunity> {
  const opp = await loadOpportunity(opportunityId);
  if (opp.stage === "ganho") throw new Error("Oportunidade ganha já gerou contrato e não pode ser reaberta");
  if (opp.stage !== "perdido") return opp;
  const stage: OpenStage = opp.proposalId ? "negociacao" : "qualificacao";
  const now = nowIso();
  const patch: Partial<Opportunity> = { stage, stageChangedAt: now, lastActivityAt: now, probability: STAGE_PROBABILITY[stage] };
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, patch);
  await clearFields(COLLECTIONS.opportunities, opp.id, ["lostAt", "lossReason", "lossCompetitor", "lossNotes"]);
  await emitEvent({
    type: "opportunity.stage_changed",
    actor,
    clientId: opp.clientId,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade reaberta: ${opp.title}`,
    description: `Perdido → ${OPPORTUNITY_STAGE_LABELS[stage]}${opp.lossReason ? ` · motivo anterior: ${LOSS_REASON_LABELS[opp.lossReason as LossReason] ?? opp.lossReason}` : ""}`,
    department: "vendas",
    payload: { from: "perdido", to: stage, ownerId: opp.ownerId, reopened: true },
  });
  return { ...opp, ...patch, lostAt: undefined, lossReason: undefined, lossCompetitor: undefined, lossNotes: undefined };
}

// ---------------------------------------------------------------------------
// Pós-venda (handler de opportunity.won)
// ---------------------------------------------------------------------------

export interface WonProcessingResult {
  contract: Contract;
  clientProducts: ClientProduct[];
  taskId?: string;
  commissionIds: string[];
}

/**
 * Efeitos de uma venda ganha (idempotente):
 * 1. cliente lead → prospect (nunca ativo aqui: ativação é do gate de implantação);
 * 2. contrato inicial (aguardando_contrato, CT-AAAA-NNNN) + contract.created;
 * 3. client_products em implantação;
 * 4. tarefa para o financeiro;
 * 5. comissões previstas (commission.calculated);
 * 6. notificação ao gestor de vendas e ao financeiro.
 */
export async function processWonOpportunity(opportunityId: string, actor: UserRef, sourceEventId?: string): Promise<WonProcessingResult | null> {
  const opp = await getById<Opportunity>(COLLECTIONS.opportunities, opportunityId);
  if (!opp || opp.stage !== "ganho") return null;
  const client = await loadClientOf(opp);

  // 1. Status do cliente.
  const clientPatch: Partial<Client> = {};
  if (client.status === "lead") clientPatch.status = "prospect";
  if (!client.ownerSalesId) clientPatch.ownerSalesId = opp.ownerId;
  if (Object.keys(clientPatch).length > 0) await update<Client>(COLLECTIONS.clients, client.id, clientPatch);
  if (clientPatch.status) {
    await emitEvent({
      type: "client.status_changed",
      actor,
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Status do cliente: ${CLIENT_STATUS_LABELS[client.status]} → ${CLIENT_STATUS_LABELS[clientPatch.status!]}`,
      description: "Negócio ganho em Vendas",
      department: "vendas",
      payload: { from: client.status, to: clientPatch.status, opportunityId: opp.id },
    });
  }

  // 2. Contrato inicial.
  const financeManager = await getDepartmentManager("financeiro");
  const salesManager = await getDepartmentManager("vendas");
  // Caminho único de criação do contrato: o serviço do Financeiro (idempotente; usa os itens da
  // proposta aceita, com desconto, quando houver). Import dinâmico para evitar ciclo de módulos.
  const { ensureContractForOpportunity } = await import("@/server/finance/service");
  const contract = await ensureContractForOpportunity(opp.id, actor);
  if (!contract) return null;

  // 3. Produtos do cliente em implantação.
  let clientProducts = await list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["contractId", "==", contract.id]] });
  if (clientProducts.length === 0) {
    clientProducts = [];
    for (const line of opp.products) {
      clientProducts.push(
        await create<ClientProduct>(COLLECTIONS.clientProducts, {
          clientId: client.id,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          setupValue: line.setupValue,
          monthlyValue: line.monthlyValue,
          hardwareValue: line.hardwareValue,
          status: "em_implantacao",
          contractId: contract.id,
          createdBy: actor.id,
        }),
      );
    }
  }

  // 4. Tarefa para o financeiro (uma por contrato).
  const existingTasks = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", contract.id]] });
  let taskId = existingTasks.find((t) => t.processType === "contract" && t.origin === "evento")?.id;
  if (!taskId) {
    const holidays = await getHolidays();
    const task = await createTaskInternal(
      {
        title: `Emitir contrato e cobrança: ${client.tradeName}`,
        description: `Venda ganha por ${actor.name}. Contrato ${contract.number} aguardando geração, assinatura e confirmação de pagamento.${opp.billingData?.paymentCondition ? ` Condição: ${opp.billingData.paymentCondition}.` : ""}`,
        clientId: client.id,
        assigneeId: financeManager?.id,
        departmentId: "financeiro",
        priority: "alta",
        dueAt: addBusinessHours(new Date(), 8, holidays).toISOString(),
        processType: "contract",
        processId: contract.id,
        origin: "evento",
        sourceEventId,
        checklist: ["Conferir dados de faturamento", "Gerar contrato e enviar para assinatura", "Emitir cobrança da adesão"],
      },
      actor,
    );
    taskId = task.id;
  }

  // 5. Comissões previstas.
  const commissions = await calculateCommissionsForOpportunity({ ...opp, contractId: contract.id }, contract, actor);

  // 6. Notificações (só na primeira execução: quando a tarefa acabou de ser criada).
  if (!existingTasks.some((t) => t.id === taskId)) {
    const owner = await getById<User>(COLLECTIONS.users, opp.ownerId);
    const targets = [salesManager?.id, owner?.managerId, financeManager?.id].filter((id): id is string => Boolean(id) && id !== actor.id);
    await notify({
      userIds: targets,
      kind: "acao",
      title: `Venda ganha: ${client.tradeName}`,
      body: `${opp.title} · ${formatCurrency(opp.monthlyTotal)}/mês · contrato ${contract.number} aguardando o financeiro`,
      href: `/clientes/${client.id}?aba=financeiro`,
      entity: { type: "contract", id: contract.id },
      eventId: sourceEventId,
    });
  }

  return { contract, clientProducts, taskId, commissionIds: commissions.map((c) => c.id) };
}

export async function notifyProposalAccepted(event: DomainEvent): Promise<void> {
  const proposal = event.entityId ? await getById<Proposal>(COLLECTIONS.proposals, event.entityId) : null;
  if (!proposal) return;
  const [client, salesManager] = await Promise.all([getById<Client>(COLLECTIONS.clients, proposal.clientId), getDepartmentManager("vendas")]);
  const targets = [proposal.ownerId, salesManager?.id].filter((id): id is string => Boolean(id) && id !== event.actorId);
  await notify({
    userIds: targets,
    kind: "acao",
    title: `Proposta ${proposal.number} aceita${client ? ` — ${client.tradeName}` : ""}`,
    body: "Marque a oportunidade como ganha para gerar o contrato e acionar o financeiro.",
    href: `/vendas/oportunidades?oportunidade=${proposal.opportunityId}`,
    entity: { type: "proposal", id: proposal.id },
    eventId: event.id,
  });
}

// ---------------------------------------------------------------------------
// Propostas
// ---------------------------------------------------------------------------

export interface SaveProposalData {
  proposalId?: string;
  opportunityId: string;
  items: ProposalItem[];
  conditions?: string;
  validUntil: string;
  notes?: string;
}

export async function saveProposal(data: SaveProposalData, actor: UserRef): Promise<Proposal> {
  const opp = await loadOpportunity(data.opportunityId);
  if (isClosed(opp)) throw new Error("Oportunidade encerrada: não é possível editar propostas");
  const items: ProposalItem[] = data.items.map((i) => ({ ...normalizeLines([i])[0], discountPct: Math.round(i.discountPct * 100) / 100 }));
  const totals = proposalTotals(items);
  const validUntil = new Date(data.validUntil).toISOString();

  if (data.proposalId) {
    const current = await getById<Proposal>(COLLECTIONS.proposals, data.proposalId);
    if (!current) throw new Error("Proposta não encontrada");
    if (current.status !== "rascunho") throw new Error("Só rascunhos podem ser editados; gere uma nova versão");
    const patch: Partial<Proposal> = { items, ...totals, conditions: data.conditions, validUntil, notes: data.notes };
    await update<Proposal>(COLLECTIONS.proposals, current.id, patch);
    const clear = (["conditions", "notes"] as const).filter((k) => !data[k] && current[k]);
    await clearFields(COLLECTIONS.proposals, current.id, [...clear]);
    return { ...current, ...patch };
  }

  const proposal = await create<Proposal>(COLLECTIONS.proposals, {
    clientId: opp.clientId,
    opportunityId: opp.id,
    number: await nextSequence(COLLECTIONS.proposals, "PR"),
    version: 1,
    status: "rascunho",
    items,
    ...totals,
    conditions: data.conditions,
    validUntil,
    notes: data.notes,
    ownerId: opp.ownerId,
    createdBy: actor.id,
  });
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { proposalId: proposal.id, lastActivityAt: nowIso() });
  await emitEvent({
    type: "proposal.created",
    actor,
    clientId: opp.clientId,
    entity: { type: "proposal", id: proposal.id },
    title: `Proposta ${proposal.number} criada (rascunho)`,
    description: [totals.monthlyTotal > 0 ? `${formatCurrency(totals.monthlyTotal)}/mês` : null, totals.setupTotal > 0 ? `adesão ${formatCurrency(totals.setupTotal)}` : null].filter(Boolean).join(" · ") || undefined,
    department: "vendas",
    payload: { opportunityId: opp.id, version: 1, ...totals },
  });
  return proposal;
}

/** Duplica a proposta como nova versão (rascunho, version + 1, validade de 15 dias). */
export async function newProposalVersion(proposalId: string, actor: UserRef): Promise<Proposal> {
  const source = await getById<Proposal>(COLLECTIONS.proposals, proposalId);
  if (!source) throw new Error("Proposta não encontrada");
  const opp = await loadOpportunity(source.opportunityId);
  if (isClosed(opp)) throw new Error("Oportunidade encerrada: não é possível gerar nova versão");
  const siblings = await list<Proposal>(COLLECTIONS.proposals, { where: [["number", "==", source.number]] });
  const version = Math.max(...siblings.map((p) => p.version), source.version) + 1;
  const proposal = await create<Proposal>(COLLECTIONS.proposals, {
    clientId: source.clientId,
    opportunityId: source.opportunityId,
    number: source.number,
    version,
    status: "rascunho",
    items: source.items,
    setupTotal: source.setupTotal,
    monthlyTotal: source.monthlyTotal,
    hardwareTotal: source.hardwareTotal,
    discountTotal: source.discountTotal,
    conditions: source.conditions,
    validUntil: new Date(Date.now() + 15 * 86_400_000).toISOString(),
    notes: source.notes,
    ownerId: source.ownerId,
    createdBy: actor.id,
  });
  await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { proposalId: proposal.id, lastActivityAt: nowIso() });
  await emitEvent({
    type: "proposal.created",
    actor,
    clientId: source.clientId,
    entity: { type: "proposal", id: proposal.id },
    title: `Proposta ${proposal.number} v${version} criada a partir da v${source.version}`,
    department: "vendas",
    payload: { opportunityId: source.opportunityId, version, previousProposalId: source.id },
  });
  return proposal;
}

const TRANSITION_FROM: Record<ProposalTransition, Proposal["status"][]> = {
  enviar: ["rascunho"],
  visualizada: ["enviada"],
  negociacao: ["enviada", "visualizada"],
  aceitar: ["enviada", "visualizada", "negociacao"],
  recusar: ["enviada", "visualizada", "negociacao"],
};

/**
 * Transições da proposta: rascunho → enviada → visualizada → negociação → aceita/recusada.
 * Proposta vencida (validade passada) não aceita transições: gere nova versão.
 */
export async function transitionProposal(proposalId: string, transition: ProposalTransition, actor: UserRef, reason?: string): Promise<Proposal> {
  const proposal = await getById<Proposal>(COLLECTIONS.proposals, proposalId);
  if (!proposal) throw new Error("Proposta não encontrada");
  const opp = await loadOpportunity(proposal.opportunityId);
  const status = effectiveProposalStatus(proposal, dateKey(new Date()));
  if (status === "vencida") throw new Error("Proposta vencida: gere uma nova versão com nova validade");
  if (!TRANSITION_FROM[transition].includes(proposal.status)) throw new Error("Transição não permitida para o status atual da proposta");
  if (isClosed(opp) && transition !== "recusar") throw new Error("Oportunidade encerrada");

  const now = nowIso();
  const base = { actor, clientId: proposal.clientId, entity: { type: "proposal", id: proposal.id }, department: "vendas" as const };
  const summary = [proposal.monthlyTotal > 0 ? `${formatCurrency(proposal.monthlyTotal)}/mês` : null, proposal.setupTotal > 0 ? `adesão ${formatCurrency(proposal.setupTotal)}` : null].filter(Boolean).join(" · ");
  let patch: Partial<Proposal> = {};

  switch (transition) {
    case "enviar":
      patch = { status: "enviada", sentAt: now };
      await update<Proposal>(COLLECTIONS.proposals, proposal.id, patch);
      await emitEvent({ ...base, type: "proposal.sent", title: `Proposta ${proposal.number} v${proposal.version} enviada`, description: summary || undefined, payload: { opportunityId: opp.id, ownerId: proposal.ownerId, validUntil: proposal.validUntil } });
      await advanceStageTo(opp, "proposta", actor);
      break;
    case "visualizada":
      patch = { status: "visualizada", viewedAt: now };
      await update<Proposal>(COLLECTIONS.proposals, proposal.id, patch);
      await emitEvent({ ...base, type: "proposal.viewed", title: `Proposta ${proposal.number} visualizada pelo cliente`, payload: { opportunityId: opp.id, ownerId: proposal.ownerId } });
      break;
    case "negociacao":
      patch = { status: "negociacao" };
      await update<Proposal>(COLLECTIONS.proposals, proposal.id, patch);
      await emitEvent({ ...base, type: "note.added", title: `Proposta ${proposal.number} em negociação`, description: reason, payload: { opportunityId: opp.id, proposalStatus: "negociacao" } });
      await advanceStageTo(opp, "negociacao", actor);
      break;
    case "aceitar": {
      patch = { status: "aceita", acceptedAt: now };
      await update<Proposal>(COLLECTIONS.proposals, proposal.id, patch);
      // Itens aceitos (com desconto aplicado) passam a ser os produtos da oportunidade.
      const products: OpportunityProduct[] = proposal.items.map((i) => {
        const net = netItem(i);
        return { productId: i.productId, productName: i.productName, quantity: i.quantity, setupValue: net.setupTotal, monthlyValue: net.monthlyTotal, hardwareValue: net.hardwareTotal };
      });
      await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { products, ...productTotals(products), proposalId: proposal.id, lastActivityAt: now });
      await emitEvent({ ...base, type: "proposal.accepted", title: `Proposta ${proposal.number} v${proposal.version} aceita`, description: summary || undefined, payload: { opportunityId: opp.id, ownerId: proposal.ownerId } });
      await advanceStageTo({ ...opp, products }, "fechamento", actor);
      break;
    }
    case "recusar":
      patch = { status: "recusada", rejectedAt: now, notes: [proposal.notes, `Motivo da recusa: ${reason}`].filter(Boolean).join("\n") };
      await update<Proposal>(COLLECTIONS.proposals, proposal.id, patch);
      await emitEvent({ ...base, type: "proposal.rejected", title: `Proposta ${proposal.number} recusada`, description: reason, payload: { opportunityId: opp.id, ownerId: proposal.ownerId, reason } });
      break;
  }
  if (transition !== "aceitar") await update<Opportunity>(COLLECTIONS.opportunities, opp.id, { lastActivityAt: now });
  return { ...proposal, ...patch };
}

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

export interface CreateVisitData {
  clientId: string;
  opportunityId?: string;
  sellerId: string;
  scheduledAt: string;
  durationMinutes: number;
  objective: string;
  notes?: string;
  address: Address;
  /** Comercial (padrão) ou técnica. */
  kind?: VisitKind;
}

export async function createVisit(data: CreateVisitData, actor: UserRef): Promise<Visit> {
  const client = await getById<Client>(COLLECTIONS.clients, data.clientId);
  if (!client) throw new Error("Cliente não encontrado");
  const seller = await getById<User>(COLLECTIONS.users, data.sellerId);
  if (!seller || seller.active === false) throw new Error("Vendedor não encontrado ou inativo");
  const hasAddress = Boolean(data.address.street || data.address.city);
  const address: Address = hasAddress ? { ...data.address } : { ...client.address };
  // Mesmo endereço do cadastro: reaproveita a coordenada gravada; senão geocodifica (mock).
  const sameAsClient = address.city === client.address?.city && address.street === client.address?.street;
  const position = sameAsClient && client.address?.lat !== undefined ? { lat: client.address.lat!, lng: client.address.lng! } : await geocode({ ...address, lat: undefined, lng: undefined });
  if (position) {
    address.lat = position.lat;
    address.lng = position.lng;
  }
  const scheduledAt = new Date(data.scheduledAt).toISOString();
  const kind: VisitKind = data.kind ?? "comercial";
  const visit = await create<VisitRecord>(COLLECTIONS.visits, {
    clientId: client.id,
    opportunityId: data.opportunityId,
    sellerId: seller.id,
    address,
    scheduledAt,
    durationMinutes: data.durationMinutes,
    objective: data.objective,
    notes: data.notes,
    status: "agendada",
    kind,
    createdBy: actor.id,
  });
  if (data.opportunityId) await update<Opportunity>(COLLECTIONS.opportunities, data.opportunityId, { lastActivityAt: nowIso() });
  await emitEvent({
    type: "visit.scheduled",
    actor,
    clientId: client.id,
    entity: { type: "visit", id: visit.id },
    title: `Visita ${VISIT_KIND_LABELS[kind].toLowerCase()} agendada: ${data.objective}`,
    description: `${formatDateTime(scheduledAt)} · ${seller.name}`,
    department: "vendas",
    payload: { sellerId: seller.id, opportunityId: data.opportunityId, scheduledAt, kind },
  });
  if (seller.id !== actor.id) {
    await notify({ userIds: [seller.id], kind: "acao", title: `Visita agendada: ${client.tradeName}`, body: `${formatDateTime(scheduledAt)} · ${data.objective}`, href: `/vendas/visitas?visita=${visit.id}`, entity: { type: "visit", id: visit.id } });
  }
  return visit;
}

async function loadVisit(id: string): Promise<Visit> {
  const visit = await getById<Visit>(COLLECTIONS.visits, id);
  if (!visit) throw new Error("Visita não encontrada");
  return visit;
}

const PENDING_VISIT = new Set<Visit["status"]>(["agendada", "remarcada"]);

/** Conclui a visita: resultado obrigatório, visit.completed na timeline (registro do contato). */
export async function completeVisit(input: { visitId: string; result: string; notes?: string }, actor: UserRef): Promise<Visit> {
  const visit = await loadVisit(input.visitId);
  if (!PENDING_VISIT.has(visit.status)) throw new Error("Só visitas agendadas ou remarcadas podem ser concluídas");
  const patch: Partial<Visit> = { status: "realizada", result: input.result, notes: input.notes ?? visit.notes };
  await update<Visit>(COLLECTIONS.visits, visit.id, patch);
  await emitEvent({
    type: "visit.completed",
    actor,
    clientId: visit.clientId,
    entity: { type: "visit", id: visit.id },
    title: `Visita realizada: ${visit.objective}`,
    description: input.result,
    department: "vendas",
    payload: { sellerId: visit.sellerId, opportunityId: visit.opportunityId, scheduledAt: visit.scheduledAt },
  });
  if (visit.opportunityId) await update<Opportunity>(COLLECTIONS.opportunities, visit.opportunityId, { lastActivityAt: nowIso() });
  return { ...visit, ...patch };
}

export async function cancelVisit(input: { visitId: string; reason: string }, actor: UserRef): Promise<Visit> {
  const visit = await loadVisit(input.visitId);
  if (!PENDING_VISIT.has(visit.status)) throw new Error("Só visitas agendadas ou remarcadas podem ser canceladas");
  const patch: Partial<Visit> = { status: "cancelada", result: `Cancelada: ${input.reason}` };
  await update<Visit>(COLLECTIONS.visits, visit.id, patch);
  await emitEvent({
    type: "visit.cancelled",
    actor,
    clientId: visit.clientId,
    entity: { type: "visit", id: visit.id },
    title: `Visita cancelada: ${visit.objective}`,
    description: input.reason,
    department: "vendas",
    payload: { visitStatus: "cancelada", sellerId: visit.sellerId, opportunityId: visit.opportunityId },
  });
  return { ...visit, ...patch };
}

export async function rescheduleVisit(input: { visitId: string; scheduledAt: string; reason?: string }, actor: UserRef): Promise<Visit> {
  const visit = await loadVisit(input.visitId);
  if (!PENDING_VISIT.has(visit.status)) throw new Error("Só visitas agendadas ou remarcadas podem ser remarcadas");
  const scheduledAt = new Date(input.scheduledAt).toISOString();
  const patch: Partial<Visit> = { status: "remarcada", scheduledAt };
  await update<Visit>(COLLECTIONS.visits, visit.id, patch);
  await emitEvent({
    type: "visit.scheduled",
    actor,
    clientId: visit.clientId,
    entity: { type: "visit", id: visit.id },
    title: `Visita remarcada: ${visit.objective}`,
    description: [`${formatDateTime(visit.scheduledAt)} → ${formatDateTime(scheduledAt)}`, input.reason].filter(Boolean).join(" · "),
    department: "vendas",
    payload: { sellerId: visit.sellerId, opportunityId: visit.opportunityId, scheduledAt, previousScheduledAt: visit.scheduledAt, rescheduled: true },
  });
  return { ...visit, ...patch };
}

// ---------------------------------------------------------------------------
// Follow-up automático
// ---------------------------------------------------------------------------

export interface SweepResult {
  ranAt: string;
  scanned: number;
  followupTasksCreated: number;
  stalledFlagged: number;
}

/**
 * Varre oportunidades abertas:
 * - próxima ação vencida há mais de 1 dia sem tarefa de follow-up aberta → cria "Follow-up: <cliente>"
 *   para o vendedor (origem automação) e emite opportunity.followup_overdue;
 * - sem atividade há mais de `diasSemMovimentoParaParada` → emite opportunity.stalled (uma vez por
 *   período parado) e notifica vendedor e gestor.
 *
 * Hoje roda sob demanda (botão "Executar varredura" e, no máximo 1×/hora, ao abrir a Central de
 * Vendas). Na Onda 5 vira automação agendada (automation_rules com trigger "agendado").
 */
export async function detectStalledOpportunities(actor: UserRef = SYSTEM_ACTOR): Promise<SweepResult> {
  const now = new Date();
  const ranAt = now.toISOString();
  const [opps, settings, oppTasks, stalledEvents, salesManager] = await Promise.all([
    list<Opportunity>(COLLECTIONS.opportunities),
    getOpportunitySettings(),
    list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", "opportunity"]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "opportunity.stalled"]] }),
    getDepartmentManager("vendas"),
  ]);
  const open = opps.filter((o) => !isClosed(o));
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, open.map((o) => o.clientId));
  const owners = await getManyByIds<User>(COLLECTIONS.users, open.map((o) => o.ownerId));
  const overdueLimit = new Date(now.getTime() - 86_400_000).toISOString();
  const stalledLimit = new Date(now.getTime() - settings.diasSemMovimentoParaParada * 86_400_000).toISOString();
  const lastStalledAt = new Map<string, string>();
  for (const e of stalledEvents) if (e.entityId && (lastStalledAt.get(e.entityId) ?? "") < e.occurredAt) lastStalledAt.set(e.entityId, e.occurredAt);

  let followupTasksCreated = 0;
  let stalledFlagged = 0;
  for (const opp of open) {
    const clientName = clients.get(opp.clientId)?.tradeName ?? opp.title;

    if (opp.nextActionAt && opp.nextActionAt < overdueLimit) {
      const hasOpenFollowup = oppTasks.some((t) => t.processId === opp.id && OPEN_TASK_STATUS.has(t.status) && t.title.startsWith("Follow-up"));
      if (!hasOpenFollowup) {
        const task = await createTaskInternal(
          {
            title: `Follow-up: ${clientName}`,
            description: `Próxima ação vencida em ${formatDateTime(opp.nextActionAt)}${opp.nextAction ? `: ${opp.nextAction}` : ""}. Oportunidade: ${opp.title}.`,
            clientId: opp.clientId,
            assigneeId: owners.has(opp.ownerId) ? opp.ownerId : undefined,
            departmentId: "vendas",
            priority: "alta",
            dueAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
            processType: "opportunity",
            processId: opp.id,
            origin: "automacao",
          },
          actor,
        );
        oppTasks.push(task);
        followupTasksCreated += 1;
        await emitEvent({
          type: "opportunity.followup_overdue",
          actor,
          clientId: opp.clientId,
          entity: { type: "opportunity", id: opp.id },
          title: `Follow-up atrasado: ${opp.title}`,
          description: `Próxima ação vencida em ${formatDateTime(opp.nextActionAt)}; tarefa de follow-up criada`,
          department: "vendas",
          payload: { ownerId: opp.ownerId, nextActionAt: opp.nextActionAt, taskId: task.id },
        });
      }
    }

    if (opp.lastActivityAt < stalledLimit && (lastStalledAt.get(opp.id) ?? "") < opp.lastActivityAt) {
      stalledFlagged += 1;
      const days = Math.floor((now.getTime() - new Date(opp.lastActivityAt).getTime()) / 86_400_000);
      const event = await emitEvent({
        type: "opportunity.stalled",
        actor,
        clientId: opp.clientId,
        entity: { type: "opportunity", id: opp.id },
        title: `Oportunidade parada há ${days} dias: ${opp.title}`,
        description: `Sem atividade desde ${formatDateTime(opp.lastActivityAt)}`,
        department: "vendas",
        payload: { ownerId: opp.ownerId, lastActivityAt: opp.lastActivityAt, days },
      });
      const owner = owners.get(opp.ownerId);
      await notify({
        userIds: [opp.ownerId, salesManager?.id, owner?.managerId].filter((id): id is string => Boolean(id)),
        kind: "atencao",
        title: `Oportunidade parada: ${clientName}`,
        body: `${opp.title} · sem atividade há ${days} dias${owner ? ` · ${owner.name}` : ""}`,
        href: `/vendas/oportunidades?oportunidade=${opp.id}`,
        entity: { type: "opportunity", id: opp.id },
        eventId: event.id,
      });
    }
  }

  await saveSetting("sweeps", { ...((await readSetting("sweeps")) ?? {}), followupLastRunAt: ranAt, followupLastResult: { scanned: open.length, followupTasksCreated, stalledFlagged } }, "Última execução das varreduras automáticas.");
  return { ranAt, scanned: open.length, followupTasksCreated, stalledFlagged };
}

/** Executa a varredura no máximo uma vez por hora (chamado ao abrir a Central de Vendas). */
export async function maybeRunFollowupSweep(): Promise<SweepResult | null> {
  const sweeps = await readSetting<{ followupLastRunAt?: string }>("sweeps");
  const last = sweeps?.followupLastRunAt ? new Date(sweeps.followupLastRunAt).getTime() : 0;
  if (Date.now() - last < 3_600_000) return null;
  // Marca antes de rodar para evitar execuções concorrentes em requisições simultâneas.
  await saveSetting("sweeps", { ...(sweeps ?? {}), followupLastRunAt: nowIso() }, "Última execução das varreduras automáticas.");
  return detectStalledOpportunities();
}

export async function getLastSweep(): Promise<{ ranAt?: string; result?: { scanned: number; followupTasksCreated: number; stalledFlagged: number } }> {
  const sweeps = await readSetting<{ followupLastRunAt?: string; followupLastResult?: { scanned: number; followupTasksCreated: number; stalledFlagged: number } }>("sweeps");
  return { ranAt: sweeps?.followupLastRunAt, result: sweeps?.followupLastResult };
}
