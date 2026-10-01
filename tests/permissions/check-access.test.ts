/**
 * Verificador de cobertura (A15/A21): o analisador reconhece guarda, helper local, chave divergente e chave
 * inexistente (árvore sintética), e no repositório real as categorias ESTRUTURAIS estão zeradas — só faltam as
 * guardas de página/action/API, que são a lista de trabalho da fase seguinte (modo relatório).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeAccess, type FindingKind } from "../../scripts/check-access/analyze";

const tmp = mkdtempSync(path.join(os.tmpdir(), "check-access-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function put(file: string, content: string) {
  const full = path.join(tmp, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe("analisador (árvore sintética)", () => {
  put(
    "src/app/(app)/tarefas/page.tsx",
    `import { requireScreen } from "@/server/auth/session";
export default async function Page() { await requireScreen("operacao.tarefas"); return null; }`,
  );
  put(
    "src/app/(app)/vendas/pipeline/page.tsx",
    `import { requireScreen } from "@/server/auth/session";
export default async function Page() { await requireScreen("vendas.central"); return null; }`,
  );
  put("src/app/(app)/workflow/page.tsx", `export default async function Page() { return null; }`);
  put("src/app/(app)/inventada/page.tsx", `export default async function Page() { return null; }`);
  put(
    "src/server/tasks/actions.ts",
    `"use server";
import { can, requirePermission } from "@/server/auth/session";
async function guard() { return requirePermission("operacao.tarefas.editar"); }
export async function createTask() { await requirePermission("operacao.tarefas.criar"); }
export async function updateTask() { await guard(); }
export async function toggleChecklistItem() { await requirePermission("vendas.pipeline.ver"); }
export async function addChecklistItem() { return can({} as never, "operacao.tarefas.inexistente" as never); }
export const naoCatalogada = async () => {};`,
  );
  put(
    "src/app/api/relatorios/[tipo]/route.ts",
    `import { requireApiPermission } from "@/server/auth/session";
export async function GET() { const u = await requireApiPermission("gestao.relatorios.exportar"); return u as Response; }`,
  );
  put("src/app/api/nova/route.ts", `export async function POST() { return new Response(null); }`);

  const report = analyzeAccess(tmp);
  const of = (kind: FindingKind) => report.findings.filter((f) => f.kind === kind).map((f) => f.target);

  it("página com a tela dona passa; tela diferente, sem guarda e sem tela são acusadas", () => {
    expect(of("pagina-sem-guarda")).toEqual(["src/app/(app)/inventada/page.tsx", "src/app/(app)/workflow/page.tsx"]);
    expect(of("pagina-tela-divergente")).toEqual(["src/app/(app)/vendas/pipeline/page.tsx"]);
    expect(of("pagina-sem-tela")).toEqual(["src/app/(app)/inventada/page.tsx"]);
  });

  it("action: requirePermission direto ou por helper local passa; chave fora do dono e função sem dono são acusadas", () => {
    const sem = of("funcao-sem-guarda");
    expect(sem).toContain("src/server/tasks/actions.ts#addChecklistItem");
    expect(sem).not.toContain("src/server/tasks/actions.ts#createTask");
    expect(sem).not.toContain("src/server/tasks/actions.ts#updateTask");
    expect(of("funcao-chave-divergente")).toEqual(["src/server/tasks/actions.ts#toggleChecklistItem"]);
    expect(of("funcao-sem-dono")).toEqual(["src/server/tasks/actions.ts#naoCatalogada"]);
  });

  it("API: requireApiPermission passa; handler novo sem guarda nem isenção é acusado", () => {
    expect(of("api-sem-guarda")).toEqual(["src/app/api/nova/route.ts#POST"]);
  });

  it("chave inexistente no catálogo é acusada com arquivo e linha", () => {
    expect(of("chave-inexistente")).toEqual(["src/server/tasks/actions.ts:7"]);
  });

  it("guards do catálogo sem função e telas sem página aparecem (a árvore sintética só tem parte do app)", () => {
    expect(of("guard-sem-funcao").length).toBeGreaterThan(0);
    expect(of("tela-sem-pagina").length).toBeGreaterThan(0);
  });
});

describe("repositório real", () => {
  const report = analyzeAccess(path.resolve(__dirname, "../.."));
  const count = (kind: FindingKind) => report.findings.filter((f) => f.kind === kind).length;

  // 238 = 235 + savePermissionProfile/saveUserPermissionOverrides/saveActiveModules (futureGuards de admin.acessos.gerir).
  // Etapa 6B (D31): + página pública /portal/[token] (isenta) e 3 actions do portal (gerar, enviar, revogar).
  // Etapa CP/CR 1: + página /financeiro/cadastros e 10 actions dos cadastros financeiros.
  // Etapa CP/CR 2: + undoPayablePaymentAction (desfazer pagamento) e listPaymentAccountsAction (contas do diálogo de baixa).
  // Etapa CP/CR 3: + 3 actions de Contas a Pagar (parcial, resíduo, quitar pelo já pago) e 9 dos títulos a receber avulsos.
  it("inventário: 90 páginas (8 isentas), 265 funções 'use server' (3 isentas), 9 handlers de API (8 isentos)", () => {
    expect(report.totals).toMatchObject({ pages: 90, pagesExempt: 8, serverFunctions: 265, serverFunctionsExempt: 3, apiHandlers: 9, apiExempt: 8 });
  });

  it("categorias estruturais zeradas: toda página/função/rota tem dono, toda chave existe, todo guard aponta para função", () => {
    for (const kind of ["pagina-sem-tela", "pagina-tela-divergente", "funcao-sem-dono", "funcao-chave-divergente", "chave-inexistente", "tela-sem-pagina", "guard-sem-funcao"] as const) {
      expect(report.findings.filter((f) => f.kind === kind), kind).toEqual([]);
    }
  });

  it("guardas ainda não aplicadas (lista da fase seguinte) não crescem: páginas ≤ 79, actions ≤ 232, APIs ≤ 1", () => {
    expect(count("pagina-sem-guarda")).toBeLessThanOrEqual(79);
    expect(count("funcao-sem-guarda")).toBeLessThanOrEqual(232);
    expect(count("api-sem-guarda")).toBeLessThanOrEqual(1);
  });
});
