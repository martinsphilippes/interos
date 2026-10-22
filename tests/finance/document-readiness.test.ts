/**
 * Pendências do modelo agrupadas por onde se corrigem (painel do cartão Assinatura) e o representante do cliente
 * (de qual contato vem o CPF).
 */
import { describe, expect, it } from "vitest";
import { fixTargetOf, groupReadinessGaps } from "@/domain/document-readiness";
import { resolveClientRepresentative, resolveRepresentativeDocument, type TemplateDataGap } from "@/domain/contract-templates";

const gap = (variable: string, patch: Partial<TemplateDataGap>): TemplateDataGap => ({ variable, reason: "sem_dado", label: variable, ...patch });

describe("pendências agrupadas por onde se corrigem", () => {
  it("cada origem vai para o seu lugar", () => {
    expect(fixTargetOf(gap("cpf", { source: "contato", field: "contratante.representante_cpf" }))).toBe("representante");
    expect(fixTargetOf(gap("rep", { source: "signatario", field: "contratante.representante" }))).toBe("representante");
    expect(fixTargetOf(gap("bairro", { source: "cliente", field: "contratante.bairro" }))).toBe("cliente");
    expect(fixTargetOf(gap("produto", { source: "contrato", field: "contrato.produto" }))).toBe("itens");
    expect(fixTargetOf(gap("itens", { source: "contrato", field: "contrato.itens" }))).toBe("itens");
    expect(fixTargetOf(gap("mensal", { source: "contrato", field: "valores.mensalidade" }))).toBe("itens");
    expect(fixTargetOf(gap("venc", { source: "contrato", field: "contrato.primeiro_vencimento" }))).toBe("condicoes");
    expect(fixTargetOf(gap("assina", { source: "intercert", field: "contratada.representante" }))).toBe("intercert");
    expect(fixTargetOf(gap("garantia", { reason: "sem_ligacao" }))).toBe("modelo");
    expect(fixTargetOf(gap("inicio", { reason: "apos_liberacao", source: "contrato", field: "contrato.inicio_vigencia" }))).toBe("modelo");
  });

  it("um item por lugar, na ordem do painel (quem assina primeiro), sem perder nenhuma pendência", () => {
    const gaps = [
      gap("garantia", { reason: "sem_ligacao" }),
      gap("bairro", { source: "cliente", field: "contratante.bairro" }),
      gap("cep", { source: "cliente", field: "contratante.cep" }),
      gap("cpf", { source: "contato", field: "contratante.representante_cpf" }),
      gap("produto", { source: "contrato", field: "contrato.produto" }),
    ];
    const groups = groupReadinessGaps(gaps);
    expect(groups.map((g) => [g.target, g.gaps.map((x) => x.variable)])).toEqual([
      ["representante", ["cpf"]],
      ["cliente", ["bairro", "cep"]],
      ["itens", ["produto"]],
      ["modelo", ["garantia"]],
    ]);
    expect(groups.flatMap((g) => g.gaps)).toHaveLength(gaps.length);
    expect(groupReadinessGaps([])).toEqual([]);
  });
});

describe("representante do cliente (de qual contato vem o CPF)", () => {
  const signer = (name: string, email: string, role = "Contratante") => ({ name, email, role });
  it("o contato com o e-mail do signatário; e-mail compartilhado decide pelo nome; duplicados com CPFs diferentes ficam ambíguos", () => {
    expect(resolveClientRepresentative([signer("Ana", "ana@x.com")], [{ name: "Ana", email: "ANA@x.com" }]).contact?.name).toBe("Ana");
    expect(resolveClientRepresentative([signer("Ana", "ana@x.com")], []).contact).toBeUndefined();
    const shared = [
      { name: "João", email: "fin@x.com" },
      { name: "Maria", email: "fin@x.com", document: "52998224725" },
    ];
    expect(resolveClientRepresentative([signer("João", "fin@x.com")], shared).contact?.name).toBe("João");
    expect(resolveClientRepresentative([signer("Fulano", "fin@x.com")], shared).ambiguous).toBe("nome");
    expect(resolveClientRepresentative([signer("Maria", "fin@x.com")], [...shared, { name: "Maria", email: "fin@x.com", document: "11144477735" }]).ambiguous).toBe("cpf");
    expect(resolveClientRepresentative([signer("Pedro", "p@x.com", "Testemunha")], []).signer).toBeUndefined();
  });

  it("e-mail e nome precisam bater: o único contato com o e-mail, mas outro nome, não é a pessoa; contato sem e-mail vale pelo nome", () => {
    const only = resolveClientRepresentative([signer("João Pereira", "geral@x.com")], [{ name: "Maria Financeiro", email: "geral@x.com", document: "52998224725" }]);
    expect(only).toMatchObject({ ambiguous: "outro_nome", otherName: "Maria Financeiro" });
    expect(only.contact).toBeUndefined();
    const noEmail = resolveClientRepresentative([signer("João  Pereira", "geral@x.com")], [{ name: "joão pereira" }, { name: "Outro", email: "o@x.com" }]);
    expect(noEmail.contact?.name).toBe("joão pereira");
    expect(resolveClientRepresentative([signer("João", "geral@x.com")], [{ name: "João" }, { name: "João", document: "52998224725" }, { name: "João", document: "11144477735" }]).ambiguous).toBe("cpf");
  });

  it("ordem: o contato que é a pessoa; sem contato, o cliente pessoa física pelo faturamento; sem contato, o nome da empresa", () => {
    const sig = (name: string, email: string) => [signer(name, email)];
    // Cliente PF sem contatos: o CPF do faturamento em nome dele.
    expect(resolveRepresentativeDocument(sig("Carlos Pereira", "carlos@x.com"), [], { legalName: "Carlos Pereira", tradeName: "Carlos Pereira" }, { legalName: "Carlos Pereira", document: "529.982.247-25" })).toMatchObject({ fromClient: true, document: "52998224725" });
    // Lead que virou cliente com o nome da pessoa; faturamento numa empresa; o contato É a pessoa: CPF do contato.
    const lead = resolveRepresentativeDocument(sig("João Silva", "joao@x.com"), [{ name: "João Silva", email: "joao@x.com", document: "11144477735" }], { legalName: "João Silva", tradeName: "João Silva" }, { legalName: "Padaria X Ltda", document: "12345678000190" });
    expect(lead).toMatchObject({ document: "11144477735" });
    expect(lead.ambiguous).toBeUndefined();
    // Empresário individual (razão social = nome civil, CNPJ) com contato: CPF do contato.
    expect(resolveRepresentativeDocument(sig("Ana Paula Ribeiro", "ana@x.com"), [{ name: "Ana Paula Ribeiro", email: "ana@x.com", document: "52998224725" }], { legalName: "Ana Paula Ribeiro" }, { legalName: "Ana Paula Ribeiro", document: "12345678000190" })).toMatchObject({ document: "52998224725" });
    // Faturamento em nome de OUTRA pessoa física; a signatária (contato, sem CPF) tem o nome do cadastro: pendência, nunca o CPF de outro.
    const other = resolveRepresentativeDocument(sig("Ana Lima", "ana@x.com"), [{ name: "Ana Lima", email: "ana@x.com" }], { legalName: "Ana Lima", tradeName: "Ana Lima" }, { legalName: "Paulo Mendes", document: "11144477735" });
    expect(other.document).toBeUndefined();
    expect(other.fromClient).toBeUndefined();
    expect(other.contact?.name).toBe("Ana Lima");
    // Nome da empresa: nem o contato sem e-mail com esse nome recebe CPF.
    const pj = resolveRepresentativeDocument(sig("Padaria X", "contato@x.com"), [{ name: "Padaria X", document: "52998224725" }], { legalName: "Padaria X Ltda", tradeName: "Padaria X" }, { legalName: "Padaria X Ltda", document: "12345678000190" });
    expect(pj).toMatchObject({ ambiguous: "empresa" });
    expect(pj.document).toBeUndefined();
    // Nome da empresa + o e-mail de um contato com outro nome: é a empresa (escolher quem assina).
    expect(resolveRepresentativeDocument(sig("Padaria X Ltda", "geral@x.com"), [{ name: "Maria", email: "geral@x.com" }], { legalName: "Padaria X Ltda" }, { legalName: "Padaria X Ltda", document: "12345678000190" })).toMatchObject({ ambiguous: "empresa" });
  });
});
