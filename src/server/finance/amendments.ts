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
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/firebase-admin";
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
  describeReadjustment,
  describeSnapshotValue,
  SNAPSHOT_FIELDS,
} from "@/domain/contract-snapshot";
import { COLLECTIONS, type Billing, type Client, type Contract, type ContractAmendment, type ContractReadjustment, type ContractSignerEntry, type ContractSnapshot, type Document, type ItemSince, type Product, type ProposalItem, type UserRef } from "@/domain/types";
import { billingDocId, dayInMonth, dueIso, lastRecurringBilling, recurringStep, round2, todayKey } from "./billing";
import type { AmendmentInput, AmendmentSignatureInput } from "./schemas";
import { addContractDocument, cancelChargeAtProvider, createBillingWithDeterministicId, generateNextBillings, loadContract, providerChargeFields, syncClientProductsFromContract } from "./service";

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

/**
 * Calcula o "depois" a partir do contrato e da entrada. Renovação: endDate = base (fim atual ou hoje) + meses,
 * `termMonths` PRESERVADO, reajuste percentual aplicado à mensalidade; índice NÃO é buscado (fica pendente).
 */
export function buildAmendmentAfter(contract: Contract, input: Omit<AmendmentInput, "contractId" | "reason" | "effectiveFrom" | "requiresSignature">): { after: ContractSnapshot; renewalMonths?: number; readjustment?: ContractReadjustment } {
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
    if (c.readjustment !== undefined) after.readjustment = stripUndefined({ ...c.readjustment });
    if (c.noticeDays !== undefined) after.noticeDays = c.noticeDays;
  }
  if (input.renewal) {
    const today = todayKey();
    const base = contract.endDate && dateKey(contract.endDate) >= today ? contract.endDate : dueIso(today);
    after.endDate = addMonthsIso(base, input.renewal.months);
    renewalMonths = input.renewal.months;
    const r = input.renewal.readjustment ?? contract.readjustment;
    if (r?.type === "percentual" && r.percent && r.percent > 0) {
      readjustment = { type: "percentual", percent: r.percent };
      after.items = readjustItems(after.items, r.percent);
      after.monthlyTotal = proposalTotals(after.items).monthlyTotal;
    } else if (r?.type === "indice") {
      // Índice oficial NÃO é buscado automaticamente: renova sem reajuste e o CS informa o índice (tarefa).
      readjustment = { type: "indice", index: r.index, pending: true };
    } else readjustment = { type: "nenhum" };
  }
  return { after, renewalMonths, readjustment };
}

export interface CreateAmendmentOptions {
  source?: ContractAmendment["source"];
  renewalId?: string;
  /** Emitir eventos (o seed desliga). */
  emit?: boolean;
}

/** Cria o aditivo em rascunho com before/after/changes calculados no servidor. Um aditivo em andamento por contrato. */
export async function createAmendment(input: AmendmentInput, actor: UserRef, options: CreateAmendmentOptions = {}): Promise<ContractAmendment> {
  const contract = await loadContract(input.contractId);
  if (!APPLICABLE_STATUSES.includes(contract.status)) throw new Error("Aditivo só em contrato assinado (ou já liberado). Antes da assinatura, altere itens e condições diretamente no contrato.");
  const existing = await listContractAmendments(contract.id);
  const open = existing.find((a) => AMENDMENT_OPEN_STATUSES.includes(a.status));
  if (open) throw new Error(`Já existe o aditivo ${open.number} em andamento (${open.status.replace("_", " ")}). Aplique ou cancele antes de criar outro.`);
  if (input.items && input.items.length === 0) throw new Error("O contrato precisa de pelo menos um item");
  const effectiveFrom = input.effectiveFrom.slice(0, 10);
  const before = contractSnapshot(contract);
  const { after, renewalMonths, readjustment } = buildAmendmentAfter(contract, input);
  const audit = auditChanges<ContractSnapshot>(before, after, [...SNAPSHOT_FIELDS]);
  const changed = Object.keys(audit.changes);
  if (changed.length === 0) throw new Error("Nenhuma alteração em relação ao contrato atual");
  const readjustmentOnly = Boolean(input.renewal) === false && changed.every((f) => f === "items" || f === "monthlyTotal") && Boolean(input.conditions?.readjustment) && !input.items;
  const kind = amendmentKindFor(changed, { renewal: Boolean(input.renewal), readjustmentOnly });
  const requiresSignature = input.requiresSignature ?? (kind === "renovacao" ? false : amendmentRequiresSignatureByDefault(changed));
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
  /** Renovação automática: aviso ao CS quando o índice fica pendente. */
  notifyIndexPending?: boolean;
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
  const { before, after: next } = await firestore.runTransaction(async (tx) => {
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
      items: a.after.items,
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
    // Renovação com índice pendente: o contrato guarda o reajuste pendente para o CS informar.
    if (a.kind === "renovacao" && a.readjustment?.type === "indice" && a.readjustment.pending) patch.readjustment = { ...(current.readjustment ?? { type: "indice" }), type: "indice", index: a.readjustment.index, pending: true };
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
    const openFrom = all.filter((b) => b.type === "mensalidade" && b.status === "aberta" && b.competence >= fromComp).map((b) => b.installment ?? 1);
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

  // 6. Renovação com índice pendente → tarefa ao CS "Informar índice de reajuste".
  if (a.kind === "renovacao" && a.readjustment?.type === "indice" && a.readjustment.pending && options.notifyIndexPending !== false) {
    const { createTaskInternal } = await import("@/server/tasks/service");
    const client = await getById<Client>(COLLECTIONS.clients, next.clientId);
    const csManager = await getDepartmentManager("cs");
    const assigneeId = client?.ownerCsId ?? csManager?.id;
    const existingTasks = await list<import("@/domain/types").Task>(COLLECTIONS.tasks, { where: [["processId", "==", a.id]] });
    if (assigneeId && !existingTasks.some((t) => t.title.startsWith("Informar índice de reajuste"))) {
      await createTaskInternal(
        {
          title: `Informar índice de reajuste: ${client?.tradeName ?? next.number} (${a.number})`,
          description: `Contrato ${next.number} renovado por ${a.renewalMonths} meses com reajuste por ${describeReadjustment({ type: "indice", index: a.readjustment.index })}. O índice oficial NÃO é buscado automaticamente: consulte o índice acumulado, crie um aditivo de reajuste com o percentual e informe o cliente.`,
          clientId: next.clientId,
          assigneeId,
          departmentId: "cs",
          priority: "media",
          dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          processType: "renewal",
          processId: a.id,
          origin: "automacao",
          tags: ["renovacao", "reajuste"],
        },
        actor,
      );
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
 * Cobranças futuras do contrato depois do aditivo: mensalidades EM ABERTO com competência ≥ vigência do aditivo são
 * canceladas (também no provedor, quando conectado) e recriadas com o novo valor mantendo `installment`, competência
 * e vencimento (ids determinísticos). Pagas e vencidas não são tocadas. Diferença de adesão/hardware para mais vira
 * uma cobrança avulsa no próximo vencimento; mensalidade zerada só cancela.
 */
export async function rebuildFutureBillings(contract: Contract, previous: Contract, amendment: ContractAmendment, actor: UserRef, options: { emit?: boolean } = {}): Promise<{ cancelled: string[]; created: string[] }> {
  const all = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", contract.id]] });
  const fromComp = amendment.effectiveFrom.slice(0, 7);
  const cancelled: string[] = [];
  const created: Billing[] = [];
  const stamp = nowIso();
  const providerNotes: string[] = [];
  const { amount: monthlyAmount } = recurringStep(contract);
  const recurringChanged = monthlyAmount !== recurringStep(previous).amount || contract.paymentMethod !== previous.paymentMethod || contract.recurrence !== previous.recurrence;
  const client = await getById<Client>(COLLECTIONS.clients, contract.clientId);
  const providerErrors: string[] = [];
  if (recurringChanged) {
    const targets = all.filter((b) => b.type === "mensalidade" && b.status === "aberta" && b.competence >= fromComp).sort((x, y) => (x.installment ?? 0) - (y.installment ?? 0));
    for (const b of targets) {
      const note = await cancelChargeAtProvider(b);
      if (note) providerNotes.push(`${b.installment}: ${note}`);
      await update<Billing>(COLLECTIONS.billing, b.id, { status: "cancelada", ...(b.chargeStatus ? { chargeStatus: "cancelado" } : {}) });
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
  const today = todayKey();
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
      description: [cancelled.length > 0 ? `${cancelled.length} mensalidade(s) em aberto cancelada(s) a partir de ${fromComp}` : null, created.length > 0 ? `${created.length} cobrança(s) gerada(s) com os novos valores (mesma numeração) · total ${formatCurrency(total)}` : null, providerNotes.length > 0 ? providerNotes.join(" · ") : null, providerErrors.length > 0 ? `falhas no provedor: ${providerErrors.join(" · ")}` : null].filter(Boolean).join(" · "),
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
