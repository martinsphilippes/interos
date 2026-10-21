import "server-only";
/**
 * Agendador da Central (rota /api/cron/central, chamada a cada 5 minutos pelo pg_cron do Supabase — o plano atual da
 * Vercel só agenda uma vez por dia). Cada passo é independente: a falha de um não impede os outros.
 *
 * 1. Menu sem resposta há 10 min → vai para a fila padrão.
 * 2. Transbordo: na fila há mais que o tempo da fila → fila de transbordo (com nota).
 * 3. Distribuição para quem está online.
 * 4. Aviso de posição na fila (mensagem automática).
 * 5. Cliente que parou de responder: lembrete e, depois, encerramento automático.
 * 6. Limpeza dos registros técnicos com mais de 30 dias.
 * 7. Sincronização dos modelos do WhatsApp com a Meta (a cada hora).
 * 8. Alertas do gerente (fila cheia, SLA em risco, cliente sem resposta, pausa longa), quando ligados.
 * No fim, grava a hora da execução (a tela «Ativação dos canais» mostra se o agendador está rodando).
 */
import { col, create, list, nowIso, ORG_ID, update } from "@/server/db";
import { COLLECTIONS, type Conversation, type ServiceQueue, type Settings } from "@/domain/types";
import { isOpenConversation } from "@/domain/conversations";
import { CHANNEL_EVENT_RETENTION_DAYS } from "./channel-events";
import { addConversationNote, closeConversation, distributeWaiting, routeNewConversation, SYSTEM_ACTOR } from "./service";
import { getAutoMessages, sendAutoMessage } from "./auto-messages";
import { syncTemplatesFromMeta } from "./templates";
import { patchFields } from "./store";

const MENU_TIMEOUT_MS = 10 * 60_000;
export const STATE_SETTING = "central_agendador";

export interface CentralSweepReport {
  ranAt: string;
  steps: { step: string; ok: boolean; summary: string }[];
}

async function step(report: CentralSweepReport, name: string, fn: () => Promise<string>): Promise<void> {
  try {
    report.steps.push({ step: name, ok: true, summary: await fn() });
  } catch (error) {
    console.error(`[central:agendador] ${name}`, error);
    report.steps.push({ step: name, ok: false, summary: error instanceof Error ? error.message : "falha" });
  }
}

async function openConversations(): Promise<Conversation[]> {
  return (await list<Conversation>(COLLECTIONS.conversations, { where: [["status", "in", ["nova", "na_fila", "em_atendimento", "aguardando_cliente"]]] })).filter(isOpenConversation);
}

export async function runCentralSweep(now: Date = new Date()): Promise<CentralSweepReport> {
  const report: CentralSweepReport = { ranAt: now.toISOString(), steps: [] };
  const t = now.getTime();
  const auto = await getAutoMessages();

  await step(report, "menu sem resposta", async () => {
    const pending = (await openConversations()).filter((c) => c.menuPending && t - new Date(c.autoSentAt?.menu ?? c.openedAt).getTime() > MENU_TIMEOUT_MS);
    for (const c of pending) await routeNewConversation(c, { hasOpenTicket: Boolean(c.ticketId) });
    return `${pending.length} conversa(s) enviada(s) para a fila padrão`;
  });

  await step(report, "transbordo", async () => {
    const queues = new Map((await list<ServiceQueue>(COLLECTIONS.serviceQueues)).map((q) => [q.id, q]));
    const waiting = (await openConversations()).filter((c) => c.status === "na_fila" && !c.assigneeId && c.queueId);
    let moved = 0;
    for (const c of waiting) {
      const q = queues.get(c.queueId!);
      const target = q?.overflowQueueId ? queues.get(q.overflowQueueId) : undefined;
      if (!q || !target || !target.active || !q.overflowAfterMinutes || !target.channels.includes(c.channel)) continue;
      const since = new Date(c.queuedAt ?? c.openedAt).getTime();
      if (t - since < q.overflowAfterMinutes * 60_000) continue;
      await patchFields<Conversation>(COLLECTIONS.conversations, c.id, { queueId: target.id, queuedAt: now.toISOString() });
      await addConversationNote(c.id, `Sem operador disponível em ${q.overflowAfterMinutes} min na fila ${q.name}: transbordou para ${target.name}.`, SYSTEM_ACTOR);
      moved += 1;
    }
    return `${moved} conversa(s) transbordada(s)`;
  });

  await step(report, "distribuição", async () => `${await distributeWaiting()} conversa(s) atribuída(s)`);

  await step(report, "posição na fila", async () => {
    if (!auto.aguardandoFila.ativa) return "desligada";
    const waiting = (await openConversations()).filter((c) => c.status === "na_fila" && !c.assigneeId && c.awaitingReply).sort((a, b) => ((a.queuedAt ?? a.openedAt) < (b.queuedAt ?? b.openedAt) ? -1 : 1));
    let sent = 0;
    const position = new Map<string, number>();
    for (const c of waiting) {
      const n = (position.get(c.queueId ?? "") ?? 0) + 1;
      position.set(c.queueId ?? "", n);
      const since = new Date(c.lastInboundAt ?? c.openedAt).getTime();
      if (t - since < auto.aguardandoFila.minutos * 60_000) continue;
      // Uma vez por espera: só se não avisou depois da última mensagem do cliente.
      if (c.autoSentAt?.aguardandoFila && c.lastInboundAt && c.autoSentAt.aguardandoFila > c.lastInboundAt) continue;
      if (await sendAutoMessage(c, "aguardandoFila", auto.aguardandoFila.texto.replace(/\{posicao\}/g, String(n)), { allowRepeat: true })) sent += 1;
    }
    return `${sent} aviso(s) de posição`;
  });

  await step(report, "cliente sem resposta", async () => {
    if (!auto.semResposta.ativa) return "desligada";
    const waitingClient = (await openConversations()).filter((c) => c.status === "aguardando_cliente" && c.lastOutboundAt);
    let reminders = 0;
    let closed = 0;
    for (const c of waitingClient) {
      const since = t - new Date(c.lastOutboundAt!).getTime();
      const reminded = c.autoSentAt?.lembrete && c.autoSentAt.lembrete > c.lastOutboundAt!;
      if (since >= auto.semResposta.encerrarHoras * 3600_000 && reminded) {
        await closeConversation(c.id, { reason: "sem_resposta", summary: "Encerrado automaticamente: o cliente não respondeu.", ticket: "nenhum", autoText: auto.semResposta.textoEncerramento }, SYSTEM_ACTOR);
        closed += 1;
      } else if (since >= auto.semResposta.lembreteHoras * 3600_000 && !reminded) {
        if (await sendAutoMessage(c, "lembrete", auto.semResposta.textoLembrete, { allowRepeat: true })) reminders += 1;
      }
    }
    return `${reminders} lembrete(s) · ${closed} encerrada(s)`;
  });

  await step(report, "limpeza dos registros técnicos", async () => {
    const cutoff = new Date(t - CHANNEL_EVENT_RETENTION_DAYS * 86_400_000).toISOString();
    const snap = await col(COLLECTIONS.channelEvents).where("organizationId", "==", ORG_ID).where("occurredAt", "<", cutoff).limit(500).get();
    for (const d of snap.docs) await d.ref.delete();
    return `${snap.docs.length} registro(s) apagado(s)`;
  });

  await step(report, "modelos do WhatsApp", async () => {
    const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", STATE_SETTING]] });
    const last = (docs[0]?.value as { templatesSyncedAt?: string } | undefined)?.templatesSyncedAt;
    if (last && t - new Date(last).getTime() < 3600_000) return "sincronizados há menos de 1 h";
    if (!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) return "conta do WhatsApp Business não configurada";
    const r = await syncTemplatesFromMeta();
    const value = { ...(docs[0]?.value ?? {}), templatesSyncedAt: nowIso() };
    if (docs[0]) await update<Settings>(COLLECTIONS.settings, docs[0].id, { value });
    else await create<Settings>(COLLECTIONS.settings, { key: STATE_SETTING, value, description: "Estado do agendador da Central de Atendimento." });
    return r.ok ? `${r.total} modelo(s) lido(s) da Meta` : `falha: ${r.error}`;
  });

  await step(report, "gravações vencidas", async () => {
    const { purgeExpiredRecordings } = await import("@/server/telephony/retention");
    return `${await purgeExpiredRecordings(now)} gravação(ões) apagada(s)`;
  });

  await step(report, "alertas do gerente", async () => {
    const { runManagerAlerts } = await import("./supervision");
    return `${await runManagerAlerts(t)} alerta(s) enviado(s)`;
  });

  await step(report, "relatórios agendados", async () => {
    const { runDueReportSchedules } = await import("@/server/reports/schedules");
    return `${await runDueReportSchedules(t)} envio(s) processado(s)`;
  });

  await step(report, "registro da execução", async () => {
    const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", STATE_SETTING]] });
    const value = { ...(docs[0]?.value ?? {}), lastRunAt: now.toISOString(), lastRunOk: report.steps.every((s) => s.ok) };
    if (docs[0]) await update<Settings>(COLLECTIONS.settings, docs[0].id, { value });
    else await create<Settings>(COLLECTIONS.settings, { key: STATE_SETTING, value, description: "Estado do agendador da Central de Atendimento." });
    return "ok";
  });

  return report;
}

