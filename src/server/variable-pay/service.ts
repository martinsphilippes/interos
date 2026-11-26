import "server-only";
/**
 * Fechamento da remuneração variável: congela, por colaborador, comissões adquiridas + bônus + prêmios da competência
 * (todos os colaboradores — quem fecha é o Financeiro). Refechar cria nova versão; a tela mostra o que mudou depois.
 * Não gera pagamento: comissões e bônus seguem pelos seus títulos em Contas a Pagar.
 */
import { createIfAbsent, list } from "@/server/db";
import { emitEvent } from "@/server/events";
import { formatCurrency } from "@/lib/format";
import { monthPeriod } from "@/server/kpis/period";
import { COLLECTIONS, type UserRef, type VariablePayClosing } from "@/domain/types";
import { computeVariablePay } from "./queries";

export async function closeVariablePay(competence: string, actor: UserRef, notes?: string): Promise<VariablePayClosing> {
  const previous = await list<VariablePayClosing>(COLLECTIONS.variablePayClosings, { where: [["competence", "==", competence]] });
  const version = Math.max(0, ...previous.map((p) => p.version)) + 1;
  const { lines, totals } = await computeVariablePay(competence, () => true);
  const id = `vpc_${competence}_v${version}`;
  const { doc } = await createIfAbsent<VariablePayClosing>(COLLECTIONS.variablePayClosings, id, {
    competence,
    version,
    lines: lines.map((l) => ({ userId: l.userId, userName: l.userName, commissions: l.commissions.earned, bonus: l.bonus.amount, prizes: l.prizes.amount, total: l.total })),
    total: totals.total,
    closedBy: actor.id,
    closedByName: actor.name,
    notes,
    createdBy: actor.id,
  } as Omit<VariablePayClosing, "id" | "organizationId" | "createdAt" | "updatedAt">);
  await emitEvent({
    type: "variable_pay.closed",
    actor,
    entity: { type: "variable_pay_closing", id },
    title: `Remuneração variável de ${monthPeriod(competence).label} fechada (v${version}): ${formatCurrency(totals.total)}`,
    description: `${totals.people} colaborador(es) · comissões ${formatCurrency(totals.commissions)} · bônus ${formatCurrency(totals.bonus)} · prêmios ${formatCurrency(totals.prizes)}${notes ? ` · ${notes}` : ""}`,
    department: "financeiro",
    payload: { competence, version, total: totals.total, people: totals.people },
    timeline: false,
  });
  return doc;
}
