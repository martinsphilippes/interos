/**
 * DATABASE_URL copiada do painel do Supabase: parâmetros de outros clientes (ex.: ?pgbouncer=true do Prisma) não podem
 * chegar ao Postgres como parâmetro de sessão.
 */
import { describe, expect, it } from "vitest";
import { databaseRole, sanitizeDatabaseUrl } from "@/server/docdb";

const BASE = "postgresql://interos_app.ref:s3nh%40@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

describe("DATABASE_URL", () => {
  it("remove pgbouncer e demais parâmetros de outros clientes, preservando os do Postgres", () => {
    expect(sanitizeDatabaseUrl(`${BASE}?pgbouncer=true`)).toBe(BASE);
    expect(sanitizeDatabaseUrl(`${BASE}?pgbouncer=true&connection_limit=1&sslmode=require`)).toBe(`${BASE}?sslmode=require`);
  });

  it("URL sem query string ou inválida volta como veio", () => {
    expect(sanitizeDatabaseUrl(BASE)).toBe(BASE);
    expect(sanitizeDatabaseUrl("não é url")).toBe("não é url");
  });

  it("identifica o papel do pooler (papel.ref)", () => {
    expect(databaseRole(BASE)).toBe("interos_app");
    expect(databaseRole(BASE.replace("interos_app.ref", "postgres.ref"))).toBe("postgres");
    expect(databaseRole("postgres://interos_app:local@127.0.0.1:5432/interos")).toBe("interos_app");
  });
});
