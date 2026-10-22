/**
 * Pendências do modelo agrupadas por onde se corrigem (painel do cartão Assinatura) e o representante do cliente
 * (de qual contato vem o CPF).
 */
import { describe, expect, it } from "vitest";
import { fixTargetOf, groupReadinessGaps } from "@/domain/document-readiness";
import { resolveClientRepresentative, type TemplateDataGap } from "@/domain/contract-templates";

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
});
