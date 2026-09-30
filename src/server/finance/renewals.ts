import "server-only";
/**
 * Renovação automática (D26): passo da varredura diária `renovacoes`. Contratos liberados com `autoRenew` cuja
 * vigência termina em até `noticeDays` (padrão 30) recebem um aditivo "renovacao" aplicado na hora (mesmo caminho da
 * renovação pelo CS): endDate + `renewalTermMonths` (ou o prazo do contrato), `termMonths` preservado, reajuste
 * percentual aplicado; índice NÃO é buscado — renova sem reajuste, marca `readjustment.pending` e abre tarefa ao CS
 * "Informar índice de reajuste". Idempotente: a renovação estende `endDate` (sai da janela) e só existe um aditivo em
 * andamento por contrato. Renovação aberta no CS para o mesmo contrato é marcada "renovado".
 */
import { list, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { COLLECTIONS, type Client, type Contract, type ContractAmendment, type Renewal } from "@/domain/types";
import { SYSTEM_ACTOR, todayKey } from "./billing";
import { applyAmendment, createAmendment, listContractAmendments } from "./amendments";

const DAY_MS = 86_400_000;
export const DEFAULT_NOTICE_DAYS = 30;

export interface AutoRenewResult {
  /** Contratos com renovação automática avaliados. */
  candidates: number;
  renewed: number;
  /** Renovados sem reajuste porque o índice precisa ser informado (tarefa ao CS). */
  indexPending: number;
  skipped: number;
  errors: string[];
  renewedContractIds: string[];
}

export async function autoRenewContracts(now: Date = new Date()): Promise<AutoRenewResult> {
  const today = dateKey(now);
  const contracts = (await list<Contract>(COLLECTIONS.contracts, { where: [["status", "==", "liberado"]] })).filter((c) => c.autoRenew && c.endDate && c.recurrence !== "unico");
  const result: AutoRenewResult = { candidates: contracts.length, renewed: 0, indexPending: 0, skipped: 0, errors: [], renewedContractIds: [] };
  if (contracts.length === 0) return result;
  const clients = await list<Client>(COLLECTIONS.clients, { where: [["id", "in", Array.from(new Set(contracts.map((c) => c.clientId)))]] });
  const clientById = new Map(clients.map((c) => [c.id, c]));
  for (const c of contracts) {
    const noticeDays = c.noticeDays && c.noticeDays > 0 ? c.noticeDays : DEFAULT_NOTICE_DAYS;
    const limit = dateKey(new Date(now.getTime() + noticeDays * DAY_MS));
    if (dateKey(c.endDate!) > limit) continue;
    const client = clientById.get(c.clientId);
    if (!client || client.status === "cancelado") {
      result.skipped += 1;
      continue;
    }
    // Já existe aditivo em andamento (ex.: renovação pelo CS aguardando assinatura)? Não interfere.
    const open = (await listContractAmendments(c.id)).find((a) => a.status !== "aplicado" && a.status !== "cancelado");
    if (open) {
      result.skipped += 1;
      continue;
    }
    try {
      const months = c.renewalTermMonths && c.renewalTermMonths > 0 ? c.renewalTermMonths : c.termMonths > 0 ? c.termMonths : 12;
      const amendment = await createAmendment(
        {
          contractId: c.id,
          effectiveFrom: dateKey(c.endDate!) < today ? today : dateKey(c.endDate!),
          reason: `Renovação automática por ${months} meses (renovação automática combinada no contrato, ${noticeDays} dias antes do fim da vigência)`,
          requiresSignature: false,
          renewal: { months, readjustment: c.readjustment },
        },
        SYSTEM_ACTOR,
        { source: "renovacao_automatica" },
      );
      const applied = await applyAmendment(amendment.id, SYSTEM_ACTOR);
      result.renewed += 1;
      result.renewedContractIds.push(c.id);
      if (amendment.readjustment?.type === "indice" && amendment.readjustment.pending) result.indexPending += 1;
      // Renovação aberta no CS para este contrato: concluída como renovada (a negociação humana não é mais necessária).
      const renewals = (await list<Renewal>(COLLECTIONS.renewals, { where: [["contractId", "==", c.id]] })).filter((r) => r.status === "aguardando" || r.status === "em_negociacao");
      for (const r of renewals) await update<Renewal>(COLLECTIONS.renewals, r.id, { status: "renovado", result: `Renovado automaticamente por ${months} meses até ${formatDate(amendment.after.endDate)} (aditivo ${amendment.number}).` });
      await emitEvent({
        type: "contract.renewed",
        actor: SYSTEM_ACTOR,
        clientId: c.clientId,
        entity: { type: "contract", id: c.id },
        title: `Contrato ${c.number} renovado automaticamente até ${formatDate(amendment.after.endDate)} (aditivo ${amendment.number})`,
        description: `${months} meses · ${formatCurrency(applied.contract.monthlyTotal)}/mês · reajuste: ${amendment.readjustment?.type === "percentual" ? `${amendment.readjustment.percent}%` : amendment.readjustment?.type === "indice" ? "índice a informar pelo CS (não aplicado)" : "nenhum"}${applied.billings.created.length > 0 ? ` · ${applied.billings.created.length} mensalidade(s) gerada(s)` : ""}`,
        department: "financeiro",
        payload: { contractId: c.id, amendmentId: amendment.id, amendmentNumber: amendment.number, termMonths: months, newEndDate: amendment.after.endDate, previousEndDate: c.endDate, source: "renovacao_automatica", readjustment: amendment.readjustment ?? null, changes: { endDate: { from: c.endDate ?? null, to: amendment.after.endDate ?? null } } },
      });
    } catch (error) {
      result.errors.push(`${c.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** Aditivo de renovação mais recente aplicado a um contrato (para telas e verificações). */
export async function lastRenewalAmendment(contractId: string): Promise<ContractAmendment | null> {
  const all = await listContractAmendments(contractId);
  return all.filter((a) => a.kind === "renovacao" && a.status === "aplicado").pop() ?? null;
}

/** Registro mínimo para as telas: quando o contrato renova sozinho. */
export function autoRenewalDue(contract: Pick<Contract, "autoRenew" | "endDate" | "noticeDays">, today = todayKey()): boolean {
  if (!contract.autoRenew || !contract.endDate) return false;
  const noticeDays = contract.noticeDays && contract.noticeDays > 0 ? contract.noticeDays : DEFAULT_NOTICE_DAYS;
  return dateKey(contract.endDate) <= dateKey(new Date(Date.parse(`${today}T12:00:00.000Z`) + noticeDays * DAY_MS));
}

