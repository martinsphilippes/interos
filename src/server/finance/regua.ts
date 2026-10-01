import "server-only";
/**
 * Régua de cobrança parametrizável (D24). Setting `regua_cobranca`: marcos com `offsetDias` (NEGATIVO = dias
 * ANTES do vencimento, POSITIVO = depois), canal (WhatsApp, e-mail, ambos, tarefa ao Financeiro, notificação) e
 * texto com variáveis. `ativa: false` (padrão) = nada automático; os marcos padrão (−15, −7, +21) são uma proposta.
 *
 * Varredura `regua_cobranca` (diária + preguiçosa ao abrir Cobranças/Contas a Receber): para cada cobrança
 * aberta/vencida e cada marco ativo cujo dia (vencimento + offset, corridos ou úteis) é hoje — ou até 2 dias
 * atrás sem execução (folga) — executa UMA vez:
 * - idempotência: comunicação com id determinístico `comm_regua_<billingId>_<marcoId>[_canal]` (createIfAbsent)
 *   para WhatsApp/e-mail/notificação e tarefa por processId `regua:<billingId>` + título para o canal "tarefa";
 * - canal não conectado: NÃO finge envio — registra "não enviada" e cria tarefa ao Financeiro com o texto pronto
 *   e o link wa.me/mailto; opt-out do cliente também vira "não enviada" (sem tarefa: o cliente pediu);
 * - evento `billing.reminder_due` (billingId, marcoId, offsetDias, canal) para automações.
 * Não roda para contrato cancelado nem, quando `pausarQuando.pendencia`, para contrato com pendência.
 */
import { createIfAbsent, getManyByIds, list } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { createTaskInternal } from "@/server/tasks/service";
import { getDepartmentManager } from "@/server/workflow/service";
import { getSetting } from "@/server/admin/queries";
import { getHolidays } from "@/server/sla";
import { reguaCobrancaSchema, SETTING_DEFAULTS, type ReguaCanal, type ReguaCobrancaConfig, type ReguaMarco } from "@/server/admin/schemas";
import { isConnected } from "@/server/integrations/status";
import { manualSendUrl } from "@/server/integrations/communications";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type Communication, type Contact, type Contract, type Opportunity, type Task } from "@/domain/types";
import { billingLabel, buildBillingMessageContext, renderBillingTemplate, type BillingMessageContext } from "./billing-message";
import { daysBetween, SYSTEM_ACTOR } from "./billing";

const RECOVERY_DAYS = 2;
const HOUR_MS = 3_600_000;
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

export async function getReguaSettings(): Promise<ReguaCobrancaConfig> {
  const raw = await getSetting<ReguaCobrancaConfig>("regua_cobranca", SETTING_DEFAULTS.regua_cobranca);
  const parsed = reguaCobrancaSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...SETTING_DEFAULTS.regua_cobranca, marcos: SETTING_DEFAULTS.regua_cobranca.marcos.map((m) => ({ ...m })) };
}

/**
 * Dias do bloco "Vencem nos próximos N dias" do Meu Dia: menor marco negativo ativo da régua (quando ela está
 * ativa); fallback 3.
 */
export async function getDueSoonDays(): Promise<number> {
  try {
    const settings = await getReguaSettings();
    if (!settings.ativa) return 3;
    const before = settings.marcos.filter((m) => m.ativo && m.offsetDias < 0).map((m) => -m.offsetDias);
    return before.length > 0 ? Math.min(...before) : 3;
  } catch {
    return 3;
  }
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isBusinessKey(key: string, holidays: Set<string>): boolean {
  const day = new Date(`${key}T12:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(key);
}

/** Dia do marco: vencimento ± offset em dias corridos ou úteis (fins de semana e feriados não contam). */
export function reminderDayKey(dueKey: string, offsetDias: number, diasUteis: boolean, holidays: Set<string>): string {
  if (!diasUteis || offsetDias === 0) return shiftKey(dueKey, offsetDias);
  const step = offsetDias > 0 ? 1 : -1;
  let remaining = Math.abs(offsetDias);
  let cursor = dueKey;
  while (remaining > 0) {
    cursor = shiftKey(cursor, step);
    if (isBusinessKey(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

/** O marco está "vencido" hoje (ou na folga de recuperação de 2 dias). */
export function reminderIsDue(targetKey: string, today: string): boolean {
  const late = daysBetween(targetKey, today);
  return late >= 0 && late <= RECOVERY_DAYS;
}

export const reminderCommunicationId = (billingId: string, marcoId: string) => `comm_regua_${billingId}_${marcoId}`;
export const reminderProcessId = (billingId: string) => `regua:${billingId}`;

function reminderTaskTitle(marco: ReguaMarco, client: Client, billing: Billing, kind: "enviar" | "cobrar"): string {
  return kind === "enviar" ? `Enviar lembrete (${marco.nome}) — ${client.tradeName} · ${billingLabel(billing)}` : `Cobrar (${marco.nome}): ${client.tradeName} · ${billingLabel(billing)}`;
}

// ---------------------------------------------------------------------------
// Alvos (cobranças × marcos vencidos hoje) — compartilhado pela prévia e pela varredura
// ---------------------------------------------------------------------------

interface ReminderTarget {
  billing: Billing;
  contract: Contract;
  marco: ReguaMarco;
  targetKey: string;
}

async function collectTargets(settings: ReguaCobrancaConfig, today: string): Promise<{ targets: ReminderTarget[]; open: Billing[]; paused: number }> {
  const marcos = settings.marcos.filter((m) => m.ativo);
  const open = (await list<Billing>(COLLECTIONS.billing)).filter((b) => b.status === "aberta" || b.status === "vencida");
  if (marcos.length === 0 || open.length === 0) return { targets: [], open, paused: 0 };
  const contracts = await getManyByIds<Contract>(COLLECTIONS.contracts, open.map((b) => b.contractId));
  const holidays = settings.diasUteis ? await getHolidays() : new Set<string>();
  const targets: ReminderTarget[] = [];
  let paused = 0;
  for (const billing of open) {
    const contract = contracts.get(billing.contractId);
    if (!contract || contract.status === "cancelado") continue;
    if (settings.pausarQuando.pendencia && contract.status === "pendencia") {
      paused += 1;
      continue;
    }
    const dueKey = dateKey(billing.dueDate);
    for (const marco of marcos) {
      const targetKey = reminderDayKey(dueKey, marco.offsetDias, settings.diasUteis, holidays);
      if (reminderIsDue(targetKey, today)) targets.push({ billing, contract, marco, targetKey });
    }
  }
  return { targets, open, paused };
}

/** Execuções já registradas (comunicações determinísticas e tarefas da régua) para prévia/idempotência. */
async function loadExecuted(targets: ReminderTarget[]): Promise<{ comms: Map<string, Communication>; tasks: Task[] }> {
  const ids = new Set<string>();
  for (const t of targets) {
    const base = reminderCommunicationId(t.billing.id, t.marco.id);
    ids.add(base);
    ids.add(`${base}_whatsapp`);
    ids.add(`${base}_email`);
  }
  const [comms, tasks] = await Promise.all([getManyByIds<Communication>(COLLECTIONS.communications, Array.from(ids)), list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", "contract"]] })]);
  return { comms, tasks: tasks.filter((t) => t.processId?.startsWith("regua:")) };
}

function alreadyExecuted(t: ReminderTarget, executed: { comms: Map<string, Communication>; tasks: Task[] }, client?: Client): boolean {
  const base = reminderCommunicationId(t.billing.id, t.marco.id);
  if (executed.comms.has(base) || executed.comms.has(`${base}_whatsapp`) || executed.comms.has(`${base}_email`)) return true;
  if (t.marco.canal === "tarefa" && client) {
    const title = reminderTaskTitle(t.marco, client, t.billing, "cobrar");
    return executed.tasks.some((task) => task.processId === reminderProcessId(t.billing.id) && task.title === title && task.status !== "cancelada");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Prévia honesta: o que a régua faria hoje (contagem por marco, sem enviar nada)
// ---------------------------------------------------------------------------

export interface ReguaPreviewItem {
  marcoId: string;
  nome: string;
  offsetDias: number;
  canal: ReguaCanal;
  ativo: boolean;
  /** Cobranças cujo marco vence hoje (ou na folga de 2 dias). */
  due: number;
  /** Dessas, já executadas (não seriam repetidas). */
  done: number;
  /** Exemplos "cliente · cobrança · vence dd/mm". */
  sample: string[];
}

export interface ReguaPreview {
  ativa: boolean;
  diasUteis: boolean;
  today: string;
  openBillings: number;
  pausedByPendency: number;
  items: ReguaPreviewItem[];
  channels: { whatsapp: boolean; email: boolean };
}

export async function previewBillingReminders(now: Date = new Date()): Promise<ReguaPreview> {
  const settings = await getReguaSettings();
  const today = dateKey(now);
  const { targets, open, paused } = await collectTargets(settings, today);
  const executed = targets.length > 0 ? await loadExecuted(targets) : { comms: new Map<string, Communication>(), tasks: [] as Task[] };
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, targets.map((t) => t.billing.clientId));
  const items: ReguaPreviewItem[] = settings.marcos.map((marco) => {
    const mine = targets.filter((t) => t.marco.id === marco.id);
    const done = mine.filter((t) => alreadyExecuted(t, executed, clients.get(t.billing.clientId))).length;
    return {
      marcoId: marco.id,
      nome: marco.nome,
      offsetDias: marco.offsetDias,
      canal: marco.canal,
      ativo: marco.ativo,
      due: mine.length,
      done,
      sample: mine.slice(0, 3).map((t) => `${clients.get(t.billing.clientId)?.tradeName ?? t.billing.clientId} · ${billingLabel(t.billing)} ${formatCurrency(t.billing.amount)} · vence ${formatDate(t.billing.dueDate)}`),
    };
  });
  return { ativa: settings.ativa, diasUteis: settings.diasUteis, today, openBillings: open.length, pausedByPendency: paused, items, channels: { whatsapp: isConnected("whatsapp"), email: isConnected("email") } };
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

export interface ReguaRunResult {
  skipped: boolean;
  reason?: string;
  billings: number;
  due: number;
  sent: number;
  tasks: number;
  notifications: number;
  skippedExisting: number;
  notSent: number;
  errors: string[];
}

export async function runBillingReminders(now: Date = new Date()): Promise<ReguaRunResult> {
  const result: ReguaRunResult = { skipped: false, billings: 0, due: 0, sent: 0, tasks: 0, notifications: 0, skippedExisting: 0, notSent: 0, errors: [] };
  const settings = await getReguaSettings();
  if (!settings.ativa) return { ...result, skipped: true, reason: "régua de cobrança desligada (Configurações › Cobrança)" };
  if (!settings.marcos.some((m) => m.ativo)) return { ...result, skipped: true, reason: "nenhum marco ativo na régua" };
  const today = dateKey(now);
  const { targets, open } = await collectTargets(settings, today);
  result.billings = open.length;
  result.due = targets.length;
  if (targets.length === 0) return result;

  const [clients, contacts, executed, financeManager] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, targets.map((t) => t.billing.clientId)),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "in", Array.from(new Set(targets.map((t) => t.billing.clientId)))]] }),
    loadExecuted(targets),
    getDepartmentManager("financeiro"),
  ]);
  const opps = await getManyByIds<Opportunity>(COLLECTIONS.opportunities, targets.map((t) => t.contract.opportunityId ?? ""));
  const { sendBillingMessage } = await import("./service");

  for (const t of targets) {
    const client = clients.get(t.billing.clientId);
    if (!client) continue;
    if (alreadyExecuted(t, executed, client)) {
      result.skippedExisting += 1;
      continue;
    }
    const ctx = buildBillingMessageContext({ billing: t.billing, contract: t.contract, client, contacts: contacts.filter((c) => c.clientId === client.id), opportunity: t.contract.opportunityId ? (opps.get(t.contract.opportunityId) ?? null) : null });
    // {linkPortal}: WhatsApp/e-mail preservam o marcador (o envio gera um link novo, 30 dias); tarefa e notificação
    // são internas (nada chega ao cliente) e ficam sem link.
    const internalOnly = t.marco.canal === "tarefa" || t.marco.canal === "notificacao";
    const text = renderBillingTemplate(t.marco.template, ctx, internalOnly ? { linkPortal: "" } : {});
    const assigneeId = t.contract.ownerId ?? financeManager?.id;
    const originLabel = `régua · ${t.marco.nome}`;
    try {
      let outcome: Record<string, unknown> = {};
      if (t.marco.canal === "whatsapp" || t.marco.canal === "email" || t.marco.canal === "whatsapp_email") {
        const channel = t.marco.canal === "whatsapp_email" ? "ambos" : t.marco.canal;
        const { results, sentText } = await sendBillingMessage(t.billing.id, { channel, text }, SYSTEM_ACTOR, { id: reminderCommunicationId(t.billing.id, t.marco.id), whenNotConnected: "nao_enviada", templateKey: "regua", originLabel });
        const created = results.filter((r) => r.created);
        if (created.length === 0) {
          result.skippedExisting += 1;
          continue;
        }
        let tasksHere = 0;
        for (const r of created) {
          if (r.delivery === "enviada") result.sent += 1;
          else if (r.delivery === "falha" || r.delivery === "nao_enviada") {
            result.notSent += 1;
            const optOut = Boolean(ctx.client.communicationOptOut?.[r.channel]);
            if (!optOut) {
              // Canal não conectado (ou falha): o Financeiro envia pelo próprio aparelho — com o texto e o link prontos.
              const made = await ensureReminderTask(executed.tasks, {
                title: reminderTaskTitle(t.marco, client, t.billing, "enviar"),
                description: `${r.channel === "whatsapp" ? "WhatsApp" : "E-mail"} ${r.delivery === "falha" ? `com falha no envio (${r.error ?? "provedor"})` : "não conectado"}: envie pelo seu aparelho e registre.\n\nTexto:\n${sentText}${r.url ? `\n\nLink: ${r.url}` : `\n\nCliente sem ${r.channel === "whatsapp" ? "telefone" : "e-mail"} cadastrado.`}`,
                clientId: client.id,
                assigneeId,
                processId: reminderProcessId(t.billing.id),
                now,
              });
              if (made) tasksHere += 1;
            }
          }
        }
        result.tasks += tasksHere;
        outcome = { deliveries: created.map((r) => ({ channel: r.channel, delivery: r.delivery, communicationId: r.communicationId })), tasks: tasksHere };
      } else if (t.marco.canal === "tarefa") {
        const made = await ensureReminderTask(executed.tasks, {
          title: reminderTaskTitle(t.marco, client, t.billing, "cobrar"),
          description: `${text}\n\nContato: ${ctx.contactName}${ctx.phone ? ` · ${ctx.phone}` : ""}${ctx.email ? ` · ${ctx.email}` : ""}${manualSendUrl("whatsapp", ctx.phone, "", text) ? `\nWhatsApp: ${manualSendUrl("whatsapp", ctx.phone, "", text)}` : ""}`,
          clientId: client.id,
          assigneeId,
          processId: reminderProcessId(t.billing.id),
          now,
          priority: "alta",
        });
        if (!made) {
          result.skippedExisting += 1;
          continue;
        }
        result.tasks += 1;
        outcome = { task: true };
      } else {
        // notificacao: marcador determinístico + aviso interno ao responsável/gestor financeiro.
        const marker = await createIfAbsent<Communication>(COLLECTIONS.communications, reminderCommunicationId(t.billing.id, t.marco.id), {
          clientId: client.id,
          channel: "interno",
          direction: "saida",
          userId: SYSTEM_ACTOR.id,
          entityType: "billing",
          entityId: t.billing.id,
          body: text,
          templateKey: "regua_notificacao",
          status: "enviada",
          provider: "outro",
          createdBy: SYSTEM_ACTOR.id,
        });
        if (!marker.created) {
          result.skippedExisting += 1;
          continue;
        }
        const targetsIds = [assigneeId, financeManager?.id].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i);
        await notify({ userIds: targetsIds, kind: "atencao", title: `Régua de cobrança (${t.marco.nome}): ${client.tradeName}`, body: text, href: `/financeiro/cobrancas?cliente=${client.id}`, entity: { type: "billing", id: t.billing.id } });
        result.notifications += targetsIds.length;
        outcome = { notified: targetsIds.length };
      }
      await emitEvent({
        type: "billing.reminder_due",
        actor: SYSTEM_ACTOR,
        clientId: client.id,
        entity: { type: "billing", id: t.billing.id },
        title: `Régua de cobrança (${t.marco.nome}): ${billingLabel(t.billing)} de ${formatCurrency(t.billing.amount)} · ${client.tradeName}`,
        description: `${t.marco.offsetDias < 0 ? `${-t.marco.offsetDias} dia(s) antes` : t.marco.offsetDias > 0 ? `${t.marco.offsetDias} dia(s) depois` : "no dia"} do vencimento (${formatDate(t.billing.dueDate)}) · canal ${t.marco.canal}`,
        department: "financeiro",
        payload: { billingId: t.billing.id, contractId: t.contract.id, clientId: client.id, marcoId: t.marco.id, marcoNome: t.marco.nome, offsetDias: t.marco.offsetDias, canal: t.marco.canal, targetDay: t.targetKey, dueDate: t.billing.dueDate, amount: t.billing.amount, ...outcome },
        timeline: t.marco.canal === "tarefa" || t.marco.canal === "notificacao",
      });
    } catch (error) {
      result.errors.push(`${t.billing.id}/${t.marco.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** Tarefa da régua (idempotente por processId + título, não cancelada). */
async function ensureReminderTask(existing: Task[], input: { title: string; description: string; clientId: string; assigneeId?: string; processId: string; now: Date; priority?: Task["priority"] }): Promise<boolean> {
  if (existing.some((t) => t.processId === input.processId && t.title === input.title && t.status !== "cancelada" && (OPEN_TASK.has(t.status) || t.status === "concluida"))) return false;
  const task = await createTaskInternal(
    {
      title: input.title,
      description: input.description,
      clientId: input.clientId,
      assigneeId: input.assigneeId,
      departmentId: "financeiro",
      priority: input.priority ?? "media",
      dueAt: new Date(input.now.getTime() + 8 * HOUR_MS).toISOString(),
      processType: "contract",
      processId: input.processId,
      origin: "automacao",
      tags: ["financeiro", "cobranca", "regua"],
    },
    SYSTEM_ACTOR,
  );
  existing.push(task);
  return true;
}

export type { BillingMessageContext };
