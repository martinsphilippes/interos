"use server";
/**
 * Server Actions da supervisão de ligações (fase 4): o gerente começa a acompanhar, muda o modo (ouvir, sussurrar,
 * entrar) e sai; o atendente pergunta se há gerente na ligação. Padrão: requirePermission → zod → escopo → serviço.
 */
import { headers } from "next/headers";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { CALL_MONITOR_MODES, type ActionResult } from "@/domain/types";
import { monitorNoticeFor, setCallMonitorMode, startCallMonitor, stopCallMonitor, type MonitorNotice } from "./monitor";

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
  return failAction(error, fallback, "comunicacao");
}

async function baseUrl(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
}

const idSchema = z.object({ id: z.string().trim().min(1) });

/** Prepara a ligação para o gerente entrar (o softphone dele liga em seguida com o parâmetro monitor). */
export async function startCallMonitorAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.ligacoes");
    const { id } = idSchema.parse(input);
    return { ok: true, data: await startCallMonitor(user, id, await baseUrl()) };
  } catch (error) {
    return fail(error, "Não foi possível acompanhar a ligação");
  }
}

const modeSchema = z.object({ id: z.string().trim().min(1), mode: z.enum(CALL_MONITOR_MODES) });

export async function setCallMonitorModeAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.ligacoes");
    const { id, mode } = modeSchema.parse(input);
    await setCallMonitorMode(user, id, mode);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível mudar o modo");
  }
}

export async function stopCallMonitorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.ligacoes");
    const { id } = idSchema.parse(input);
    await stopCallMonitor(user, id);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível sair da ligação");
  }
}

const sidSchema = z.object({ callSid: z.string().trim().min(5).max(64) });

/** O atendente vê no softphone se há gerente na ligação (e em que modo). */
export async function callMonitorNoticeAction(input: unknown): Promise<ActionResult<MonitorNotice | null>> {
  try {
    const user = await requirePermission("comunicacao.ligacoes.ligar");
    const { callSid } = sidSchema.parse(input);
    return { ok: true, data: await monitorNoticeFor(user.id, callSid) };
  } catch (error) {
    return fail(error, "Não foi possível consultar a ligação");
  }
}
