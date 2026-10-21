"use server";
/**
 * Server Actions do envio agendado de relatórios: criar/alterar, pausar/retomar, excluir e enviar agora.
 * Padrão: requirePermission → zod → serviço (o serviço confere acesso ao relatório, exportação e destinatários).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { REPORT_SCHEDULE_FREQUENCIES, REPORT_SCHEDULE_PERIODS, type ActionResult } from "@/domain/types";
import { REPORT_KEYS } from "./definitions";
import { MAX_RECIPIENTS, deleteReportSchedule, runReportScheduleNow, saveReportSchedule, setReportScheduleActive } from "./schedules";

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
  return failAction(error, fallback, "gestao");
}

const scheduleSchema = z.object({
  id: z.string().trim().optional(),
  reportKey: z.enum(REPORT_KEYS),
  recipientIds: z.array(z.string().trim().min(1)).min(1, "Escolha quem vai receber").max(MAX_RECIPIENTS, `No máximo ${MAX_RECIPIENTS} pessoas`),
  filters: z.record(z.string(), z.string()).default({}),
  period: z.enum(REPORT_SCHEDULE_PERIODS),
  format: z.enum(["xlsx", "pdf", "csv"]),
  frequency: z.enum(REPORT_SCHEDULE_FREQUENCIES),
  weekday: z.coerce.number().int().min(0).max(6).optional(),
  monthDay: z.coerce.number().int().min(1, "Dia de 1 a 28").max(28, "Dia de 1 a 28").optional(),
  hour: z.coerce.number().int().min(0).max(23),
});

export async function saveReportScheduleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("gestao.relatorios.agendar");
    const { id, ...data } = scheduleSchema.parse(input);
    const s = await saveReportSchedule(user, data, id || undefined);
    revalidatePath("/gestao/relatorios");
    return { ok: true, data: { id: s.id } };
  } catch (error) {
    return fail(error, "Não foi possível agendar o envio");
  }
}

const idSchema = z.object({ id: z.string().trim().min(1) });

export async function toggleReportScheduleAction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requirePermission("gestao.relatorios.agendar");
    const { id, active } = idSchema.extend({ active: z.boolean() }).parse(input);
    await setReportScheduleActive(user, id, active);
    revalidatePath("/gestao/relatorios");
    return { ok: true, data: { active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar o envio");
  }
}

export async function deleteReportScheduleAction(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await requirePermission("gestao.relatorios.agendar");
    const { id } = idSchema.parse(input);
    await deleteReportSchedule(user, id);
    revalidatePath("/gestao/relatorios");
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error, "Não foi possível excluir o envio");
  }
}

export async function runReportScheduleNowAction(input: unknown): Promise<ActionResult<{ summary: string }>> {
  try {
    const user = await requirePermission("gestao.relatorios.agendar");
    const { id } = idSchema.parse(input);
    const summary = await runReportScheduleNow(user, id);
    revalidatePath("/gestao/relatorios");
    return { ok: true, data: { summary } };
  } catch (error) {
    return fail(error, "Não foi possível enviar agora");
  }
}
