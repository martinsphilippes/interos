import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes de integração do banco (`npm run test:db`): exigem DATABASE_URL de um Postgres com as migrations de
// supabase/migrations aplicadas (ver scripts/db-local.sh). Rodam em série: compartilham as mesmas tabelas.
export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./src/", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.dbtest.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
