/**
 * Guardas dos títulos a receber AVULSOS (etapa CP/CR 3): cobertura real da página e das actions (verificador A15),
 * função → chave do catálogo (a primeira exigida é a dona, antes da validação), escopo do registro em toda action sobre
 * um título, página que nega a aba sem a seção ANTES de ler, e capacidades padrão ≡ quem opera as cobranças hoje.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCREENS } from "@/domain/permissions";
import { canSeeFinanceValues } from "@/server/finance/access";
import { asCurrentUser, ALL_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyCanOperateFinance, legacyUser } from "./legacy";

const { analyzeAccess } = await import("../../scripts/check-access/analyze");
const { receivableCapabilities } = await import("@/server/receivables/access");

const ROOT = path.resolve(__dirname, "../..");
const ACTIONS_FILE = "src/server/receivables/actions.ts";
const PAGE_FILE = "src/app/(app)/financeiro/contas-a-receber/page.tsx";
const operates = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "financeiro") && legacyCanOperateFinance(legacyUser(u));

describe("títulos a receber avulsos — cobertura e função → chave", () => {
  it("nenhuma pendência do verificador na página de Contas a Receber nem nas actions dos avulsos", () => {
    const report = analyzeAccess(ROOT);
    expect(report.findings.filter((f) => f.target.startsWith(ACTIONS_FILE) || f.target.startsWith(PAGE_FILE) || f.target.startsWith("src/server/receivables/"))).toEqual([]);
  });

  const source = readFileSync(path.join(ROOT, ACTIONS_FILE), "utf8");
  const functions = [...source.matchAll(/export async function (\w+)\([\s\S]*?\n\}\n/g)].map((m) => ({ name: m[1], body: m[0] }));
  const owners = new Map<string, string>();
  for (const s of SCREENS) for (const a of s.actions) for (const g of a.guards) if (g.startsWith(`${ACTIONS_FILE}#`)) owners.set(g.split("#")[1].split("?")[0], a.key);

  it("as 9 funções exportadas exigem a chave dona (financeiro.contas-a-receber.avulsos.*) antes da validação", () => {
    expect(functions.length).toBe(9);
    for (const fn of functions) {
      const first = fn.body.match(/requirePermission\("([^"]+)"\)/);
      expect(first?.[1], fn.name).toBe(owners.get(fn.name));
      expect(first?.[1].startsWith("financeiro.contas-a-receber.avulsos."), fn.name).toBe(true);
      expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(fn.body.indexOf(".parse("));
    }
  });

  it("toda action sobre um título confere o escopo; criar confere o escopo da aba; recebimento exige a conta", () => {
    for (const fn of functions) {
      if (fn.name === "createReceivableAction") expect(fn.body).toMatch(/await assertCanCreateReceivable\(user\)/);
      else expect(fn.body, fn.name).toMatch(/await assertReceivableAccess\(user, data\.receivableId\)/);
    }
    for (const name of ["receiveReceivableAction", "partialReceiveReceivableAction", "receiveWithResidualAction"]) expect(functions.find((f) => f.name === name)!.body, name).toMatch(/await requireManualPaymentAccount\(data\.accountId\)/);
  });

  it("página: ?aba=avulsos sem a seção redireciona ANTES de ler os títulos", () => {
    const page = readFileSync(path.join(ROOT, PAGE_FILE), "utf8");
    const deny = page.indexOf('if (!showTabs) redirect("/meu-dia?erro=sem-permissao")');
    expect(deny).toBeGreaterThan(0);
    expect(page.indexOf('const showTabs = can(user, "financeiro.contas-a-receber.avulsos.ver")')).toBeLessThan(deny);
    expect(deny).toBeLessThan(page.indexOf("<AvulsosView"));
  });
});

describe("títulos a receber avulsos — capacidades padrão", () => {
  it("criar/editar/receber/desfazer/cancelar ≡ quem opera as cobranças (módulo Financeiro ∧ canOperateFinance); criar e receber exigem também 'Visualizar valores'", () => {
    for (const u of ALL_USERS) {
      const user = asCurrentUser(u);
      const caps = receivableCapabilities(user);
      const op = operates(u);
      const values = canSeeFinanceValues(user);
      expect(caps.edit, `${label(u)} editar`).toBe(op);
      expect(caps.undo, `${label(u)} desfazer`).toBe(op);
      expect(caps.cancel, `${label(u)} cancelar`).toBe(op);
      expect(caps.create, `${label(u)} criar`).toBe(op && values);
      expect(caps.receive, `${label(u)} receber`).toBe(op && values);
    }
  });
});
