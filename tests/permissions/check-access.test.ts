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
  // Modo restrito das exceções: + previewUserPermissionOverrides (prévia antes de salvar).
  // Central de Atendimento parte 2: + 5 actions (modelo na conversa, salvar/sincronizar modelos, respostas rápidas, automáticas).
  // Parte 3: + página /comunicacao/historico, 3 actions (reabrir, exportar, atendimento do usuário) e o webhook de e-mail.
  // Fases 0 e 2: + páginas supervisao, supervisao/tv e ativacao e 7 actions (supervisão, pausas, alertas, gravação).
  // Fase 3: + páginas ligacoes, correio-de-voz e pabx, 8 actions de telefonia e 7 rotas de voz (5 da Twilio, isentas por assinatura).
  // Fase 4: + 4 actions da supervisão de ligações, 4 do envio agendado de relatórios e a rota monitor-end (isenta por assinatura).
  // Fase 5: + 6 actions de conexão dos canais (Meta e Telegram), 1 do chat do site; rotas: retorno do login da Meta
  // (com permissão), webhooks da Meta (GET/POST) e do Telegram e as 3 do chat do site (isentas: assinatura/token).
  // Troca de versão: + rota pública /api/versao (isenta: só o id do deploy, sem dados).
  // Reajuste anual: + 4 actions do cadastro de índices (salvar, desativar, lançar mês, atualizar agora) e 2 do contrato
  // (aplicar e dispensar o reajuste).
  it("inventário: 101 páginas (10 isentas), 320 funções 'use server' (3 isentas), 32 handlers de API (23 isentos)", () => {
    expect(report.totals).toMatchObject({ pages: 101, pagesExempt: 10, serverFunctions: 320, serverFunctionsExempt: 3, apiHandlers: 32, apiExempt: 23 });
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
