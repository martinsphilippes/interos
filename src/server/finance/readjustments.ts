import "server-only";
/**
 * Reajuste anual dos contratos (data-base = aniversário do início da vigência), com o índice do cadastro «Índices de
 * reajuste» ou o percentual fixo do contrato. Regras puras em src/domain/readjustment.ts.
 *
 * - Varredura diária `reajustes_contratos` (`runContractReadjustments`): para cada contrato liberado com regra de
 *   reajuste, a data-base que chegou e ainda não foi decidida vira um aditivo "reajuste" aplicado na hora (sem
 *   assinatura: o reajuste já está no contrato), vigente na própria data-base — cobranças em aberto a partir dela são
 *   refeitas. Índice ≤ 0 com a regra «manter» só registra «mantido». Índice ainda não publicado: espera (até 45 dias
 *   depois da data-base); passou disso ou algo trava (aditivo em andamento, índice fora do cadastro, acumulado acima
 *   de 25% em módulo, regra trocada depois da data-base) → tarefa ao Financeiro, fechada sozinha quando a data-base é
 *   decidida. Prévia ao Financeiro e ao CS 30 dias antes de o reajuste entrar (contrato com cobrança anual: 60 dias
 *   antes da data-base, porque ele entra 30 dias antes dela).
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
import { dateKey, formatDate } from "@/lib/format";
import { AMENDMENT_OPEN_STATUSES, describeReadjustment } from "@/domain/contract-snapshot";
import {
  addDaysKey,
  coveredAnniversaries,
  daysBetween,
  describeIndexSource,
  describeQuote,
  formatPct,
  hasReadjustmentRule,
  indexDisplayName,
  MAX_AUTO_PERCENT,
  quoteReadjustment,
  READJUSTMENT_GRACE_DAYS,
  READJUSTMENT_NOTICE_DAYS,
  readjustmentFloor,
  readjustmentSchedule,
} from "@/domain/readjustment";
import { COLLECTIONS, type AmendmentReadjust, type Client, type Contract, type ContractAmendment, type ContractReadjustmentLogEntry, type ReadjustmentIndex, type ReadjustmentQuote, type Task, type UserRef } from "@/domain/types";
import { getReadjustmentIndexMap } from "@/server/finance-registry/indices";
import { redactReadjustmentLog } from "./redact";
import { applyAmendment, cancelAmendment, createAmendment, readjustItems } from "./amendments";
import { dueIso, SYSTEM_ACTOR, todayKey } from "./billing";

/** O Financeiro pode aplicar (ou dispensar) o reajuste com até N dias de antecedência da data-base. */
export const EARLY_APPLY_DAYS = 60;
export { MAX_AUTO_PERCENT };

/** Tempo máximo da varredura aplicando aditivos (o cron inteiro tem 60 s). */
const RUN_BUDGET_MS = 25_000;


const dmy = (key: string) => formatDate(dueIso(key));

/** Nova mensalidade com o percentual aplicado aos itens (mesma conta do aditivo). */
export function readjustedMonthly(contract: Pick<Contract, "items">, percent: number): number {
  return proposalTotals(readjustItems(contract.items, percent)).monthlyTotal;
}

/** Dias antes da data-base em que o reajuste entra sozinho: cobrança anual, 30 (a parcela do ano vence perto dela). */
export function readjustmentLeadDays(contract: Pick<Contract, "recurrence">): number {
  return contract.recurrence === "anual" ? READJUSTMENT_NOTICE_DAYS : 0;
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
  /** A janela de aplicação abriu (data-base chegou; contrato anual: 30 dias antes). */
  due: boolean;
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

/**
 * Situação do reajuste anual do contrato hoje: o que acontece, quando, com quanto. Contrato com cobrança ANUAL abre a
 * janela 30 dias antes da data-base (a parcela do ano vence perto dela: o valor novo precisa estar nela antes do
 * vencimento); mensal, na própria data-base.
 */
export function contractReadjustmentState(contract: Contract, ctx: ReadjustmentContext): ContractReadjustmentState {
  const none = { canApply: false, canSkip: false, due: false };
  if (!hasReadjustmentRule(contract)) return { ...none, status: "sem_regra", message: contract.readjustment?.type === "indice" ? "Escolha o índice do reajuste nas condições do contrato" : "Contrato sem reajuste anual" };
  if (!contract.startDate) return { ...none, status: "sem_vigencia", message: "O primeiro reajuste é 12 meses depois do início da vigência (na liberação do contrato)" };
  const covered = coveredAnniversaries(contract, ctx.amendments);
  const lead = readjustmentLeadDays(contract);
  const horizon = addDaysKey(ctx.today, lead);
  const sched = readjustmentSchedule({ startDate: dateKey(contract.startDate), covered, today: horizon, floor: readjustmentFloor(contract), notBefore: contract.readjustmentTrackedFrom });
  const anniversary = sched.due?.anniversary ?? sched.next?.anniversary;
  if (!anniversary) return { ...none, status: "sem_regra", message: "Sem data-base pela frente" };
  const days = daysBetween(anniversary, ctx.today);
  const due = Boolean(sched.due);
  const rule = contract.readjustment!;
  const index = rule.type === "indice" && rule.index ? ctx.indices.get(rule.index) : undefined;
  const q = quoteReadjustment(rule, index, anniversary);
  const quote = q.ok ? q.quote : undefined;
  const values = quote ? { monthlyBefore: contract.monthlyTotal, monthlyAfter: readjustedMonthly(contract, quote.percent) } : {};
  const base = { anniversary, days, due, quote, ...values };
  const open = ctx.amendments.find((a) => AMENDMENT_OPEN_STATUSES.includes(a.status));
  if (!withinTerm(contract, anniversary)) {
    const end = dateKey(contract.endDate!);
    const message = sameMonth(anniversary, end)
      ? `A data-base ${dmy(anniversary)} coincide com o fim da vigência: o reajuste entra no aditivo de renovação${contract.autoRenew ? " (renovação automática)" : " (renovação pelo CS)"}.`
      : `A data-base ${dmy(anniversary)} é depois do fim da vigência (${dmy(end)}): se o contrato for renovado, o reajuste entra nela.`;
    return { ...base, ...none, due, status: "renovacao", message };
  }
  const window = due || -days <= EARLY_APPLY_DAYS;
  const indexName = index?.name ?? indexDisplayName(rule.index);
  if (open) {
    return { ...base, canApply: false, canSkip: window, status: "bloqueado", blockingAmendment: open.number, message: `O aditivo ${open.number} está em andamento: o reajuste de ${dmy(anniversary)} espera ele ser aplicado ou cancelado.` };
  }
  // Regra trocada por aditivo vigente DEPOIS desta data-base: não entra sozinho (nem prévia de «entra sozinho»).
  const decideFrom = window ? "decida" : `a partir de ${dmy(addDaysKey(anniversary, -EARLY_APPLY_DAYS))}, decida`;
  if (contract.readjustmentRuleSince && anniversary < contract.readjustmentRuleSince) {
    return { ...base, canApply: window, canSkip: window, status: "bloqueado", message: `A regra do reajuste mudou em ${dmy(contract.readjustmentRuleSince)}, depois desta data-base: o reajuste não entra sozinho; ${decideFrom} se aplica (com a regra nova ou um percentual informado) ou não reajusta.` };
  }
  if (due && days > READJUSTMENT_GRACE_DAYS) {
    return { ...base, canApply: true, canSkip: true, status: "atrasado", message: `A data-base ${dmy(anniversary)} passou há ${days} dias sem reajuste${q.ok ? "" : ` (${q.reason})`}: aplique (com o índice ou um percentual informado) ou dispense.` };
  }
  if (!q.ok) {
    const archived = index?.archived ? " O índice está desativado no cadastro: reative-o ou troque o índice do contrato." : "";
    if (!q.waiting) return { ...base, canApply: window, canSkip: window, status: "bloqueado", message: `${q.reason}. Corrija no contrato ou no cadastro de índices.${archived}` };
    return { ...base, canApply: window, canSkip: window, status: "aguardando_indice", message: `${q.reason}. ${due ? `Entra sozinho quando o ${indexName} sair (até ${READJUSTMENT_GRACE_DAYS} dias depois da data-base).` : "A prévia aparece quando o índice sair."}${archived}` };
  }
  // Acumulado BRUTO (antes do «manter»): série errada para baixo também não vira «sem aumento» definitivo sozinha.
  if (Math.abs(q.quote.rawPercent) > MAX_AUTO_PERCENT) {
    return { ...base, canApply: window, canSkip: window, status: "bloqueado", message: `Reajuste de ${formatPct(q.quote.rawPercent)} fora do esperado (acima de ${MAX_AUTO_PERCENT}% em módulo): não entra sozinho. Confira o índice e ${window ? "aplique" : `aplique a partir de ${dmy(addDaysKey(anniversary, -EARLY_APPLY_DAYS))}`} (com o índice ou um percentual informado) ou dispense.` };
  }
  if (due) {
    const message = q.quote.percent === 0 ? `Data-base ${dmy(anniversary)}: ${describeQuote(q.quote)}. A próxima rotina diária (06h) registra «sem aumento».` : `Data-base ${dmy(anniversary)}: o reajuste entra na próxima rotina diária (06h)${lead && days < 0 ? `, ${-days} dias antes da data-base (cobrança anual)` : ""}.`;
    return { ...base, canApply: q.quote.percent !== 0, canSkip: true, status: "pronto", message };
  }
  return { ...base, canApply: window && q.quote.percent !== 0, canSkip: window, status: "previsto", message: `Próximo reajuste em ${dmy(anniversary)} (em ${-days} dias). ${quote?.type === "indice" ? "Prévia com o último índice publicado: o valor final usa o acumulado até o mês anterior à data-base." : "Percentual fixo do contrato."}` };
}

// ---------------------------------------------------------------------------
// Aplicar / manter / dispensar
// ---------------------------------------------------------------------------

/**
 * Quem é avisado do reajuste: o gestor do Financeiro e o dono do contrato (link para o contrato) e o CS do cliente (ou
 * o gestor de CS), com link para a ficha do cliente — o CS não abre a tela de contratos do Financeiro. Os avisos não
 * levam valores em R$ (quem não vê valores também recebe): só o percentual; os valores ficam no contrato.
 */
async function notifyReadjustment(contract: Pick<Contract, "id" | "clientId" | "ownerId">, input: { kind: "informativa" | "acao"; key: string; title: (clientName: string) => string; body: string }): Promise<number> {
  const [finance, cs, client] = await Promise.all([getDepartmentManager("financeiro"), getDepartmentManager("cs"), getById<Client>(COLLECTIONS.clients, contract.clientId)]);
  const name = client?.tradeName ?? "cliente";
  const financeIds = [finance?.id, contract.ownerId].filter((v): v is string => Boolean(v));
  const csIds = [client?.ownerCsId ?? cs?.id].filter((v): v is string => Boolean(v) && !financeIds.includes(v as string));
  const base = { kind: input.kind, title: input.title(name), body: input.body, entity: { type: "contract", id: contract.id } };
  const sent = await notify({ ...base, userIds: financeIds, key: input.key, href: `/financeiro/contratos/${contract.id}` });
  const sentCs = await notify({ ...base, userIds: csIds, key: input.key, href: `/clientes/${contract.clientId}?aba=financeiro` });
  return sent.length + sentCs.length;
}

/**
 * Anuncia um reajuste aplicado (aditivo "reajuste" ou renovação com reajuste): evento `contract.readjusted` (histórico
 * do contrato e gatilho de automações) e aviso único ao Financeiro, ao CS do cliente e ao dono do contrato.
 */
export async function announceReadjustment(contract: Pick<Contract, "id" | "number" | "clientId" | "ownerId">, amendment: Pick<ContractAmendment, "id" | "number" | "readjust" | "kind">, monthlyBefore: number, monthlyAfter: number, actor: UserRef): Promise<void> {
  const quote = amendment.readjust;
  // Renovação «sem reajuste» ou índice ≤ 0 mantido: nada mudou de valor (o registro da data-base já está no contrato).
  if (!quote || quote.percent === 0) return;
  const anniversary = quote.anniversary;
  const renewal = amendment.kind === "renovacao" ? " junto com a renovação" : "";
  await emitEvent({
    type: "contract.readjusted",
    actor,
    clientId: contract.clientId,
    entity: { type: "contract", id: contract.id },
    title: `Contrato ${contract.number} reajustado em ${formatPct(quote.percent)}${renewal} (data-base ${dmy(anniversary)})`,
    description: `${describeQuote(quote)} · aditivo ${amendment.number}`,
    department: "financeiro",
    payload: { contractId: contract.id, amendmentId: amendment.id, amendmentNumber: amendment.number, anniversary, percent: quote.percent, rawPercent: quote.rawPercent, indexId: quote.indexId ?? null, from: quote.from ?? null, to: quote.to ?? null, manual: quote.manual ?? false, monthlyBefore, monthlyAfter, changes: { monthlyTotal: { from: monthlyBefore, to: monthlyAfter } } },
  });
  await notifyReadjustment(contract, {
    kind: "informativa",
    key: `reajuste_aplicado_${contract.id}_${anniversary}`,
    title: (name) => `Reajuste aplicado${renewal}: ${name} (${formatPct(quote.percent)})`,
    body: `Contrato ${contract.number}: ${describeQuote(quote)} (aditivo ${amendment.number}), vigente em ${dmy(anniversary)}; as cobranças em aberto foram refeitas com o novo valor. Avise o cliente.`,
  });
}

const lateTaskTitle = (contract: Pick<Contract, "number">, client: Pick<Client, "tradeName"> | undefined, anniversary: string) => `Reajuste não aplicado: ${client?.tradeName ?? contract.number} (data-base ${dmy(anniversary)})`;
const OPEN_TASK_STATUSES: readonly Task["status"][] = ["aberta", "em_andamento", "aguardando"];

/**
 * Data-base decidida (aplicada, mantida ou dispensada, por qualquer caminho): conclui a tarefa «Reajuste não
 * aplicado» dela, se houver (o título termina com a data-base; o nome do cliente pode ter mudado). Falha só registra.
 */
export async function closeLateReadjustmentTasks(contractId: string, anniversary: string, actor: UserRef): Promise<number> {
  try {
    const suffix = `(data-base ${dmy(anniversary)})`;
    const tasks = (await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", contractId]] })).filter((t) => t.processType === "contract" && OPEN_TASK_STATUSES.includes(t.status) && t.title.startsWith("Reajuste não aplicado") && t.title.endsWith(suffix));
    if (tasks.length === 0) return 0;
    const { completeTaskInternal } = await import("@/server/tasks/service");
    for (const t of tasks) await completeTaskInternal(t, actor);
    return tasks.length;
  } catch (error) {
    console.error(`[financeiro] reajuste ${contractId} ${anniversary}: falha ao concluir a tarefa de atraso`, error);
    return 0;
  }
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
  // O motivo (texto livre, pode citar valores) fica no payload: o histórico do contrato mostra a quem pode ver.
  const text = outcome === "mantido" ? `${details.quote ? describeQuote(details.quote) : "índice ≤ 0"}: mensalidade mantida` : "Reajuste dispensado pelo Financeiro (motivo no registro)";
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
  await notifyReadjustment(contract, {
    kind: "informativa",
    key: `reajuste_${outcome}_${contract.id}_${anniversary}`,
    title: (name) => `Reajuste ${outcome === "mantido" ? "sem aumento" : "dispensado"}: ${name}`,
    body: `Contrato ${contract.number}, data-base ${dmy(anniversary)}. ${text}.`,
  });
  await closeLateReadjustmentTasks(contract.id, anniversary, actor);
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
    log: hide ? redactReadjustmentLog(log) : log,
  };
}

/**
 * Financeiro aplica o reajuste agora: da data-base que chegou ou da próxima (até 60 dias antes). Sem `percent`, usa o
 * cálculo (índice/percentual do contrato) — índice ≤ 0 com «manter» registra «sem aumento»; com `percent`, o
 * informado (fica marcado como manual).
 */
export async function applyReadjustmentNow(input: { contractId: string; anniversary: string; percent?: number }, actor: UserRef): Promise<{ amendmentNumber?: string; monthlyBefore: number; monthlyAfter: number }> {
  const { contract, ctx } = await loadContext(input.contractId);
  if (contract.status !== "liberado") throw new BusinessError("O reajuste anual vale para contrato liberado");
  const state = contractReadjustmentState(contract, ctx);
  if (state.anniversary !== input.anniversary) throw new BusinessError("A data-base do reajuste mudou: recarregue a página");
  if (state.status === "renovacao") throw new BusinessError("Essa data-base fica para a renovação: o reajuste entra no aditivo de renovação");
  if (state.blockingAmendment) throw new BusinessError(`Aplique ou cancele o aditivo ${state.blockingAmendment} antes`);
  if (!state.due && -(state.days ?? 0) > EARLY_APPLY_DAYS) throw new BusinessError(`Dá para aplicar a partir de ${EARLY_APPLY_DAYS} dias antes da data-base`);
  // Mesma regra do cartão: aplicar quando a situação permite, ou registrar «sem aumento» quando a data-base chegou.
  const held = state.quote?.percent === 0;
  if (!state.canApply && !(held && state.due && state.canSkip)) throw new BusinessError(held ? "O acumulado não dá aumento: a data-base é registrada «sem aumento» quando chegar (ou dispense)." : `${state.message} Recarregue a página.`);
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
    if (quote.percent === 0) {
      // O índice da prévia ainda pode mudar: «sem aumento» é definitivo e só é registrado com a data-base chegada.
      if (!state.due) throw new BusinessError("O índice do período ainda pode mudar: «sem aumento» só é registrado a partir da data-base.");
      await recordReadjustmentDecision(contract.id, input.anniversary, "mantido", { quote }, actor);
      return { monthlyBefore: contract.monthlyTotal, monthlyAfter: contract.monthlyTotal };
    }
  }
  const r = await applyReadjustment(contract, input.anniversary, quote, actor, "financeiro");
  return { amendmentNumber: r.amendment.number, monthlyBefore: r.monthlyBefore, monthlyAfter: r.monthlyAfter };
}

/** Financeiro decide não reajustar a data-base (com motivo). */
export async function skipReadjustment(input: { contractId: string; anniversary: string; reason: string }, actor: UserRef): Promise<ContractReadjustmentLogEntry> {
  const { contract, ctx } = await loadContext(input.contractId);
  if (contract.status !== "liberado") throw new BusinessError("O reajuste anual vale para contrato liberado");
  const state = contractReadjustmentState(contract, ctx);
  if (state.anniversary !== input.anniversary) throw new BusinessError("A data-base do reajuste mudou: recarregue a página");
  if (state.status === "renovacao") throw new BusinessError("Essa data-base fica para a renovação: a decisão entra no aditivo de renovação");
  if (!state.canSkip) throw new BusinessError(`Dá para dispensar a partir de ${EARLY_APPLY_DAYS} dias antes da data-base: recarregue a página`);
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
  /** Ficaram para a próxima rotina (orçamento de tempo esgotado). */
  deferred: number;
  errors: string[];
  appliedContractIds: string[];
}

async function ensureLateTask(existing: Task[], contract: Contract, client: Client | undefined, anniversary: string, why: string, now: Date): Promise<boolean> {
  const title = lateTaskTitle(contract, client, anniversary);
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
      dueAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
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

/**
 * Tarefas «Reajuste não aplicado» de OUTRA data-base que a em foco: a anterior foi decidida por outro caminho ou
 * substituída pela seguinte (anterior ao acompanhamento) — não há mais o que fazer nela. Canceladas com o motivo.
 */
async function cancelObsoleteLateTasks(tasks: Task[], contract: Contract, anniversary: string): Promise<void> {
  const suffix = `(data-base ${dmy(anniversary)})`;
  const stale = tasks.filter((t) => t.processId === contract.id && t.processType === "contract" && OPEN_TASK_STATUSES.includes(t.status) && t.title.startsWith("Reajuste não aplicado") && !t.title.endsWith(suffix));
  if (stale.length === 0) return;
  const { cancelTaskInternal } = await import("@/server/tasks/service");
  for (const t of stale) {
    await cancelTaskInternal(t, SYSTEM_ACTOR, `A data-base desta tarefa já foi decidida ou ficou para trás: o reajuste em foco agora é o de ${dmy(anniversary)}`);
    t.status = "cancelada";
  }
}

export interface ContractReadjustmentRunOptions {
  /** Limite global da rotina (epoch ms): o cron inteiro tem 60 s e outras varreduras rodam antes. */
  deadline?: number;
  /** Só os contratos deste cliente (testes). */
  clientId?: string;
}

/** Prévia ao Financeiro e ao CS (uma por data-base). */
async function sendReadjustmentPreview(c: Contract, state: ContractReadjustmentState, anniversary: string, indices: Map<string, ReadjustmentIndex>): Promise<boolean> {
  const index = c.readjustment?.type === "indice" && c.readjustment.index ? indices.get(c.readjustment.index) : undefined;
  const lead = readjustmentLeadDays(c);
  const preview = state.quote ? `prévia ${describeQuote(state.quote)}` : "prévia ainda sem o índice do período";
  const when = state.due
    ? `o índice do período ainda não saiu: entra sozinho quando sair (até ${READJUSTMENT_GRACE_DAYS} dias depois da data-base)`
    : lead > 0
      ? `entra sozinho a partir de ${dmy(addDaysKey(anniversary, -lead))} (cobrança anual: antes do vencimento da parcela do ano) com o índice publicado até lá`
      : "entra sozinho na data-base com o índice publicado até lá";
  const sent = await notifyReadjustment(c, {
    kind: "acao",
    // Sem o índice do período, uma prévia sem número; quando ele sai, a prévia com o percentual (chave própria).
    key: `reajuste_previa_${c.id}_${anniversary}${state.quote ? "" : "_sem_indice"}`,
    title: (name) => `Reajuste em ${dmy(anniversary)}: ${name}`,
    body: `Contrato ${c.number} (${index ? `${index.name} · ${describeIndexSource(index.source)}` : describeReadjustment(c.readjustment)}): ${preview}. ${when[0].toUpperCase()}${when.slice(1)}; avise o cliente.`,
  });
  return sent > 0;
}

export async function runContractReadjustments(now: Date = new Date(), options: ContractReadjustmentRunOptions = {}): Promise<ContractReadjustmentRunResult> {
  const today = dateKey(now);
  const contracts = (await list<Contract>(COLLECTIONS.contracts, { where: [["status", "==", "liberado"]] })).filter((c) => hasReadjustmentRule(c) && c.startDate && (!options.clientId || c.clientId === options.clientId));
  const result: ContractReadjustmentRunResult = { contracts: contracts.length, applied: 0, held: 0, waiting: 0, notices: 0, lateTasks: 0, deferred: 0, errors: [], appliedContractIds: [] };
  const deadline = Math.min(Date.now() + RUN_BUDGET_MS, options.deadline ?? Number.POSITIVE_INFINITY);
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
      // Reajuste automático que ficou em rascunho (falha entre criar e aplicar): aplica de novo — ou cancela, se o
      // contrato mudou depois (outra versão) ou a data-base já foi decidida por outro caminho; a rotina recria.
      const stuck = amendments.find((a) => a.status === "rascunho" && a.readjust && !a.requiresSignature && a.source === "reajuste_automatico");
      if (stuck) {
        if (Date.now() > deadline) {
          result.deferred += 1;
          continue;
        }
        const decided = (c.readjustmentLog ?? []).some((e) => sameMonth(e.anniversary, stuck.readjust!.anniversary));
        try {
          if (decided || stuck.before.version !== c.version) throw new BusinessError(decided ? "data-base já decidida" : `contrato mudou (v${stuck.before.version} → v${c.version})`);
          await applyAmendment(stuck.id, SYSTEM_ACTOR);
          result.applied += 1;
          result.appliedContractIds.push(c.id);
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          await cancelAmendment(stuck.id, `Rascunho de reajuste desatualizado: ${why}`.slice(0, 480), SYSTEM_ACTOR);
          result.errors.push(`${c.number}: rascunho de reajuste ${stuck.number} cancelado (${why})`);
        }
        continue;
      }
      const state = contractReadjustmentState(c, { indices, amendments, today });
      const anniversary = state.anniversary;
      if (!anniversary) continue;
      // Com aditivo em andamento, a data-base que ele cobre ainda não foi decidida de fato: as tarefas ficam.
      if (!amendments.some((a) => AMENDMENT_OPEN_STATUSES.includes(a.status))) await cancelObsoleteLateTasks(tasks, c, anniversary);
      if (state.due) {
        if (state.status === "pronto" && state.quote) {
          // Orçamento de tempo da rotina (cron de 60 s): o que sobrar fica para amanhã, dentro da folga.
          if (Date.now() > deadline) {
            result.deferred += 1;
            continue;
          }
          if (state.quote.percent === 0) {
            await recordReadjustmentDecision(c.id, anniversary, "mantido", { quote: state.quote }, SYSTEM_ACTOR);
            result.held += 1;
          } else {
            await applyReadjustment(c, anniversary, state.quote, SYSTEM_ACTOR, "reajuste_automatico");
            result.applied += 1;
            result.appliedContractIds.push(c.id);
          }
        } else if (state.status === "aguardando_indice") {
          result.waiting += 1;
          // Sem a prévia antes (contrato anual com índice atrasado): o CS fica sabendo antes do vencimento da parcela.
          if (await sendReadjustmentPreview(c, state, anniversary, indices)) result.notices += 1;
        } else if (state.status === "atrasado" || (state.status === "bloqueado" && (!state.blockingAmendment || (state.days ?? 0) > READJUSTMENT_GRACE_DAYS))) {
          if (await ensureLateTask(tasks, c, client, anniversary, state.message, now)) result.lateTasks += 1;
        }
      } else if ((state.status === "previsto" || state.status === "aguardando_indice") && -(state.days ?? 0) <= READJUSTMENT_NOTICE_DAYS + readjustmentLeadDays(c)) {
        if (await sendReadjustmentPreview(c, state, anniversary, indices)) result.notices += 1;
      }
    } catch (error) {
      result.errors.push(`${c.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
