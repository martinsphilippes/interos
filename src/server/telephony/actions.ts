"use server";
/**
 * Server Actions da telefonia: atender (quem atendeu), transferir, marcar retorno, tratar recado, abrir gravação (com
 * motivo e registro de acesso) e configurar o PABX/ramais. Padrão: requirePermission → zod → escopo → serviço.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import { create, getById, getManyByIds, list, nowIso } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ActionResult, type Communication, type CurrentUser, type RecordingAccessLog, type User, type UserRef } from "@/domain/types";
import { isExtension, toE164, transferTwiml } from "@/domain/telephony";
import { redirectCall, defaultCallerId } from "@/server/integrations/twilio";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { patchFields } from "@/server/conversations/store";
import { callInScope } from "./queries";
import { availableAgents, claimCall, getPabx, markReturned, markVoicemailHandled, savePabx } from "./service";

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
  return failAction(error, fallback, "comunicacao");
}

async function loadCallInScope(user: CurrentUser, id: string): Promise<Communication> {
  const c = await getById<Communication>(COLLECTIONS.communications, id);
  if (!c || c.channel !== "voip" || !(await callInScope(user, c))) throw new BusinessError("Ligação não encontrada");
  return c;
}

const callSidSchema = z.object({ callSid: z.string().trim().min(5).max(64) });

/** O softphone atendeu: a ligação passa a ser de quem atendeu. */
export async function claimCallAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.ligacoes.ligar");
    const { callSid } = callSidSchema.parse(input);
    await claimCall(callSid, actor(user));
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o atendimento");
  }
}

const transferSchema = z
  .object({
    callSid: z.string().trim().min(5).max(64),
    toUserId: z.string().trim().optional(),
    toNumber: z.string().trim().optional(),
  })
  .refine((v) => Boolean(v.toUserId) !== Boolean(v.toNumber), { message: "Escolha um ramal ou digite um número" });

/** Transferência direta de uma ligação recebida: para o ramal de outra pessoa (disponível) ou um número externo. */
export async function transferCallAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    await requirePermission("comunicacao.ligacoes.ligar");
    const data = transferSchema.parse(input);
    if (data.toUserId) {
      const target = await getById<User>(COLLECTIONS.users, data.toUserId);
      if (!target || target.active === false || !target.central?.extension) throw new BusinessError("Essa pessoa não tem ramal");
      if (target.presence !== "online") throw new BusinessError(`${target.name} não está disponível agora`);
    }
    const number = data.toNumber ? toE164(data.toNumber) : null;
    if (data.toNumber && !number) throw new BusinessError("Número inválido");
    const pabx = await getPabx();
    const r = await redirectCall(data.callSid, transferTwiml(data.toUserId ? { client: data.toUserId } : { number: number! }, pabx.numbers.find((n) => n.active)?.number ?? defaultCallerId()));
    if (!r.ok) throw new BusinessError(`Não foi possível transferir: ${r.error}`);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível transferir a ligação");
  }
}

/** Pessoas com ramal disponíveis para receber a transferência. */
export async function transferTargetsAction(): Promise<ActionResult<{ id: string; name: string; extension: string }[]>> {
  try {
    const user = await requirePermission("comunicacao.ligacoes.ligar");
    const agents = (await availableAgents(undefined)).filter((u) => u.id !== user.id);
    return { ok: true, data: agents.map((u) => ({ id: u.id, name: u.name, extension: u.central?.extension ?? "" })) };
  } catch (error) {
    return fail(error, "Não foi possível listar os ramais");
  }
}

const idSchema = z.object({ id: z.string().trim().min(1) });

export async function markCallReturnedAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.ligacoes.ligar");
    const { id } = idSchema.parse(input);
    const c = await loadCallInScope(user, id);
    await markReturned(c.id, actor(user));
    revalidatePath("/comunicacao/ligacoes");
    revalidatePath("/comunicacao/correio-de-voz");
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível marcar o retorno");
  }
}

export async function markVoicemailHandledAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.correio.tratar");
    const { id } = idSchema.parse(input);
    const c = await loadCallInScope(user, id);
    await markVoicemailHandled(c.id, actor(user));
    revalidatePath("/comunicacao/correio-de-voz");
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar o recado");
  }
}

const openRecordingSchema = z.object({ id: z.string().trim().min(1), action: z.enum(["ouvir", "baixar"]).default("ouvir"), reason: z.string().trim().max(300, "Motivo muito longo").optional() });

/**
 * Abrir gravação: confere escopo e política (papel na lista «quem pode ouvir», ou quem atendeu), exige o motivo quando
 * a política manda e grava o acesso. Devolve o endereço do áudio (vale 15 minutos para esse acesso).
 */
export async function openRecordingAction(input: unknown): Promise<ActionResult<{ url: string; urls: string[] }>> {
  try {
    const user = await requirePermission("comunicacao.ligacoes.gravacoes.ouvir");
    const data = openRecordingSchema.parse(input);
    const c = await loadCallInScope(user, data.id);
    if (!c.recordingSid || c.recordingDeletedAt) throw new BusinessError("Esta ligação não tem gravação");
    const policy = await getRecordingPolicy();
    if (!policy.listenRoles.includes(user.role) && c.userId !== user.id) throw new BusinessError("A política de gravação não libera esta gravação para o seu papel");
    if (policy.requireReason && (data.reason ?? "").length < 5) throw new BusinessError("Escreva o motivo (a política de gravação exige)");
    const log = await create<RecordingAccessLog>(COLLECTIONS.recordingAccessLogs, { userId: user.id, communicationId: c.id, action: data.action, reason: data.reason || undefined, at: nowIso() });
    // Ligação que passou pela supervisão: a gravação tem mais de uma parte (antes e depois do gerente entrar).
    const parts = 1 + (c.recordingParts?.length ?? 0);
    const urls = Array.from({ length: parts }, (_, i) => {
      const q = new URLSearchParams();
      if (i > 0) q.set("parte", String(i + 1));
      if (data.action === "baixar") q.set("download", "1");
      const qs = q.toString();
      return `/api/voice/recordings/${log.id}${qs ? `?${qs}` : ""}`;
    });
    return { ok: true, data: { url: urls[0], urls } };
  } catch (error) {
    return fail(error, "Não foi possível abrir a gravação");
  }
}

// ---------------------------------------------------------------------------
// PABX
// ---------------------------------------------------------------------------

const pabxSchema = z.object({
  numbers: z
    .array(z.object({ number: z.string().trim().min(8, "Número inválido"), label: z.string().trim().min(2, "Nome do número").max(40), queueId: z.string().trim().optional(), active: z.boolean() }))
    .max(30),
  ringSeconds: z.coerce.number().int().min(5, "Mínimo de 5 segundos").max(60, "Máximo de 60 segundos"),
  welcome: z.string().trim().max(300, "Mensagem muito longa"),
  voicemail: z.boolean(),
  closedMessage: z.string().trim().min(5, "Escreva a mensagem fora do horário").max(400),
  noAgentMessage: z.string().trim().min(5, "Escreva a mensagem sem atendente").max(400),
  rates: z.object({ fixo: z.coerce.number().min(0, "Tarifa inválida").max(50), movel: z.coerce.number().min(0, "Tarifa inválida").max(50), entrada: z.coerce.number().min(0, "Tarifa inválida").max(50) }),
});

export async function savePabxAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  try {
    const user = await requirePermission("comunicacao.pabx.editar");
    const data = pabxSchema.parse(input);
    await savePabx({ ...data, numbers: data.numbers.map((n) => ({ ...n, queueId: n.queueId || undefined })) }, actor(user));
    revalidatePath("/comunicacao/pabx");
    revalidatePath("/comunicacao/ativacao");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o PABX");
  }
}

const extensionsSchema = z.object({ extensions: z.array(z.object({ userId: z.string().trim().min(1), extension: z.string().trim().max(6) })).max(500) });

/** Ramais (User.central.extension): únicos; vazio = sem ramal (não recebe ligação). */
export async function saveExtensionsAction(input: unknown): Promise<ActionResult<{ changed: number }>> {
  try {
    const user = await requirePermission("comunicacao.pabx.editar");
    const { extensions } = extensionsSchema.parse(input);
    for (const e of extensions) if (e.extension && !isExtension(e.extension)) throw new BusinessError(`Ramal inválido: ${e.extension} (2 a 6 dígitos)`);
    const used = extensions.filter((e) => e.extension).map((e) => e.extension);
    if (new Set(used).size !== used.length) throw new BusinessError("Dois usuários com o mesmo ramal");
    const users = await getManyByIds<User>(COLLECTIONS.users, extensions.map((e) => e.userId));
    // Ramal já usado por quem não está na lista.
    const others = (await list<User>(COLLECTIONS.users)).filter((u) => !extensions.some((e) => e.userId === u.id) && u.central?.extension);
    const clash = others.find((u) => used.includes(u.central!.extension!));
    if (clash) throw new BusinessError(`O ramal ${clash.central!.extension} já é de ${clash.name}`);
    const changes: string[] = [];
    for (const e of extensions) {
      const u = users.get(e.userId);
      if (!u) continue;
      const current = u.central?.extension ?? "";
      if (current === e.extension) continue;
      await patchFields<User>(COLLECTIONS.users, u.id, { central: { ...(u.central ?? { attends: true }), extension: e.extension || undefined } });
      changes.push(`${u.name}: ${current || "sem ramal"} → ${e.extension || "sem ramal"}`);
    }
    if (changes.length) await emitEvent({ type: "settings.updated", actor: actor(user), entity: { type: "setting", id: "ramais" }, title: `${user.name} alterou ramais`, description: changes.join("; "), payload: { key: "ramais", changes }, timeline: false });
    revalidatePath("/comunicacao/pabx");
    return { ok: true, data: { changed: changes.length } };
  } catch (error) {
    return fail(error, "Não foi possível salvar os ramais");
  }
}
