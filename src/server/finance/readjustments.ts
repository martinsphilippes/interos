import "server-only";
/**
 * Reajuste anual dos contratos (data-base = aniversário do início da vigência), com o índice do cadastro «Índices de
 * reajuste» ou o percentual fixo do contrato. Regras puras em src/domain/readjustment.ts.
 *
 * - Varredura diária `reajustes_contratos` (`runContractReadjustments`): para cada contrato liberado com regra de
 *   reajuste, a data-base que chegou e ainda não foi decidida vira um aditivo "reajuste" aplicado na hora (sem
 *   assinatura: o reajuste já está no contrato), vigente na própria data-base — cobranças em aberto a partir dela são
 *   refeitas. Índice ≤ 0 com a regra «manter» só registra «mantido». Índice ainda não publicado: espera (até 45 dias
 *   depois da data-base); passou disso ou algo trava (aditivo em andamento, índice fora do cadastro) → tarefa ao
 *   Financeiro. 30 dias antes da data-base, prévia ao Financeiro e ao CS.
 * - A data-base que coincide com o fim da vigência fica para a renovação (o reajuste entra no aditivo de renovação).
 * - O Financeiro pode aplicar antes (até 60 dias antes da data-base), aplicar com outro percentual ou dispensar
 *   (`applyReadjustmentNow` / `skipReadjustment`).
 *
 * Idempotente: cada data-base é decidida uma vez (registro no contrato, gravado na mesma transação do aditivo) e o
 * aditivo exige a versão do contrato de quando foi criado.
 */
import { col, getById, getManyByIds, list, nowIso, stripUndefined } from "@/server/db";
import { docdb } from "@/server/docdb";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { getDepartmentManager } from "@/server/workflow/service";
import { BusinessError } from "@/server/auth/error-classes";
import { proposalTotals } from "@/components/sales/model";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { AMENDMENT_OPEN_STATUSES, describeReadjustment } from "@/domain/contract-snapshot";
import {
  coveredAnniversaries,
  describeIndexSource,
  describeQuote,
  formatPct,
  hasReadjustmentRule,
  indexDisplayName,
  quoteReadjustment,
  READJUSTMENT_GRACE_DAYS,
  READJUSTMENT_NOTICE_DAYS,
  readjustmentSchedule,
} from "@/domain/readjustment";
import { COLLECTIONS, type AmendmentReadjust, type Client, type Contract, type ContractAmendment, type ContractReadjustmentLogEntry, type ReadjustmentIndex, type ReadjustmentQuote, type Task, type UserRef } from "@/domain/types";
import { getReadjustmentIndexMap } from "@/server/finance-registry/indices";
import { applyAmendment, createAmendment, readjustItems } from "./amendments";
import { dueIso, SYSTEM_ACTOR, todayKey } from "./billing";

/** O Financeiro pode aplicar o reajuste com até N dias de antecedência da data-base. */
export const EARLY_APPLY_DAYS = 60;

const dmy = (key: string) => formatDate(dueIso(key));

/** Nova mensalidade com o percentual aplicado aos itens (mesma conta do aditivo). */
export function readjustedMonthly(contract: Pick<Contract, "items">, percent: number): number {
  return proposalTotals(readjustItems(contract.items, percent)).monthlyTotal;
}

function withinTerm(contract: Pick<Contract, "endDate">, anniversary: string): boolean {
  return !contract.endDate || anniversary < dateKey(contract.endDate);
}

const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

// ---------------------------------------------------------------------------
// Situação do reajuste de um contrato (tela do contrato e varredura)
// ---------------------------------------------------------------------------

export type ReadjustmentStatus = "previsto" | "pronto" | "aguardando_indice" | "atrasado" | "bloqueado" | "renovacao" | "sem_vigencia" | "sem_regra";

export interface ContractReadjustmentState {
  status: ReadjustmentStatus;
  message: string;
  /** Data-base em foco (a que chegou e não foi decidida, ou a próxima). */
  anniversary?: string;
  /** Dias de atraso (data-base que chegou) ou até a data-base (negativo). */
  days?: number;
  quote?: ReadjustmentQuote;
  monthlyBefore?: number;
  monthlyAfter?: number;
  /** O Financeiro pode aplicar agora / dispensar esta data-base. */
  canApply: boolean;
  canSkip: boolean;
  /** Aditivo em andamento que segura o reajuste. */
  blockingAmendment?: string;
}

export interface ReadjustmentContext {
  indices: Map<string, ReadjustmentIndex>;
  amendments: ContractAmendment[];
  today: string;
}

/** Situação do reajuste anual do contrato hoje: o que acontece, quando, com quanto. */
export function contractReadjustmentState(contract: Contract, ctx: ReadjustmentContext): ContractReadjustmentState {
  const none = { canApply: false, canSkip: false };
  if (!hasReadjustmentRule(contract)) return { ...none, status: "sem_regra", message: contract.readjustment?.type === "indice" ? "Escolha o índice do reajuste nas condições do contrato" : "Contrato sem reajuste anual" };
  if (!contract.startDate) return { ...none, status: "sem_vigencia", message: "O primeiro reajuste é 12 meses depois do início da vigência (na liberação do contrato)" };
  const covered = coveredAnniversaries(contract, ctx.amendments);
  const sched = readjustmentSchedule({ startDate: dateKey(contract.startDate), covered, today: ctx.today });
  const target = sched.due ?? (sched.next ? { anniversary: sched.next.anniversary, overdueDays: -sched.next.daysUntil } : null);
  if (!target) return { ...none, status: "sem_regra", message: "Sem data-base pela frente" };
  const anniversary = target.anniversary;
  const rule = contract.readjustment!;
  const index = rule.type === "indice" && rule.index ? ctx.indices.get(rule.index) : undefined;
  const q = quoteReadjustment(rule, index, anniversary);
  const quote = q.ok ? q.quote : undefined;
  const values = quote ? { monthlyBefore: contract.monthlyTotal, monthlyAfter: readjustedMonthly(contract, quote.percent) } : {};
  const base = { anniversary, days: target.overdueDays, quote, ...values };
  const open = ctx.amendments.find((a) => AMENDMENT_OPEN_STATUSES.includes(a.status));
  if (!withinTerm(contract, anniversary)) {
    return { ...base, ...none, status: "renovacao", message: `A data-base ${dmy(anniversary)} coincide com o fim da vigência: o reajuste entra no aditivo de renovação${contract.autoRenew ? " (renovação automática)" : " (renovação pelo CS)"}.` };
  }
  const due = target.overdueDays >= 0;
  const indexName = index?.name ?? indexDisplayName(rule.index);
  if (open) {
    return { ...base, ...none, canSkip: due, status: "bloqueado", blockingAmendment: open.number, message: `O aditivo ${open.number} está em andamento: o reajuste de ${dmy(anniversary)} espera ele ser aplicado ou cancelado.` };
  }
  const canApply = Boolean(quote) && (due || -target.overdueDays <= EARLY_APPLY_DAYS);
  if (due && target.overdueDays > READJUSTMENT_GRACE_DAYS) {
    return { ...base, canApply: true, canSkip: true, status: "atrasado", message: `A data-base ${dmy(anniversary)} passou há ${target.overdueDays} dias sem reajuste${q.ok ? "" : ` (${q.reason})`}: aplique (com o índice ou um percentual informado) ou dispense.` };
  }
  if (!q.ok) {
    if (!q.waiting) return { ...base, canApply: due, canSkip: due, status: "bloqueado", message: `${q.reason}. Corrija no contrato ou no cadastro de índices.` };
    return { ...base, canApply: due, canSkip: due, status: "aguardando_indice", message: `${q.reason}. ${due ? `Entra sozinho quando o ${indexName} sair (até ${READJUSTMENT_GRACE_DAYS} dias depois da data-base).` : "A prévia aparece quando o índice sair."}` };
  }
  if (due) return { ...base, canApply: true, canSkip: true, status: "pronto", message: `Data-base ${dmy(anniversary)}: o reajuste entra na próxima rotina diária (06h).` };
  return { ...base, canApply, canSkip: false, status: "previsto", message: `Próximo reajuste em ${dmy(anniversary)} (em ${-target.overdueDays} dias). ${quote?.type === "indice" ? "Prévia com o último índice publicado: o valor final usa o acumulado até o mês anterior à data-base." : "Percentual fixo do contrato."}` };
}

// ---------------------------------------------------------------------------
// Aplicar / manter / dispensar
// ---------------------------------------------------------------------------

async function recipients(contract: Pick<Contract, "clientId" | "ownerId">): Promise<{ ids: string[]; client: Client | null }> {
  const [finance, cs, client] = await Promise.all([getDepartmentManager("financeiro"), getDepartmentManager("cs"), getById<Client>(COLLECTIONS.clients, contract.clientId)]);
  return { ids: [finance?.id, client?.ownerCsId ?? cs?.id, contract.ownerId].filter((v): v is string => Boolean(v)), client };
}

/**
 * Anuncia um reajuste aplicado (aditivo "reajuste" ou renovação com reajuste): evento `contract.readjusted` (histórico
 * do contrato e gatilho de automações) e aviso único ao Financeiro, ao CS do cliente e ao dono do contrato.
 */
export async function announceReadjustment(contract: Pick<Contract, "id" | "number" | "clientId" | "ownerId">, amendment: Pick<ContractAmendment, "id" | "number" | "readjust" | "kind">, monthlyBefore: number, monthlyAfter: number, actor: UserRef): Promise<void> {
  const quote = amendment.readjust;
  if (!quote) return;
  const anniversary = quote.anniversary;
  const { ids, client } = await recipients(contract);
  const name = client?.tradeName ?? contract.number;
  const renewal = amendment.kind === "renovacao" ? " junto com a renovação" : "";
  await emitEvent({
    type: "contract.readjusted",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} reajustado em ${formatPct(quote.percent)}${renewal} (data-base ${dmy(anniversary)})`,
    description: `${describeQuote(quote)} · mensalidade ${formatCurrency(monthlyBefore)} → ${formatCurrency(monthlyAfter)} · aditivo ${amendment.number}`,
    department: "financeiro",
    payload: { contractId: contract.id, amendmentId: amendment.id, amendmentNumber: amendment.number, anniversary, percent: quote.percent, rawPercent: quote.rawPercent, indexId: quote.indexId ?? null, from: quote.from ?? null, to: quote.to ?? null, manual: quote.manual ?? false, monthlyBefore, monthlyAfter, changes: { monthlyTotal: { from: monthlyBefore, to: monthlyAfter } } },
  });
  await notify({
    userIds: ids,
    kind: "informativa",
    key: `reajuste_aplicado_${contract.id}_${anniversary}`,
    title: `Reajuste aplicado${renewal}: ${name} (${formatPct(quote.percent)})`,
    body: `Contrato ${contract.number}: ${describeQuote(quote)}. Mensalidade ${formatCurrency(monthlyBefore)} → ${formatCurrency(monthlyAfter)} (aditivo ${amendment.number}); as cobranças em aberto da vigência foram refeitas. Avise o cliente.`,
    href: `/financeiro/contratos/${contract.id}`,
    entity: { type: "contract", id: contract.id },
  });
}

/** Aplica o reajuste da data-base por aditivo "reajuste" (sem assinatura), avisa Financeiro/CS e registra o evento. */
export async function applyReadjustment(contract: Contract, anniversary: string, quote: ReadjustmentQuote, actor: UserRef, source: ContractAmendment["source"]): Promise<{ amendment: ContractAmendment; monthlyBefore: number; monthlyAfter: number }> {
  const readjust: AmendmentReadjust = { ...quote, anniversary };
  const reason = `Reajuste anual (data-base ${dmy(anniversary)}): ${describeQuote(quote)}`;
  const amendment = await createAmendment({ contractId: contract.id, effectiveFrom: anniversary, reason, requiresSignature: false }, actor, { source, readjust });
  const applied = await applyAmendment(amendment.id, actor);
  return { amendment, monthlyBefore: contract.monthlyTotal, monthlyAfter: applied.contract.monthlyTotal };
}

/** Registra a data-base sem mudar valor: «mantido» (índice ≤ 0) ou «dispensado» (decisão do Financeiro). */
export async function recordReadjustmentDecision(contractId: string, anniversary: string, outcome: "mantido" | "dispensado", details: { quote?: ReadjustmentQuote; reason?: string }, actor: UserRef): Promise<ContractReadjustmentLogEntry> {
  const ref = col(COLLECTIONS.contracts).doc(contractId);
  const amendments = await list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["contractId", "==", contractId]] });
  const { entry, contract } = await docdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new BusinessError("Contrato não encontrado");
    const contract = { ...(snap.data() as Omit<Contract, "id">), id: contractId } as Contract;
    if (coveredAnniversaries(contract, amendments).some((c) => sameMonth(c, anniversary))) throw new BusinessError(`O reajuste da data-base ${dmy(anniversary)} já foi decidido`);
    const q = details.quote;
    const entry = stripUndefined<ContractReadjustmentLogEntry>({ anniversary, outcome, at: nowIso(), by: actor.id, byName: actor.name, percent: outcome === "mantido" ? 0 : undefined, rawPercent: q?.rawPercent, indexId: q?.indexId, indexName: q?.indexName, from: q?.from, to: q?.to, monthlyBefore: contract.monthlyTotal, monthlyAfter: contract.monthlyTotal, reason: details.reason?.trim() || undefined });
    const patch: Record<string, unknown> = { readjustmentLog: [...(contract.readjustmentLog ?? []), entry], updatedAt: nowIso() };
    if (contract.readjustment?.pending) patch.readjustment = stripUndefined({ ...contract.readjustment, pending: undefined });
    tx.update(ref, patch);
    return { entry, contract };
  });
  const text = outcome === "mantido" ? `${details.quote ? describeQuote(details.quote) : "índice ≤ 0"}: mensalidade mantida em ${formatCurrency(contract.monthlyTotal)}` : `Reajuste dispensado pelo Financeiro${details.reason?.trim() ? `: ${details.reason.trim()}` : ""}`;
  await emitEvent({
    type: "contract.readjustment_skipped",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number}: reajuste da data-base ${dmy(anniversary)} ${outcome === "mantido" ? "sem aumento (índice negativo ou zero)" : "dispensado"}`,
    description: text,
    department: "financeiro",
    payload: { contractId: contract.id, anniversary, outcome, rawPercent: details.quote?.rawPercent ?? null, indexId: details.quote?.indexId ?? null, ...(details.reason?.trim() ? { reason: details.reason.trim() } : {}) },
  });
  const { ids, client } = await recipients(contract);
  await notify({
    userIds: ids,
    kind: "informativa",
    key: `reajuste_${outcome}_${contract.id}_${anniversary}`,
    title: `Reajuste ${outcome === "mantido" ? "sem aumento" : "dispensado"}: ${client?.tradeName ?? contract.number}`,
    body: `Contrato ${contract.number}, data-base ${dmy(anniversary)}. ${text}.`,
    href: `/financeiro/contratos/${contract.id}`,
    entity: { type: "contract", id: contract.id },
  });
  return entry;
}

async function loadContext(contractId: string): Promise<{ contract: Contract; ctx: ReadjustmentContext }> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract) throw new BusinessError("Contrato não encontrado");
  const [indices, amendments] = await Promise.all([getReadjustmentIndexMap(), list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["contractId", "==", contractId]] })]);
  return { contract, ctx: { indices, amendments, today: todayKey() } };
}

export interface ContractReadjustmentView {
  /** "IPCA · Banco Central · série 433" / "5,00% ao ano (percentual fixo)". */
  rule: string;
  startDate?: string;
  indexId?: string;
  state: ContractReadjustmentState;
  log: ContractReadjustmentLogEntry[];
}

/**
 * Cartão «Reajuste anual» da página do contrato (null = contrato sem reajuste e sem histórico). Sem «ver valores do
 * contrato», as mensalidades não saem do servidor.
 */
export async function getContractReadjustmentView(contract: Contract, amendments: ContractAmendment[], options: { hideValues: boolean }): Promise<ContractReadjustmentView | null> {
  const r = contract.readjustment;
  const log = contract.readjustmentLog ?? [];
  if ((!r || r.type === "nenhum") && log.length === 0) return null;
  const indices = await getReadjustmentIndexMap();
  const index = r?.type === "indice" && r.index ? indices.get(r.index) : undefined;
  const rule = !r || r.type === "nenhum" ? "Sem reajuste combinado" : r.type === "percentual" ? `${formatPct(r.percent ?? 0)} ao ano (percentual fixo)` : index ? `${index.name} · ${describeIndexSource(index.source)}${index.archived ? " (índice desativado)" : ""}` : `${indexDisplayName(r.index)} (fora do cadastro de índices)`;
  const state = contractReadjustmentState(contract, { indices, amendments, today: todayKey() });
  const hide = options.hideValues;
  return {
    rule,
    startDate: contract.startDate ? dateKey(contract.startDate) : undefined,
    indexId: index?.id,
    state: hide ? { ...state, monthlyBefore: undefined, monthlyAfter: undefined } : state,
    log: hide ? log.map((e) => ({ ...e, monthlyBefore: undefined, monthlyAfter: undefined })) : log,
  };
}

/**
 * Financeiro aplica o reajuste agora: da data-base que chegou ou da próxima (até 60 dias antes). Sem `percent`, usa o
 * cálculo (índice/percentual do contrato); com `percent`, o informado (fica marcado como manual).
 */
export async function applyReadjustmentNow(input: { contractId: string; anniversary: string; percent?: number }, actor: UserRef): Promise<{ amendmentNumber: string; monthlyBefore: number; monthlyAfter: number }> {
  const { contract, ctx } = await loadContext(input.contractId);
  if (contract.status !== "liberado") throw new BusinessError("O reajuste anual vale para contrato liberado");
  const state = contractReadjustmentState(contract, ctx);
  if (state.anniversary !== input.anniversary) throw new BusinessError("A data-base do reajuste mudou: recarregue a página");
  if (state.status === "renovacao") throw new BusinessError("Essa data-base é a da renovação: o reajuste entra no aditivo de renovação");
  if (state.status === "bloqueado" && state.blockingAmendment) throw new BusinessError(`Aplique ou cancele o aditivo ${state.blockingAmendment} antes`);
  if ((state.days ?? 0) < -EARLY_APPLY_DAYS) throw new BusinessError(`Dá para aplicar a partir de ${EARLY_APPLY_DAYS} dias antes da data-base`);
  let quote: ReadjustmentQuote;
  if (input.percent !== undefined) {
    const p = Math.round(input.percent * 100) / 100;
    if (!Number.isFinite(p) || p === 0 || Math.abs(p) > 100) throw new BusinessError("Informe um percentual diferente de zero (até 100%)");
    const rule = contract.readjustment!;
    const index = rule.type === "indice" && rule.index ? ctx.indices.get(rule.index) : undefined;
    quote = { type: rule.type === "indice" ? "indice" : "percentual", percent: p, rawPercent: p, manual: true, ...(rule.type === "indice" ? { indexId: rule.index, indexName: index?.name ?? indexDisplayName(rule.index) } : {}) };
  } else {
    if (!state.quote) throw new BusinessError(`${state.message} Informe o percentual para aplicar agora.`);
    quote = state.quote;
    if (quote.percent === 0) throw new BusinessError("O índice do período deu zero ou negativo: use «Não reajustar» (o valor fica igual)");
  }
  const r = await applyReadjustment(contract, input.anniversary, quote, actor, "financeiro");
  return { amendmentNumber: r.amendment.number, monthlyBefore: r.monthlyBefore, monthlyAfter: r.monthlyAfter };
}

/** Financeiro decide não reajustar a data-base (com motivo). */
export async function skipReadjustment(input: { contractId: string; anniversary: string; reason: string }, actor: UserRef): Promise<ContractReadjustmentLogEntry> {
  const { contract, ctx } = await loadContext(input.contractId);
  const state = contractReadjustmentState(contract, ctx);
  if (state.anniversary !== input.anniversary || !state.canSkip) throw new BusinessError("Só dá para dispensar o reajuste de uma data-base que já chegou: recarregue a página");
  return recordReadjustmentDecision(contract.id, input.anniversary, "dispensado", { quote: state.quote, reason: input.reason }, actor);
}

// ---------------------------------------------------------------------------
// Varredura diária
// ---------------------------------------------------------------------------

export interface ContractReadjustmentRunResult {
  contracts: number;
  applied: number;
  held: number;
  waiting: number;
  notices: number;
  lateTasks: number;
  errors: string[];
  appliedContractIds: string[];
}

async function ensureLateTask(existing: Task[], contract: Contract, client: Client | undefined, anniversary: string, why: string): Promise<boolean> {
  const title = `Reajuste não aplicado: ${client?.tradeName ?? contract.number} (data-base ${dmy(anniversary)})`;
  if (existing.some((t) => t.processId === contract.id && t.title === title && t.status !== "cancelada")) return false;
  const manager = await getDepartmentManager("financeiro");
  const { createTaskInternal } = await import("@/server/tasks/service");
  const task = await createTaskInternal(
    {
      title,
      description: `Contrato ${contract.number} (${describeReadjustment(contract.readjustment)}): ${why} Abra o contrato e aplique o reajuste (com o índice ou um percentual informado) ou dispense com o motivo.`,
      clientId: contract.clientId,
      assigneeId: manager?.id,
      departmentId: "financeiro",
      priority: "alta",
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      processType: "contract",
      processId: contract.id,
      origin: "automacao",
      tags: ["contrato", "reajuste"],
    },
    SYSTEM_ACTOR,
  );
  existing.push(task);
  return true;
}

export async function runContractReadjustments(now: Date = new Date()): Promise<ContractReadjustmentRunResult> {
  const today = dateKey(now);
  const contracts = (await list<Contract>(COLLECTIONS.contracts, { where: [["status", "==", "liberado"]] })).filter((c) => hasReadjustmentRule(c) && c.startDate);
  const result: ContractReadjustmentRunResult = { contracts: contracts.length, applied: 0, held: 0, waiting: 0, notices: 0, lateTasks: 0, errors: [], appliedContractIds: [] };
  if (contracts.length === 0) return result;
  const ids = contracts.map((c) => c.id);
  const [indices, clients, allAmendments, tasks] = await Promise.all([
    getReadjustmentIndexMap(),
    getManyByIds<Client>(COLLECTIONS.clients, contracts.map((c) => c.clientId)),
    list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["contractId", "in", ids]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", "contract"]] }),
  ]);
  for (const c of contracts) {
    const client = clients.get(c.clientId);
    if (!client || client.status === "cancelado") continue;
    try {
      const amendments = allAmendments.filter((a) => a.contractId === c.id);
      // Reajuste automático que ficou em rascunho (falha entre criar e aplicar): aplica de novo.
      const stuck = amendments.find((a) => a.status === "rascunho" && a.readjust && !a.requiresSignature && a.source === "reajuste_automatico");
      if (stuck) {
        await applyAmendment(stuck.id, SYSTEM_ACTOR);
        result.applied += 1;
        result.appliedContractIds.push(c.id);
        continue;
      }
      const state = contractReadjustmentState(c, { indices, amendments, today });
      const anniversary = state.anniversary;
      if (!anniversary) continue;
      const due = (state.days ?? -1) >= 0;
      if (due) {
        if (state.status === "pronto" && state.quote) {
          if (state.quote.percent === 0) {
            await recordReadjustmentDecision(c.id, anniversary, "mantido", { quote: state.quote }, SYSTEM_ACTOR);
            result.held += 1;
          } else {
            await applyReadjustment(c, anniversary, state.quote, SYSTEM_ACTOR, "reajuste_automatico");
            result.applied += 1;
            result.appliedContractIds.push(c.id);
          }
        } else if (state.status === "aguardando_indice") result.waiting += 1;
        else if (state.status === "atrasado" || (state.status === "bloqueado" && (state.days ?? 0) > READJUSTMENT_GRACE_DAYS) || (state.status === "bloqueado" && !state.blockingAmendment)) {
          if (await ensureLateTask(tasks, c, client, anniversary, state.message)) result.lateTasks += 1;
        }
      } else if ((state.status === "previsto" || state.status === "aguardando_indice") && -(state.days ?? 0) <= READJUSTMENT_NOTICE_DAYS) {
        const { ids: userIds } = await recipients(c);
        const index = c.readjustment?.type === "indice" && c.readjustment.index ? indices.get(c.readjustment.index) : undefined;
        const preview = state.quote ? `${describeQuote(state.quote)} → mensalidade ${formatCurrency(state.monthlyBefore ?? c.monthlyTotal)} → ${formatCurrency(state.monthlyAfter ?? c.monthlyTotal)} (prévia)` : "prévia ainda sem o índice do período";
        const sent = await notify({
          userIds,
          kind: "acao",
          key: `reajuste_previa_${c.id}_${anniversary}`,
          title: `Reajuste em ${dmy(anniversary)}: ${client.tradeName}`,
          body: `Contrato ${c.number} (${index ? `${index.name} · ${describeIndexSource(index.source)}` : describeReadjustment(c.readjustment)}): ${preview}. Entra sozinho na data-base; avise o cliente.`,
          href: `/financeiro/contratos/${c.id}`,
          entity: { type: "contract", id: c.id },
        });
        if (sent.length > 0) result.notices += 1;
      }
    } catch (error) {
      result.errors.push(`${c.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
