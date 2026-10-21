"use server";
/**
 * Server Actions da Central de Comando (supervisão) e das configurações da operação (pausas, alertas, política de
 * gravação). Padrão: requirePermission → zod → escopo da supervisão → serviço → revalidatePath.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import { ROLE_KEYS } from "@/domain/constants";
import { pauseKeyOf } from "@/domain/central-ops";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { escalate, superviseAssume, supervisedConversation, touchMonitoring, whisper } from "./supervision";
import { ALERTS_SETTING, PAUSES_SETTING, RECORDING_SETTING, writeSetting } from "./ops-settings";

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
  return failAction(error, fallback, "comunicacao");
}

const conversationId = z.object({ conversationId: z.string("Conversa inválida").trim().min(1, "Conversa inválida") });

async function assertSupervisedConversation(user: CurrentUser, id: string) {
  const c = await supervisedConversation(user, id);
  if (!c) throw new BusinessError("Conversa não encontrada");
  return c;
}

function revalidate() {
  revalidatePath("/comunicacao/supervisao");
  revalidatePath("/comunicacao");
}

/** A tela do gerente está na conversa: abre/continua a sessão de acompanhamento (registro de supervisão). */
export async function monitorConversationAction(input: unknown): Promise<ActionResult<{ logId: string }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.acompanhar");
    const { conversationId: id } = conversationId.parse(input);
    const c = await assertSupervisedConversation(user, id);
    const log = await touchMonitoring(actor(user), c);
    return { ok: true, data: { logId: log.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o acompanhamento");
  }
}

export async function whisperAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.sussurrar");
    const data = conversationId.extend({ body: z.string("Escreva a orientação").trim().min(2, "Escreva a orientação").max(1000, "Orientação muito longa") }).parse(input);
    const c = await assertSupervisedConversation(user, data.conversationId);
    const note = await whisper(c, data.body, actor(user));
    revalidate();
    return { ok: true, data: { id: note.id } };
  } catch (error) {
    return fail(error, "Não foi possível enviar o sussurro");
  }
}

export async function superviseAssumeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.assumir");
    const { conversationId: id } = conversationId.parse(input);
    const c = await assertSupervisedConversation(user, id);
    const next = await superviseAssume(c, actor(user));
    revalidate();
    return { ok: true, data: { id: next.id } };
  } catch (error) {
    return fail(error, "Não foi possível assumir o atendimento");
  }
}

export async function escalateConversationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("comunicacao.supervisao.escalar");
    const data = conversationId.extend({ reason: z.string().trim().max(300, "Motivo muito longo").default("") }).parse(input);
    const c = await assertSupervisedConversation(user, data.conversationId);
    await escalate(c, data.reason, actor(user));
    revalidate();
    return { ok: true, data: { id: c.id } };
  } catch (error) {
    return fail(error, "Não foi possível escalar o atendimento");
  }
}

// ---------------------------------------------------------------------------
// Configurações (Canais e filas › Pausas / Alertas; Ativação › Política de gravação)
// ---------------------------------------------------------------------------

const pauseSchema = z.object({
  reasons: z
    .array(
      z.object({
        key: z.string().trim().max(40).optional(),
        label: z.string("Nome do motivo").trim().min(2, "Nome do motivo muito curto").max(40, "Nome do motivo muito longo"),
        maxMinutes: z.coerce
          .number()
          .int()
          .min(1, "Limite mínimo de 1 minuto")
          .max(480, "Limite máximo de 8 horas")
          .nullish()
          .transform((v) => v ?? undefined),
        active: z.boolean().default(true),
      }),
    )
    .min(1, "Cadastre ao menos um motivo")
    .max(20, "No máximo 20 motivos"),
});

export async function savePauseReasonsAction(input: unknown): Promise<ActionResult<{ saved: number }>> {
  try {
    await requirePermission("comunicacao.canais.pausas.editar");
    const { reasons } = pauseSchema.parse(input);
    // A chave fica estável (é o que está gravado na presença de quem está em pausa); motivo novo ganha chave do nome.
    const normalized = reasons.map((r) => ({ ...r, key: r.key || pauseKeyOf(r.label) }));
    const keys = normalized.map((r) => r.key);
    if (keys.some((k) => !k)) throw new BusinessError("Nome do motivo inválido");
    if (new Set(keys).size !== keys.length) throw new BusinessError("Há dois motivos com o mesmo nome");
    await writeSetting(PAUSES_SETTING, { reasons: normalized }, "Motivos de pausa da Central de Atendimento.");
    revalidatePath("/comunicacao/canais");
    revalidatePath("/", "layout");
    return { ok: true, data: { saved: normalized.length } };
  } catch (error) {
    return fail(error, "Não foi possível salvar os motivos de pausa");
  }
}

const alertsSchema = z.object({
  queue: z.object({ active: z.boolean(), maxWaiting: z.coerce.number().int().min(1, "Mínimo de 1 conversa").max(200, "Máximo de 200") }),
  sla: z.object({ active: z.boolean() }),
  idle: z.object({ active: z.boolean(), minutes: z.coerce.number().int().min(1, "Mínimo de 1 minuto").max(240, "Máximo de 4 horas") }),
  pause: z.object({ active: z.boolean() }),
  repeatMinutes: z.coerce.number().int().min(5, "Repetir no mínimo a cada 5 minutos").max(1440, "Repetir no máximo a cada 24 h"),
});

export async function saveManagerAlertsAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  try {
    await requirePermission("comunicacao.canais.alertas.editar");
    const data = alertsSchema.parse(input);
    await writeSetting(ALERTS_SETTING, data, "Alertas do gerente da Central de Atendimento.");
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    return fail(error, "Não foi possível salvar os alertas");
  }
}

const recordingSchema = z.object({
  enabled: z.boolean(),
  notice: z.string("Escreva o aviso").trim().min(10, "Escreva o aviso ao cliente").max(400, "Aviso muito longo"),
  retentionDays: z.coerce.number().int().min(7, "Guarde por no mínimo 7 dias").max(3650, "No máximo 10 anos"),
  listenRoles: z.array(z.enum(ROLE_KEYS)).min(1, "Escolha quem pode ouvir"),
  requireReason: z.boolean(),
});

export async function saveRecordingPolicyAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  try {
    await requirePermission("comunicacao.ativacao.gravacao.editar");
    const data = recordingSchema.parse(input);
    await writeSetting(RECORDING_SETTING, data, "Política de gravação de ligações (aviso, retenção e quem ouve).");
    revalidatePath("/comunicacao/ativacao");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a política de gravação");
  }
}
