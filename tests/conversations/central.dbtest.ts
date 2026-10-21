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
import { closeConversation, distributeWaiting, linkConversationIdentity, NOTE_TEMPLATE_KEY, sendConversationMessage, transferConversation } from "@/server/conversations/service";
import { runCentralSweep } from "@/server/conversations/scheduler";
import { quickRepliesFor, saveQuickReply, listQuickReplies } from "@/server/conversations/quick-replies";
import { patchFields } from "@/server/conversations/store";

const RUN = `t${Date.now().toString(36)}`;
const PHONE_A = `5588${String(Date.now()).slice(-8)}`; // número que ninguém tem
const PHONE_B = `5585${String(Date.now() + 7).slice(-8)}`;
const PHONE_C = `5586${String(Date.now() + 13).slice(-8)}`;
const PHONE_D = `5587${String(Date.now() + 29).slice(-8)}`;
const OVERFLOW_ID = `${RUN}_transbordo`;
const OP = { id: `${RUN}_op`, name: "Operadora Teste" };
const QUEUE_ID = `${RUN}_fila`;

let savedQueues: { id: string; data: unknown }[] = [];
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
