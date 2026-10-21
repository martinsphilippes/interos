import "server-only";
/**
 * Modelos do WhatsApp (coleção message_templates): sincronização com a Meta, cadastro e envio à análise, ligação das
 * variáveis {{n}} às variáveis do INTEROS e o uso deles (conversa da Central e régua de cobrança).
 *
 * A Meta é a fonte da verdade do texto e da situação (aprovado, em análise, rejeitado, pausado). O INTEROS guarda o
 * que é dele: qual variável preenche cada {{n}} e onde o modelo pode ser usado. Sem a conta configurada
 * (WHATSAPP_BUSINESS_ACCOUNT_ID), dá para cadastrar como rascunho — nada é enviado como se estivesse aprovado.
 */
import { createIfAbsent, getById, list, nowIso, update } from "@/server/db";
import { BusinessError } from "@/server/auth/error-classes";
import { createWhatsappTemplate, listWhatsappTemplates, type MetaTemplate } from "@/server/integrations/providers";
import { COLLECTIONS, type Communication, type MessageTemplate, type TemplateCategory, type TemplateContext, type TemplateStatus } from "@/domain/types";
import { MESSAGE_VARIABLES, isMessageVariable, placeholderCount, placeholdersValid, templateNameOf, variablesFor } from "@/domain/message-variables";

export function templateId(name: string, language: string): string {
  return `tpl_${name}_${language.replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** Chave gravada em communications.templateKey quando o modelo é enviado. */
export function templateKeyOf(t: Pick<MessageTemplate, "name">): string {
  return `modelo:${t.name}`;
}

const META_STATUS: Record<string, TemplateStatus> = { APPROVED: "aprovado", PENDING: "em_analise", IN_APPEAL: "em_analise", REJECTED: "rejeitado", PAUSED: "pausado", DISABLED: "desativado", PENDING_DELETION: "desativado" };

export async function listTemplates(): Promise<MessageTemplate[]> {
  return (await list<MessageTemplate>(COLLECTIONS.messageTemplates)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** O modelo pode ser enviado: aprovado e com todas as variáveis ligadas. */
export function templateUsable(t: MessageTemplate, context?: TemplateContext): boolean {
  if (t.status !== "aprovado") return false;
  if (context && t.context !== context) return false;
  const n = placeholderCount(t.body);
  return t.variables.length >= n && t.variables.slice(0, n).every((v) => isMessageVariable(v));
}

export async function usableTemplates(context: TemplateContext): Promise<MessageTemplate[]> {
  return (await listTemplates()).filter((t) => templateUsable(t, context));
}

export async function getTemplate(id: string): Promise<MessageTemplate | null> {
  return getById<MessageTemplate>(COLLECTIONS.messageTemplates, id);
}

function fromMeta(m: MetaTemplate): { body: string; footer?: string; buttons?: MessageTemplate["buttons"] } {
  const body = m.components?.find((c) => c.type === "BODY")?.text ?? "";
  const footer = m.components?.find((c) => c.type === "FOOTER")?.text;
  const buttons = m.components?.find((c) => c.type === "BUTTONS")?.buttons?.map((b) => ({ type: b.type, text: b.text, url: b.url }));
  return { body, footer, buttons: buttons?.length ? buttons : undefined };
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  total: number;
}

/**
 * Lê os modelos da Meta e atualiza a coleção (texto, situação, motivo de rejeição, qualidade). Mantém a ligação das
 * variáveis e o contexto definidos no INTEROS. Modelos de autenticação ficam de fora (não servem para atendimento).
 */
export async function syncTemplatesFromMeta(): Promise<SyncResult> {
  const r = await listWhatsappTemplates();
  if (!r.ok) return { ok: false, error: r.error, created: 0, updated: 0, total: 0 };
  const existing = new Map((await listTemplates()).map((t) => [t.id, t]));
  let created = 0;
  let updated = 0;
  const syncedAt = nowIso();
  for (const m of r.templates) {
    if (m.category === "AUTHENTICATION") continue;
    const id = templateId(m.name, m.language);
    const { body, footer, buttons } = fromMeta(m);
    const data = {
      status: META_STATUS[m.status] ?? "em_analise",
      category: (m.category === "MARKETING" ? "marketing" : "utilidade") as TemplateCategory,
      body,
      footer,
      buttons,
      rejectedReason: m.status === "REJECTED" && m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : undefined,
      quality: m.quality_score?.score,
      metaId: m.id,
      syncedAt,
    };
    const current = existing.get(id);
    if (current) {
      await update<MessageTemplate>(COLLECTIONS.messageTemplates, id, data);
      updated += 1;
    } else {
      const n = placeholderCount(body);
      await createIfAbsent<MessageTemplate>(COLLECTIONS.messageTemplates, id, { ...data, name: m.name, language: m.language, variables: Array.from({ length: n }, () => ""), context: "conversa" });
      created += 1;
    }
  }
  return { ok: true, created, updated, total: r.templates.length };
}

export interface SaveTemplateInput {
  /** Edição (variáveis e contexto) de um modelo existente. */
  id?: string;
  name: string;
  category: TemplateCategory;
  context: TemplateContext;
  body: string;
  footer?: string;
  variables: string[];
}

function checkVariables(body: string, variables: string[], context: TemplateContext): void {
  const n = placeholderCount(body);
  if (!placeholdersValid(body)) throw new BusinessError("Use {{1}}, {{2}}… em sequência, sem pular números");
  if (variables.length < n || variables.slice(0, n).some((v) => !isMessageVariable(v))) throw new BusinessError(`Escolha a variável de cada {{n}} (o modelo usa ${n})`);
  const allowed = new Set<string>(variablesFor(context));
  const wrong = variables.slice(0, n).filter((v) => !allowed.has(v));
  if (wrong.length) throw new BusinessError(`Variável que não existe neste uso: ${wrong.map((w) => MESSAGE_VARIABLES[w as keyof typeof MESSAGE_VARIABLES]?.label ?? w).join(", ")}`);
}

/**
 * Novo modelo: vai à Meta para análise quando a conta está configurada (fica "em análise"); sem conta, fica como
 * rascunho. Edição de um modelo existente: só a ligação das variáveis e o contexto (o texto aprovado não muda — para
 * mudar o texto, crie uma versão nova).
 */
export async function saveTemplate(input: SaveTemplateInput): Promise<{ template: MessageTemplate; sentToMeta: boolean; error?: string }> {
  if (input.id) {
    const current = await getTemplate(input.id);
    if (!current) throw new BusinessError("Modelo não encontrado");
    checkVariables(current.body, input.variables, input.context);
    const patch = { variables: input.variables.slice(0, placeholderCount(current.body)), context: input.context };
    await update<MessageTemplate>(COLLECTIONS.messageTemplates, current.id, patch);
    return { template: { ...current, ...patch }, sentToMeta: false };
  }
  const name = templateNameOf(input.name);
  if (name.length < 3) throw new BusinessError("Nome do modelo: ao menos 3 letras (minúsculas, números e _)");
  checkVariables(input.body, input.variables, input.context);
  const language = "pt_BR";
  const id = templateId(name, language);
  if (await getTemplate(id)) throw new BusinessError("Já existe um modelo com esse nome: crie uma versão nova (ex.: _v2)");
  const n = placeholderCount(input.body);
  const variables = input.variables.slice(0, n);
  const examples = variables.map((v) => MESSAGE_VARIABLES[v as keyof typeof MESSAGE_VARIABLES].example);
  const meta = await createWhatsappTemplate({ name, language, category: input.category === "marketing" ? "MARKETING" : "UTILITY", body: input.body, examples, footer: input.footer });
  const status: TemplateStatus = meta.ok ? (META_STATUS[meta.status] ?? "em_analise") : "rascunho";
  const { doc } = await createIfAbsent<MessageTemplate>(COLLECTIONS.messageTemplates, id, {
    name,
    language,
    category: input.category,
    status,
    body: input.body,
    footer: input.footer,
    variables,
    context: input.context,
    metaId: meta.ok ? meta.id : undefined,
    rejectedReason: meta.ok ? undefined : meta.error,
  });
  return { template: doc, sentToMeta: meta.ok, error: meta.ok ? undefined : meta.error };
}

/** Envios de cada modelo nos últimos 30 dias (pela chave gravada nas comunicações). */
export async function templateUsage(templates: MessageTemplate[]): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const out = new Map<string, number>();
  for (const t of templates) {
    const sent = await list<Communication>(COLLECTIONS.communications, { where: [["templateKey", "==", templateKeyOf(t)]] });
    out.set(t.id, sent.filter((c) => c.createdAt >= since).length);
  }
  return out;
}
