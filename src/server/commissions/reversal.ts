import "server-only";
/**
 * Efeitos do estorno de pagamento de uma cobrança (D22) nas comissões e títulos — handler de `payment.reversed`
 * (registrado em src/server/events/handlers/commissions.ts). Idempotente: transições condicionadas ao status.
 *
 * Comissões elegíveis/com título que dependem da cobrança estornada (`billingId` da comissão, ou gatilho
 * "N-ésima mensalidade" quando a cobrança estornada é essa mensalidade):
 * - título ainda não pago → título cancelado (motivo: estorno) e a comissão volta a "aguardando recebimento";
 * - título já pago → NÃO mexe (estorno da comissão é manual, com motivo) e avisa o gestor financeiro.
 * As pendentes (prevista/carência/aguardando) o motor reavalia normalmente na próxima reconciliação.
 */
import { getById, list } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { getDepartmentManager } from "@/server/workflow/service";
import { formatCurrency } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type Commission, type Payable, type UserRef } from "@/domain/types";
import { cancelPayable } from "./payables";
import { deleteField, historyEntry, transitionCommission } from "./store";

export interface PaymentReversalEffects {
  returned: string[];
  cancelledPayables: string[];
  paidKept: string[];
}

function dependsOnBilling(c: Commission, billing: Billing): boolean {
  if (c.billingId === billing.id) return true;
  const rule = c.ruleSnapshot;
  return Boolean(rule && rule.trigger === "mensalidade_n" && billing.type === "mensalidade" && (billing.installment ?? 1) === rule.releaseInstallment);
}

export async function applyPaymentReversalToCommissions(billing: Billing, reason: string, actor: UserRef): Promise<PaymentReversalEffects> {
  const out: PaymentReversalEffects = { returned: [], cancelledPayables: [], paidKept: [] };
  const commissions = (await list<Commission>(COLLECTIONS.commissions, { where: [["contractId", "==", billing.contractId]] })).filter((c) => (c.status === "liberada" || c.status === "titulo_gerado") && dependsOnBilling(c, billing));
  const note = `Pagamento da cobrança estornado: ${reason}`;
  for (const c of commissions) {
    if (c.status === "titulo_gerado" && c.payableId) {
      const payable = await getById<Payable>(COLLECTIONS.payables, c.payableId);
      if (payable?.status === "pago") {
        out.paidKept.push(c.id);
        continue;
      }
      if (payable && payable.status !== "cancelado") {
        try {
          await cancelPayable(c.payableId, note, actor);
          out.cancelledPayables.push(c.payableId);
        } catch (error) {
          console.error(`[comissoes] estorno: falha ao cancelar o título ${c.payableId}`, error);
          continue;
        }
      }
    }
    const changed = await transitionCommission(c.id, ["liberada"], { status: "aguardando_recebimento", eligibleAt: deleteField(), releaseAt: deleteField() }, historyEntry(actor, "aguardando_recebimento", "liberada", note));
    if (!changed) continue;
    out.returned.push(c.id);
    await emitEvent({
      type: "commission.updated",
      actor,
      clientId: c.clientId,
      entity: { type: "commission", id: c.id },
      title: `Comissão ${c.code ?? c.id} voltou a aguardar recebimento (pagamento estornado)`,
      description: note,
      department: "financeiro",
      payload: { commissionId: c.id, billingId: billing.id, contractId: billing.contractId, reason, changes: { status: { from: c.status, to: "aguardando_recebimento" } } },
      timeline: false,
    });
  }
  if (out.paidKept.length > 0) {
    const [manager, client] = await Promise.all([getDepartmentManager("financeiro"), getById<Client>(COLLECTIONS.clients, billing.clientId)]);
    const total = commissions.filter((c) => out.paidKept.includes(c.id)).reduce((s, c) => s + c.amount, 0);
    if (manager) {
      await notify({
        userIds: [manager.id],
        kind: "atencao",
        title: `Comissão já paga de cobrança estornada: ${client?.tradeName ?? billing.clientId}`,
        body: `${out.paidKept.length} comissão(ões) paga(s) (${formatCurrency(total)}) dependem do pagamento estornado (${reason}). O estorno da comissão é manual, com motivo, em Financeiro › Comissões.`,
        href: `/financeiro/comissoes?contrato=${billing.contractId}`,
        entity: { type: "billing", id: billing.id },
      });
    }
  }
  return out;
}
