import "server-only";
/**
 * Envio agendado de relatórios (fase 4): quem tem acesso e exportação de um relatório agenda o envio por e-mail para
 * pessoas do INTEROS. Segurança: cada destinatário recebe o relatório montado COM O ACESSO E O ESCOPO DELE (quem não
 * pode ver o relatório é pulado), e o envio só sai enquanto quem agendou ainda pode exportar. Só pessoas do INTEROS
 * (nada de endereço externo). Sem e-mail configurado, o destinatário recebe uma notificação com o link do relatório.
 */
import { create, getById, getManyByIds, list, remove, update } from "@/server/db";
import { currentUserFor } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { BusinessError } from "@/server/auth/error-classes";
import { notify } from "@/server/notifications";
import { sendEmail } from "@/server/integrations/providers";
import { isConnected } from "@/server/integrations/status";
import { COLLECTIONS, type CurrentUser, type ReportSchedule, type User } from "@/domain/types";
import { describeSchedule, nextRunAt, periodFiltersFor, periodsFor } from "@/domain/report-schedule";
import { buildReport, canAccessReport, reportExportKey, reportFileName } from "./build";
import { REPORT_DEFINITIONS, filtersToQuery, isReportKey, type ReportKey } from "./definitions";
import { reportToCsv } from "./export-csv";
import { reportToXlsx } from "./export-xlsx";
import { reportToPdf } from "./export-pdf";

export const MAX_RECIPIENTS = 20;
const MAX_PER_RUN = 10;

/** O relatório filtra por data, por competência ou é uma fotografia (sem período)? */
export function periodKindOf(key: ReportKey): "dia" | "mes" | "nenhum" {
  const f = REPORT_DEFINITIONS[key].filters;
  return f.includes("periodo_data") ? "dia" : f.includes("periodo_mes") ? "mes" : "nenhum";
}

/** Pode agendar este relatório: agendar + ver + exportar o tipo. */
export function canScheduleReport(user: CurrentUser, key: ReportKey): boolean {
  return can(user, "gestao.relatorios.agendar") && can(user, "gestao.relatorios.exportar") && canAccessReport(user, key) && can(user, reportExportKey(key));
}

async function decorated(ids: string[]): Promise<Map<string, CurrentUser>> {
  const users = await getManyByIds<User>(COLLECTIONS.users, ids);
  const out = new Map<string, CurrentUser>();
  for (const u of users.values()) if (u.active !== false) out.set(u.id, await currentUserFor(u));
  return out;
}

export interface ScheduleInput {
  reportKey: ReportKey;
  recipientIds: string[];
  filters: Record<string, string>;
  period: ReportSchedule["period"];
  format: ReportSchedule["format"];
  frequency: ReportSchedule["frequency"];
  weekday?: number;
  monthDay?: number;
  hour: number;
}

/** Cria ou altera (só quem agendou, ou admin). Destinatários precisam poder ver o relatório hoje. */
export async function saveReportSchedule(user: CurrentUser, input: ScheduleInput, id?: string): Promise<ReportSchedule> {
  if (!canScheduleReport(user, input.reportKey)) throw new BusinessError("Você não pode agendar este relatório");
  if (!periodsFor(periodKindOf(input.reportKey)).includes(input.period)) throw new BusinessError("Período inválido para este relatório");
  const ids = Array.from(new Set(input.recipientIds)).slice(0, MAX_RECIPIENTS);
  if (!ids.length) throw new BusinessError("Escolha quem vai receber");
  const people = await decorated(ids);
  const blocked = ids.filter((rid) => !people.get(rid) || !canAccessReport(people.get(rid)!, input.reportKey));
  if (blocked.length) {
    const names = await getManyByIds<User>(COLLECTIONS.users, blocked);
    throw new BusinessError(`Sem acesso a este relatório: ${blocked.map((b) => names.get(b)?.name ?? "usuário inativo").join(", ")}`);
  }
  // Filtros fixos só os do relatório (período vem do agendamento).
  const allowed = new Set(["colaborador", "cliente", "produto", "status", "departamento", "entidade", "evento", "texto"]);
  const filters = Object.fromEntries(Object.entries(input.filters).filter(([k, v]) => allowed.has(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 120)]));
  const base = {
    reportKey: input.reportKey,
    recipientIds: ids,
    filters,
    period: input.period,
    format: input.format,
    frequency: input.frequency,
    weekday: input.frequency === "semanal" ? (input.weekday ?? 1) : undefined,
    monthDay: input.frequency === "mensal" ? (input.monthDay ?? 1) : undefined,
    hour: input.hour,
  };
  const next = nextRunAt(base);
  if (id) {
    const current = await getById<ReportSchedule>(COLLECTIONS.reportSchedules, id);
    if (!current || (current.ownerId !== user.id && !user.isAdmin)) throw new BusinessError("Envio agendado não encontrado");
    await update<ReportSchedule>(COLLECTIONS.reportSchedules, id, { ...base, nextRunAt: next, active: true });
    return { ...current, ...base, nextRunAt: next, active: true };
  }
  return create<ReportSchedule>(COLLECTIONS.reportSchedules, { ...base, ownerId: user.id, active: true, nextRunAt: next });
}

async function ownSchedule(user: CurrentUser, id: string): Promise<ReportSchedule> {
  const s = await getById<ReportSchedule>(COLLECTIONS.reportSchedules, id);
  if (!s || (s.ownerId !== user.id && !user.isAdmin)) throw new BusinessError("Envio agendado não encontrado");
  return s;
}

export async function setReportScheduleActive(user: CurrentUser, id: string, active: boolean): Promise<void> {
  const s = await ownSchedule(user, id);
  await update<ReportSchedule>(COLLECTIONS.reportSchedules, s.id, { active, ...(active ? { nextRunAt: nextRunAt(s) } : {}) });
}

export async function deleteReportSchedule(user: CurrentUser, id: string): Promise<void> {
  const s = await ownSchedule(user, id);
  await remove(COLLECTIONS.reportSchedules, s.id);
}

export interface ScheduleRow {
  id: string;
  reportKey: string;
  reportTitle: string;
  when: string;
  format: string;
  recipients: string[];
  ownerName: string;
  mine: boolean;
  active: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastOk?: boolean;
  lastResult?: string;
}

/** Os envios de quem está vendo (admin: todos). */
export async function listReportSchedules(user: CurrentUser): Promise<ScheduleRow[]> {
  const all = await list<ReportSchedule>(COLLECTIONS.reportSchedules);
  const visible = all.filter((s) => user.isAdmin || s.ownerId === user.id);
  const users = await getManyByIds<User>(COLLECTIONS.users, visible.flatMap((s) => [s.ownerId, ...s.recipientIds]));
  return visible
    .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1))
    .map((s) => ({
      id: s.id,
      reportKey: s.reportKey,
      reportTitle: isReportKey(s.reportKey) ? REPORT_DEFINITIONS[s.reportKey].title : s.reportKey,
      when: describeSchedule(s),
      format: s.format.toUpperCase(),
      recipients: s.recipientIds.map((r) => users.get(r)?.name ?? "Usuário removido"),
      ownerName: users.get(s.ownerId)?.name ?? "Usuário removido",
      mine: s.ownerId === user.id,
      active: s.active,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      lastOk: s.lastOk,
      lastResult: s.lastResult,
    }));
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

async function renderFile(key: ReportKey, filters: Record<string, string>, viewer: CurrentUser, format: ReportSchedule["format"]) {
  const data = await buildReport(key, filters, viewer);
  const body = format === "csv" ? reportToCsv(data) : format === "xlsx" ? await reportToXlsx(data) : await reportToPdf(data);
  return { data, filename: reportFileName(data, format), content: new Uint8Array(body) };
}

/** Envia um agendamento agora (agendador ou «Enviar agora»). Devolve o resumo gravado em lastResult. */
export async function runReportSchedule(s: ReportSchedule, now: number = Date.now()): Promise<{ ok: boolean; summary: string }> {
  if (!isReportKey(s.reportKey)) return { ok: false, summary: "Relatório inexistente" };
  const key = s.reportKey;
  const people = await decorated([s.ownerId, ...s.recipientIds]);
  const owner = people.get(s.ownerId);
  if (!owner || !canScheduleReport(owner, key)) {
    // Quem agendou perdeu o acesso (ou saiu): pausa e avisa os admins pela tela.
    await update<ReportSchedule>(COLLECTIONS.reportSchedules, s.id, { active: false, lastRunAt: new Date(now).toISOString(), lastOk: false, lastResult: "Pausado: quem agendou não pode mais exportar este relatório." });
    return { ok: false, summary: "pausado (sem acesso de quem agendou)" };
  }
  const filters = { ...s.filters, ...periodFiltersFor(periodKindOf(key), s.period, now) };
  const email = isConnected("email");
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const rid of s.recipientIds) {
    const viewer = people.get(rid);
    if (!viewer || !canAccessReport(viewer, key) || !viewer.email) {
      skipped += 1;
      continue;
    }
    try {
      const file = await renderFile(key, filters, viewer, s.format);
      const title = `Relatório de ${file.data.definition.title} · ${file.data.periodLabel}`;
      const link = `/gestao/relatorios?tipo=${key}&${filtersToQuery(file.data.effective)}`;
      if (email) {
        const r = await sendEmail({
          to: viewer.email,
          internal: true,
          subject: `[INTEROS] ${title}`,
          text: `Olá, ${viewer.name.split(" ")[0]}.\n\nSegue o ${title.toLowerCase()} (${file.data.rows.length} linha(s)), conforme o envio agendado por ${owner.name}: ${describeSchedule(s).toLowerCase()}.\n\nO relatório foi gerado com o seu acesso no INTEROS.\n`,
          attachments: [{ filename: file.filename, content: file.content }],
        });
        if (r.ok) sent += 1;
        else failed += 1;
      } else {
        await notify({ userIds: [viewer.id], kind: "informativa", title, body: `Envio agendado por ${owner.name}. Abra para ver ou exportar.`, href: link });
        sent += 1;
      }
    } catch (error) {
      console.error(`[relatorios] falha no envio agendado ${s.id} para ${rid}`, error);
      failed += 1;
    }
  }
  const ok = failed === 0 && sent > 0;
  const summary = `${sent} enviado(s)${email ? " por e-mail" : " como notificação (e-mail não configurado)"}${skipped ? `, ${skipped} sem acesso` : ""}${failed ? `, ${failed} com falha` : ""}`;
  await update<ReportSchedule>(COLLECTIONS.reportSchedules, s.id, { lastRunAt: new Date(now).toISOString(), lastOk: ok, lastResult: summary, nextRunAt: nextRunAt(s, now) });
  return { ok, summary };
}

/** «Enviar agora» (não muda a próxima execução programada além do recálculo normal). */
export async function runReportScheduleNow(user: CurrentUser, id: string): Promise<string> {
  const s = await ownSchedule(user, id);
  return (await runReportSchedule(s)).summary;
}

/** Agendador: envia os vencidos (até 10 por execução, os mais atrasados primeiro). */
export async function runDueReportSchedules(now: number = Date.now()): Promise<number> {
  const at = new Date(now).toISOString();
  const due = (await list<ReportSchedule>(COLLECTIONS.reportSchedules, { where: [["active", "==", true]] })).filter((s) => s.nextRunAt <= at).sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1)).slice(0, MAX_PER_RUN);
  for (const s of due) {
    try {
      await runReportSchedule(s, now);
    } catch (error) {
      console.error(`[relatorios] envio agendado ${s.id} falhou`, error);
      await update<ReportSchedule>(COLLECTIONS.reportSchedules, s.id, { lastRunAt: at, lastOk: false, lastResult: "Falha ao gerar (detalhes no log do servidor)", nextRunAt: nextRunAt(s, now) });
    }
  }
  return due.length;
}

