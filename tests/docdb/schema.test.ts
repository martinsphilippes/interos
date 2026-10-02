/**
 * Toda coleção do domínio (COLLECTIONS) tem tabela criada por uma migration (interos.create_doc_table) — substitui a
 * antiga exigência de regra explícita em firestore.rules. Sem tabela, a primeira gravação falharia em produção.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/domain/types";

const DIR = join(__dirname, "../../supabase/migrations");
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .join("\n");

/** Nomes passados a create_doc_table: no array do bloco inicial ou em chamadas avulsas create_doc_table('x'). */
function migratedCollections(): Set<string> {
  const names = new Set<string>();
  const block = /foreach c in array array\[([\s\S]*?)\]/g;
  for (const m of sql.matchAll(block)) for (const n of m[1].matchAll(/'([a-z0-9_]+)'/g)) names.add(n[1]);
  for (const m of sql.matchAll(/create_doc_table\('([a-z0-9_]+)'\)/g)) names.add(m[1]);
  return names;
}

describe("schema do banco", () => {
  it("toda coleção de COLLECTIONS tem tabela nas migrations", () => {
    const migrated = migratedCollections();
    const missing = Object.values(COLLECTIONS).filter((c) => !migrated.has(c));
    expect(missing, `Crie uma migration com select interos.create_doc_table('<nome>') para: ${missing.join(", ")}`).toEqual([]);
  });

  it("migrations não expõem o schema interos a anon/authenticated", () => {
    expect(sql).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });
});
