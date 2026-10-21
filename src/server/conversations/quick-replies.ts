import "server-only";
/**
 * Respostas rápidas da Central (coleção quick_replies): o operador digita «/atalho» e o texto vem com as variáveis
 * ({contato}, {cliente}, {operador}, {atendimento}) preenchidas. Da empresa inteira ou de uma fila.
 */
import { col, createIfAbsent, list, nowIso } from "@/server/db";
import { FieldValue } from "@/server/docdb";
import { BusinessError } from "@/server/auth/error-classes";
import { COLLECTIONS, type QuickReply } from "@/domain/types";
import { isMessageVariable, variablesFor } from "@/domain/message-variables";

export function normalizeShortcut(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function listQuickReplies(): Promise<QuickReply[]> {
  return (await list<QuickReply>(COLLECTIONS.quickReplies)).sort((a, b) => a.shortcut.localeCompare(b.shortcut, "pt-BR"));
}

/** As que valem para quem atende estas filas (empresa inteira + as das filas). */
export function quickRepliesFor(all: readonly QuickReply[], queueIds: readonly string[]): QuickReply[] {
  return all.filter((r) => r.active && (!r.queueId || queueIds.includes(r.queueId)));
}

export interface SaveQuickReplyInput {
  id?: string;
  shortcut: string;
  body: string;
  queueId?: string;
  active: boolean;
}

export async function saveQuickReply(input: SaveQuickReplyInput): Promise<QuickReply> {
  const shortcut = normalizeShortcut(input.shortcut);
  if (shortcut.length < 2) throw new BusinessError("Atalho: ao menos 2 letras ou números");
  const unknown = Array.from(input.body.matchAll(/\{(\w+)\}/g), (m) => m[1]).filter((k) => !isMessageVariable(k) || !variablesFor("conversa").includes(k as never));
  if (unknown.length) throw new BusinessError(`Variável que não existe na conversa: {${unknown[0]}}. Use {contato}, {cliente}, {operador} ou {atendimento}.`);
  const all = await listQuickReplies();
  const clash = all.find((r) => r.shortcut === shortcut && r.id !== input.id);
  if (clash) throw new BusinessError(`Já existe a resposta /${shortcut}`);
  const data = { shortcut, body: input.body.trim(), queueId: input.queueId || undefined, active: input.active };
  if (input.id) {
    const current = all.find((r) => r.id === input.id);
    if (!current) throw new BusinessError("Resposta não encontrada");
    // queueId vazio = empresa inteira: apaga o campo.
    await col(COLLECTIONS.quickReplies)
      .doc(current.id)
      .update({ ...data, queueId: data.queueId ?? FieldValue.delete(), updatedAt: nowIso() });
    return { ...current, ...data };
  }
  const { doc } = await createIfAbsent<QuickReply>(COLLECTIONS.quickReplies, `qr_${Date.now().toString(36)}_${shortcut}`, { ...data, usageCount: 0 });
  return doc;
}

/** Conta um uso (a resposta foi enviada). Nunca derruba o envio. */
export async function countQuickReplyUse(id: string): Promise<void> {
  try {
    await col(COLLECTIONS.quickReplies).doc(id).update({ usageCount: FieldValue.increment(1) });
  } catch (error) {
    console.error("[respostas] falha ao contar uso", error);
  }
}
