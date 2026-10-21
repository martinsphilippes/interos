/**
 * Identificação única do contato (src/server/conversations/identity.ts): contato vence o telefone geral do cliente,
 * cliente vence lead, cliente cancelado só se não houver outro, e o lead passa a ser reconhecido.
 */
import { describe, expect, it } from "vitest";
import { identityCandidatesIn, resolveIdentityIn } from "@/server/conversations/identity";
import type { Client, Contact, Lead } from "@/domain/types";

const base = { organizationId: "o", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const client = (id: string, extra: Partial<Client> = {}) => ({ ...base, id, tradeName: id.toUpperCase(), status: "ativo", ...extra }) as Client;
const contact = (id: string, clientId: string, extra: Partial<Contact> = {}) => ({ ...base, id, clientId, name: id, isPrimary: false, ...extra }) as Contact;
const lead = (id: string, extra: Partial<Lead> = {}) => ({ ...base, id, name: id, status: "novo", origin: "site", score: 10, ...extra }) as Lead;

describe("resolveIdentityIn", () => {
  it("contato do cliente pelo WhatsApp (o WhatsApp entrega sem o 9)", () => {
    const dir = { clients: [client("c1", { phone: "(88) 3570-0000" })], contacts: [contact("joao", "c1", { whatsapp: "(88) 99811-2040" })], leads: [] };
    expect(resolveIdentityIn(dir, "whatsapp", "558898112040")).toEqual({ identity: "cliente", clientId: "c1", contactId: "joao", name: "joao" });
  });

  it("telefone geral do cliente quando não há contato", () => {
    const dir = { clients: [client("c1", { whatsapp: "88 99811-2040" })], contacts: [], leads: [] };
    expect(resolveIdentityIn(dir, "whatsapp", "5588998112040")).toMatchObject({ identity: "cliente", clientId: "c1" });
  });

  it("cliente vence lead com o mesmo número", () => {
    const dir = { clients: [client("c1", { whatsapp: "88998112040" })], contacts: [], leads: [lead("l1", { phone: "88998112040" })] };
    expect(resolveIdentityIn(dir, "whatsapp", "88998112040").identity).toBe("cliente");
  });

  it("lead é reconhecido (antes a mensagem caía como desconhecida); lead convertido vira o cliente", () => {
    const dir = { clients: [client("c9")], contacts: [], leads: [lead("l1", { phone: "88998112040", ownerId: "u1" })] };
    expect(resolveIdentityIn(dir, "whatsapp", "558898112040")).toEqual({ identity: "lead", leadId: "l1", name: "l1", ownerId: "u1" });
    const converted = { ...dir, leads: [lead("l1", { phone: "88998112040", clientId: "c9" })] };
    expect(resolveIdentityIn(converted, "whatsapp", "88998112040")).toMatchObject({ identity: "cliente", clientId: "c9", leadId: "l1" });
  });

  it("lead desqualificado ou duplicado não identifica", () => {
    const dir = { clients: [], contacts: [], leads: [lead("l1", { phone: "88998112040", status: "desqualificado" }), lead("l2", { phone: "88998112040", duplicateOfId: "l9" })] };
    expect(resolveIdentityIn(dir, "whatsapp", "88998112040").identity).toBe("desconhecido");
  });

  it("cliente cancelado só quando não há outro", () => {
    const dir = { clients: [client("old", { status: "cancelado", whatsapp: "88998112040" }), client("new", { whatsapp: "88998112040" })], contacts: [], leads: [] };
    expect(resolveIdentityIn(dir, "whatsapp", "88998112040").clientId).toBe("new");
  });

  it("e-mail por e-mail, sem diferenciar maiúsculas", () => {
    const dir = { clients: [], contacts: [contact("ana", "c1", { email: "Ana@Agropet.com.br" })], leads: [] };
    expect(resolveIdentityIn({ ...dir, clients: [client("c1")] }, "email", "ana@agropet.com.br")).toMatchObject({ contactId: "ana" });
  });
});

describe("identityCandidatesIn", () => {
  it("mesmo telefone primeiro (avisando quando o cadastro está sem o 9), depois nome parecido", () => {
    const dir = {
      clients: [client("c1", { tradeName: "Auto Peças Lima" })],
      contacts: [contact("João Lima", "c1", { whatsapp: "(88) 9811-2040" }), contact("João Pedro", "c1", { whatsapp: "(85) 90000-0000" })],
      leads: [lead("João L.", { phone: "(11) 91111-1111" })],
    };
    const out = identityCandidatesIn(dir, "whatsapp", "5588998112040", "João AP");
    expect(out[0]).toMatchObject({ kind: "contato", id: "João Lima", reason: "mesmo telefone", phoneWithoutNine: true, company: "Auto Peças Lima" });
    expect(out.slice(1).every((x) => x.reason === "nome parecido")).toBe(true);
    expect(out.map((x) => x.id)).toContain("João L.");
  });
});
