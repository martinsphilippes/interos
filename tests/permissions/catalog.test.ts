/**
 * Integridade do catálogo de acessos (A2/A24): chaves únicas e bem formadas, pai existente, regras válidas, grafo
 * de `can` acíclico, navegação e atalhos cobrindo as constantes atuais, mapa de configurações e cobertura de páginas.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_ACCESS, ROLE_KEYS } from "@/domain/constants";
import { MOBILE_NAV, NAVIGATION, QUICK_ACTIONS } from "@/domain/navigation";
import {
  EXEMPTIONS,
  MODULES,
  MODULE_KEYS,
  NODE_BY_KEY,
  PERMISSION_KEYS,
  PERMISSION_NODES,
  PROTECTED_KEYS,
  SCOPE_KINDS,
  SCREENS,
  SCREEN_BY_KEY,
  SETTING_PERMISSION,
  isValidRule,
  ruleReferences,
  type AccessRule,
} from "@/domain/permissions";
import { SETTING_KEYS } from "@/server/admin/schemas";
import { screenForHref } from "@/server/auth/permissions";

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

describe("catálogo — números e chaves", () => {
  it("tem 11 módulos, 66 telas, 134 seções e 264 ações (475 chaves únicas) — etapa CP/CR 3: + 3 ações de Contas a Pagar (parcial, resíduo, quitar pelo já pago) e a seção Títulos avulsos com 5 ações em Contas a Receber; etapa CP/CR 5: + editar/cancelar em série (2 em Contas a Pagar, 2 nos avulsos)", () => {
    expect(MODULES.length).toBe(11);
    expect(SCREENS.length).toBe(66);
    expect(SCREENS.reduce((n, s) => n + s.sections.length, 0)).toBe(134);
    expect(SCREENS.reduce((n, s) => n + s.actions.length, 0)).toBe(264);
    expect(PERMISSION_KEYS.length).toBe(475);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("módulos = MODULE_KEYS = chaves de MODULE_ACCESS", () => {
    expect(MODULES.map((m) => m.key)).toEqual([...MODULE_KEYS]);
    expect(Object.keys(MODULE_ACCESS).sort()).toEqual([...MODULE_KEYS].sort());
  });

  it("chaves em pt-kebab com o prefixo do pai", () => {
    for (const node of PERMISSION_NODES) {
      expect(node.key, node.key).toMatch(KEY);
      expect(node.key.startsWith(`${node.module}.`), node.key).toBe(true);
      if (node.kind === "tela" || node.kind === "secao") expect(node.key.endsWith(".ver"), node.key).toBe(true);
      if (node.kind === "acao") expect(node.key.endsWith(".ver"), `${node.key} (ação não termina em .ver)`).toBe(false);
      if (node.screen) expect(node.key.startsWith(`${node.screen}.`), node.key).toBe(true);
    }
    for (const s of SCREENS) expect(s.key.startsWith(`${s.module}.`), s.key).toBe(true);
  });

  it("todo pai existe; seções e ações têm pai na mesma tela", () => {
    for (const node of PERMISSION_NODES) {
      for (const parent of node.requires.keys) expect(NODE_BY_KEY.has(parent), `${node.key} → ${parent}`).toBe(true);
      if (node.kind === "secao") expect(node.requires.keys).toEqual([`${node.screen}.ver`]);
      if (node.kind === "acao") {
        const parent = NODE_BY_KEY.get(node.requires.keys[0])!;
        expect(parent.screen, node.key).toBe(node.screen);
      }
    }
  });

  it("chaves protegidas existem e estão marcadas", () => {
    for (const key of PROTECTED_KEYS) expect(NODE_BY_KEY.get(key)?.protected, key).toBe(true);
    expect(PERMISSION_NODES.filter((n) => n.protected).map((n) => n.key).sort()).toEqual([...PROTECTED_KEYS].sort());
  });
});

describe("catálogo — regras", () => {
  const rules: [string, AccessRule][] = [];
  for (const m of MODULES) rules.push([`${m.key}.acessar`, m.rule]);
  for (const s of SCREENS) {
    rules.push([`${s.key}.ver`, s.rule]);
    for (const x of s.sections) rules.push([x.key, x.rule]);
    for (const a of s.actions) rules.push([a.key, a.rule]);
    if (s.nav?.rule) rules.push([`${s.key} (nav.rule)`, s.nav.rule]);
    if (s.nav?.quickAction) rules.push([`${s.key} (quickAction.rule)`, s.nav.quickAction.rule]);
    for (const o of s.scope?.overrides ?? []) rules.push([`${s.key} (scope.overrides)`, o.when]);
    const iv = s.scope?.initialView;
    if (iv && typeof iv === "object") rules.push([`${s.key} (scope.initialView)`, iv.when]);
  }

  it("todas as regras são válidas na DSL", () => {
    for (const [key, rule] of rules) expect(isValidRule(rule), `${key}: ${JSON.stringify(rule)}`).toBe(true);
  });

  it("listas de papéis que o código atual deixa passar incluem 'admin' explicitamente (sem curto-circuito)", () => {
    for (const m of MODULES) {
      const legacy = MODULE_ACCESS[m.key];
      if (legacy !== "all" && typeof m.rule === "object" && "role" in m.rule) expect(m.rule.role, m.key).toContain("admin");
    }
  });

  it("grafo de `can` é acíclico (inclui a dependência do pai)", () => {
    const edges = new Map<string, string[]>();
    for (const node of PERMISSION_NODES) edges.set(node.key, [...ruleReferences(node.rule), ...node.requires.keys]);
    const state = new Map<string, 1 | 2>();
    const visit = (k: string, trail: string[]) => {
      if (state.get(k) === 2) return;
      if (state.get(k) === 1) throw new Error(`ciclo: ${[...trail, k].join(" → ")}`);
      state.set(k, 1);
      for (const next of edges.get(k) ?? []) visit(next, [...trail, k]);
      state.set(k, 2);
    };
    for (const k of edges.keys()) visit(k, []);
  });

  it("guards no formato arquivo#função[?condição] apontando para src/", () => {
    const re = /^src\/[\w\-/.()[\]]+\.tsx?#\w+(\?.+)?$/;
    for (const s of SCREENS) {
      for (const a of s.actions) for (const g of [...a.guards, ...(a.checkedIn ?? [])]) expect(g, a.key).toMatch(re);
      for (const g of s.viewGuards ?? []) expect(g.guard, s.key).toMatch(re);
      for (const x of s.sections) for (const g of x.viewGuards ?? []) expect(g.guard, x.key).toMatch(re);
    }
  });
});

describe("catálogo — escopo", () => {
  it("escopos válidos, padrão dentro do permitido e sameAs existente", () => {
    for (const s of SCREENS) {
      const sc = s.scope;
      if (!sc) continue;
      if (sc.sameAs) expect(SCREEN_BY_KEY.has(sc.sameAs), `${s.key} sameAs ${sc.sameAs}`).toBe(true);
      if (!sc.allowed) continue;
      for (const k of sc.allowed) expect(SCOPE_KINDS).toContain(k);
      expect(sc.allowed, `${s.key}: "unidades" não é oferecido`).not.toContain("unidades");
      for (const [role, kind] of Object.entries(sc.defaultByRole ?? {})) {
        expect(ROLE_KEYS as readonly string[]).toContain(role);
        expect(sc.allowed, `${s.key}.${role}`).toContain(kind);
      }
      for (const o of sc.overrides ?? []) expect(sc.allowed).toContain(o.scope);
    }
  });
});

describe("catálogo — navegação e configurações", () => {
  it("cada item de NAVIGATION corresponde a uma tela com nav na mesma seção e ordem", () => {
    for (const section of NAVIGATION) {
      section.items.forEach((item, i) => {
        const screen = SCREENS.find((s) => s.nav?.href === item.href);
        expect(screen, item.href).toBeDefined();
        expect(screen!.nav!.menu, item.href).toBe(section.key);
        expect(screen!.nav!.order, item.href).toBe(i + 1);
        expect(screen!.nav!.icon, item.href).toBe(item.icon);
      });
    }
    const navScreens = SCREENS.filter((s) => s.nav?.menu && s.nav.order !== undefined);
    expect(navScreens.length).toBe(NAVIGATION.reduce((n, s) => n + s.items.length, 0));
  });

  it("MOBILE_NAV e QUICK_ACTIONS derivam do catálogo", () => {
    const mobile = SCREENS.filter((s) => s.nav?.mobile !== undefined).sort((a, b) => a.nav!.mobile! - b.nav!.mobile!).map((s) => s.nav!.href);
    expect(mobile).toEqual(MOBILE_NAV.map((i) => i.href));
    const quick = SCREENS.flatMap((s) => (s.nav?.quickAction ? [s.nav.quickAction] : [])).sort((a, b) => a.order - b.order);
    expect(quick.map((q) => [q.key, q.href, q.icon, q.label, q.description])).toEqual(QUICK_ACTIONS.map((q) => [q.key, q.href, q.icon, q.label, q.description]));
    for (const q of quick) expect(NODE_BY_KEY.get(q.via)?.kind, q.via).toBe("acao");
  });

  it("SETTING_PERMISSION cobre as 18 configurações e bate com os guards de upsertSetting", () => {
    expect(Object.keys(SETTING_PERMISSION).sort()).toEqual([...SETTING_KEYS].sort());
    const fromGuards = new Map<string, string>();
    for (const s of SCREENS)
      for (const a of s.actions)
        for (const g of a.guards) {
          const m = /admin\/actions\.ts#upsertSetting\?key=(.+)$/.exec(g);
          if (m) fromGuards.set(m[1], a.key);
        }
    expect(Object.fromEntries(fromGuards)).toEqual(SETTING_PERMISSION);
  });

  it("requireScreenAny e redirectTo apontam para telas existentes", () => {
    for (const s of SCREENS) {
      for (const k of s.requireScreenAny ?? []) expect(SCREEN_BY_KEY.has(k), k).toBe(true);
      for (const r of [s.redirectTo, ...s.sections.map((x) => x.redirectTo)]) if (r) expect(r.startsWith("/"), r).toBe(true);
    }
  });
});

describe("catálogo — cobertura de páginas", () => {
  const appDir = path.resolve(__dirname, "../../src/app");
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") pages.push(path.relative(path.resolve(__dirname, "../.."), full).split(path.sep).join("/"));
    }
  };
  walk(appDir);
  const toRoute = (file: string) =>
    "/" +
    file
      .replace(/^src\/app\//, "")
      .replace(/\/?page\.tsx$/, "")
      .split("/")
      .filter((s) => s && !/^\(.*\)$/.test(s))
      .join("/");

  it("toda page.tsx é rota de uma tela/seção do catálogo ou isenção justificada (90 páginas — etapa CP/CR 1: + /financeiro/cadastros)", () => {
    expect(pages.length).toBe(90);
    const exempt = new Set<string>(EXEMPTIONS.filter((e) => e.kind === "page").map((e) => e.target));
    const routes = new Set(SCREENS.flatMap((s) => [...s.routes, ...s.sections.flatMap((x) => x.routes ?? [])]));
    const missing = pages.filter((p) => !exempt.has(p) && !routes.has(toRoute(p)));
    expect(missing).toEqual([]);
  });

  it("toda rota do catálogo tem página", () => {
    const pageRoutes = new Set(pages.map(toRoute));
    for (const s of SCREENS) for (const r of [...s.routes, ...s.sections.flatMap((x) => x.routes ?? [])]) expect(pageRoutes.has(r), `${s.key} ${r}`).toBe(true);
  });

  it("toda página não isenta resolve para o nó do catálogo pela URL (canSeeHref)", () => {
    const exempt = new Set<string>(EXEMPTIONS.filter((e) => e.kind === "page").map((e) => e.target));
    for (const p of pages) {
      if (exempt.has(p)) continue;
      const route = toRoute(p);
      if (route.includes("[...")) continue; // catch-all não é tela
      const sample = route.replace(/\[[^\]]+\]/g, "x1");
      expect(screenForHref(sample), route).not.toBeNull();
    }
  });
});

describe("catálogo — abas (?aba=) controladas por seção", () => {
  it("cada `tab` existe na página da tela e as abas das telas com seções por aba estão todas modeladas", async () => {
    const { SETTINGS_TABS } = await import("@/components/admin/admin-model");
    const { CLIENT_TABS } = await import("@/components/clients/client-tabs");
    const { REGISTRY_TABS } = await import("@/components/finance-registry/registry-tabs");
    const { RECEIVABLES_SECTION_TABS } = await import("@/components/receivables/receivables-tabs");
    const pageTabs: Record<string, readonly string[]> = {
      "admin.configuracoes": SETTINGS_TABS,
      "financeiro.configuracoes": SETTINGS_TABS,
      "operacao.clientes": CLIENT_TABS.map((t) => t.key),
      "financeiro.cadastros": REGISTRY_TABS,
      // Etapa CP/CR 3: aba "Títulos avulsos" de Contas a Receber (a aba padrão é a própria tela).
      "financeiro.contas-a-receber": RECEIVABLES_SECTION_TABS,
    };
    const modeled = new Set<string>();
    for (const screen of SCREENS) {
      for (const section of screen.sections) {
        if (!section.tab) continue;
        expect(pageTabs[screen.key], `${section.key}: tela sem lista de abas conhecida`).toBeDefined();
        expect(pageTabs[screen.key], section.key).toContain(section.tab);
        modeled.add(`${pageTabs[screen.key] === SETTINGS_TABS ? "configuracoes" : screen.key}:${section.tab}`);
      }
    }
    // Toda aba das páginas acima tem seção (exceto a aba padrão "visao" do Cliente 360, que é a própria tela).
    for (const tab of SETTINGS_TABS) expect(modeled.has(`configuracoes:${tab}`), `aba ${tab} de /admin/configuracoes sem seção`).toBe(true);
    for (const { key } of CLIENT_TABS) if (key !== "visao") expect(modeled.has(`operacao.clientes:${key}`), `aba ${key} do Cliente 360 sem seção`).toBe(true);
    for (const tab of REGISTRY_TABS) expect(modeled.has(`financeiro.cadastros:${tab}`), `aba ${tab} de Cadastros financeiros sem seção`).toBe(true);
    for (const tab of RECEIVABLES_SECTION_TABS) expect(modeled.has(`financeiro.contas-a-receber:${tab}`), `aba ${tab} de Contas a Receber sem seção`).toBe(true);
  });
});
