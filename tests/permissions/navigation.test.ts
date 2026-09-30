/**
 * Navegação derivada do catálogo (A11, fase F3).
 *
 * T0 de navegação: as tabelas NAVIGATION/MOBILE_NAV/QUICK_ACTIONS derivadas de SCREENS são IGUAIS às listas escritas
 * à mão antes (cópia congelada em legacy-navigation.ts) e, para cada usuário, o menu, a barra do celular, os atalhos
 * "+" e os links fixos do shell ficam como antes — salvo as correções deliberadas A14/A27, listadas por usuário.
 * Depois: o mapa de rotas entregue ao cliente (hrefAccessMap) decide igual a canSeeHref, e perfil/módulo desativado
 * mudam o menu (T9/T10 no nível puro).
 */
import { describe, expect, it } from "vitest";
import { HELP_LINKS, MOBILE_NAV, NAVIGATION, QUICK_ACTIONS, SEARCH_CREATE_LINKS, SEARCH_SHORTCUTS, USER_MENU_LINKS } from "@/domain/constants";
import { MODULE_KEYS, SCREENS, canSeeHrefIn, type ModuleKey } from "@/domain/permissions";
import { canSeeHref } from "@/server/auth/permissions";
import { filterMobileNav, filterNavigation, filterQuickActions, filterShellLinks, hrefAccessMap, visibleScreens } from "@/server/auth/navigation";
import { ALL_USERS, SEED_USERS, asCurrentUser, label } from "./fixtures";
import { legacyMenu, legacyMobileNav, legacyQuickActions, legacyUser } from "./legacy";
import { LEGACY_MOBILE_NAV, LEGACY_NAVIGATION, LEGACY_QUICK_ACTIONS } from "./legacy-navigation";

const USERS = ALL_USERS.map((u) => ({ fixture: u, current: asCurrentUser(u), legacy: legacyUser(u) }));

describe("T0 — tabelas de navegação derivadas ≡ listas anteriores (congeladas)", () => {
  it("NAVIGATION: mesmas seções, itens, rótulos, ícones, ordem e onda", () => {
    const strip = (sections: { key: string; label: string; items: { label: string; href: string; icon: string; wave?: number }[] }[]) =>
      sections.map((s) => ({ key: s.key, label: s.label, items: s.items.map((i) => ({ label: i.label, href: i.href, icon: i.icon, wave: i.wave })) }));
    expect(strip(NAVIGATION)).toEqual(strip(LEGACY_NAVIGATION));
  });

  it("MOBILE_NAV: mesmos itens, rótulos e ícones na mesma ordem", () => {
    expect(MOBILE_NAV.map((i) => [i.label, i.href, i.icon])).toEqual(LEGACY_MOBILE_NAV.map((i) => [i.label, i.href, i.icon]));
  });

  it("QUICK_ACTIONS: mesmos atalhos, módulo e papéis", () => {
    const strip = (list: { key: string; label: string; description: string; href: string; icon: string; module: string; roles?: readonly string[] }[]) =>
      list.map((q) => ({ key: q.key, label: q.label, description: q.description, href: q.href, icon: q.icon, module: q.module, roles: q.roles ? [...q.roles].sort() : undefined }));
    expect(strip(QUICK_ACTIONS)).toEqual(strip(LEGACY_QUICK_ACTIONS));
  });

  it("todo item derivado aponta para a tela do catálogo dona do href", () => {
    for (const item of [...NAVIGATION.flatMap((s) => s.items), ...MOBILE_NAV]) {
      const screen = SCREENS.find((s) => s.key === item.screen);
      expect(screen?.nav?.href, item.href).toBe(item.href);
    }
    for (const q of QUICK_ACTIONS) expect(SCREENS.find((s) => s.key === q.screen)?.nav?.quickAction?.key, q.key).toBe(q.key);
  });
});

describe("T0 — navegação por usuário ≡ antes, exceto A14/A27", () => {
  it("menu (filterNavigation: layout, /menu e drawer) — diferenças só as correções nominais", () => {
    const diff: string[] = [];
    const exp: string[] = [];
    for (const { fixture, current, legacy: old } of USERS) {
      const before = new Set(legacyMenu(old).flatMap((s) => s.hrefs));
      const now = new Set(filterNavigation(current).flatMap((s) => s.items.map((i) => i.href)));
      for (const href of new Set([...before, ...now])) if (before.has(href) !== now.has(href)) diff.push(`${label(fixture)} ${href} ${now.has(href) ? "+" : "-"}`);
      if (fixture.role === "gestor" || fixture.role === "diretoria") exp.push(`${label(fixture)} /admin/departamentos +`, `${label(fixture)} /admin/usuarios +`);
      if (fixture.role === "gestor") exp.push(`${label(fixture)} /gestao/cockpit -`);
      if (fixture.role === "vendas" && fixture.departmentId === "financeiro") exp.push(`${label(fixture)} /financeiro/contas-a-pagar +`);
    }
    expect(diff.sort()).toEqual(exp.sort());
  });

  it("usuários do seed: diferenças nominais por pessoa (relatório da fase)", () => {
    const perUser: Record<string, string> = {};
    for (const u of SEED_USERS) {
      const before = new Set(legacyMenu(legacyUser(u)).flatMap((s) => s.hrefs));
      const now = new Set(filterNavigation(asCurrentUser(u)).flatMap((s) => s.items.map((i) => i.href)));
      const plus = [...now].filter((h) => !before.has(h)).sort();
      const minus = [...before].filter((h) => !now.has(h)).sort();
      if (plus.length || minus.length) perUser[u.name] = [...plus.map((h) => `+${h}`), ...minus.map((h) => `-${h}`)].join(" ");
    }
    // Os 5 gestores: ganham Administração › Usuários e Departamentos (já abriam por URL) e deixam de ver o Cockpit
    // (a rota exige diretoria). Admins, vendedores, financeiro, implantação, CS, suporte e marketing: menu idêntico.
    const gestor = "+/admin/departamentos +/admin/usuarios -/gestao/cockpit";
    expect(perUser).toEqual({
      "Mateus Carvalho": gestor,
      "Igor Sampaio": gestor,
      "Karem Feitosa": gestor,
      "Lando Tavares": gestor,
      "Felipe Araújo": gestor,
    });
  });

  it("barra do celular (filterMobileNav) e atalhos '+' (filterQuickActions) idênticos para todos", () => {
    for (const { fixture, current, legacy: old } of USERS) {
      expect(filterMobileNav(current).map((i) => i.href), label(fixture)).toEqual(legacyMobileNav());
      expect(filterQuickActions(current).map((q) => q.key), label(fixture)).toEqual(legacyQuickActions(old));
    }
  });

  it("links fixos do shell (busca, criação, ajuda, menu do usuário) idênticos para todos (antes: sem filtro)", () => {
    for (const { fixture, current } of USERS) {
      for (const list of [SEARCH_SHORTCUTS, SEARCH_CREATE_LINKS, HELP_LINKS, USER_MENU_LINKS]) {
        expect(filterShellLinks(current, list).map((l) => l.href), label(fixture)).toEqual(list.map((l) => l.href));
      }
    }
  });
});

/** Hrefs de amostra: todas as rotas do catálogo, itens de menu, abas por seção, e casos inválidos. */
function sampleHrefs(): string[] {
  const hrefs = new Set<string>(["/", "/nao-existe", "/vendas/%", "https://externo.com/x", "/clientes/novo", "/admin/configuracoes?aba=nao-existe", "/tarefas?view=equipe#x"]);
  for (const s of SCREENS) {
    for (const r of [...s.routes, ...s.sections.flatMap((x) => x.routes ?? [])]) hrefs.add(r.replace(/\[[^\]]+\]/g, "x1"));
    if (s.nav?.href) hrefs.add(s.nav.href);
    for (const x of s.sections) {
      if (!x.tab) continue;
      const base = (s.routes[0] ?? s.nav?.href?.split("?")[0] ?? "/").replace(/\[[^\]]+\]/g, "x1");
      hrefs.add(`${base}?aba=${x.tab}`);
    }
  }
  return [...hrefs];
}

describe("mapa de rotas do cliente (hrefAccessMap) ≡ canSeeHref do servidor", () => {
  const hrefs = sampleHrefs();

  it("mesmo resultado para todos os usuários e hrefs de amostra (matriz padrão)", () => {
    for (const { fixture, current } of USERS) {
      const map = hrefAccessMap(current);
      for (const href of hrefs) expect(canSeeHrefIn(map, href), `${label(fixture)} ${href}`).toBe(canSeeHref(current, href));
    }
  });

  it("mesmo resultado com perfil, exceção e módulos desativados", () => {
    const vinicius = SEED_USERS.find((u) => u.id === "user_vinicius")!;
    const karem = SEED_USERS.find((u) => u.id === "user_karem")!;
    const cases = [
      asCurrentUser(vinicius, { roleProfile: { grants: { "vendas.pipeline.ver": false, "financeiro.comissoes.todas.ver": true } } }),
      asCurrentUser(karem, { userOverride: { grants: { "financeiro.configuracoes.ver": true, "financeiro.configuracoes.gate.ver": true } } }),
      asCurrentUser(karem, { organization: { activeModules: ["inicio", "admin", "vendas"] } }),
    ];
    for (const current of cases) {
      const map = hrefAccessMap(current);
      for (const href of hrefs) expect(canSeeHrefIn(map, href), `${current.id} ${href}`).toBe(canSeeHref(current, href));
    }
  });

  it("é serializável (vai do Server Component ao Client Component) e não carrega chaves de permissão", () => {
    const map = hrefAccessMap(asCurrentUser(SEED_USERS[0]));
    const json = JSON.stringify(map);
    expect(JSON.parse(json)).toEqual(map);
    expect(json).not.toMatch(/\.acessar|\.ver"/);
  });
});

describe("T9/T10 (nível puro): perfil e módulo desativado mudam a navegação", () => {
  const vinicius = SEED_USERS.find((u) => u.id === "user_vinicius")!;

  it("T9: negar uma tela no perfil tira o item do menu e o link do mapa; conceder devolve", () => {
    const base = asCurrentUser(vinicius);
    const denied = asCurrentUser(vinicius, { roleProfile: { grants: { "vendas.pipeline.ver": false } } });
    const hrefsOf = (u: typeof base) => filterNavigation(u).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefsOf(base)).toContain("/vendas/pipeline");
    expect(hrefsOf(denied)).not.toContain("/vendas/pipeline");
    expect(canSeeHrefIn(hrefAccessMap(denied), "/vendas/pipeline")).toBe(false);
    expect(visibleScreens(denied).has("vendas.pipeline")).toBe(false);
    // Exceção individual concedendo de volta vence o perfil.
    const granted = asCurrentUser(vinicius, { roleProfile: { grants: { "vendas.pipeline.ver": false } }, userOverride: { grants: { "vendas.pipeline.ver": true } } });
    expect(hrefsOf(granted)).toContain("/vendas/pipeline");
  });

  it("T10: módulo desativado some do menu, da barra do celular, dos atalhos '+' e dos links fixos", () => {
    const admin = SEED_USERS.find((u) => u.id === "user_hercules")!;
    for (const off of MODULE_KEYS.filter((m) => m !== "inicio" && m !== "admin")) {
      const active = MODULE_KEYS.filter((m) => m !== off) as ModuleKey[];
      const current = asCurrentUser(admin, { organization: { activeModules: active } });
      expect(filterNavigation(current).map((s) => s.key), off).not.toContain(off);
      const screensOff = SCREENS.filter((s) => s.module === off && !s.moduleGate);
      for (const s of screensOff) if (s.nav?.href) expect(canSeeHref(current, s.nav.href), `${off} ${s.nav.href}`).toBe(false);
      for (const q of filterQuickActions(current)) expect(q.module, `${off} ${q.key}`).not.toBe(off);
    }
    const noOperacao = asCurrentUser(admin, { organization: { activeModules: MODULE_KEYS.filter((m) => m !== "operacao") } });
    expect(filterMobileNav(noOperacao).map((i) => i.href)).toEqual(["/meu-dia", "/menu"]);
    expect(filterShellLinks(noOperacao, SEARCH_SHORTCUTS).map((l) => l.href)).toEqual(["/meu-dia", "/notificacoes", "/performance"]);
    expect(filterShellLinks(noOperacao, SEARCH_CREATE_LINKS)).toEqual([]);
  });

  it("Início e Administração não são desativáveis (o menu sempre tem Meu Dia)", () => {
    const current = asCurrentUser(vinicius, { organization: { activeModules: [] } });
    expect(filterNavigation(current).map((s) => s.key)).toEqual(["inicio"]);
    expect(filterMobileNav(current).map((i) => i.href)).toEqual(["/meu-dia", "/menu"]);
  });
});
