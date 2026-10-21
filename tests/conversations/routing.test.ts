/**
 * Regras puras da Central: escolha do operador (estratégias da fila), janela de 24 h do WhatsApp e fila de entrada.
 */
import { describe, expect, it } from "vitest";
import { pickAssignee, whatsappWindow, WHATSAPP_WINDOW_MS } from "@/domain/conversations";
import { chooseQueue } from "@/server/conversations/queues";
import type { ServiceQueue } from "@/domain/types";

const c = (id: string, load: number, available = true) => ({ id, load, available });

describe("pickAssignee", () => {
  it("menor carga entre os disponíveis abaixo do limite", () => {
    expect(pickAssignee({ strategy: "menor_carga", candidates: [c("a", 3), c("b", 1), c("c", 0, false)], maxConcurrent: 4 })).toBe("b");
  });

  it("ninguém disponível ou todos no limite: fica na fila", () => {
    expect(pickAssignee({ strategy: "menor_carga", candidates: [c("a", 4), c("b", 2, false)], maxConcurrent: 4 })).toBeUndefined();
    expect(pickAssignee({ strategy: "menor_carga", candidates: [], maxConcurrent: 4 })).toBeUndefined();
  });

  it("manual nunca atribui", () => {
    expect(pickAssignee({ strategy: "manual", candidates: [c("a", 0)], maxConcurrent: 4, preferredId: "a" })).toBeUndefined();
  });

  it("responsável natural disponível tem preferência; ocupado ou fora, cai para a menor carga", () => {
    const candidates = [c("a", 0), c("b", 3)];
    expect(pickAssignee({ strategy: "responsavel_primeiro", candidates, maxConcurrent: 4, preferredId: "b" })).toBe("b");
    expect(pickAssignee({ strategy: "responsavel_primeiro", candidates: [c("a", 0), c("b", 4)], maxConcurrent: 4, preferredId: "b" })).toBe("a");
    expect(pickAssignee({ strategy: "responsavel_primeiro", candidates: [c("a", 0), c("b", 0, false)], maxConcurrent: 4, preferredId: "b" })).toBe("a");
  });

  it("rodízio: o próximo depois do último, pulando quem não pode", () => {
    const candidates = [c("a", 0), c("b", 0, false), c("d", 0)];
    expect(pickAssignee({ strategy: "rodizio", candidates, maxConcurrent: 4 })).toBe("a");
    expect(pickAssignee({ strategy: "rodizio", candidates, maxConcurrent: 4, lastAssignedId: "a" })).toBe("d");
    expect(pickAssignee({ strategy: "rodizio", candidates, maxConcurrent: 4, lastAssignedId: "d" })).toBe("a");
  });
});

describe("whatsappWindow", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  it("aberta até 24 h depois da última mensagem do cliente", () => {
    const at = new Date(now - WHATSAPP_WINDOW_MS + 60_000).toISOString();
    expect(whatsappWindow(at, now)).toEqual({ open: true, closesAt: new Date(now + 60_000).toISOString() });
  });

  it("fechada depois de 24 h ou se o cliente nunca escreveu", () => {
    expect(whatsappWindow(new Date(now - WHATSAPP_WINDOW_MS - 1).toISOString(), now).open).toBe(false);
    expect(whatsappWindow(undefined, now)).toEqual({ open: false });
  });
});

describe("chooseQueue", () => {
  const q = (id: string, department: ServiceQueue["department"], extra: Partial<ServiceQueue> = {}): ServiceQueue => ({
    id,
    organizationId: "o",
    createdAt: "",
    updatedAt: "",
    name: id,
    department,
    channels: ["whatsapp", "email"],
    memberIds: [],
    strategy: "menor_carga",
    maxConcurrent: 4,
    active: true,
    order: 1,
    ...extra,
  });
  const queues = [q("n1", "suporte"), q("n2", "suporte", { strategy: "manual" }), q("com", "vendas"), q("geral", "administrativo", { isDefault: true })];

  it("chamado aberto → Suporte (a fila automática, não a manual); lead → Comercial; resto → padrão", () => {
    expect(chooseQueue(queues, { channel: "whatsapp", identity: "cliente", hasOpenTicket: true })?.id).toBe("n1");
    expect(chooseQueue(queues, { channel: "whatsapp", identity: "lead", hasOpenTicket: false })?.id).toBe("com");
    expect(chooseQueue(queues, { channel: "whatsapp", identity: "desconhecido", hasOpenTicket: false })?.id).toBe("geral");
    expect(chooseQueue(queues, { channel: "whatsapp", identity: "cliente", hasOpenTicket: false })?.id).toBe("geral");
  });

  it("só filas ativas que atendem o canal", () => {
    const onlyEmail = [q("n1", "suporte", { channels: ["email"] }), q("geral", "administrativo", { isDefault: true })];
    expect(chooseQueue(onlyEmail, { channel: "whatsapp", identity: "cliente", hasOpenTicket: true })?.id).toBe("geral");
    expect(chooseQueue([q("x", "suporte", { active: false })], { channel: "whatsapp", identity: "cliente", hasOpenTicket: true })).toBeUndefined();
  });
});
