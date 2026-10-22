/**
 * Seletor de signatários do contrato: contatos do cliente e equipe, sem quem já assina, contato sem e-mail
 * desabilitado, nome sem sobrenome marcado só com a Clicksign ligada.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SIGNER_ROLE, DEFAULT_TEAM_SIGNER_ROLE, signerChoices } from "@/components/finance/signer-options";

const options = {
  contacts: [
    { id: "c1", name: "Maria Silva", email: "Maria@Acme.com.br", role: "Sócia", isPrimary: true },
    { id: "c2", name: "TESTE", email: "teste@acme.com.br" },
    { id: "c3", name: "João Sem Email" },
    { id: "c4", name: "Ana Já Assina", email: "ana@acme.com.br" },
    { id: "c5", name: "Beto Email Ruim", email: "a..b@acme.com.br" },
  ],
  users: [
    { id: "u1", name: "Pedro Testemunha", email: "pedro@intercert.com.br" },
    { id: "u2", name: "Hércules", email: "hercules@intercert.com.br" },
    { id: "u3", name: "Zé Email Ruim", email: "zé@intercert.com.br" },
  ],
};

describe("signerChoices", () => {
  it("lista contatos e equipe com rótulo, e-mail em minúsculas e papel sugerido; quem já assina sai", () => {
    const { contacts, users } = signerChoices(options, [{ email: "ANA@acme.com.br" }], false);
    expect(contacts.map((c) => c.name)).toEqual(["Maria Silva", "TESTE", "Beto Email Ruim", "João Sem Email"]);
    expect(contacts[0]).toMatchObject({ value: "contact:c1", email: "maria@acme.com.br", label: "Maria Silva · Sócia · maria@acme.com.br", suggestedRole: DEFAULT_CLIENT_SIGNER_ROLE });
    expect(users.map((u) => u.value)).toEqual(["user:u2", "user:u1", "user:u3"]);
    expect(users[1]).toMatchObject({ suggestedRole: DEFAULT_TEAM_SIGNER_ROLE, email: "pedro@intercert.com.br" });
  });

  it("contato sem e-mail fica por último e desabilitado", () => {
    const { contacts } = signerChoices(options, [], false);
    const semEmail = contacts.find((c) => c.name === "João Sem Email")!;
    expect(contacts.at(-1)).toBe(semEmail);
    expect(semEmail.disabledReason).toMatch(/sem e-mail/);
    expect(semEmail.label).toContain("sem e-mail");
  });

  it("e-mail que a assinatura não aceita (cadastro mais frouxo) desabilita contato e usuário, apontando onde corrigir", () => {
    const { contacts, users } = signerChoices(options, [], false);
    expect(contacts.find((c) => c.name === "Beto Email Ruim")?.disabledReason).toMatch(/inválido.*ficha do cliente/);
    expect(contacts.find((c) => c.name === "Beto Email Ruim")?.label).toBe("Beto Email Ruim · a..b@acme.com.br · e-mail inválido");
    expect(users.find((u) => u.name === "Zé Email Ruim")?.label).toContain("· e-mail inválido");
    expect(users.find((u) => u.name === "Zé Email Ruim")?.disabledReason).toMatch(/inválido.*cadastro do usuário/);
    expect(users.at(-1)?.name).toBe("Zé Email Ruim");
    expect(users.find((u) => u.name === "Pedro Testemunha")?.disabledReason).toBeUndefined();
  });

  it("com a Clicksign ligada, nome sem sobrenome é marcado (sem ela, não)", () => {
    const on = signerChoices(options, [], true);
    expect(on.contacts.find((c) => c.name === "TESTE")?.nameProblem).toMatch(/sobrenome/);
    expect(on.contacts.find((c) => c.name === "Maria Silva")?.nameProblem).toBeUndefined();
    expect(on.users.find((u) => u.name === "Hércules")?.nameProblem).toMatch(/sobrenome/);
    const off = signerChoices(options, [], false);
    expect(off.contacts.every((c) => !c.nameProblem)).toBe(true);
  });
});
