import "server-only";
/**
 * Contas a Pagar geral (D28) — varreduras:
 * - `ensureRecurringPayables`: séries recorrentes de títulos manuais (`Payable.recurrence` + `seriesId`) ganham a próxima
 *   ocorrência 30 dias antes do vencimento, com id determinístico `pag_rec_<seriesId>_<AAAA-MM>` (createIfAbsent):
 *   rodar duas vezes não duplica. A série termina em `recurrence.until` (ou quando o título da série é cancelado).
 * - `notifyOverduePayables`: título vencido (previsto/aprovado/a pagar com vencimento passado) avisa o Financeiro
 *   UMA vez (marca `overdueNotifiedAt`); o Meu Dia já lista os vencidos.
 */
import { createIfAbsent, list, nowIso, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { getDepartmentManager } from "@/server/workflow/service";
import { dayInMonth } from "@/server/finance/billing";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { COLLECTIONS, type Payable, type PayableHistoryEntry, type User } from "@/domain/types";
import { assignPayableCode, cleanPatch, SYSTEM_ACTOR } from "./store";

const DAY_MS = 86_400_000;
const LEAD_DAYS = 30;
const OPEN: Payable["status"][] = ["previsto", "aprovado", "a_pagar"];

export function recurringOccurrenceId(seriesId: string, competence: string): string {
  return `pag_rec_${seriesId}_${competence}`;
}

function addMonthsKey(comp: string, n: number): string {
  const [y, m] = comp.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Competência da próxima ocorrência depois de `comp` (mensal: +1; anual: +12). */
function nextCompetence(comp: string, frequency: "mensal" | "anual"): string {
  return addMonthsKey(comp, frequency === "anual" ? 12 : 1);
}

export interface RecurringPayablesResult {
  series: number;
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Para cada série (título com `recurrence` e `seriesId`, não cancelado): a partir da última ocorrência existente,
 * cria as próximas cuja data de vencimento esteja a até 30 dias de `now` (recuperando atrasos, no máximo 24 por
 * execução), respeitando `until`.
 */
export async function ensureRecurringPayables(now: Date = new Date()): Promise<RecurringPayablesResult> {
  const all = await list<Payable>(COLLECTIONS.payables);
  const templates = all.filter((p) => p.recurrence && p.seriesId && p.seriesId === p.id && p.status !== "cancelado");
  const result: RecurringPayablesResult = { series: templates.length, created: 0, skipped: 0, errors: [] };
  const limit = dateKey(new Date(now.getTime() + LEAD_DAYS * DAY_MS));
  for (const t of templates) {
    try {
      const rec = t.recurrence!;
      const members = all.filter((p) => p.seriesId === t.id);
      let last = members.map((p) => p.competence).sort().pop() ?? t.competence;
      for (let i = 0; i < 24; i++) {
        const comp = nextCompetence(last, rec.frequency);
        const dueDate = dayInMonth(comp, 0, rec.dayOfMonth);
        const dueKey = dateKey(dueDate);
        if (rec.until && dueKey > rec.until.slice(0, 10)) break;
        if (dueKey > limit) break;
        const id = recurringOccurrenceId(t.id, comp);
        const history: PayableHistoryEntry[] = [{ at: nowIso(), by: SYSTEM_ACTOR.id, byName: SYSTEM_ACTOR.name, action: `Ocorrência da série ${t.code ?? t.id} (${rec.frequency})`, to: "previsto" }];
        const { created, doc } = await createIfAbsent<Payable>(
          COLLECTIONS.payables,
          id,
          stripUndefined({
            creditorType: t.creditorType,
            creditorId: t.creditorId,
            creditorName: t.creditorName,
            category: t.category,
            description: t.description,
            // Etapa CP/CR 3: quitar o título-modelo com desconto/juros/resíduo ajusta o valor DELE, não o da série.
            amount: t.originalAmount ?? t.amount,
            competence: comp,
            dueDate,
            status: "previsto",
            origin: "recorrencia",
            sourceIds: { commissionIds: [], clientId: t.sourceIds?.clientId },
            supplierId: t.supplierId,
            costCenter: t.costCenter,
            seriesId: t.id,
            notes: t.notes,
            history,
            createdBy: SYSTEM_ACTOR.id,
          }) as Omit<Payable, "id" | "organizationId" | "createdAt" | "updatedAt">,
        );
        last = comp;
        if (!created) {
          result.skipped += 1;
          continue;
        }
        const code = await assignPayableCode(id, doc.createdAt);
        result.created += 1;
        await emitEvent({
          type: "payable.created",
          actor: SYSTEM_ACTOR,
          clientId: t.sourceIds?.clientId,
          entity: { type: "payable", id },
          title: `Título ${code} gerado pela série ${t.code ?? t.id}: ${formatCurrency(t.originalAmount ?? t.amount)} para ${t.creditorName}`,
          description: `${t.description} · competência ${comp} · vence ${formatDate(dueDate)}`,
          department: "financeiro",
          payload: { payableId: id, code, seriesId: t.id, competence: comp, amount: t.originalAmount ?? t.amount, dueDate, creditorId: t.creditorId ?? null, origin: "recorrencia" },
          timeline: false,
        });
      }
    } catch (error) {
      result.errors.push(`${t.code ?? t.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export interface OverduePayablesResult {
  overdue: number;
  notified: number;
  alreadyNotified: number;
}

/** Aviso único por título vencido ao gestor do Financeiro (e a quem aprovou/programou, quando houver). */
export async function notifyOverduePayables(now: Date = new Date()): Promise<OverduePayablesResult> {
  const today = dateKey(now);
  const overdue = (await list<Payable>(COLLECTIONS.payables, { where: [["status", "in", OPEN]] })).filter((p) => dateKey(p.dueDate) < today);
  const result: OverduePayablesResult = { overdue: overdue.length, notified: 0, alreadyNotified: 0 };
  if (overdue.length === 0) return result;
  const [manager, users] = await Promise.all([getDepartmentManager("financeiro"), list<User>(COLLECTIONS.users)]);
  const active = (id: string | undefined) => (id && users.some((u) => u.id === id && u.active !== false) ? id : undefined);
  for (const p of overdue) {
    if (p.overdueNotifiedAt) {
      result.alreadyNotified += 1;
      continue;
    }
    const targets = [manager?.id, active(p.scheduledBy), active(p.approvedBy)].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i);
    const days = Math.max(1, Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / DAY_MS));
    await update<Payable>(COLLECTIONS.payables, p.id, cleanPatch({ overdueNotifiedAt: nowIso() }) as Partial<Payable>);
    if (targets.length > 0) {
      await notify({
        userIds: targets,
        kind: "atencao",
        title: `Título a pagar vencido: ${p.code ?? p.id}`,
        body: `${p.creditorName} · ${formatCurrency(p.amount)} · venceu em ${formatDate(p.dueDate)} (há ${days} dia(s)) · ${p.description}`,
        href: `/financeiro/contas-a-pagar?titulo=${p.id}`,
        entity: { type: "payable", id: p.id },
      });
    }
    result.notified += 1;
  }
  return result;
}
