/**
 * Verificador de cobertura de acesso (A15/A21) — análise estática com a API do compilador TypeScript.
 *
 * Confere, contra o catálogo (src/domain/permissions), que a proteção real existe no servidor:
 *  1. toda `src/app/**\/page.tsx` chama requireScreen/requireScreenAny com a tela dona da rota (ou é isenta);
 *  2. toda função exportada de arquivo "use server" tem dono no catálogo (actions[].guards, viewGuards de tela/seção,
 *     guards com qualificador — inclusive o mapa SETTING_PERMISSION de upsertSetting) ou isenção, e chama
 *     requirePermission (direto ou por helper local);
 *  3. todo handler de `src/app/api/**\/route.ts` chama requireApiPermission (ou é isento: token/assinatura/público);
 *  4. toda chave passada às funções de autorização existe no catálogo;
 *  5. toda rota de tela do catálogo tem página, e todo guard do catálogo aponta para uma função existente.
 *
 * Puro em relação ao runtime da aplicação: lê arquivos e o catálogo; não abre banco nem servidor.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { EXEMPTIONS, NODE_BY_KEY, SCREENS, SCREEN_BY_KEY, SETTING_PERMISSION, type ScreenDef } from "@/domain/permissions";

export type FindingKind =
  | "pagina-sem-guarda"
  | "pagina-sem-tela"
  | "pagina-tela-divergente"
  | "funcao-sem-dono"
  | "funcao-sem-guarda"
  | "funcao-chave-divergente"
  | "api-sem-guarda"
  | "chave-inexistente"
  | "tela-sem-pagina"
  | "guard-sem-funcao";

export interface Finding {
  kind: FindingKind;
  /** Arquivo (e função/método, quando houver) — `arquivo#nome`. */
  target: string;
  detail: string;
}

export interface AccessReport {
  findings: Finding[];
  totals: {
    pages: number;
    pagesExempt: number;
    serverFunctions: number;
    serverFunctionsExempt: number;
    apiHandlers: number;
    apiExempt: number;
    keyLiterals: number;
    dynamicKeys: number;
    /** futureGuards do catálogo cujas funções ainda não existem (informativo). */
    futurePending: string[];
  };
}

/** Rótulos das categorias (ordem de impressão). */
export const FINDING_LABELS: Record<FindingKind, string> = {
  "pagina-sem-guarda": "Páginas sem requireScreen/requireScreenAny",
  "pagina-sem-tela": "Páginas sem tela no catálogo (nem isenção)",
  "pagina-tela-divergente": "Páginas que exigem uma tela diferente da dona da rota",
  "funcao-sem-dono": 'Funções "use server" sem dono no catálogo (nem isenção)',
  "funcao-sem-guarda": 'Funções "use server" sem requirePermission',
  "funcao-chave-divergente": 'Funções "use server" que exigem chave fora do dono no catálogo',
  "api-sem-guarda": "Handlers de API sem requireApiPermission (nem isenção)",
  "chave-inexistente": "Chaves usadas no código que não existem no catálogo",
  "tela-sem-pagina": "Rotas de tela do catálogo sem página",
  "guard-sem-funcao": "Guards do catálogo que apontam para função inexistente",
};

const PAGE_GUARDS = new Set(["requireScreen", "requireScreenAny"]);
const ACTION_GUARDS = new Set(["requirePermission", "guardAction"]);
const API_GUARDS = new Set(["requireApiPermission"]);
/** Funções cujos argumentos string são chaves do catálogo (permissão, tela ou seção). */
const KEY_FUNCTIONS = new Set([
  "can",
  "canAny",
  "requirePermission",
  "guardAction",
  "requireScreen",
  "requireScreenAny",
  "requireApiPermission",
  "canSeeRecord",
  "resolveDataScope",
  "defaultScopeKind",
  "scopeDefOf",
  "permissionLabel",
  "nodeViewKey",
  "screenViewKey",
]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const KEY_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

function walk(dir: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full, accept);
    return accept(name) ? [full] : [];
  });
}

const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

/** Rota de uma page.tsx (grupos "(x)" não entram na URL). */
export function pageRoute(file: string): string {
  return (
    "/" +
    file
      .replace(/^src\/app\//, "")
      .replace(/\/?page\.tsx$/, "")
      .split("/")
      .filter((s) => s && !/^\(.*\)$/.test(s))
      .join("/")
  );
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function hasUseServer(sf: ts.SourceFile): boolean {
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) return false;
    if (st.expression.text === "use server") return true;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Nome da função chamada (`f(...)`, `obj.f(...)`). */
function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Declarações de nível superior de funções (declaração ou const = arrow/function), exportadas ou não. */
function topLevelFunctions(sf: ts.SourceFile): Map<string, { node: ts.Node; exported: boolean }> {
  const out = new Map<string, { node: ts.Node; exported: boolean }>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) out.set(st.name.text, { node: st, exported: isExported(st) });
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = d.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isCallExpression(init)) out.set(d.name.text, { node: d, exported: isExported(st) });
      }
    }
  }
  // `export { a, b as c }`
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const el of st.exportClause.elements) {
      const local = (el.propertyName ?? el.name).text;
      const found = out.get(local);
      if (found) out.set(el.name.text, { ...found, exported: true });
    }
  }
  return out;
}

/** Nomes das funções chamadas dentro de um nó (qualquer profundidade). */
function calledNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name) names.add(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** A função (ou um helper local chamado por ela, transitivamente) chama um dos guardas? */
function reachesGuard(name: string, fns: Map<string, { node: ts.Node }>, guards: Set<string>, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const fn = fns.get(name);
  if (!fn) return false;
  for (const called of calledNames(fn.node)) {
    if (guards.has(called)) return true;
    if (fns.has(called) && reachesGuard(called, fns, guards, seen)) return true;
  }
  return false;
}

/** Literais string (inclusive em arrays) passados a chamadas de `names` dentro do nó. */
function keyLiterals(node: ts.Node, names: Set<string>): { literals: { value: string; call: string; line: number }[]; dynamic: number } {
  const literals: { value: string; call: string; line: number }[] = [];
  let dynamic = 0;
  const sf = node.getSourceFile();
  const collect = (arg: ts.Expression, call: string) => {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      literals.push({ value: arg.text, call, line: sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1 });
    } else if (ts.isArrayLiteralExpression(arg)) {
      for (const el of arg.elements) collect(el as ts.Expression, call);
    } else if (ts.isAsExpression(arg) || ts.isSatisfiesExpression(arg) || ts.isParenthesizedExpression(arg)) {
      collect(arg.expression, call);
    } else if (ts.isTemplateExpression(arg)) {
      dynamic += 1;
    }
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name && names.has(name)) for (const a of n.arguments) collect(a, name);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return { literals, dynamic };
}

/** Chave válida para as funções de autorização: permissão, tela ou seção do catálogo. */
function isCatalogKey(value: string): boolean {
  return NODE_BY_KEY.has(value) || SCREEN_BY_KEY.has(value);
}

interface Owner {
  keys: Set<string>;
  extra: Set<string>;
}

/** Dono de cada função/handler no catálogo: `arquivo#função` → chaves (guards e viewGuards) e chaves adicionais (checkedIn). */
function catalogOwners(): { owners: Map<string, Owner>; guardRefs: { target: string; key: string }[]; future: { target: string; key: string }[] } {
  const owners = new Map<string, Owner>();
  const guardRefs: { target: string; key: string }[] = [];
  /** Funções previstas (futureGuards): passam a dono quando existirem; até lá só aparecem no resumo. */
  const future: { target: string; key: string }[] = [];
  const own = (guard: string, key: string, extra = false) => {
    const target = guard.split("?")[0];
    let o = owners.get(target);
    if (!o) owners.set(target, (o = { keys: new Set(), extra: new Set() }));
    (extra ? o.extra : o.keys).add(key);
    if (!extra) guardRefs.push({ target, key });
  };
  for (const s of SCREENS as readonly ScreenDef[]) {
    for (const v of s.viewGuards ?? []) own(v.guard, `${s.key}.ver`);
    for (const x of s.sections) for (const v of x.viewGuards ?? []) own(v.guard, x.key);
    for (const a of s.actions) {
      for (const g of a.guards) own(g, a.key);
      for (const g of a.futureGuards ?? []) future.push({ target: g.split("?")[0], key: a.key });
    }
  }
  // checkedIn: chave exigida ALÉM do dono quando uma condição ocorre (não é dono, mas é chave legítima na função).
  for (const s of SCREENS as readonly ScreenDef[]) for (const a of s.actions) for (const g of a.checkedIn ?? []) own(g, a.key, true);
  // upsertSetting despacha pela SettingKey (A21): todas as chaves do mapa são legítimas nela.
  for (const key of Object.values(SETTING_PERMISSION)) own("src/server/admin/actions.ts#upsertSetting", key, true);
  return { owners, guardRefs, future };
}

/** Nós (tela/seção) donos de uma rota de página, e as telas aceitas por página compartilhada. */
function pageOwners(route: string): { nodes: Set<string>; accepted: Set<string> } {
  const nodes = new Set<string>();
  const accepted = new Set<string>();
  for (const s of SCREENS as readonly ScreenDef[]) {
    if (s.routes.includes(route)) {
      nodes.add(s.key);
      accepted.add(s.key);
      for (const k of s.requireScreenAny ?? []) accepted.add(k);
    }
    for (const x of s.sections) {
      if (!x.routes?.includes(route)) continue;
      nodes.add(x.key);
      accepted.add(x.key);
    }
  }
  return { nodes, accepted };
}

export function analyzeAccess(root: string): AccessReport {
  const findings: Finding[] = [];
  const add = (kind: FindingKind, target: string, detail: string) => findings.push({ kind, target, detail });
  const exempt = new Map<string, string>(EXEMPTIONS.map((e) => [e.target, e.kind]));
  const { owners, guardRefs, future } = catalogOwners();
  const src = path.join(root, "src");
  const files = walk(src, (n) => /\.tsx?$/.test(n) && !n.endsWith(".d.ts")).map((f) => ({ abs: f, rel: rel(root, f) }));
  const totals: AccessReport["totals"] = { pages: 0, pagesExempt: 0, serverFunctions: 0, serverFunctionsExempt: 0, apiHandlers: 0, apiExempt: 0, keyLiterals: 0, dynamicKeys: 0, futurePending: [] };

  /** Funções existentes por arquivo (para conferir os guards do catálogo). */
  const existing = new Set<string>();

  for (const file of files) {
    const sf = parse(file.abs);
    const fns = topLevelFunctions(sf);
    for (const [name] of fns) existing.add(`${file.rel}#${name}`);

    // (4) chaves usadas no código — o catálogo em si não entra (é a fonte).
    if (!file.rel.startsWith("src/domain/permissions/")) {
      const { literals, dynamic } = keyLiterals(sf, KEY_FUNCTIONS);
      totals.dynamicKeys += dynamic;
      for (const lit of literals) {
        if (!KEY_SHAPE.test(lit.value)) continue;
        totals.keyLiterals += 1;
        if (!isCatalogKey(lit.value)) add("chave-inexistente", `${file.rel}:${lit.line}`, `${lit.call}("${lit.value}")`);
      }
    }

    // (1) páginas
    if (/^src\/app\/(.*\/)?page\.tsx$/.test(file.rel)) {
      totals.pages += 1;
      if (exempt.get(file.rel) === "page") {
        totals.pagesExempt += 1;
        continue;
      }
      const route = pageRoute(file.rel);
      const { nodes, accepted } = pageOwners(route);
      if (!nodes.size) add("pagina-sem-tela", file.rel, `rota ${route}`);
      const called = calledNames(sf);
      const guarded = [...PAGE_GUARDS].some((g) => called.has(g));
      const expected = [...nodes].join(" | ") || "(sem tela)";
      if (!guarded) {
        add("pagina-sem-guarda", file.rel, `rota ${route} → requireScreen("${expected}")`);
        continue;
      }
      const used = keyLiterals(sf, PAGE_GUARDS).literals.map((l) => l.value);
      const wrong = used.filter((k) => !accepted.has(k));
      if (nodes.size && wrong.length) add("pagina-tela-divergente", file.rel, `exige ${wrong.join(", ")}; dona da rota: ${expected}`);
      continue;
    }

    // (3) rotas de API
    if (/^src\/app\/api\/.*route\.ts$/.test(file.rel)) {
      for (const [name, fn] of fns) {
        if (!fn.exported || !HTTP_METHODS.has(name)) continue;
        totals.apiHandlers += 1;
        const target = `${file.rel}#${name}`;
        if (exempt.get(target) === "api") {
          totals.apiExempt += 1;
          continue;
        }
        if (!reachesGuard(name, fns, API_GUARDS)) {
          const owner = owners.get(target);
          add("api-sem-guarda", target, owner ? `→ requireApiPermission("${[...owner.keys].join(" | ")}")` : "sem dono no catálogo nem isenção");
        }
      }
      continue;
    }

    // (2) funções "use server"
    if (!hasUseServer(sf)) continue;
    for (const [name, fn] of fns) {
      if (!fn.exported) continue;
      totals.serverFunctions += 1;
      const target = `${file.rel}#${name}`;
      if (exempt.get(target) === "action") {
        totals.serverFunctionsExempt += 1;
        continue;
      }
      const owner = owners.get(target);
      if (!owner || !owner.keys.size) {
        const planned = future.find((f) => f.target === target);
        add("funcao-sem-dono", target, planned ? `prevista em futureGuards de ${planned.key}: mova para guards` : "sem guard/viewGuard no catálogo nem isenção");
        continue;
      }
      const expectedKeys = [...owner.keys];
      if (!reachesGuard(name, fns, ACTION_GUARDS)) {
        add("funcao-sem-guarda", target, `→ requirePermission("${expectedKeys.join(" | ")}")`);
        continue;
      }
      const used = keyLiterals(fn.node, ACTION_GUARDS).literals.map((l) => l.value);
      const allowed = new Set([...owner.keys, ...owner.extra]);
      const wrong = used.filter((k) => !allowed.has(k));
      if (wrong.length) add("funcao-chave-divergente", target, `exige ${wrong.join(", ")}; dono no catálogo: ${expectedKeys.join(" | ")}`);
    }
  }

  // futureGuards ainda não criados (informativo; quando a função existir e não estiver em `guards`, o laço acima a
  // acusa como função sem dono).
  totals.futurePending = future.filter((f) => !existing.has(f.target)).map((f) => `${f.target} (${f.key})`);

  // (5a) guards do catálogo apontando para funções que não existem
  const reported = new Set<string>();
  for (const ref of guardRefs) {
    if (existing.has(ref.target) || reported.has(ref.target)) continue;
    reported.add(ref.target);
    add("guard-sem-funcao", ref.target, `guard de ${ref.key}`);
  }

  // (5b) rotas de telas do catálogo sem página
  const pageRoutes = new Set(files.filter((f) => /^src\/app\/(.*\/)?page\.tsx$/.test(f.rel)).map((f) => pageRoute(f.rel)));
  for (const s of SCREENS as readonly ScreenDef[]) {
    for (const r of [...s.routes, ...s.sections.flatMap((x) => x.routes ?? [])]) if (!pageRoutes.has(r)) add("tela-sem-pagina", s.key, `rota ${r}`);
    // "(layout)" = o shell autenticado (src/app/(app)/layout.tsx), que abriga a barra superior e a navegação.
    for (const host of s.hostRoutes ?? []) {
      const ok = host === "(layout)" ? existsSync(path.join(root, "src/app/(app)/layout.tsx")) : pageRoutes.has(host);
      if (!ok) add("tela-sem-pagina", s.key, `página hospedeira ${host}`);
    }
  }

  findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target));
  return { findings, totals };
}

/** Relatório em texto (uma seção por categoria, com contagem). */
export function formatReport(report: AccessReport): string {
  const lines: string[] = [];
  const { totals } = report;
  const by = (k: FindingKind) => report.findings.filter((f) => f.kind === k);
  lines.push("Verificador de cobertura de acesso (npm run check:access)");
  lines.push("");
  lines.push(`Páginas: ${totals.pages} (${totals.pagesExempt} isentas) · funções "use server": ${totals.serverFunctions} (${totals.serverFunctionsExempt} isentas) · handlers de API: ${totals.apiHandlers} (${totals.apiExempt} isentos)`);
  lines.push(`Chaves literais conferidas: ${totals.keyLiterals} · chaves montadas dinamicamente (template): ${totals.dynamicKeys}`);
  if (totals.futurePending.length) lines.push(`Funções previstas no catálogo (futureGuards) ainda não criadas: ${totals.futurePending.join(", ")}`);
  lines.push("");
  lines.push("Resumo:");
  for (const kind of Object.keys(FINDING_LABELS) as FindingKind[]) lines.push(`  ${String(by(kind).length).padStart(4)}  ${FINDING_LABELS[kind]}`);
  lines.push(`  ${String(report.findings.length).padStart(4)}  TOTAL`);
  for (const kind of Object.keys(FINDING_LABELS) as FindingKind[]) {
    const list = by(kind);
    if (!list.length) continue;
    lines.push("");
    lines.push(`## ${FINDING_LABELS[kind]} (${list.length})`);
    for (const f of list) lines.push(`- ${f.target} — ${f.detail}`);
  }
  return lines.join("\n");
}
