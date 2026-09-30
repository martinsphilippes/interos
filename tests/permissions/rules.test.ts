/**
 * Avaliador único da DSL (evaluateRule), descrição em português (describeRule) e validação de regras.
 */
import { describe, expect, it } from "vitest";
import { deriveSubject, describeRule, evaluateRule, isValidRule, type AccessRule } from "@/domain/permissions";

const s = (role: Parameters<typeof deriveSubject>[0]["role"], departmentId?: Parameters<typeof deriveSubject>[0]["departmentId"]) => deriveSubject({ role, departmentId });

describe("evaluateRule", () => {
  it("all, role, department", () => {
    expect(evaluateRule("all", s("colaborador", "administrativo"))).toBe(true);
    expect(evaluateRule({ role: "vendas" }, s("vendas", "vendas"))).toBe(true);
    expect(evaluateRule({ role: ["admin", "financeiro"] }, s("vendas", "financeiro"))).toBe(false);
    expect(evaluateRule({ department: "financeiro" }, s("vendas", "financeiro"))).toBe(true);
    expect(evaluateRule({ department: ["cs", "suporte"] }, s("cs", "vendas"))).toBe(false);
    expect(evaluateRule({ department: "financeiro" }, s("vendas"))).toBe(false);
  });

  it("manager = gestor|diretoria|admin; director = diretoria|admin (derivados só do papel, como decorate)", () => {
    for (const role of ["gestor", "diretoria", "admin"] as const) expect(evaluateRule({ manager: true }, s(role, "vendas"))).toBe(true);
    for (const role of ["vendas", "financeiro", "colaborador"] as const) expect(evaluateRule({ manager: true }, s(role, "vendas"))).toBe(false);
    expect(evaluateRule({ director: true }, s("diretoria", "diretoria"))).toBe(true);
    expect(evaluateRule({ director: true }, s("admin", "diretoria"))).toBe(true);
    expect(evaluateRule({ director: true }, s("gestor", "diretoria"))).toBe(false);
  });

  it("managerOf = isManager ∧ (papel ou departamento = d) — semântica de isFinanceManager", () => {
    expect(evaluateRule({ managerOf: "financeiro" }, s("gestor", "financeiro"))).toBe(true);
    expect(evaluateRule({ managerOf: "financeiro" }, s("gestor", "vendas"))).toBe(false);
    expect(evaluateRule({ managerOf: "financeiro" }, s("financeiro", "financeiro"))).toBe(false);
    expect(evaluateRule({ managerOf: "financeiro" }, s("admin", "diretoria"))).toBe(false);
    expect(evaluateRule({ any: [{ director: true }, { managerOf: "financeiro" }] }, s("admin", "diretoria"))).toBe(true);
  });

  it("any/all aninhados", () => {
    const rule: AccessRule = { all: [{ any: [{ manager: true }, { role: "financeiro" }] }, { department: "financeiro" }] };
    expect(evaluateRule(rule, s("gestor", "financeiro"))).toBe(true);
    expect(evaluateRule(rule, s("financeiro", "financeiro"))).toBe(true);
    expect(evaluateRule(rule, s("gestor", "vendas"))).toBe(false);
    expect(evaluateRule(rule, s("vendas", "financeiro"))).toBe(false);
  });

  it("can consulta o resolvedor; sem resolvedor nega (falha fechada)", () => {
    expect(evaluateRule({ can: "financeiro.acessar" }, s("vendas"), { can: (k) => k === "financeiro.acessar" })).toBe(true);
    expect(evaluateRule({ can: "financeiro.acessar" }, s("vendas"), { can: () => false })).toBe(false);
    expect(evaluateRule({ can: "financeiro.acessar" }, s("admin"))).toBe(false);
  });

  it("regra desconhecida nega", () => {
    expect(evaluateRule({ foo: true } as unknown as AccessRule, s("admin"))).toBe(false);
  });
});

describe("isValidRule", () => {
  it("aceita as formas da DSL e recusa o resto", () => {
    expect(isValidRule("all")).toBe(true);
    expect(isValidRule({ any: [{ manager: true }, { role: ["vendas", "cs"] }] })).toBe(true);
    expect(isValidRule({ can: "financeiro.acessar" })).toBe(true);
    expect(isValidRule({ can: "nao.existe" })).toBe(false);
    expect(isValidRule({ role: "ceo" })).toBe(false);
    expect(isValidRule({ department: "rh" })).toBe(false);
    expect(isValidRule({ any: [] })).toBe(false);
    expect(isValidRule({ manager: false })).toBe(false);
    expect(isValidRule({ role: "admin", department: "vendas" })).toBe(false);
    expect(isValidRule(null)).toBe(false);
  });
});

describe("describeRule", () => {
  it("gera texto de negócio em português", () => {
    expect(describeRule("all")).toBe("Todos (que acessam o nível acima)");
    expect(describeRule({ role: ["admin", "diretoria", "gestor", "financeiro", "vendas"] })).toBe("Papéis Administrador, Diretoria, Gestor, Financeiro e Vendas");
    expect(describeRule({ role: "admin" })).toBe("Papel Administrador");
    expect(describeRule({ any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] })).toBe(
      "Gestores (gestor, diretoria e administrador), papel Financeiro ou departamento Financeiro",
    );
    expect(describeRule({ any: [{ director: true }, { managerOf: "financeiro" }] })).toBe(
      "Diretoria e administrador ou gestores de Financeiro (gestor, diretoria ou administrador com papel ou departamento Financeiro)",
    );
    expect(describeRule({ all: [{ can: "financeiro.acessar" }, { any: [{ manager: true }, { role: "financeiro" }] }] })).toBe(
      "Quem tem «acesso ao módulo Financeiro» e (gestores (gestor, diretoria e administrador) ou papel Financeiro)",
    );
    expect(describeRule({ can: "suporte.acessar" })).toBe("Quem tem «acesso ao módulo Suporte»");
    expect(describeRule({ department: ["financeiro", "vendas"] })).toBe("Departamentos Financeiro e Vendas");
  });

  it("nenhuma regra do catálogo fica sem descrição ou com chave técnica crua", async () => {
    const { PERMISSION_NODES } = await import("@/domain/permissions");
    for (const node of PERMISSION_NODES) {
      const text = describeRule(node.rule);
      expect(text.length, node.key).toBeGreaterThan(3);
      expect(text, node.key).not.toMatch(/regra desconhecida|a permissão [a-z]+\./);
    }
  });
});
