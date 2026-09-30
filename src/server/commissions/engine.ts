import "server-only";
/**
 * Motor de comissionamento v2 (D10–D12): reconcilia as comissões de um ou mais contratos com o estado atual
 * (itens efetivos do contrato, regras, cobranças e datas). É o ÚNICO caminho que cria ou muda comissões
 * automaticamente — chamado pelos handlers (venda ganha, assinatura, pagamento, inadimplência, cancelamento,
 * liberação, alteração de itens), pela varredura diária "comissoes" e pelo seed (data de referência do seed).
 *
 * Idempotência:
 * - cada comissão tem chave determinística `contractId|revenueType|productId|parcela|ruleId` e id `com_<hash>`,
 *   criada com createIfAbsent (nunca sobrescreve); o código COM-AAAA-NNNNN só é emitido quando o documento nasce;
 * - toda troca de status é uma transação condicionada ao status lido (transitionCommission): rodar o motor duas vezes,
 *   ou handler e varredura ao mesmo tempo, não emite evento nem gera título em dobro;
 * - o título da comissão elegível é `pag_<commissionId>` (createIfAbsent).
 *
 * Efeitos:
 * - venda ganha / contrato criado → previstas (projeção) por item × tipo de receita × regra aplicável;
 * - gatilho cumprido (assinatura, pagamento…) → em carência (se houver carência não cumprida) ou Elegível;
 * - Elegível → título em Contas a Pagar (comissão "Título gerado");
 * - cobrança vencida da parcela → aguardando recebimento (não cancela; volta a andar quando for paga);
 * - contrato cancelado → tudo que não foi adquirido vira cancelada (nada futuro); pagas nunca são apagadas
 *   (estorno só manual, com motivo — service.ts);
 * - regra/itens alterados → previstas que deixaram de existir são canceladas e as novas criadas.
 */
import { createIfAbsent, getManyByIds, list } from "@/server/db";
import { emitEvent } from "@/server/events";
import { dateKey, formatCurrency } from "@/lib/format";
import { contractEffectiveItems, effectiveTotals } from "@/domain/sale-closing";
import { COMMISSION_PENDING_STATUSES, COMMISSION_REVENUE_LABELS, COMMISSION_REVENUE_TYPES, COMMISSION_STATUS_LABELS } from "@/domain/commissions";
import {
  COLLECTIONS,
  type Billing,
  type Commission,
  type CommissionHistoryEntry,
  type CommissionRule,
  type CommissionStatus,
  type Contract,
  type Opportunity,
  type Product,
  type UserRef,
} from "@/domain/types";
import { evaluateSlot, planSlots, resolveRules, type SlotEvaluation } from "./rules";
import { assignCommissionCode, commissionIdFor, deleteField, historyEntry, SYSTEM_ACTOR, transitionCommission } from "./store";
import { ensurePayableForCommission, getCommissionPaymentSettings } from "./payables";

export { SYSTEM_ACTOR };

export interface ReconcileOptions {
  /** Contratos a reconciliar (padrão: todos os contratos vindos de venda). */
  contractIds?: string[];
  /** Data de referência (padrão: agora). O seed usa a data de referência do seed. */
  now?: Date;
  actor?: UserRef;
  /** Emitir eventos (padrão true; o seed desliga para não disparar notificações e automações). */
  emit?: boolean;
  /** Seed: datas de criação/histórico nas datas de origem (venda, pagamento, elegibilidade). */
  backfill?: boolean;
  /** Gerar título para as elegíveis (padrão true). */
  payables?: boolean;
}

export interface ReconcileResult {
  contracts: number;
  created: number;
  updated: number;
  released: number;
  inGrace: number;
  awaiting: number;
  cancelled: number;
  payables: number;
  /** Tipos de receita pulados porque o motor v1 já liberou/pagou comissão para o item. */
  skippedLegacy: number;
  commissionIds: string[];
}

const emptyResult = (): ReconcileResult => ({ contracts: 0, created: 0, updated: 0, released: 0, inGrace: 0, awaiting: 0, cancelled: 0, payables: 0, skippedLegacy: 0, commissionIds: [] });

interface Desired {
  id: string;
  sourceKey: string;
  productId: string;
  productName: string;
  evaluation: SlotEvaluation;
  doc: Omit<Commission, "id" | "organizationId" | "createdAt" | "updatedAt" | "status" | "history">;
}

/** Contrato que gera comissão: nasceu de uma venda (tem vendedor). */
export function isCommissionable(contract: Pick<Contract, "sellerId" | "opportunityId">): boolean {
  return Boolean(contract.sellerId || contract.opportunityId);
}

/** Campos comparados para decidir se uma comissão pendente precisa ser atualizada. */
function signature(c: Pick<Commission, "status" | "amount" | "baseAmount" | "competence" | "eligibleAt" | "billingId" | "calc" | "ruleSnapshot">): string {
  return JSON.stringify([c.status, c.amount, c.baseAmount, c.competence, c.eligibleAt ?? null, c.billingId ?? null, c.calc?.steps ?? null, c.calc?.formula ?? null, c.ruleSnapshot ?? null]);
}

export async function reconcileCommissions(options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const now = options.now ?? new Date();
  const actor = options.actor ?? SYSTEM_ACTOR;
  const result = emptyResult();
  const all = options.contractIds ? Array.from((await getManyByIds<Contract>(COLLECTIONS.contracts, options.contractIds)).values()) : await list<Contract>(COLLECTIONS.contracts);
  const contracts = all.filter(isCommissionable).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (contracts.length === 0) return result;
  const ids = contracts.map((c) => c.id);
  const [rules, products, billings, commissions, opps, settings] = await Promise.all([
    list<CommissionRule>(COLLECTIONS.commissionRules),
    list<Product>(COLLECTIONS.products),
    list<Billing>(COLLECTIONS.billing, { where: [["contractId", "in", ids]] }),
    list<Commission>(COLLECTIONS.commissions, { where: [["contractId", "in", ids]] }),
    getManyByIds<Opportunity>(COLLECTIONS.opportunities, contracts.map((c) => c.opportunityId ?? "")),
    getCommissionPaymentSettings(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const contract of contracts) {
    try {
      await reconcileContract(contract, {
        rules,
        products: productById,
        billings: billings.filter((b) => b.contractId === contract.id),
        commissions: commissions.filter((c) => c.contractId === contract.id),
        opp: contract.opportunityId ? opps.get(contract.opportunityId) : undefined,
        now,
        actor,
        emit: options.emit !== false,
        backfill: Boolean(options.backfill),
        payables: options.payables !== false,
        settings,
        result,
      });
      result.contracts++;
    } catch (error) {
      console.error(`[comissoes] falha ao reconciliar o contrato ${contract.id}`, error);
    }
  }
  return result;
}

interface ContractContext {
  rules: CommissionRule[];
  products: Map<string, Product>;
  billings: Billing[];
  commissions: Commission[];
  opp?: Opportunity;
  now: Date;
  actor: UserRef;
  emit: boolean;
  backfill: boolean;
  payables: boolean;
  settings: Awaited<ReturnType<typeof getCommissionPaymentSettings>>;
  result: ReconcileResult;
}

const PENDING = COMMISSION_PENDING_STATUSES;
const CANCELLABLE_ON_CONTRACT: readonly CommissionStatus[] = [...PENDING, "bloqueada"];
const minIso = (a: string, b: string) => (a < b ? a : b);

async function reconcileContract(contract: Contract, ctx: ContractContext): Promise<void> {
  const { actor, now, result } = ctx;
  const nowIsoStr = now.toISOString();
  const sellerId = contract.sellerId ?? ctx.opp?.ownerId;
  if (!sellerId) return;
  const saleDate = ctx.opp?.wonAt ?? contract.createdAt;
  const saleNumber = contract.saleNumber ?? ctx.opp?.saleNumber;
  const existing = new Map(ctx.commissions.map((c) => [c.id, c]));

  // Contrato cancelado: nada que não foi adquirido segue; nada futuro é gerado.
  if (contract.status === "cancelado") {
    const reason = `Contrato ${contract.number} cancelado${contract.cancelReason ? `: ${contract.cancelReason}` : ""}`;
    await cancelMany(Array.from(existing.values()).filter((c) => CANCELLABLE_ON_CONTRACT.includes(c.status)), reason, contract, ctx, contract.cancelledAt);
    return;
  }

  // Itens efetivos (líquidos) do contrato × regras aplicáveis → parcelas desejadas.
  const items = contractEffectiveItems(contract);
  const totals = effectiveTotals(items);
  const legacy = Array.from(existing.values()).filter((c) => !c.sourceKey);
  const legacyEarned = new Set(legacy.filter((c) => c.status === "liberada" || c.status === "titulo_gerado" || c.status === "paga").map((c) => `${c.productId}|${c.revenueType}`));
  const desired = new Map<string, Desired>();
  const seenProducts = new Map<string, number>();
  for (const item of items) {
    const occurrence = (seenProducts.get(item.productId) ?? 0) + 1;
    seenProducts.set(item.productId, occurrence);
    const productKey = occurrence === 1 ? item.productId : `${item.productId}#${occurrence}`;
    const product = ctx.products.get(item.productId);
    for (const revenueType of COMMISSION_REVENUE_TYPES) {
      if (legacyEarned.has(`${item.productId}|${revenueType}`)) {
        result.skippedLegacy++;
        continue;
      }
      const applicable = resolveRules(ctx.rules, { contractId: contract.id, sellerId, productId: item.productId, productCategory: product?.category, revenueType, saleDate: dateKey(saleDate) }, product);
      for (const rule of applicable) {
        for (const spec of planSlots(rule, item, contract, totals, ctx.billings)) {
          const sourceKey = [contract.id, revenueType, productKey, spec.slot, rule.id].join("|");
          const id = commissionIdFor(sourceKey);
          const evaluation = evaluateSlot({ rule, spec, item, contract, billings: ctx.billings, saleDate, now });
          desired.set(id, {
            id,
            sourceKey,
            productId: item.productId,
            productName: item.productName,
            evaluation,
            doc: {
              userId: sellerId,
              clientId: contract.clientId,
              contractId: contract.id,
              opportunityId: contract.opportunityId,
              productId: item.productId,
              productName: item.productName,
              revenueType,
              baseAmount: evaluation.base,
              amount: evaluation.amount,
              competence: evaluation.competence,
              releaseAt: evaluation.eligibleAt,
              ruleId: rule.source === "regra" ? rule.id : undefined,
              sourceKey,
              slot: spec.slot,
              installment: spec.installment,
              saleNumber,
              ruleSnapshot: rule,
              calc: { steps: evaluation.steps, formula: evaluation.formula },
              billingId: evaluation.billing?.id,
              eligibleAt: evaluation.eligibleAt,
              createdBy: actor.id,
            },
          });
        }
      }
    }
  }

  // Previstas do motor v1 (sem chave) e pendentes que deixaram de existir (regra/itens alterados) → canceladas.
  const legacyPending = legacy.filter((c) => c.status === "prevista");
  await cancelMany(legacyPending, "Substituída pelo cálculo do motor de comissões v2 (itens efetivos do contrato)", contract, ctx);
  const obsolete = Array.from(existing.values()).filter((c) => c.sourceKey && PENDING.includes(c.status) && !desired.has(c.id));
  await cancelMany(obsolete, "Regra de comissão ou itens do contrato alterados: parcela substituída", contract, ctx);

  // Criação e atualização.
  const created: Commission[] = [];
  for (const d of desired.values()) {
    const ev = d.evaluation;
    const current = existing.get(d.id);
    if (!current) {
      const createdAt = ctx.backfill ? minIso(saleDate, nowIsoStr) : nowIsoStr;
      const history: CommissionHistoryEntry[] = [historyEntry(actor, "prevista", undefined, "Prevista na venda (projeção)", createdAt)];
      if (ev.status !== "prevista") {
        const at = ctx.backfill ? minIso(ev.eligibleAt ?? ev.triggeredAt ?? nowIsoStr, nowIsoStr) : nowIsoStr;
        history.push(historyEntry(actor, ev.status, "prevista", transitionNote(ev), at));
      }
      const { created: isNew, doc } = await createIfAbsent<Commission>(COLLECTIONS.commissions, d.id, { ...d.doc, status: ev.status, history, createdAt, updatedAt: createdAt });
      if (!isNew) {
        existing.set(d.id, doc);
        continue;
      }
      const code = await assignCommissionCode(d.id, createdAt);
      const full = { ...doc, code };
      created.push(full);
      existing.set(d.id, full);
      result.created++;
      result.commissionIds.push(d.id);
      tally(result, ev.status);
      if (ev.status === "liberada") await onReleased(full, contract, ctx);
      continue;
    }
    if (!PENDING.includes(current.status)) continue;
    const next = { ...current, ...d.doc, status: ev.status } as Commission;
    if (signature(current) === signature(next)) continue;
    const statusChanged = current.status !== ev.status;
    const at = ctx.backfill ? minIso(ev.eligibleAt ?? ev.triggeredAt ?? nowIsoStr, nowIsoStr) : nowIsoStr;
    const changed = await transitionCommission(
      d.id,
      [current.status],
      {
        status: ev.status,
        baseAmount: ev.base,
        amount: ev.amount,
        competence: ev.competence,
        releaseAt: ev.eligibleAt ?? deleteField(),
        eligibleAt: ev.eligibleAt ?? deleteField(),
        billingId: ev.billing?.id ?? deleteField(),
        calc: d.doc.calc,
        ruleSnapshot: d.doc.ruleSnapshot,
        ruleId: d.doc.ruleId ?? deleteField(),
        saleNumber,
      },
      statusChanged ? historyEntry(actor, ev.status, current.status, transitionNote(ev), at) : undefined,
    );
    if (!changed) continue;
    result.updated++;
    result.commissionIds.push(d.id);
    existing.set(d.id, changed.after);
    if (statusChanged) {
      tally(result, ev.status);
      if (ev.status === "liberada") await onReleased(changed.after, contract, ctx);
    }
  }

  // Elegíveis sem título (inclusive do motor v1, ou de uma execução interrompida) → título.
  if (ctx.payables) {
    for (const c of existing.values()) {
      if (c.status === "liberada" && !c.payableId && !(c.previousPayableIds?.length) && !created.includes(c)) {
        const r = await ensurePayableForCommission(c, { actor, emit: ctx.emit, backfill: ctx.backfill, settings: ctx.settings });
        if (r?.created) result.payables++;
      }
    }
  }

  if (created.length > 0 && ctx.emit) {
    const total = created.reduce((s, c) => s + c.amount, 0);
    const byType = { setup: 0, recorrencia: 0, hardware: 0 };
    for (const c of created) byType[c.revenueType] = Math.round((byType[c.revenueType] + c.amount) * 100) / 100;
    await emitEvent({
      type: "commission.calculated",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Comissão prevista calculada: ${formatCurrency(total)}`,
      description: COMMISSION_REVENUE_TYPES.filter((t) => byType[t] > 0)
        .map((t) => `${COMMISSION_REVENUE_LABELS[t]} ${formatCurrency(byType[t])}`)
        .join(" · "),
      department: "vendas",
      payload: { userId: sellerId, opportunityId: contract.opportunityId, contractId: contract.id, saleNumber, total, byType, commissionIds: created.map((c) => c.id) },
      timeline: false,
    });
  }
}

function tally(result: ReconcileResult, status: CommissionStatus): void {
  if (status === "liberada") result.released++;
  else if (status === "em_carencia") result.inGrace++;
  else if (status === "aguardando_recebimento") result.awaiting++;
}

function transitionNote(ev: SlotEvaluation): string {
  if (ev.status === "liberada") return "Condições cumpridas: elegível";
  if (ev.status === "em_carencia") return ev.eligibleAt ? `Gatilho cumprido; carência até ${dateKey(ev.eligibleAt).split("-").reverse().join("/")}` : "Gatilho cumprido; carência aguardando o início do contrato";
  if (ev.status === "aguardando_recebimento") return `Aguardando recebimento: ${ev.waiting ?? "cobrança vencida"}`;
  return `Aguardando ${ev.waiting ?? "gatilho"}`;
}

/** Comissão acabou de ficar elegível: evento commission.released (uma vez) e título em Contas a Pagar. */
async function onReleased(commission: Commission, contract: Contract, ctx: ContractContext): Promise<void> {
  if (ctx.emit) {
    await emitEvent({
      type: "commission.released",
      actor: ctx.actor,
      clientId: commission.clientId,
      entity: { type: "commission", id: commission.id },
      title: `Comissão ${commission.code ?? ""} elegível: ${formatCurrency(commission.amount)}`.replace("  ", " "),
      description: `${COMMISSION_REVENUE_LABELS[commission.revenueType]} · ${commission.productName ?? ""} · contrato ${contract.number}`,
      department: "financeiro",
      payload: { commissionId: commission.id, userId: commission.userId, contractId: contract.id, amount: commission.amount, eligibleAt: commission.eligibleAt, changes: { status: { from: "prevista", to: "liberada" } } },
      timeline: false,
    });
  }
  if (ctx.payables) {
    const r = await ensurePayableForCommission(commission, { actor: ctx.actor, emit: ctx.emit, backfill: ctx.backfill, settings: ctx.settings });
    if (r?.created) ctx.result.payables++;
  }
}

async function cancelMany(list: Commission[], reason: string, contract: Contract, ctx: ContractContext, at?: string): Promise<void> {
  if (list.length === 0) return;
  const when = at ?? ctx.now.toISOString();
  const cancelled: Commission[] = [];
  for (const c of list) {
    const changed = await transitionCommission(c.id, CANCELLABLE_ON_CONTRACT, () => ({ status: "cancelada", cancelledAt: when, cancelReason: reason}), historyEntry(ctx.actor, "cancelada", c.status, reason, ctx.backfill ? when : undefined));
    if (changed) cancelled.push(changed.after);
  }
  ctx.result.cancelled += cancelled.length;
  if (cancelled.length > 0 && ctx.emit) {
    const total = cancelled.reduce((s, c) => s + c.amount, 0);
    await emitEvent({
      type: "commission.cancelled",
      actor: ctx.actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `${cancelled.length} comissão(ões) cancelada(s) (${formatCurrency(total)})`,
      description: reason,
      department: "financeiro",
      payload: {
        contractId: contract.id,
        commissionIds: cancelled.map((c) => c.id),
        reason,
        total,
        changes: Object.fromEntries(cancelled.map((c) => [c.id, { from: COMMISSION_STATUS_LABELS[list.find((x) => x.id === c.id)?.status ?? "prevista"], to: COMMISSION_STATUS_LABELS.cancelada }])),
      },
      timeline: false,
    });
  }
}

/** Reconcilia só um contrato (handlers). Falhas não derrubam o fluxo que chamou. */
export async function reconcileContractCommissions(contractId: string | undefined | null, actor?: UserRef): Promise<ReconcileResult> {
  if (!contractId) return emptyResult();
  return reconcileCommissions({ contractIds: [contractId], actor });
}
