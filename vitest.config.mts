import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes unitários (puros) — `npm test`. Os e2e ficam fora (scripts próprios com Playwright).
export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./src/", import.meta.url)),
      // "server-only" lança fora do servidor do Next; nos testes os módulos de servidor são exercitados isolados.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
