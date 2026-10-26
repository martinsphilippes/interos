import "server-only";
/**
 * Aditivos do MESMO contrato (D25) e renovação como aditivo (D26). Sem contrato filho: as chaves de comissão,
 * cobrança, projeto e MRR são por contractId e continuam valendo.
 *
 * Fluxo: `createAmendment` (rascunho com before/after/changes calculados AQUI) → `sendAmendmentForSignature`
 * (hash próprio; o hash do contrato original NÃO muda) → `registerAmendmentSignature` (evidência manual por
 * assinante, como no contrato) → `applyAmendment` (transação: contrato ← after, version + 1, previousVersions com o
 * snapshot completo; depois: contract.updated com changes, comissões previstas/em carência recalculadas,
 * client_products sincronizados, cobranças futuras refeitas mantendo a numeração; NENHUM projeto de implantação
 * novo — só aviso ao gestor quando entra item novo em contrato liberado). `requiresSignature: false` → "Aplicar"
 * direto pelo Financeiro. Renovação (kind "renovacao") também gera as mensalidades do novo prazo.
 */
import { createHash } from "node:crypto";
import { docdb, FieldValue } from "@/server/docdb";
import { col, createIfAbsent, getById, getManyByIds, list, nowIso, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { getDepartmentManager } from "@/server/workflow/service";
import { auditChanges, describeChanges } from "@/server/audit";
import { proposalTotals } from "@/components/sales/model";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import {
  AMENDMENT_FIELD_LABELS,
  AMENDMENT_KIND_LABELS,
  AMENDMENT_OPEN_STATUSES,
  amendmentKindFor,
  amendmentRequiresSignatureByDefault,
  contractSnapshot,
  describeSnapshotValue,
  SNAPSHOT_FIELDS,
} from "@/domain/contract-snapshot";
import { COLLECTIONS, type AmendmentReadjust, type Billing, type Client, type Contract, type ContractAmendment, type ContractReadjustment, type ContractReadjustmentLogEntry, type ContractSignerEntry, type ContractSnapshot, type Document, type ItemSince, type Product, type ProposalItem, type UserRef } from "@/domain/types";
import { addCompetence, addDaysKey, addMonthsClamped, coveredAnniversaries, formatPct, hasReadjustmentRule, inReadjustmentGap, MAX_AUTO_PERCENT, nextReadjustmentGaps, quoteReadjustment, READJUSTMENT_NOTICE_DAYS, readjustmentFloor, readjustmentSchedule, sameReadjustmentRule } from "@/domain/readjustment";
import { BusinessError } from "@/server/auth/error-classes";
import { readjustmentBaseDate } from "./readjustment-base";
import { getReadjustmentIndexMap, normalizeReadjustment } from "@/server/finance-registry/indices";
import { billingDocId, dayInMonth, dueIso, lastRecurringBilling, recurringStep, round2, todayKey } from "./billing";
import type { AmendmentInput, AmendmentSignatureInput } from "./schemas";
import { addContractDocument, billingCancellationPatch, cancelChargeAtProvider, createBillingWithDeterministicId, generateNextBillings, loadContract, providerChargeFields, syncClientProductsFromContract } from "./service";

const APPLICABLE_STATUSES: readonly Contract["status"][] = ["assinado", "aguardando_pagamento", "pago", "liberado", "pendencia"];

export async function loadAmendment(id: string): Promise<ContractAmendment> {
  const a = await getById<ContractAmendment>(COLLECTIONS.contractAmendments, id);
  if (!a) throw new Error("Aditivo não encontrado");
  return a;
}

export async function listContractAmendments(contractId: string): Promise<ContractAmendment[]> {
  return (await list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["contractId", "==", contractId]] })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Hash do termo aditivo: identifica o conteúdo assinado (contrato base + antes/depois + motivo + signatários). */
export function amendmentDocumentHash(a: Pick<ContractAmendment, "number" | "contractId" | "kind" | "effectiveFrom" | "reason" | "before" | "after" | "signers">): string {
  const canonical = {
    number: a.number,
    contractId: a.contractId,
    kind: a.kind,
    effectiveFrom: a.effectiveFrom,
    reason: a.reason,
    before: a.before,
    after: a.after,
    signers: (a.signers ?? []).map((s) => ({ name: s.name, email: s.email, role: s.role })),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), 12)).toISOString();
}

/** Itens com o reajuste percentual aplicado aos valores recorrentes (mensalidade), centavos arredondados. */
export function readjustItems(items: ProposalItem[], percent: number): ProposalItem[] {
  const factor = 1 + percent / 100;
  return items.map((i) => ({ ...i, monthlyValue: round2(i.monthlyValue * factor) }));
}

/** Itens normalizados; a origem por aditivo (`since`) dos itens já existentes é preservada (o motor de comissões depende dela). */
function normalizeItems(items: NonNullable<AmendmentInput["items"]>, previous: ProposalItem[]): ProposalItem[] {
  return items.map((i) => {
    const prior = previous.find((p) => p.productId === i.productId && p.since);
    return { productId: i.productId, productName: i.productName, quantity: i.quantity, setupValue: round2(i.setupValue), monthlyValue: round2(i.monthlyValue), hardwareValue: round2(i.hardwareValue), discountPct: i.discountPct, ...(prior?.since ? { since: prior.since } : {}) };
  });
}

export interface AmendmentReadjustOptions {
  /** Reajuste anual calculado (data-base + percentual): aplicado na mensalidade (renovação ou aditivo "reajuste"). */
  readjust?: AmendmentReadjust;
  /** Renovação numa data-base cujo índice do período ainda não saiu: fica pendente (a rotina aplica na data-base). */
  pendingIndex?: string;
  pendingIndexName?: string;
}

/**
 * Calcula o "depois" a partir do contrato e da entrada. Renovação: endDate = base (fim atual ou hoje) + meses,
 * `termMonths` PRESERVADO. Reajuste anual (`readjust`, calculado no servidor pela data-base): mensalidade de cada item
 * × (1 + %), na renovação ou sozinho (aditivo "reajuste").
 */
export function buildAmendmentAfter(contract: Contract, input: Omit<AmendmentInput, "contractId" | "reason" | "effectiveFrom" | "requiresSignature">, options: AmendmentReadjustOptions = {}): { after: ContractSnapshot; renewalMonths?: number; readjustment?: ContractReadjustment } {
  const before = contractSnapshot(contract);
  const after: ContractSnapshot = { ...before, items: before.items.map((i) => ({ ...i })) };
  let readjustment: ContractReadjustment | undefined;
  let renewalMonths: number | undefined;
  if (input.items) {
    after.items = normalizeItems(input.items, before.items);
    const totals = proposalTotals(after.items);
    after.setupTotal = totals.setupTotal;
    after.monthlyTotal = totals.monthlyTotal;
    after.hardwareTotal = totals.hardwareTotal;
  }
  const c = input.conditions;
  if (c) {
    if (c.billingDay !== undefined) after.billingDay = c.billingDay;
    if (c.recurrence !== undefined) after.recurrence = c.recurrence;
    if (c.termMonths !== undefined) after.termMonths = c.termMonths;
    if (c.paymentCondition !== undefined) {
      if (c.paymentCondition) after.paymentCondition = c.paymentCondition;
      else delete after.paymentCondition;
    }
    if (c.firstDueDate !== undefined) {
      if (c.firstDueDate) after.firstDueDate = dueIso(c.firstDueDate);
      else delete after.firstDueDate;
    }
    if (c.paymentMethod !== undefined) after.paymentMethod = c.paymentMethod;
    if (c.setupInstallments !== undefined) after.setupInstallments = c.setupInstallments;
    if (c.autoRenew !== undefined) after.autoRenew = c.autoRenew;
    if (c.renewalTermMonths !== undefined) after.renewalTermMonths = c.renewalTermMonths;
    // Mesma regra reenviada pelo formulário: o «aguardando o índice» do contrato continua (não é mudança).
    if (c.readjustment !== undefined) after.readjustment = stripUndefined({ ...c.readjustment, pending: sameReadjustmentRule(before.readjustment, c.readjustment as ContractReadjustment) ? before.readjustment?.pending : undefined });
    if (c.noticeDays !== undefined) after.noticeDays = c.noticeDays;
  }
  const readjust = options.readjust;
  if (readjust && readjust.percent !== 0) {
    after.items = readjustItems(after.items, readjust.percent);
    after.monthlyTotal = proposalTotals(after.items).monthlyTotal;
  }
  if (input.renewal) {
    const today = todayKey();
    const base = contract.endDate && dateKey(contract.endDate) >= today ? contract.endDate : dueIso(today);
    after.endDate = addMonthsIso(base, input.renewal.months);
    renewalMonths = input.renewal.months;
    // Reajuste da data-base decidido nesta renovação (termo e evento). Sem data-base nela (ou reajuste que fica para a
    // rotina/Financeiro): nada — a regra do contrato continua e o termo não fala de reajuste.
    if (readjust?.waived) readjustment = { type: "nenhum" };
    else if (readjust) readjustment = readjust.type === "percentual" ? { type: "percentual", percent: readjust.percent } : stripUndefined({ type: "indice" as const, index: readjust.indexId, indexName: readjust.indexName });
    else if (options.pendingIndex) readjustment = stripUndefined({ type: "indice" as const, index: options.pendingIndex, indexName: options.pendingIndexName, pending: true });
  }
  return { after, renewalMonths, readjustment };
}

export interface CreateAmendmentOptions {
  source?: ContractAmendment["source"];
  renewalId?: string;
  /** Emitir eventos (o seed desliga). */
  emit?: boolean;
  /** Aditivo de reajuste anual (sem itens/condições/renovação): data-base e percentual já calculados. */
  readjust?: AmendmentReadjust;
}

/**
 * Data-base que a renovação decide: a mais recente ainda não decidida que cai do fim atual da vigência (inclusive) até
 * o mês da vigência da renovação. Data-base dentro da vigência atual é do aditivo de reajuste próprio (varredura
 * `reajustes_contratos`), vigente nela. Contrato antigo sem início registrado: a própria renovação é a data-base.
 * Contrato com regra decide as datas-base na ordem: uma anterior ainda pendente (desde o acompanhamento) segura a da
 * renovação (`blockedBy`), que fica para a rotina depois dela.
 */
function renewalAnniversary(contract: Contract, covered: readonly string[], effectiveFrom: string, explicit: boolean): { anniversary: string | null; blockedBy?: string; waiting?: string } {
  const baseDate = readjustmentBaseDate(contract);
  if (!baseDate) return { anniversary: covered.some((c) => c.slice(0, 7) === effectiveFrom.slice(0, 7)) ? null : effectiveFrom };
  const monthEnd = addMonthsClamped(`${effectiveFrom.slice(0, 7)}-31`, 0);
  const base = { startDate: baseDate, covered, today: monthEnd, gaps: contract.readjustmentGaps };
  // Os períodos sem regra valem para a regra do contrato; a escolha do CS na renovação vale para a data-base dela.
  const own = readjustmentSchedule(explicit ? { ...base, gaps: undefined } : base).due;
  if (!own || (contract.endDate && own.anniversary < dateKey(contract.endDate))) return { anniversary: null };
  // Contrato com regra (ou que já teve: períodos sem regra registrados) decide na ordem.
  if (hasReadjustmentRule(contract) || (contract.readjustmentGaps?.length ?? 0) > 0) {
    const first = readjustmentSchedule({ ...base, floor: readjustmentFloor(contract) }).due;
    if (first && first.anniversary < own.anniversary) return { anniversary: null, blockedBy: first.anniversary, waiting: own.anniversary };
  }
  return { anniversary: own.anniversary };
}

/** Cria o aditivo em rascunho com before/after/changes calculados no servidor. Um aditivo em andamento por contrato. */
export async function createAmendment(input: AmendmentInput, actor: UserRef, options: CreateAmendmentOptions = {}): Promise<ContractAmendment> {
  const contract = await loadContract(input.contractId);
  if (!APPLICABLE_STATUSES.includes(contract.status)) throw new Error("Aditivo só em contrato assinado (ou já liberado). Antes da assinatura, altere itens e condições diretamente no contrato.");
  const existing = await listContractAmendments(contract.id);
  const open = existing.find((a) => AMENDMENT_OPEN_STATUSES.includes(a.status));
  if (open) throw new Error(`Já existe o aditivo ${open.number} em andamento (${open.status.replace("_", " ")}). Aplique ou cancele antes de criar outro.`);
  if (input.items && input.items.length === 0) throw new Error("O contrato precisa de pelo menos um item");
  // Índice escolhido precisa estar no cadastro e ativo (o que o contrato já usa continua valendo).
  if (input.conditions?.readjustment) input = { ...input, conditions: { ...input.conditions, readjustment: await normalizeReadjustment(input.conditions.readjustment as ContractReadjustment, contract.readjustment) } };
  if (input.renewal?.readjustment) input = { ...input, renewal: { ...input.renewal, readjustment: await normalizeReadjustment(input.renewal.readjustment as ContractReadjustment, contract.readjustment) } };
  const effectiveFrom = input.effectiveFrom.slice(0, 10);
  const covered = coveredAnniversaries(contract, existing);
  let readjust = options.readjust;
  let pendingIndex: string | undefined;
  let pendingIndexName: string | undefined;
  let readjustNote: string | undefined;
  if (readjust) {
    if (input.items || input.conditions || input.renewal) throw new BusinessError("O reajuste anual vai num aditivo só dele");
    const month = readjust.anniversary.slice(0, 7);
    if (covered.some((c) => c.slice(0, 7) === month)) throw new BusinessError(`O reajuste da data-base ${formatDate(dueIso(readjust.anniversary))} já foi decidido`);
  } else if (input.renewal) {
    // Renovação: a data-base que cai do fim atual da vigência (inclusive) até o mês da renovação é decidida nela.
    // «Conforme o contrato» (sem escolha, ou a própria regra do contrato) segue a regra com as MESMAS travas da rotina
    // `reajustes_contratos`; uma escolha diferente (do CS) vale só para essa data-base — a regra do contrato não muda.
    const chosen = input.renewal.readjustment as ContractReadjustment | undefined;
    let explicit = chosen && !sameReadjustmentRule(chosen, contract.readjustment) ? chosen : undefined;
    const contractHasRule = hasReadjustmentRule(contract);
    const { anniversary, blockedBy, waiting } = renewalAnniversary(contract, covered, effectiveFrom, Boolean(chosen && (explicit || chosen.type !== "nenhum")));
    // Data-base num período sem regra: a escolha do CS (mesmo igual à regra guardada no contrato) vale como explícita.
    const target = anniversary ?? waiting;
    if (target && chosen && chosen.type !== "nenhum" && !explicit && inReadjustmentGap(target, contract.readjustmentGaps)) explicit = chosen;
    const indexOf = async (r: ContractReadjustment) => (r.type === "indice" && r.index ? (await getReadjustmentIndexMap()).get(r.index) : undefined);
    if (anniversary) {
      if (explicit?.type === "nenhum") {
        // «Sem reajuste» escolhido na renovação: a data-base fica decidida (dispensada), sem aumento.
        readjust = { type: "percentual", percent: 0, rawPercent: 0, anniversary, waived: true };
      } else if (explicit) {
        const q = quoteReadjustment(explicit, await indexOf(explicit), anniversary);
        if (!q.ok) throw new BusinessError(`${q.reason}. Renove «Conforme o contrato» (o reajuste entra sozinho quando o índice sair) ou informe um percentual.`);
        if (q.quote.type === "indice" && Math.abs(q.quote.rawPercent) > MAX_AUTO_PERCENT) throw new BusinessError(`O ${q.quote.indexName ?? "índice"} acumulado dá ${formatPct(q.quote.rawPercent)} (acima de ${MAX_AUTO_PERCENT}% em módulo): confira o índice ou informe um percentual.`);
        readjust = { ...q.quote, anniversary };
      } else if (contractHasRule && contract.readjustmentRuleSince && anniversary < contract.readjustmentRuleSince) {
        // Regra trocada por aditivo vigente depois desta data-base: o Financeiro decide (mesma ordem da rotina).
        readjustNote = `o reajuste da data-base ${formatDate(dueIso(anniversary))} fica para o Financeiro decidir (a regra mudou depois dela)`;
      } else if (contractHasRule) {
        const rule = contract.readjustment!;
        const index = await indexOf(rule);
        const q = quoteReadjustment(rule, index, anniversary);
        // A rotina só aplica na data-base (cobrança anual: 30 dias antes); a renovação vem antes (antecedência).
        const opens = addDaysKey(anniversary, contract.recurrence === "anual" ? -READJUSTMENT_NOTICE_DAYS : 0);
        const target = addCompetence(anniversary.slice(0, 7), -1);
        if (!q.ok) {
          // Índice do período ainda não publicado: renova sem reajuste e marca «aguardando» (a rotina aplica quando sair).
          // Outro problema (índice fora do cadastro): a data-base fica dentro da nova vigência e a rotina avisa o Financeiro.
          if (q.waiting && rule.type === "indice" && rule.index) {
            pendingIndex = rule.index;
            pendingIndexName = index?.name ?? rule.indexName;
          }
        } else if (readjustmentBaseDate(contract) && q.quote.type === "indice" && todayKey() < opens && (q.quote.to ?? "") < target) {
          // Renovação antes de o reajuste entrar e o mês anterior à data-base ainda não saiu: a cotação de hoje é de
          // um período errado — a rotina aplica na data-base com o acumulado certo.
          pendingIndex = rule.index;
          pendingIndexName = index?.name ?? rule.indexName;
        } else if (Math.abs(q.quote.rawPercent) > MAX_AUTO_PERCENT) {
          readjustNote = `o reajuste da data-base ${formatDate(dueIso(anniversary))} (${formatPct(q.quote.rawPercent)}, acima de ${MAX_AUTO_PERCENT}%) fica para o Financeiro decidir`;
        } else readjust = { ...q.quote, anniversary };
      }
    } else if (blockedBy && waiting) {
      // Data-base anterior ainda pendente: as datas-base são decididas na ordem.
      if (explicit && (explicit.type !== "nenhum" || contractHasRule)) {
        throw new BusinessError(
          contractHasRule
            ? `A data-base de ${formatDate(dueIso(blockedBy))} ainda não foi decidida: as datas-base são decididas na ordem — o Financeiro decide essa antes (cartão «Reajuste anual» do contrato). Renove «Conforme o contrato»: a data-base desta renovação (${formatDate(dueIso(waiting))}) fica para depois dela.`
            : `A data-base de ${formatDate(dueIso(blockedBy))}, da regra de reajuste anterior, ainda não foi decidida: o Financeiro reinclui a regra (aditivo de condições) e a decide no cartão «Reajuste anual», ou renove «Conforme o contrato».`,
        );
      }
      readjustNote = `o reajuste da data-base ${formatDate(dueIso(waiting))} espera a decisão da data-base ${formatDate(dueIso(blockedBy))} (Financeiro)`;
    } else if (explicit && (explicit.type !== "nenhum" || contractHasRule)) {
      throw new BusinessError("A renovação não cai numa data-base do contrato: o reajuste anual entra no aniversário da assinatura do contrato. Renove «Conforme o contrato»; para mudar a regra do reajuste, o Financeiro faz um aditivo de condições.");
    }
  }
  const before = contractSnapshot(contract);
  const { after, renewalMonths, readjustment } = buildAmendmentAfter(contract, input, { readjust, pendingIndex, pendingIndexName });
  const audit = auditChanges<ContractSnapshot>(before, after, [...SNAPSHOT_FIELDS]);
  // Mesma regra de reajuste com o nome do índice só acrescentado (contrato antigo sem `indexName`): não é mudança.
  if (audit.changes.readjustment && sameReadjustmentRule(before.readjustment, after.readjustment) && Boolean(before.readjustment?.pending) === Boolean(after.readjustment?.pending)) delete audit.changes.readjustment;
  const changed = Object.keys(audit.changes);
  if (changed.length === 0) throw new Error("Nenhuma alteração em relação ao contrato atual");
  const readjustmentOnly = Boolean(options.readjust) && !input.renewal && !input.items && !input.conditions;
  const kind = amendmentKindFor(changed, { renewal: Boolean(input.renewal), readjustmentOnly });
  const requiresSignature = input.requiresSignature ?? (kind === "renovacao" || kind === "reajuste" ? false : amendmentRequiresSignatureByDefault(changed));
  const n = existing.length + 1;
  const signers: ContractSignerEntry[] = contract.signers.map((s) => ({ name: s.name, email: s.email, role: s.role, status: "pendente" as const }));
  let created: ContractAmendment | null = null;
  for (let seq = n; seq < n + 20 && !created; seq++) {
    const id = `cta_${contract.id}_${seq}`;
    const number = `${contract.number}-A${String(seq).padStart(2, "0")}`;
    const r = await createIfAbsent<ContractAmendment>(
      COLLECTIONS.contractAmendments,
      id,
      stripUndefined({
        number,
        contractId: contract.id,
        clientId: contract.clientId,
        kind,
        status: "rascunho",
        effectiveFrom,
        reason: input.reason.trim(),
        requiresSignature,
        before,
        after,
        changes: audit.changes,
        signers,
        source: options.source ?? "financeiro",
        renewalId: options.renewalId,
        readjustment,
        readjust,
        readjustNote,
        annualModel: input.renewal ? true : undefined,
        renewalMonths,
        createdBy: actor.id,
      }) as Omit<ContractAmendment, "id" | "organizationId" | "createdAt" | "updatedAt">,
    );
    if (r.created) created = r.doc;
  }
  if (!created) throw new Error("Não foi possível numerar o aditivo");
  if (options.emit !== false) {
    await emitEvent({
      type: "contract.amendment_created",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Aditivo ${created.number} criado (${AMENDMENT_KIND_LABELS[kind].toLowerCase()})`,
      description: `${input.reason.trim()} · vigência ${formatDate(dueIso(effectiveFrom))} · ${describeChanges(audit, AMENDMENT_FIELD_LABELS, describeSnapshotValue)}${requiresSignature ? " · exige assinatura do cliente" : " · sem assinatura (aplicação direta)"}`,
      department: "financeiro",
      payload: { contractId: contract.id, amendmentId: created.id, amendmentNumber: created.number, kind, effectiveFrom, requiresSignature, ...audit },
    });
  }
  return created;
}

/** Gera o termo aditivo para assinatura (hash próprio). Sem provedor conectado, o envio ao cliente é manual. */
export async function sendAmendmentForSignature(amendmentId: string, actor: UserRef): Promise<ContractAmendment> {
  const a = await loadAmendment(amendmentId);
  if (a.status !== "rascunho") throw new Error("Só um aditivo em rascunho pode ser enviado para assinatura");
  if (!a.requiresSignature) throw new Error("Este aditivo não exige assinatura: aplique-o diretamente");
  if (!a.signers || a.signers.length === 0) throw new Error("O contrato não tem signatários");
  const signers = a.signers.map((s) => ({ name: s.name, email: s.email, role: s.role, status: "pendente" as const }));
  const documentHash = amendmentDocumentHash({ ...a, signers });
  const sentAt = nowIso();
  const patch: Partial<ContractAmendment> = { status: "aguardando_assinatura", documentHash, sentAt, signers };
  await update<ContractAmendment>(COLLECTIONS.contractAmendments, a.id, patch);
  await emitEvent({
    type: "contract.amendment_sent",
    actor,
    clientId: a.clientId,
    entity: { type: "contract", id: a.contractId },
    title: `Termo aditivo ${a.number} gerado para assinatura`,
    description: `Aguardando assinatura — envio manual ao cliente. ${signers.length} signatário(s): ${signers.map((s) => s.name).join(", ")} · hash ${documentHash.slice(0, 19)}…`,
    department: "financeiro",
    payload: { contractId: a.contractId, amendmentId: a.id, amendmentNumber: a.number, documentHash, signers: signers.map((s) => s.email), method: "manual" },
  });
  return { ...a, ...patch };
}

/** Assinatura manual do aditivo por um signatário (evidência obrigatória). Todos assinados → "assinado". */
export async function registerAmendmentSignature(input: AmendmentSignatureInput, actor: UserRef): Promise<{ allSigned: boolean; amendment: ContractAmendment }> {
  const a = await loadAmendment(input.amendmentId);
  if (a.status !== "aguardando_assinatura") throw new Error("Gere o termo aditivo para assinatura antes de registrar assinaturas");
  const signer = (a.signers ?? []).find((s) => s.email.toLowerCase() === input.email.toLowerCase());
  if (!signer) throw new Error("Signatário não encontrado no aditivo");
  if (signer.status === "assinado") throw new Error(`${signer.name} já assinou`);
  const evidenceUrl = input.evidenceUrl?.trim() || undefined;
  const description = input.description?.trim() || undefined;
  if (!evidenceUrl && !description) throw new Error("Informe a evidência: link do documento assinado ou uma descrição");
  const signedAt = dueIso(input.signedAt);
  if (dateKey(signedAt) > todayKey()) throw new Error("A data da assinatura não pode ser futura");
  const now = nowIso();
  const evidence = [description, evidenceUrl].filter(Boolean).join(" · ");
  const signers: ContractSignerEntry[] = (a.signers ?? []).map((s) => (s === signer ? { ...s, status: "assinado" as const, signedAt, method: "manual" as const, evidence, evidenceUrl, registeredBy: actor.id, registeredAt: now } : s));
  const done = signers.every((s) => s.status === "assinado");
  const patch: Partial<ContractAmendment> = { signers };
  if (done) {
    patch.status = "assinado";
    patch.signedAt = signers.map((s) => s.signedAt ?? "").sort().pop() || signedAt;
  }
  await update<ContractAmendment>(COLLECTIONS.contractAmendments, a.id, patch);
  if (evidenceUrl) await addContractDocument({ contractId: a.contractId, name: `Evidência de assinatura — ${signer.name} (aditivo ${a.number})`, url: evidenceUrl, category: "Aditivo assinado" }, actor);
  await emitEvent({
    type: "note.added",
    actor,
    clientId: a.clientId,
    entity: { type: "contract", id: a.contractId },
    title: `${signer.name} assinou o aditivo ${a.number} (registro manual)`,
    description: `${signer.role} · ${signer.email} · assinado em ${formatDate(signedAt)} · evidência: ${evidence}`,
    department: "financeiro",
    payload: { contractId: a.contractId, amendmentId: a.id, email: signer.email, method: "manual", evidence, evidenceUrl, signedAt, documentHash: a.documentHash },
  });
  if (done) {
    await addContractDocument({ contractId: a.contractId, name: `Aditivo ${a.number} assinado · ${(a.documentHash ?? "").slice(0, 19)}`, url: `/financeiro/contratos/${a.contractId}/documento?aditivo=${a.id}`, category: "Aditivo assinado" }, actor);
    await emitEvent({
      type: "contract.amendment_signed",
      actor,
      clientId: a.clientId,
      entity: { type: "contract", id: a.contractId },
      title: `Aditivo ${a.number} assinado por todos`,
      description: `${signers.length} assinatura(s) registrada(s) com evidência · hash ${(a.documentHash ?? "").slice(0, 19)}… · pronto para aplicar`,
      department: "financeiro",
      payload: { contractId: a.contractId, amendmentId: a.id, amendmentNumber: a.number, signedAt: patch.signedAt, documentHash: a.documentHash, method: "manual" },
    });
  }
  return { allSigned: done, amendment: { ...a, ...patch } };
}

export async function cancelAmendment(amendmentId: string, reason: string, actor: UserRef): Promise<ContractAmendment> {
  const a = await loadAmendment(amendmentId);
  if (a.status === "aplicado") throw new Error("Aditivo já aplicado não pode ser cancelado: crie um novo aditivo revertendo as cláusulas");
  if (a.status === "cancelado") throw new Error("Este aditivo já está cancelado");
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new Error("Descreva o motivo do cancelamento");
  const patch: Partial<ContractAmendment> = { status: "cancelado", cancelledAt: nowIso(), cancelledBy: actor.id, cancelReason: trimmed };
  await update<ContractAmendment>(COLLECTIONS.contractAmendments, a.id, patch);
  await emitEvent({
    type: "contract.amendment_cancelled",
    actor,
    clientId: a.clientId,
    entity: { type: "contract", id: a.contractId },
    title: `Aditivo ${a.number} cancelado`,
    description: trimmed,
    department: "financeiro",
    payload: { contractId: a.contractId, amendmentId: a.id, amendmentNumber: a.number, reason: trimmed, ...auditChanges<ContractAmendment>(a, { ...a, ...patch }, ["status"], trimmed) },
  });
  return { ...a, ...patch };
}

export interface ApplyAmendmentOptions {
  emit?: boolean;
}

export interface ApplyAmendmentResult {
  amendment: ContractAmendment;
  contract: Contract;
  billings: { cancelled: string[]; created: string[] };
  products: { created: number; updated: number; cancelled: number };
}

/**
 * Aplica o aditivo em transação (contrato ← after, version + 1, previousVersions com o snapshot completo, aditivo
 * "aplicado") e dispara os efeitos: contract.updated com changes, comissões (só previstas/em carência), produtos do
 * cliente, cobranças futuras refeitas (e mensalidades da renovação). Idempotente: aplicado de novo → erro claro.
 */
export async function applyAmendment(amendmentId: string, actor: UserRef, options: ApplyAmendmentOptions = {}): Promise<ApplyAmendmentResult> {
  const a = await loadAmendment(amendmentId);
  if (a.status === "aplicado") throw new Error(`O aditivo ${a.number} já foi aplicado`);
  if (a.status === "cancelado") throw new Error("Aditivo cancelado não pode ser aplicado");
  if (a.requiresSignature && a.status !== "assinado") throw new Error("Este aditivo exige a assinatura do cliente: registre todas as assinaturas antes de aplicar");
  const emit = options.emit !== false;
  const now = nowIso();
  const contractRef = col(COLLECTIONS.contracts).doc(a.contractId);
  const amendmentRef = col(COLLECTIONS.contractAmendments).doc(a.id);
  const { before, after: next } = await docdb.runTransaction(async (tx) => {
    const [cSnap, aSnap] = await Promise.all([tx.get(contractRef), tx.get(amendmentRef)]);
    if (!cSnap.exists) throw new Error("Contrato não encontrado");
    const current = { ...(cSnap.data() as Omit<Contract, "id">), id: a.contractId } as Contract;
    const currentA = aSnap.data() as Omit<ContractAmendment, "id"> | undefined;
    if (!currentA || currentA.status === "aplicado") throw new Error(`O aditivo ${a.number} já foi aplicado`);
    if (current.status === "cancelado") throw new Error("Contrato cancelado não recebe aditivo");
    if (current.version !== a.before.version) throw new Error(`O contrato mudou desde a criação do aditivo (v${current.version} ≠ v${a.before.version}). Cancele este aditivo e crie outro.`);
    const version = current.version + 1;
    const previous = [...(current.previousVersions ?? []), stripUndefined({ version: current.version, kind: "aditivo" as const, at: now, by: actor.id, reason: a.reason, amendmentId: a.id, envelopeId: current.signatureEnvelopeId, snapshot: contractSnapshot(current) })];
    const patch: Record<string, unknown> = {
      version,
      // O snapshot não leva a origem por aditivo (`since`) dos itens: devolve a de cada item que continua no contrato
      // (sem ela, o motor de comissões trata o item como se existisse desde o início).
      items: a.after.items.map((i) => {
        const prior = current.items.find((p) => p.productId === i.productId && p.since);
        return prior?.since && !i.since ? { ...i, since: prior.since } : i;
      }),
      setupTotal: a.after.setupTotal,
      monthlyTotal: a.after.monthlyTotal,
      hardwareTotal: a.after.hardwareTotal,
      billingDay: a.after.billingDay,
      recurrence: a.after.recurrence,
      termMonths: a.after.termMonths,
      previousVersions: previous,
      amendmentIds: [...(current.amendmentIds ?? []).filter((id) => id !== a.id), a.id],
      updatedAt: now,
    };
    for (const f of ["firstDueDate", "endDate", "paymentMethod", "setupInstallments", "paymentCondition", "autoRenew", "renewalTermMonths", "readjustment", "noticeDays"] as const) {
      const v = a.after[f];
      if (v === undefined) {
        if (current[f] !== undefined) patch[f] = FieldValue.delete();
      } else patch[f] = v;
    }
    // Mesma regra: o «aguardando o índice» é o do contrato AGORA (a data-base pode ter sido decidida com o rascunho aberto).
    if (a.after.readjustment && sameReadjustmentRule(current.readjustment, a.after.readjustment)) patch.readjustment = stripUndefined({ ...a.after.readjustment, pending: current.readjustment?.pending });
    // Renovação numa data-base cujo índice ainda não saiu: o contrato mostra "aguardando o índice" até o reajuste entrar.
    if (a.kind === "renovacao" && a.readjustment?.type === "indice" && a.readjustment.pending) patch.readjustment = { ...(current.readjustment ?? { type: "indice" }), type: "indice", index: a.readjustment.index, pending: true };
    // Reajuste anual aplicado: registra a decisão da data-base (uma só por data-base) e tira o "aguardando".
    if (a.readjust) {
      const month = a.readjust.anniversary.slice(0, 7);
      if ((current.readjustmentLog ?? []).some((e) => e.anniversary.slice(0, 7) === month)) throw new BusinessError(`O reajuste da data-base ${formatDate(dueIso(a.readjust.anniversary))} já foi decidido`);
      const rule = (patch.readjustment as ContractReadjustment | undefined) ?? current.readjustment;
      if (rule?.pending) patch.readjustment = stripUndefined({ ...rule, pending: undefined });
      const outcome: ContractReadjustmentLogEntry["outcome"] = a.readjust.waived ? "dispensado" : a.readjust.percent === 0 ? "mantido" : "aplicado";
      const entry: ContractReadjustmentLogEntry = stripUndefined({
        anniversary: a.readjust.anniversary,
        outcome,
        reason: a.readjust.waived ? `Renovação ${a.number} sem reajuste` : undefined,
        at: now,
        by: actor.id,
        byName: actor.name,
        percent: a.readjust.percent,
        rawPercent: a.readjust.rawPercent,
        indexId: a.readjust.indexId,
        indexName: a.readjust.indexName,
        from: a.readjust.from,
        to: a.readjust.to,
        manual: a.readjust.manual,
        amendmentId: a.id,
        amendmentNumber: a.number,
        monthlyBefore: current.monthlyTotal,
        monthlyAfter: a.after.monthlyTotal,
      });
      patch.readjustmentLog = [...(current.readjustmentLog ?? []), entry];
    }
    // Regra de reajuste por aditivo (não vale para renovação nem reajuste):
    // - trocada (havia e continua havendo regra, diferente): vale da próxima data-base em diante; a anterior pendente
    //   fica para o Financeiro (`readjustmentRuleSince`);
    // - incluída, removida (inclusive cobrança que virou única) ou reincluída: o período sem regra entra em
    //   `readjustmentGaps` (datas-base nele não têm o que decidir); na reinclusão, a pendente da regra antiga (antes da
    //   remoção) também fica para o Financeiro.
    if (!a.readjust && a.kind !== "renovacao") {
      const hadRule = hasReadjustmentRule(current);
      const hasRule = hasReadjustmentRule({ readjustment: a.after.readjustment, recurrence: a.after.recurrence });
      const gaps = nextReadjustmentGaps(current.readjustmentGaps, { hadRule, hasRule, effectiveFrom: a.effectiveFrom });
      if (gaps) {
        patch.readjustmentGaps = gaps.gaps;
        if (gaps.reincluded) patch.readjustmentRuleSince = a.effectiveFrom;
      } else if (hadRule && hasRule && !sameReadjustmentRule(current.readjustment, a.after.readjustment)) patch.readjustmentRuleSince = a.effectiveFrom;
    }
    tx.update(contractRef, stripUndefined(patch));
    tx.update(amendmentRef, { status: "aplicado", appliedAt: now, appliedBy: actor.id, appliedVersion: version, updatedAt: now });
    const merged = { ...current } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v instanceof FieldValue) delete merged[k];
      else merged[k] = v;
    }
    return { before: current, after: merged as unknown as Contract };
  });
  const applied: ContractAmendment = { ...a, status: "aplicado", appliedAt: now, appliedBy: actor.id, appliedVersion: next.version };
  const audit = auditChanges<Contract>(before, next, [...SNAPSHOT_FIELDS, "version"], a.reason);

  // 1. contract.updated (existia sem uso): a auditoria "de → para" do contrato.
  if (emit) {
    await emitEvent({
      type: "contract.updated",
      actor,
      clientId: a.clientId,
      entity: { type: "contract", id: a.contractId },
      title: `Contrato ${before.number} atualizado pelo aditivo ${a.number} (v${next.version})`,
      description: describeChanges(audit, AMENDMENT_FIELD_LABELS, describeSnapshotValue) || a.reason,
      department: "financeiro",
      payload: { contractId: a.contractId, amendmentId: a.id, amendmentNumber: a.number, kind: a.kind, effectiveFrom: a.effectiveFrom, fromVersion: before.version, toVersion: next.version, ...audit, labels: AMENDMENT_FIELD_LABELS },
    });
  }

  // 2. Produtos do cliente (ativos inclusive: item removido → cancelado; novo → criado; valores atualizados).
  const synced = await syncClientProductsFromContract(next, actor, { amendment: { number: a.number, reason: a.reason, effectiveFrom: a.effectiveFrom } });

  // 3. Cobranças futuras refeitas com os novos valores, mantendo a numeração; renovação gera as mensalidades do novo prazo.
  const billings = await rebuildFutureBillings(next, before, applied, actor, { emit });
  if (a.kind === "renovacao" && a.renewalMonths && next.recurrence !== "unico" && next.monthlyTotal > 0) {
    try {
      const all = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", next.id]] });
      const oldEndComp = before.endDate ? dateKey(before.endDate).slice(0, 7) : todayKey().slice(0, 7);
      // Mensalidades que o horizonte rolante já gerou além do fim anterior contam para o novo prazo.
      const beyond = all.filter((b) => b.type === "mensalidade" && b.status !== "cancelada" && b.competence > oldEndComp).length;
      const months = Math.max(0, a.renewalMonths - beyond);
      if (months > 0 && lastRecurringBilling(all).installment > 0) {
        const r = await generateNextBillings(next.id, actor, { months, source: "renovacao", reason: `Renovação ${a.number} (+${a.renewalMonths} meses)`, emit });
        billings.created.push(...r.created.map((b) => b.id));
      }
    } catch (error) {
      console.error(`[financeiro] renovação ${a.number}: falha ao gerar as mensalidades do novo prazo`, error);
    }
  }
  if (billings.cancelled.length > 0 || billings.created.length > 0) await update<ContractAmendment>(COLLECTIONS.contractAmendments, a.id, { billingsRebuilt: billings });

  // 3b. Itens incluídos pelo aditivo ganham a origem (`since`): 1ª mensalidade em aberto a partir da vigência (ou a
  // próxima a gerar) e a cobrança avulsa de adesão/hardware. O motor de comissões não comissiona mensalidades pagas
  // antes do item existir.
  const added = next.items.filter((i) => !i.since && !before.items.some((b) => b.productId === i.productId));
  if (added.length > 0) {
    const all = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", next.id]] });
    const createdIds = new Set(billings.created);
    const fromComp = a.effectiveFrom.slice(0, 7);
    // Mesmo critério do refazimento (passo 3): mensalidade em aberto já vencida ficou com o valor antigo, sem o item.
    const notDue = todayKey();
    const openFrom = all.filter((b) => b.type === "mensalidade" && b.status === "aberta" && dateKey(b.dueDate) >= notDue && b.competence >= fromComp).map((b) => b.installment ?? 1);
    const installment = openFrom.length > 0 ? Math.min(...openFrom) : lastRecurringBilling(all).installment + 1;
    const setupInstallment = all.find((b) => b.type === "setup" && createdIds.has(b.id))?.installment;
    const hardwareInstallment = all.find((b) => b.type === "hardware" && createdIds.has(b.id))?.installment;
    const since = stripUndefined({ amendmentId: a.id, installment, setupInstallment, hardwareInstallment }) as ItemSince;
    const items = next.items.map((i) => (added.includes(i) ? { ...i, since } : i));
    await update<Contract>(COLLECTIONS.contracts, next.id, { items });
  }

  // 4. Comissões: só previstas/em carência mudam (pagas e elegíveis com título ficam intactas — regra do motor).
  if (next.sellerId || next.opportunityId) {
    try {
      const { reconcileCommissions } = await import("@/server/commissions/engine");
      await reconcileCommissions({ contractIds: [next.id], actor, emit });
    } catch (error) {
      console.error(`[financeiro] aditivo ${a.number}: falha ao recalcular as comissões`, error);
    }
  }

  // 5. Item novo em contrato liberado que exige implantação: só aviso ao gestor (nenhum projeto automático).
  const addedProductIds = next.items.map((i) => i.productId).filter((id) => !before.items.some((i) => i.productId === id));
  if (addedProductIds.length > 0 && next.status === "liberado" && next.implementationRequired !== false) {
    const [manager, client, products] = await Promise.all([getDepartmentManager("implantacao"), getById<Client>(COLLECTIONS.clients, next.clientId), getManyByIds<Product>(COLLECTIONS.products, addedProductIds).then((m) => Array.from(m.values()))]);
    const names = addedProductIds.map((id) => products.find((p) => p.id === id)?.name ?? next.items.find((i) => i.productId === id)?.productName ?? id);
    await update<ContractAmendment>(COLLECTIONS.contractAmendments, a.id, { implementationNoticeProductIds: addedProductIds });
    if (manager) {
      await notify({
        userIds: [manager.id],
        kind: "acao",
        title: `Aditivo ${a.number}: item novo em contrato liberado (${client?.tradeName ?? next.number})`,
        body: `${names.join(", ")} entrou no contrato ${next.number}. Nenhum projeto foi criado automaticamente: avalie se precisa de implantação.`,
        href: `/financeiro/contratos/${next.id}`,
        entity: { type: "contract", id: next.id },
      });
    }
  }

  // 6. Reajuste anual decidido (aditivo "reajuste" ou renovação na data-base): evento contract.readjusted + aviso
  // ao Financeiro, ao CS e ao dono do contrato (uma vez por data-base); a tarefa de atraso dela, se houver, é concluída.
  if (a.readjust) {
    try {
      const { announceReadjustment, closeLateReadjustmentTasks } = await import("./readjustments");
      if (emit) await announceReadjustment(next, applied, before.monthlyTotal, next.monthlyTotal, actor);
      await closeLateReadjustmentTasks(next.id, a.readjust.anniversary, actor);
    } catch (error) {
      console.error(`[financeiro] aditivo ${a.number}: falha ao avisar o reajuste`, error);
    }
  }

  if (emit) {
    await emitEvent({
      type: "contract.amendment_applied",
      actor,
      clientId: a.clientId,
      entity: { type: "contract", id: a.contractId },
      title: `Aditivo ${a.number} aplicado: contrato ${before.number} v${next.version}`,
      description: [
        `${AMENDMENT_KIND_LABELS[a.kind]} · vigência ${formatDate(dueIso(a.effectiveFrom))}`,
        next.monthlyTotal !== before.monthlyTotal ? `mensalidade ${formatCurrency(before.monthlyTotal)} → ${formatCurrency(next.monthlyTotal)}` : null,
        billings.cancelled.length > 0 ? `${billings.cancelled.length} cobrança(s) refeita(s)` : null,
        billings.created.length > 0 ? `${billings.created.length} cobrança(s) gerada(s)` : null,
        synced.created + synced.updated + synced.cancelled > 0 ? `produtos: ${synced.created} novo(s), ${synced.updated} atualizado(s), ${synced.cancelled} cancelado(s)` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      department: "financeiro",
      payload: { contractId: a.contractId, amendmentId: a.id, amendmentNumber: a.number, kind: a.kind, effectiveFrom: a.effectiveFrom, version: next.version, billingsRebuilt: billings, products: synced, changes: audit.changes, reason: a.reason },
    });
  }
  return { amendment: applied, contract: next, billings, products: { created: synced.created, updated: synced.updated, cancelled: synced.cancelled } };
}

/**
 * Cobranças futuras do contrato depois do aditivo: mensalidades EM ABERTO e ainda não vencidas com competência ≥
 * vigência do aditivo são canceladas (também no provedor, quando conectado) e recriadas com o novo valor mantendo
 * `installment`, competência e vencimento (ids determinísticos). Pagas e vencidas (inclusive em aberto com vencimento
 * passado, que a rotina ainda não marcou) não são tocadas. Reajuste anual de contrato com cobrança ANUAL entra 30 dias
 * antes da data-base: a parcela do ano que vence nesse intervalo também é refeita. Diferença de adesão/hardware para
 * mais vira uma cobrança avulsa no próximo vencimento; mensalidade zerada só cancela.
 */
export async function rebuildFutureBillings(contract: Contract, previous: Contract, amendment: ContractAmendment, actor: UserRef, options: { emit?: boolean } = {}): Promise<{ cancelled: string[]; created: string[] }> {
  const all = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", contract.id]] });
  const fromComp = amendment.effectiveFrom.slice(0, 7);
  const today = todayKey();
  const readjust = amendment.readjust;
  const leadFrom = readjust && !readjust.waived && readjust.percent !== 0 && contract.recurrence === "anual" ? addDaysKey(readjust.anniversary, -READJUSTMENT_NOTICE_DAYS) : null;
  const fromLabel = leadFrom ? `${fromComp} (e a parcela anual que vence a partir de ${formatDate(dueIso(leadFrom))})` : fromComp;
  const cancelled: string[] = [];
  const created: Billing[] = [];
  const stamp = nowIso();
  const providerNotes: string[] = [];
  const { amount: monthlyAmount } = recurringStep(contract);
  const recurringChanged = monthlyAmount !== recurringStep(previous).amount || contract.paymentMethod !== previous.paymentMethod || contract.recurrence !== previous.recurrence;
  const client = await getById<Client>(COLLECTIONS.clients, contract.clientId);
  const providerErrors: string[] = [];
  if (recurringChanged) {
    const targets = all
      .filter((b) => b.type === "mensalidade" && b.status === "aberta" && dateKey(b.dueDate) >= today && (b.competence >= fromComp || (leadFrom !== null && dateKey(b.dueDate) >= leadFrom)))
      .sort((x, y) => (x.installment ?? 0) - (y.installment ?? 0));
    for (const b of targets) {
      const note = await cancelChargeAtProvider(b);
      if (note) providerNotes.push(`${b.installment}: ${note}`);
      await update<Billing>(COLLECTIONS.billing, b.id, billingCancellationPatch(b, actor, `Refeita pelo aditivo ${amendment.number} (novo valor a partir de ${fromLabel})`, stamp));
      cancelled.push(b.id);
      if (monthlyAmount <= 0 || contract.recurrence === "unico") continue;
      const draft = { clientId: contract.clientId, contractId: contract.id, type: "mensalidade" as const, competence: b.competence, installment: b.installment, amount: monthlyAmount, dueDate: b.dueDate, status: "aberta" as const, method: contract.paymentMethod ?? b.method ?? "boleto" };
      const id = billingDocId(contract.id, "mensalidade", b.installment ?? 1);
      const fields = client ? await providerChargeFields({ ...draft, organizationId: contract.organizationId, createdAt: stamp, updatedAt: stamp }, id, client, providerErrors) : { chargeStatus: "aguardando_emissao_manual" };
      const r = await createBillingWithDeterministicId(contract.id, draft, { ...fields, createdBy: actor.id });
      if (r.created) created.push(r.billing);
    }
  }
  // Adesão/hardware a mais: cobrança avulsa no próximo dia de vencimento (≥ vigência do aditivo e ≥ hoje + 3 dias).
  const minKey = amendment.effectiveFrom > today ? amendment.effectiveFrom : today;
  const nextDue = (() => {
    for (let offset = 0; offset < 3; offset++) {
      const candidate = dayInMonth(minKey.slice(0, 7), offset, contract.billingDay);
      if (dateKey(candidate) >= minKey && (Date.parse(candidate) - Date.parse(dueIso(today))) / 86_400_000 >= 3) return candidate;
    }
    return dayInMonth(minKey.slice(0, 7), 1, contract.billingDay);
  })();
  for (const [type, delta] of [["setup", round2(contract.setupTotal - previous.setupTotal)], ["hardware", round2(contract.hardwareTotal - previous.hardwareTotal)]] as const) {
    if (delta <= 0) continue;
    const n = all.filter((b) => b.type === type && b.status !== "cancelada").reduce((max, b) => Math.max(max, b.installment ?? 1), 0) + 1;
    const draft = { clientId: contract.clientId, contractId: contract.id, type, competence: dateKey(nextDue).slice(0, 7), installment: n, amount: delta, dueDate: nextDue, status: "aberta" as const, method: contract.paymentMethod ?? "boleto" };
    const id = billingDocId(contract.id, type, n);
    const fields = client ? await providerChargeFields({ ...draft, organizationId: contract.organizationId, createdAt: stamp, updatedAt: stamp }, id, client, providerErrors) : { chargeStatus: "aguardando_emissao_manual" };
    const r = await createBillingWithDeterministicId(contract.id, draft, { ...fields, createdBy: actor.id });
    if (r.created) created.push(r.billing);
  }
  if (options.emit !== false && (cancelled.length > 0 || created.length > 0)) {
    const total = created.reduce((s, b) => s + b.amount, 0);
    await emitEvent({
      type: "billing.created",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Cobranças do contrato ${contract.number} refeitas pelo aditivo ${amendment.number}`,
      description: [cancelled.length > 0 ? `${cancelled.length} mensalidade(s) em aberto cancelada(s) a partir de ${fromLabel}` : null, created.length > 0 ? `${created.length} cobrança(s) gerada(s) com os novos valores (mesma numeração) · total ${formatCurrency(total)}` : null, providerNotes.length > 0 ? providerNotes.join(" · ") : null, providerErrors.length > 0 ? `falhas no provedor: ${providerErrors.join(" · ")}` : null].filter(Boolean).join(" · "),
      department: "financeiro",
      payload: { contractId: contract.id, amendmentId: amendment.id, amendmentNumber: amendment.number, cancelledBillingIds: cancelled, billingIds: created.map((b) => b.id), total, reason: `Aditivo ${amendment.number}: ${amendment.reason}`, source: "aditivo" },
    });
  }
  return { cancelled, created: created.map((b) => b.id) };
}

/** Documento "Aditivo" nos documentos do contrato (usado pelo seed e por quem quiser anexar o PDF do termo). */
export async function attachAmendmentDocument(a: ContractAmendment, url: string, actor: UserRef): Promise<Document | null> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, a.contractId);
  if (!contract) return null;
  const id = await addContractDocument({ contractId: contract.id, name: `Termo aditivo ${a.number}`, url, category: "Aditivo" }, actor);
  return getById<Document>(COLLECTIONS.documents, id);
}
