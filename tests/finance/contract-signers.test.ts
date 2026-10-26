/**
 * Signatários ligados aos contatos do cliente: contrato refeito reaproveita quem assina (com os dados atuais do
 * contato), contato editado atualiza o signatário e avisos de nome de teste / equipe assinando pelo cliente.
 */
import { describe, expect, it } from "vitest";
import { looksLikePlaceholderName, reuseSigners, signerContact, signerWarnings, syncSignersFromContact } from "@/domain/contract-signers";
import type { ContractSignerEntry } from "@/domain/types";

const contacts = [
  { id: "c1", name: "Philippe Martins", email: "Philippe@Quantso.com.br" },
  { id: "c2", name: "Maria Souza", email: "maria@quantso.com.br" },
  { id: "c3", name: "Duplicado A", email: "dup@quantso.com.br" },
  { id: "c4", name: "Duplicado B", email: "dup@quantso.com.br" },
];

describe("signerContact", () => {
  it("acha pelo vínculo; sem vínculo, pelo e-mail só quando há um contato com ele", () => {
    expect(signerContact({ email: "x@y.com", contactId: "c2" }, contacts)?.id).toBe("c2");
    expect(signerContact({ email: "PHILIPPE@quantso.com.br" }, contacts)?.id).toBe("c1");
    expect(signerContact({ email: "dup@quantso.com.br" }, contacts)).toBeUndefined();
    expect(signerContact({ email: "ninguem@quantso.com.br" }, contacts)).toBeUndefined();
  });
});

describe("reuseSigners", () => {
  it("volta tudo a pendente, sem assinatura/evidência, com os dados atuais do contato; Intercert como estava", () => {
    const previous: ContractSignerEntry[] = [
      { name: "Nome Antigo", email: "antigo@quantso.com.br", role: "Contratante", status: "assinado", signedAt: "2026-10-01", evidence: "x", providerSignerId: "p1", contactId: "c1" },
      { name: "Ana Paula Macêdo", email: "anapaula@intercert.com.br", role: "Representante legal da Contratada", status: "pendente", party: "contratada" },
      { name: "Sem Email Bom", email: "a..b@x.com", role: "Testemunha", status: "pendente" },
      { name: "Philippe Repetido", email: "philippe@quantso.com.br", role: "Testemunha", status: "pendente" },
    ];
    expect(reuseSigners(previous, contacts)).toEqual([
      { name: "Philippe Martins", email: "philippe@quantso.com.br", role: "Contratante", status: "pendente", contactId: "c1" },
      { name: "Ana Paula Macêdo", email: "anapaula@intercert.com.br", role: "Representante legal da Contratada", status: "pendente", party: "contratada" },
    ]);
  });

  it("signatário antigo sem vínculo e sem contato fica como estava", () => {
    expect(reuseSigners([{ name: "TESTE", email: "teste@x.com.br", role: "Contratante", status: "pendente" }], contacts)).toEqual([
      { name: "TESTE", email: "teste@x.com.br", role: "Contratante", status: "pendente" },
    ]);
  });
});

describe("syncSignersFromContact", () => {
  const signers: ContractSignerEntry[] = [
    { name: "TESTE", email: "herculesabenevides@gmail.com", role: "Contratante", status: "pendente" },
    { name: "Hércules Andrade", email: "hercules@intercert.com.br", role: "Representante legal da Contratada", status: "pendente", party: "contratada" },
  ];

  it("contato editado (sem vínculo, pelo e-mail antigo) troca nome e e-mail e grava o vínculo", () => {
    const r = syncSignersFromContact(signers, { id: "c9", name: "Philippe Martins", email: "martinsphilippes@gmail.com" }, "herculesabenevides@gmail.com");
    expect(r.changed).toHaveLength(1);
    expect(r.signers[0]).toEqual({ name: "Philippe Martins", email: "martinsphilippes@gmail.com", role: "Contratante", status: "pendente", contactId: "c9" });
    expect(r.signers[1]).toBe(signers[1]);
  });

  it("não mexe em quem já assinou, na Intercert, com e-mail inválido ou já usado por outro signatário", () => {
    const signed = [{ ...signers[0], status: "assinado" as const }, signers[1]];
    expect(syncSignersFromContact(signed, { id: "c9", name: "X Y", email: "novo@x.com.br" }, signers[0].email).changed).toEqual([]);
    expect(syncSignersFromContact(signers, { id: "c9", name: "X Y", email: "a..b@x.com" }, signers[0].email).changed).toEqual([]);
    expect(syncSignersFromContact(signers, { id: "c9", name: "X Y", email: "hercules@intercert.com.br" }, signers[0].email).changed).toEqual([]);
    expect(syncSignersFromContact(signers, { id: "c9", name: "X Y", email: "hercules@intercert.com.br" }, "hercules@intercert.com.br").changed).toEqual([]);
  });

  it("com vínculo, acha pelo contactId mesmo com e-mail antigo diferente; sem mudança não acusa nada", () => {
    const linked: ContractSignerEntry[] = [{ name: "Maria", email: "maria@old.com.br", role: "Contratante", status: "pendente", contactId: "c2", providerSignerId: "p" }];
    const r = syncSignersFromContact(linked, { id: "c2", name: "Maria Souza", email: "maria@quantso.com.br" }, "outro@x.com");
    expect(r.signers[0]).toEqual({ name: "Maria Souza", email: "maria@quantso.com.br", role: "Contratante", status: "pendente", contactId: "c2" });
    expect(syncSignersFromContact(r.signers, { id: "c2", name: "Maria Souza", email: "maria@quantso.com.br" }, "maria@quantso.com.br").changed).toEqual([]);
  });
});

describe("signerWarnings", () => {
  it("nome de teste e equipe assinando pelo cliente; testemunha e Intercert da equipe não acusam", () => {
    expect(looksLikePlaceholderName("TESTE")).toBe(true);
    expect(looksLikePlaceholderName("Contato Teste")).toBe(true);
    expect(looksLikePlaceholderName("Pedro Testemunha")).toBe(false);
    expect(looksLikePlaceholderName("Philippe Martins")).toBe(false);
    const w = signerWarnings(
      [
        { name: "TESTE", email: "t@x.com.br", role: "Contratante", status: "pendente" },
        { name: "Philippe Martins", email: "martinsphilippes@gmail.com", role: "Contratante", status: "pendente" },
        { name: "Ana Paula", email: "anapaula@intercert.com.br", role: "Testemunha", status: "pendente" },
        { name: "Hércules", email: "hercules@intercert.com.br", role: "Representante", status: "pendente", party: "contratada" },
        { name: "Teste Assinado", email: "a@x.com.br", role: "Contratante", status: "assinado" },
      ],
      ["MartinsPhilippes@gmail.com", "anapaula@intercert.com.br", "hercules@intercert.com.br"],
    );
    expect(w.map((x) => x.email)).toEqual(["t@x.com.br", "martinsphilippes@gmail.com"]);
    expect(w[0].message).toMatch(/nome de teste/);
    expect(w[1].message).toMatch(/equipe Intercert/);
  });
});
