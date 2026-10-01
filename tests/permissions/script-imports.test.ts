/**
 * Módulos de servidor usados FORA de requisição (seed, verify, varreduras forçadas, scripts de apoio dos e2e) rodam
 * com `tsx --conditions=react-server`; nessa condição `next/navigation` (cliente) quebra com "createContext is not a
 * function". As guardas de acesso trouxeram esse risco: `can`/erros importados de `session.ts`/`errors.ts` puxam
 * `next/navigation`. Este teste percorre o grafo de imports a partir dos pontos de entrada e exige que nenhum deles
 * alcance `next/navigation` (o import dinâmico de `@/server/auth/session` dentro de função é permitido: é lido só
 * dentro de requisição e protegido por try/catch).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const src = path.join(root, "src");

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listTs(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(src, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // pacote externo
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Imports de valor (estáticos e dinâmicos) de um arquivo; `import type`/`export type` não contam. */
function importsOf(file: string): { spec: string; dynamic: boolean }[] {
  const code = readFileSync(file, "utf8");
  const out: { spec: string; dynamic: boolean }[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) out.push({ spec: m[1], dynamic: false });
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1], dynamic: true });
  return out;
}

/** Caminho (cadeia de arquivos) até `next/navigation`, ou null. */
function pathToNextNavigation(entry: string): string[] | null {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    for (const { spec, dynamic } of importsOf(file)) {
      if (dynamic && spec === "@/server/auth/session") continue;
      if (spec === "next/navigation") {
        const chain = [file];
        for (let p = parent.get(file); p; p = parent.get(p)) chain.unshift(p);
        return chain.map((f) => path.relative(root, f));
      }
      const next = resolveImport(file, spec);
      if (next && !parent.has(next)) {
        parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return null;
}

/** Pontos de entrada: tudo de src/server que os scripts do repositório importam + módulos usados pelos scripts de apoio. */
function entries(): string[] {
  const fromScripts = new Set<string>();
  for (const file of listTs(path.join(root, "scripts"))) {
    for (const { spec } of importsOf(file)) {
      if (!/src\/server\/|^@\/server\//.test(spec)) continue;
      const resolved = resolveImport(file, spec);
      if (resolved) fromScripts.add(resolved);
    }
  }
  const support = ["automations/sweeps", "automations/scheduler", "reports/build", "finance/queries", "finance/service", "finance/amendments", "finance/billing", "finance/regua", "finance/alerts", "finance/webhook", "commissions/engine", "commissions/payables", "commissions/service", "sales/service", "workflow/service", "cs/service", "support/service", "marketing/service", "implementation/service", "tasks/service"];
  for (const m of support) {
    const resolved = resolveImport(path.join(src, "server", "x.ts"), `@/server/${m}`);
    if (resolved) fromScripts.add(resolved);
  }
  return [...fromScripts].sort();
}

describe("módulos usados fora de requisição não dependem de next/navigation", () => {
  const list = entries();
  it("há pontos de entrada (scripts + módulos dos scripts de apoio)", () => {
    expect(list.length).toBeGreaterThan(20);
  });
  for (const entry of list) {
    it(path.relative(root, entry), () => {
      expect(pathToNextNavigation(entry)).toBeNull();
    });
  }
});
