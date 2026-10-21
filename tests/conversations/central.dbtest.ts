/**
 * Central de Atendimento no banco (npm run test:db): mensagem chega → conversa aberta e distribuída → aviso repetido
 * ignorado → resposta (registro manual, sem provedor) → transferência para a fila e redistribuição → encerramento →
 * nova mensagem abre outra conversa; duas mensagens simultâneas do mesmo número abrem UMA conversa.
 *
 * Isolamento: as filas existentes são guardadas e trocadas por uma fila de teste durante a execução (e devolvidas no
 * fim); usuários, contatos e telefones têm prefixo próprio e são apagados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDocdb, docdb } from "@/server/docdb";
import { create, getById, list, update } from "@/server/db";
import { COLLECTIONS, type ChannelEvent, type Communication, type Conversation, type ServiceQueue, type User } from "@/domain/types";
import { receiveInboundMessage } from "@/server/conversations/inbound";
import { closeConversation, distributeWaiting, linkConversationIdentity, NOTE_TEMPLATE_KEY, reopenConversation, sendConversationMessage, transferConversation } from "@/server/conversations/service";
import { saveUserCentral } from "@/server/conversations/queues";
import { escalate, runManagerAlerts, touchMonitoring, whisper } from "@/server/conversations/supervision";
import { ALERTS_SETTING, writeSetting } from "@/server/conversations/ops-settings";
import { buildThread } from "@/server/conversations/queries";
import { applyCallResult, applyRecording, availableAgents, callId, getPabx, pabxHistory, recordIncomingCall, recordOutgoingCall, savePabx } from "@/server/telephony/service";
import { needsCallback } from "@/domain/telephony";
import { handleMonitoredDialResult, joinMonitorTwiml, monitorNoticeFor, supervisorLeft } from "@/server/telephony/monitor";
import { buildAttendanceByQueue, buildCalls } from "@/server/reports/central";
import { runReportSchedule } from "@/server/reports/schedules";
import { currentUserFor } from "@/server/auth/session";
import { type ReportSchedule, type SupervisionLog } from "@/domain/types";
import { runCentralSweep } from "@/server/conversations/scheduler";
import { quickRepliesFor, saveQuickReply, listQuickReplies } from "@/server/conversations/quick-replies";
import { patchFields } from "@/server/conversations/store";

const RUN = `t${Date.now().toString(36)}`;
const PHONE_A = `5588${String(Date.now()).slice(-8)}`; // número que ninguém tem
const PHONE_B = `5585${String(Date.now() + 7).slice(-8)}`;
const PHONE_C = `5586${String(Date.now() + 13).slice(-8)}`;
const PHONE_D = `5587${String(Date.now() + 29).slice(-8)}`;
const OVERFLOW_ID = `${RUN}_transbordo`;
const EMAIL_A = `${RUN}.cliente@exemplo.com.br`;
const OP = { id: `${RUN}_op`, name: "Operadora Teste" };
const QUEUE_ID = `${RUN}_fila`;
const ADMIN = { id: `${RUN}_adm`, name: "Admin Teste" };

let savedQueues: { id: string; data: unknown }[] = [];
/** Configuração do PABX antes dos testes (null = não existia; undefined = os testes de telefonia não rodaram). */
let pabxBackup: unknown = undefined;
const conversationIds = new Set<string>();
const leadIds = new Set<string>();

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const sql = docdb.sql();
  savedQueues = (await sql`select id, data from interos.service_queues`) as unknown as { id: string; data: unknown }[];
  await sql`delete from interos.service_queues`;
  await create<User>(COLLECTIONS.users, { name: OP.name, email: `${RUN}@teste.local`, role: "suporte", departmentId: "suporte", active: true, presence: "online" } as Omit<User, "id" | "organizationId" | "createdAt" | "updatedAt">, OP.id);
  await create<ServiceQueue>(
    COLLECTIONS.serviceQueues,
    { name: "Fila de teste", department: "administrativo", channels: ["whatsapp", "email"], memberIds: [OP.id], strategy: "menor_carga", maxConcurrent: 5, isDefault: true, active: true, order: 1 },
    QUEUE_ID,
  );
});

afterAll(async () => {
  const sql = docdb.sql();
  const ids = [...conversationIds];
  if (ids.length) {
    await sql`delete from interos.communications where data->>'conversationId' = any(${ids})`;
    await sql`delete from interos.conversations where id = any(${ids})`;
    await sql`delete from interos.channel_events where data->>'conversationId' = any(${ids})`;
  }
  await sql`delete from interos.channel_events where data->>'externalId' like ${RUN + "%"}`;
  await sql`delete from interos.notifications where data->>'userId' = ${OP.id}`;
  if (leadIds.size) await sql`delete from interos.leads where id = any(${[...leadIds]})`;
  await sql`delete from interos.users where id = ${OP.id}`;
  await sql`delete from interos.quick_replies where data->>'shortcut' like ${RUN + "%"}`;
  if (ids.length) await sql`delete from interos.supervision_logs where data->>'conversationId' = any(${ids})`;
  await sql`delete from interos.settings where data->>'key' in ('central_alertas', 'central_alertas_estado')`;
  await sql`delete from interos.supervision_logs where data->>'supervisorId' like ${RUN + "%"}`;
  await sql`delete from interos.report_schedules where data->>'ownerId' like ${RUN + "%"}`;
  await sql`delete from interos.notifications where data->>'userId' like ${RUN + "%"}`;
  await sql`delete from interos.users where id = ${ADMIN.id}`;
  await sql`delete from interos.communications where data->>'callSid' like ${RUN + "%"}`;
  if (pabxBackup === null) await sql`delete from interos.settings where data->>'key' = 'pabx'`;
  else if (pabxBackup) await sql`update interos.settings set data = ${sql.json(pabxBackup as never)} where data->>'key' = 'pabx'`;
  await sql`delete from interos.service_queues`;
  for (const q of savedQueues) await sql`insert into interos.service_queues (id, data) values (${q.id}, ${sql.json(q.data as never)})`;
  await closeDocdb();
});

async function conv(id: string): Promise<Conversation> {
  const c = await getById<Conversation>(COLLECTIONS.conversations, id);
  if (!c) throw new Error("conversa sumiu");
  return c;
}

describe("entrada de mensagens", () => {
  let first = "";

  it("número desconhecido abre conversa, cai na fila padrão e vai para quem está online", async () => {
    const r = await receiveInboundMessage({ channel: "whatsapp", from: PHONE_A, body: "Oi, quero saber o preço", externalId: `${RUN}_m1`, displayName: "Cliente Teste" });
    expect(r.duplicate).toBe(false);
    expect(r.opened).toBe(true);
    first = r.conversationId!;
    conversationIds.add(first);
    const c = await conv(first);
    expect(c).toMatchObject({ identity: "desconhecido", queueId: QUEUE_ID, assigneeId: OP.id, status: "em_atendimento", awaitingReply: true, displayName: "Cliente Teste" });
    expect(c.number).toMatch(/^AT-\d{4}-\d{4}$/);
    const messages = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", first]] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "entrada", body: "Oi, quero saber o preço", address: PHONE_A, status: "recebida" });
    const events = await list<ChannelEvent>(COLLECTIONS.channelEvents, { where: [["externalId", "==", `${RUN}_m1`]] });
    expect(events.map((e) => e.result)).toEqual(["processado"]);
    expect(events[0].contactMasked).not.toContain(PHONE_A.slice(-8, -4));
  });

  it("o mesmo aviso de novo (reenvio da Meta) é ignorado", async () => {
    const r = await receiveInboundMessage({ channel: "whatsapp", from: PHONE_A, body: "Oi, quero saber o preço", externalId: `${RUN}_m1` });
    expect(r.duplicate).toBe(true);
    expect(await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", first]] })).toHaveLength(1);
  });

  it("nova mensagem do mesmo número, agora com o 9 na frente, entra na mesma conversa", async () => {
    const with9 = PHONE_A.replace(/^5588/, "55889");
    const r = await receiveInboundMessage({ channel: "whatsapp", from: with9, body: "Alguém aí?", externalId: `${RUN}_m2` });
    expect(r.conversationId).toBe(first);
    expect(r.opened).toBe(false);
  });

  it("resposta sem provedor fica como registro manual e conta a primeira resposta", async () => {
    const result = await sendConversationMessage(first, { body: "Olá! Já te ajudo." }, OP);
    expect(result.delivery).toBe("manual");
    const c = await conv(first);
    expect(c.status).toBe("aguardando_cliente");
    expect(c.awaitingReply).toBe(false);
    expect(c.firstResponseAt).toBeTruthy();
    // Cliente responde: volta para em atendimento.
    await receiveInboundMessage({ channel: "whatsapp", from: PHONE_A, body: "Obrigado", externalId: `${RUN}_m3` });
    expect((await conv(first)).status).toBe("em_atendimento");
  });

  it("transferir para a fila tira o responsável (com nota) e a redistribuição devolve a quem está online", async () => {
    await transferConversation(first, { toQueueId: QUEUE_ID, note: "Teste de transferência" }, OP);
    const after = await conv(first);
    // A transferência já chama a distribuição: com a única operadora online, ela recebe de novo.
    expect(after.assigneeId).toBe(OP.id);
    expect(after.transfers).toBe(1);
    const notes = (await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", first]] })).filter((m) => m.templateKey === "nota_interna");
    expect(notes.map((n) => n.body)).toEqual(["Transferido para fila Fila de teste: Teste de transferência"]);
    expect(await distributeWaiting()).toBe(0);
  });

  it("criar lead a partir da conversa leva as mensagens para o lead", async () => {
    const c = await linkConversationIdentity(first, { kind: "novo_lead", name: "Lead da Central" }, OP);
    expect(c.identity).toBe("lead");
    leadIds.add(c.leadId!);
    const msgs = (await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", first]] })).filter((m) => m.channel === "whatsapp");
    expect(msgs.every((m) => m.entityType === "lead" && m.entityId === c.leadId)).toBe(true);
  });

  it("encerrar; o próximo contato abre outra conversa", async () => {
    await closeConversation(first, { reason: "resolvida", summary: "Preço informado", ticket: "nenhum" }, OP);
    expect((await conv(first)).status).toBe("encerrada");
    const r = await receiveInboundMessage({ channel: "whatsapp", from: PHONE_A, body: "Voltei", externalId: `${RUN}_m4` });
    conversationIds.add(r.conversationId!);
    expect(r.opened).toBe(true);
    expect(r.conversationId).not.toBe(first);
    expect((await conv(r.conversationId!)).identity).toBe("lead"); // agora o número é reconhecido
  });

  it("duas mensagens ao mesmo tempo de um número novo abrem uma conversa só", async () => {
    const [a, b] = await Promise.all([
      receiveInboundMessage({ channel: "whatsapp", from: PHONE_B, body: "um", externalId: `${RUN}_p1` }),
      receiveInboundMessage({ channel: "whatsapp", from: PHONE_B, body: "dois", externalId: `${RUN}_p2` }),
    ]);
    conversationIds.add(a.conversationId!);
    conversationIds.add(b.conversationId!);
    expect(a.conversationId).toBe(b.conversationId);
    expect(await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", a.conversationId!]] })).toHaveLength(2);
  });
});

describe("agendador da Central", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

  beforeAll(async () => {
    // Ninguém online: as conversas ficam na fila (é o cenário do transbordo).
    await update<User>(COLLECTIONS.users, OP.id, { presence: "ausente" });
    await create<ServiceQueue>(
      COLLECTIONS.serviceQueues,
      { name: "Transbordo de teste", department: "administrativo", channels: ["whatsapp"], memberIds: [], strategy: "manual", maxConcurrent: 5, isDefault: false, active: true, order: 2 },
      OVERFLOW_ID,
    );
    await update<ServiceQueue>(COLLECTIONS.serviceQueues, QUEUE_ID, { overflowQueueId: OVERFLOW_ID, overflowAfterMinutes: 10 });
  });

  it("na fila há mais que o tempo da fila: transborda (com nota) e não volta", async () => {
    const r = await receiveInboundMessage({ channel: "whatsapp", from: PHONE_C, body: "Alguém?", externalId: `${RUN}_c1` });
    conversationIds.add(r.conversationId!);
    expect(await conv(r.conversationId!)).toMatchObject({ status: "na_fila", queueId: QUEUE_ID });
    await patchFields<Conversation>(COLLECTIONS.conversations, r.conversationId!, { queuedAt: minutesAgo(20) });

    const report = await runCentralSweep();
    expect(report.steps.every((s) => s.ok), JSON.stringify(report.steps)).toBe(true);
    expect((await conv(r.conversationId!)).queueId).toBe(OVERFLOW_ID);
    const notes = (await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", r.conversationId!]] })).filter((m) => m.templateKey === NOTE_TEMPLATE_KEY);
    expect(notes.map((n) => n.body).join(" ")).toMatch(/transbordou para Transbordo de teste/);

    await runCentralSweep();
    expect((await conv(r.conversationId!)).queueId).toBe(OVERFLOW_ID);
  });

  it("menu sem resposta há mais de 10 minutos: vai para a fila padrão", async () => {
    const r = await receiveInboundMessage({ channel: "whatsapp", from: PHONE_D, body: "Oi", externalId: `${RUN}_d1` });
    conversationIds.add(r.conversationId!);
    await patchFields<Conversation>(COLLECTIONS.conversations, r.conversationId!, { menuPending: true, queueId: undefined, status: "nova", autoSentAt: { menu: minutesAgo(15) } });
    await runCentralSweep();
    const c = await conv(r.conversationId!);
    expect(c.menuPending).toBeUndefined();
    expect(c).toMatchObject({ queueId: QUEUE_ID, status: "na_fila" });
  });

  it("apaga registros técnicos com mais de 30 dias e mantém os recentes", async () => {
    const old = await create<ChannelEvent>(COLLECTIONS.channelEvents, { channel: "whatsapp", kind: "status", result: "processado", detail: "antigo", externalId: `${RUN}_old`, occurredAt: new Date(Date.now() - 31 * 86_400_000).toISOString() });
    const fresh = await create<ChannelEvent>(COLLECTIONS.channelEvents, { channel: "whatsapp", kind: "status", result: "processado", detail: "recente", externalId: `${RUN}_new`, occurredAt: new Date().toISOString() });
    await runCentralSweep();
    expect(await getById<ChannelEvent>(COLLECTIONS.channelEvents, old.id)).toBeNull();
    expect(await getById<ChannelEvent>(COLLECTIONS.channelEvents, fresh.id)).not.toBeNull();
  });
});

describe("respostas rápidas", () => {
  it("atalho normalizado, variável que não existe na conversa e atalho repetido são barrados", async () => {
    const r = await saveQuickReply({ shortcut: `/${RUN} Segunda Via`, body: "Olá, {contato}! Segue a 2ª via.", active: true });
    expect(r.shortcut).toBe(`${RUN}-segunda-via`);
    await expect(saveQuickReply({ shortcut: `${RUN}-valor`, body: "Valor: {valor}", active: true })).rejects.toThrow(/não existe na conversa/);
    await expect(saveQuickReply({ shortcut: `${RUN}-segunda-via`, body: "Outra", active: true })).rejects.toThrow(/Já existe/);
  });

  it("da fila: só aparece para quem atende a fila; desativada não aparece", async () => {
    const q = await saveQuickReply({ shortcut: `${RUN}-fila`, body: "Só da fila", queueId: QUEUE_ID, active: true });
    const all = (await listQuickReplies()).filter((r) => r.shortcut.startsWith(RUN));
    expect(quickRepliesFor(all, []).map((r) => r.shortcut)).toEqual([`${RUN}-segunda-via`]);
    expect(quickRepliesFor(all, [QUEUE_ID]).map((r) => r.shortcut).sort()).toEqual([`${RUN}-fila`, `${RUN}-segunda-via`]);
    await saveQuickReply({ id: q.id, shortcut: q.shortcut, body: q.body, active: false });
    const after = (await listQuickReplies()).filter((r) => r.shortcut.startsWith(RUN));
    expect(after.find((r) => r.id === q.id)?.queueId).toBeUndefined(); // sem fila = empresa inteira
    expect(quickRepliesFor(after, [QUEUE_ID]).map((r) => r.shortcut)).toEqual([`${RUN}-segunda-via`]);
  });
});

describe("parte 3: reabrir, e-mail de entrada e atendimento por pessoa", () => {
  let emailConversation = "";
  beforeAll(async () => {
    // Volta ao cenário simples: operadora online, sem transbordo.
    await update<User>(COLLECTIONS.users, OP.id, { presence: "online" });
    await update<ServiceQueue>(COLLECTIONS.serviceQueues, QUEUE_ID, { overflowQueueId: undefined, overflowAfterMinutes: undefined });
  });

  it("e-mail recebido abre conversa com assunto e Message-ID; o aviso repetido é ignorado", async () => {
    const r = await receiveInboundMessage({ channel: "email", from: EMAIL_A, body: "Não recebi o boleto de outubro.", externalId: `${RUN}_mail1@exemplo`, subject: "Boleto de outubro", messageId: `${RUN}_mail1@exemplo` });
    conversationIds.add(r.conversationId!);
    emailConversation = r.conversationId!;
    const c = await conv(r.conversationId!);
    expect(c).toMatchObject({ channel: "email", subject: "Boleto de outubro", lastInboundMessageId: `${RUN}_mail1@exemplo`, assigneeId: OP.id });
    const [m] = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", c.id]] });
    expect(m.body).toBe("Assunto: Boleto de outubro\n\nNão recebi o boleto de outubro.");
    const again = await receiveInboundMessage({ channel: "email", from: EMAIL_A, body: "Não recebi o boleto de outubro.", externalId: `${RUN}_mail1@exemplo`, subject: "Boleto de outubro" });
    expect(again.duplicate).toBe(true);

    // A resposta do cliente entra na mesma conversa, sem repetir o assunto, e atualiza o Message-ID.
    const reply = await receiveInboundMessage({ channel: "email", from: EMAIL_A.toUpperCase(), body: "Obrigada!", externalId: `${RUN}_mail2@exemplo`, subject: "Re: Boleto de outubro", messageId: `${RUN}_mail2@exemplo` });
    expect(reply.conversationId).toBe(c.id);
    const after = await conv(c.id);
    expect(after).toMatchObject({ subject: "Boleto de outubro", lastInboundMessageId: `${RUN}_mail2@exemplo` });
    const bodies = (await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", c.id]] })).map((x) => x.body);
    expect(bodies).toContain("Obrigada!");
  });

  it("reabrir: volta para quem atendeu (disponível), com nota; com outra aberta do mesmo contato, recusa", async () => {
    const open = await conv(emailConversation);
    await closeConversation(open.id, { reason: "resolvida", ticket: "nenhum" }, OP);
    const reopened = await reopenConversation(open.id, OP);
    expect(reopened).toMatchObject({ status: "em_atendimento", assigneeId: OP.id, reopenCount: 1 });
    const fresh = await conv(open.id);
    expect(fresh.closedAt).toBeUndefined();
    expect(fresh.closeReason).toBeUndefined();
    const notes = (await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", open.id]] })).filter((m) => m.templateKey === NOTE_TEMPLATE_KEY);
    expect(notes.some((n) => n.body?.includes("reaberto"))).toBe(true);
    await expect(reopenConversation(open.id, OP)).rejects.toThrow(/já está aberto/);

    // Encerrada de novo; nova mensagem abre outra conversa; a antiga não reabre enquanto a nova estiver aberta.
    await closeConversation(open.id, { reason: "resolvida", ticket: "nenhum" }, OP);
    const next = await receiveInboundMessage({ channel: "email", from: EMAIL_A, body: "Outra dúvida", externalId: `${RUN}_mail3@exemplo`, subject: "Nota fiscal" });
    conversationIds.add(next.conversationId!);
    expect(next.conversationId).not.toBe(open.id);
    await expect(reopenConversation(open.id, OP)).rejects.toThrow(/Já existe um atendimento aberto/);
  });

  it("quem não recebe conversas fica de fora da distribuição; voltar a receber libera", async () => {
    await saveUserCentral({ userId: OP.id, attends: false, queueIds: [QUEUE_ID] });
    const r = await receiveInboundMessage({ channel: "whatsapp", from: `5589${String(Date.now() + 41).slice(-8)}`, body: "Oi", externalId: `${RUN}_x1` });
    conversationIds.add(r.conversationId!);
    expect(await conv(r.conversationId!)).toMatchObject({ status: "na_fila", queueId: QUEUE_ID });
    expect((await getById<User>(COLLECTIONS.users, OP.id))?.central).toEqual({ attends: false });

    await saveUserCentral({ userId: OP.id, attends: true, queueIds: [QUEUE_ID], channels: ["email"] });
    await distributeWaiting();
    // Só e-mail: a conversa de WhatsApp continua na fila.
    expect((await conv(r.conversationId!)).assigneeId).toBeUndefined();

    await saveUserCentral({ userId: OP.id, attends: true, queueIds: [QUEUE_ID] });
    await distributeWaiting();
    expect((await conv(r.conversationId!)).assigneeId).toBe(OP.id);
  });
});

describe("fase 2: supervisão", () => {
  const SUP = { id: `${RUN}_gerente`, name: "Gerente Teste" };
  let convId = "";

  beforeAll(async () => {
    await update<User>(COLLECTIONS.users, OP.id, { presence: "online", central: { attends: true } });
    const r = await receiveInboundMessage({ channel: "whatsapp", from: `5590${String(Date.now() + 53).slice(-8)}`, body: "Preciso de ajuda", externalId: `${RUN}_s1` });
    convId = r.conversationId!;
    conversationIds.add(convId);
    // A operadora pode estar no limite pelas conversas dos testes anteriores: atribui direto.
    await update<Conversation>(COLLECTIONS.conversations, convId, { assigneeId: OP.id, status: "em_atendimento" });
  });

  it("sussurro fica na conversa como nota privada «Sussurro de …» e avisa o operador", async () => {
    const c = await conv(convId);
    expect(c.assigneeId).toBe(OP.id);
    await whisper(c, "Ofereça a segunda via.", SUP);
    const messages = await list<Communication>(COLLECTIONS.communications, { where: [["conversationId", "==", convId]] });
    const thread = buildThread(c, messages, new Map(), { viewerId: OP.id, customerName: "Cliente" });
    expect(thread.some((t) => t.kind === "note" && t.authorName.startsWith("Sussurro de") && t.body === "Ofereça a segunda via.")).toBe(true);
    const notes = await list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; userId: string; title: string }>(COLLECTIONS.notifications, { where: [["userId", "==", OP.id]] });
    expect(notes.some((n) => n.title.includes("sussurrou"))).toBe(true);
  });

  it("escalar marca prioridade uma vez; acompanhar continua a sessão até 2 min e depois abre outra", async () => {
    await escalate(await conv(convId), "Cliente VIP", SUP);
    expect((await conv(convId)).escalatedAt).toBeTruthy();
    await expect(escalate(await conv(convId), "", SUP)).rejects.toThrow(/já está escalado/);

    const c = await conv(convId);
    const t0 = Date.now();
    const a = await touchMonitoring(SUP, c, t0);
    const b = await touchMonitoring(SUP, c, t0 + 60_000);
    expect(b.id).toBe(a.id);
    const d = await touchMonitoring(SUP, c, t0 + 60_000 + 3 * 60_000);
    expect(d.id).not.toBe(a.id);
  });

  it("alertas do gerente: desligados não saem; ligados saem uma vez dentro do intervalo de repetição", async () => {
    expect(await runManagerAlerts()).toBe(0);
    await writeSetting(ALERTS_SETTING, { queue: { active: false, maxWaiting: 5 }, sla: { active: false }, idle: { active: true, minutes: 1 }, pause: { active: false }, repeatMinutes: 30 }, "teste");
    // O cliente espera resposta há 5 minutos.
    await update<Conversation>(COLLECTIONS.conversations, convId, { awaitingReply: true, lastInboundAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    const first = await runManagerAlerts();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await runManagerAlerts()).toBe(0);
  });
});

describe("fase 3: telefonia", () => {
  const CALL_IN = `${RUN}CAin`;
  const CALL_IN2 = `${RUN}CAin2`;
  const CALL_OUT = `${RUN}CAout`;
  const CALLER = `+5591${String(Date.now() + 71).slice(-8)}`;

  beforeAll(async () => {
    const [row] = (await docdb.sql()`select data from interos.settings where data->>'key' = 'pabx'`) as unknown as { data: unknown }[];
    pabxBackup = row ? row.data : null;
  });

  it("ligação recebida: registro idempotente, perdida sem retorno, recado e retorno ao ligar de volta", async () => {
    const a = await recordIncomingCall({ callSid: CALL_IN, from: CALLER, to: "+558835700001", queueId: QUEUE_ID });
    const b = await recordIncomingCall({ callSid: CALL_IN, from: CALLER, to: "+558835700001", queueId: QUEUE_ID });
    expect(b.id).toBe(a.id);
    expect(a.id).toBe(callId(CALL_IN));
    const missed = await applyCallResult(CALL_IN, "no-answer", 0);
    expect(missed?.callStatus).toBe("perdida");
    expect(needsCallback(missed!)).toBe(true);
    await applyRecording(CALL_IN, `${RUN}RE1`, 14, true);
    const vm = await getById<Communication>(COLLECTIONS.communications, a.id);
    expect(vm).toMatchObject({ voicemail: true, recordingSid: `${RUN}RE1`, durationSeconds: 14 });

    // Ligar de volta pelo softphone marca a perdida como retornada.
    await recordOutgoingCall({ callSid: CALL_OUT, userId: OP.id, to: CALLER.replace("+55", "") });
    expect((await getById<Communication>(COLLECTIONS.communications, a.id))?.returnedById).toBe(OP.id);
    const done = await applyCallResult(CALL_OUT, "completed", 95);
    expect(done).toMatchObject({ callStatus: "atendida", durationSeconds: 95, direction: "saida" });
  });

  it("atendida: resultado com duração; o aviso repetido não muda nada", async () => {
    await recordIncomingCall({ callSid: CALL_IN2, from: CALLER, to: "+558835700001", queueId: QUEUE_ID });
    const r = await applyCallResult(CALL_IN2, "completed", 40);
    expect(r?.callStatus).toBe("atendida");
    const saved = await getById<Communication>(COLLECTIONS.communications, callId(CALL_IN2));
    await applyCallResult(CALL_IN2, "completed", 40);
    expect((await getById<Communication>(COLLECTIONS.communications, callId(CALL_IN2)))?.updatedAt).toBe(saved?.updatedAt);
  });

  it("quem toca: ramal + online + atende na Central", async () => {
    await update<User>(COLLECTIONS.users, OP.id, { presence: "online", central: { attends: true } });
    expect((await availableAgents(QUEUE_ID)).map((u) => u.id)).not.toContain(OP.id);
    await update<User>(COLLECTIONS.users, OP.id, { central: { attends: true, extension: "1077" } });
    expect((await availableAgents(QUEUE_ID)).map((u) => u.id)).toContain(OP.id);
    await update<User>(COLLECTIONS.users, OP.id, { presence: "pausa" });
    expect((await availableAgents(QUEUE_ID)).map((u) => u.id)).not.toContain(OP.id);
  });

  it("PABX: número inválido recusado; número salvo em E.164 e mudança no histórico", async () => {
    const base = await getPabx();
    const { stored, ...config } = base;
    void stored;
    await expect(savePabx({ ...config, numbers: [{ number: "123", label: "x", active: true }] }, OP)).rejects.toThrow(/Número inválido/);
    await savePabx({ ...config, numbers: [{ number: "(88) 3570-0001", label: "Principal", active: true, queueId: QUEUE_ID }] }, OP);
    expect((await getPabx()).numbers[0].number).toBe("+558835700001");
    expect((await pabxHistory()).some((e) => e.description?.includes("números"))).toBe(true);
  });
});

describe("fase 4: supervisão de ligações, relatórios e envio agendado", () => {
  const CALL = `${RUN}CAmon`;
  const SUP = `${RUN}_sup`;
  const BASE = "https://interos.test";

  it("supervisão: a ligação vai para a conferência, o atendente vê quem está, e o fim grava a duração total", async () => {
    const c = await recordIncomingCall({ callSid: CALL, from: "+5591900000001", to: "+558835700001", queueId: QUEUE_ID });
    await patchFields<Communication>(COLLECTIONS.communications, c.id, { userId: OP.id, callStatus: "em_andamento", monitor: { conference: `sup_${c.id}`, state: "movendo", supervisorId: SUP, supervisorName: "Gerente Teste", mode: "ouvir", since: new Date().toISOString(), agentLegSid: `${RUN}CAagent` } });

    // A perna principal sai do <Dial> (a filha foi para a conferência) e entra também.
    const moved = await handleMonitoredDialResult(CALL, { DialCallStatus: "completed", DialCallDuration: "30" }, null, BASE);
    expect(moved?.twiml).toContain(`<Conference`);
    expect(moved?.twiml).toContain("dial-result?fase=conf");
    let saved = await getById<Communication>(COLLECTIONS.communications, c.id);
    expect(saved?.monitor).toMatchObject({ state: "ativa", partialSeconds: 30 });
    expect(saved?.callStatus).toBe("em_andamento");

    // Outra pessoa não entra; o gerente marcado entra mudo e fica no registro.
    expect(await joinMonitorTwiml("outra_pessoa", c.id, "CAx", BASE)).toBeNull();
    const join = await joinMonitorTwiml(SUP, c.id, `${RUN}CAsup`, BASE);
    expect(join).toContain('muted="true"');
    expect(join).toContain("monitor-end?call=");
    const logs = await list<SupervisionLog>(COLLECTIONS.supervisionLogs, { where: [["communicationId", "==", c.id]] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "ligacao_ouvir", operatorId: OP.id });

    // O atendente vê; outra pessoa não.
    expect((await monitorNoticeFor(OP.id, CALL))?.text).toBe("Gerente Teste está ouvindo esta ligação");
    expect(await monitorNoticeFor(SUP, CALL)).toBeNull();

    // O gerente sai: a ligação continua, o registro fecha e o aviso some.
    await supervisorLeft(c.id);
    saved = await getById<Communication>(COLLECTIONS.communications, c.id);
    expect(saved?.monitor?.supervisorCallSid).toBeUndefined();
    expect(saved?.monitor?.state).toBe("ativa");
    expect(await monitorNoticeFor(OP.id, CALL)).toBeNull();
    expect((await list<SupervisionLog>(COLLECTIONS.supervisionLogs, { where: [["communicationId", "==", c.id]] }))[0].endedAt).toBeTruthy();

    // A gravação da conferência entra como segunda parte (aviso repetido não duplica).
    await applyRecording(CALL, `${RUN}REp1`, 20, false);
    await applyRecording(CALL, `${RUN}REp2`, 40, false, true);
    await applyRecording(CALL, `${RUN}REp2`, 40, false, true);
    saved = await getById<Communication>(COLLECTIONS.communications, c.id);
    expect(saved).toMatchObject({ recordingSid: `${RUN}REp1`, recordingParts: [`${RUN}REp2`] });

    // Fim da conferência: atendida, com a duração de antes + a da conferência.
    const end = await handleMonitoredDialResult(CALL, {}, "conf", BASE);
    expect(end?.finished).toBe(true);
    saved = await getById<Communication>(COLLECTIONS.communications, c.id);
    expect(saved?.callStatus).toBe("atendida");
    expect(saved?.durationSeconds).toBeGreaterThanOrEqual(30);
    expect(saved?.monitor?.state).toBe("encerrada");
  });

  it("relatórios: ligações com custo estimado pelas tarifas e atendimentos por fila", async () => {
    const { stored, ...config } = await getPabx();
    void stored;
    await savePabx({ ...config, rates: { fixo: 0.1, movel: 0.5, entrada: 0.05 } }, OP);
    const now = Date.now();
    const input = { period: { start: new Date(now - 86_400_000).toISOString(), end: new Date(now + 60_000).toISOString() }, filters: {}, userById: new Map(), clientName: () => null, inScope: () => true };
    const calls = await buildCalls(input);
    expect(calls.ratesConfigured).toBe(true);
    const mine = calls.rows.find((r) => r.cells.atendente === null && r.cells.fila === "Fila de teste" && r.cells.resultado === "Atendida" && Number(r.cells.duracao) >= 0.5);
    expect(mine).toBeTruthy();
    expect(Number(mine!.cells.custo)).toBeGreaterThan(0);
    const queues = await buildAttendanceByQueue(input);
    const row = queues.find((r) => r.cells.fila === "Fila de teste");
    expect(Number(row?.cells.ligacoes)).toBeGreaterThanOrEqual(1);
  });

  it("envio agendado: cada destinatário recebe com o próprio acesso; quem agendou sem acesso pausa o envio", async () => {
    await create<User>(COLLECTIONS.users, { name: ADMIN.name, email: `${RUN}.adm@teste.local`, role: "admin", departmentId: "administrativo", active: true } as Omit<User, "id" | "organizationId" | "createdAt" | "updatedAt">, ADMIN.id);
    const base = { reportKey: "ligacoes", filters: {}, period: "ontem" as const, format: "csv" as const, frequency: "diaria" as const, hour: 8, active: true, nextRunAt: new Date(Date.now() - 60_000).toISOString() };
    // Operadora (suporte, sem gestão) não pode agendar: o envio pausa sem mandar nada.
    const paused = await create<ReportSchedule>(COLLECTIONS.reportSchedules, { ...base, ownerId: OP.id, recipientIds: [OP.id] });
    const r1 = await runReportSchedule(paused);
    expect(r1.ok).toBe(false);
    expect((await getById<ReportSchedule>(COLLECTIONS.reportSchedules, paused.id))?.active).toBe(false);
    await docdb.sql()`delete from interos.report_schedules where id = ${paused.id}`;

    // Admin agenda para si e para a operadora (que vê o relatório de Ligações pelo departamento).
    const ok = await create<ReportSchedule>(COLLECTIONS.reportSchedules, { ...base, ownerId: ADMIN.id, recipientIds: [ADMIN.id, OP.id] });
    expect(await currentUserFor((await getById<User>(COLLECTIONS.users, ADMIN.id))!)).toBeTruthy();
    const r2 = await runReportSchedule(ok);
    expect(r2.summary).toMatch(/2 enviado\(s\)/);
    const after = await getById<ReportSchedule>(COLLECTIONS.reportSchedules, ok.id);
    expect(after?.lastOk).toBe(true);
    expect(after!.nextRunAt > new Date().toISOString()).toBe(true);
  });
});

