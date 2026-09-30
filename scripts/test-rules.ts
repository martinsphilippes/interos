/**
 * Teste das regras do Firestore (firestore.rules) contra o emulador — hardening A0.
 *
 * Uso: npm run test:rules   (emulador do Firestore em FIRESTORE_EMULATOR_HOST ou 127.0.0.1:8080)
 *
 * Usa um projectId de teste separado ("interos-rules-test"): as regras são enviadas ao emulador só para esse
 * projeto (initializeTestEnvironment usa a API do emulador) e os dados do teste são apagados ao fim. O projeto
 * da aplicação (interos-crm) e o firebase.json do emulador não são tocados.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, setLogLevel, updateDoc } from "firebase/firestore";

const PROJECT_ID = "interos-rules-test";
const [host, portText] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
const port = Number(portText);

interface CaseResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function runCase(results: CaseResult[], name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function main(): Promise<void> {
  // As negações esperadas geram avisos de PERMISSION_DENIED do SDK; o resultado de cada caso é impresso abaixo.
  setLogLevel("silent");
  const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
  let env: RulesTestEnvironment | undefined;
  try {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules, host, port } });
    await env.clearFirestore();

    // Estado inicial gravado sem regras (como o Admin SDK faria).
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/alice"), { name: "Alice", role: "vendas", active: true, organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" });
      await setDoc(doc(db, "users/bob"), { name: "Bob", role: "admin", active: true, organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" });
      await setDoc(doc(db, "permission_profiles/role_vendas"), { grants: {}, scopes: {}, organizationId: "intercert" });
    });

    const alice = env.authenticatedContext("alice").firestore();
    const mallory = env.authenticatedContext("mallory").firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const results: CaseResult[] = [];

    await runCase(results, "usuário autenticado lê o próprio users/{uid}", () => assertSucceeds(getDoc(doc(alice, "users/alice"))));
    await runCase(results, "usuário autenticado NÃO lê users/{outro}", () => assertFails(getDoc(doc(alice, "users/bob"))));
    await runCase(results, "visitante sem login NÃO lê users/{uid}", () => assertFails(getDoc(doc(anonymous, "users/alice"))));
    await runCase(results, "usuário autenticado NÃO atualiza o próprio users/{uid} (ex.: papel admin)", () =>
      assertFails(updateDoc(doc(alice, "users/alice"), { role: "admin" })),
    );
    await runCase(results, "usuário autenticado NÃO sobrescreve o próprio users/{uid} com set", () =>
      assertFails(setDoc(doc(alice, "users/alice"), { name: "Alice", role: "admin", active: true, createdAt: "2026-01-01T00:00:00.000Z" })),
    );
    await runCase(results, "conta do Auth sem documento NÃO cria o próprio users/{uid} (mesmo com createdAt)", () =>
      assertFails(setDoc(doc(mallory, "users/mallory"), { name: "Mallory", role: "admin", active: true, organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" })),
    );
    await runCase(results, "usuário autenticado NÃO exclui o próprio users/{uid}", () => assertFails(deleteDoc(doc(alice, "users/alice"))));
    await runCase(results, "usuário autenticado NÃO lê permission_profiles", () => assertFails(getDoc(doc(alice, "permission_profiles/role_vendas"))));
    await runCase(results, "usuário autenticado NÃO grava permission_profiles", () =>
      assertFails(setDoc(doc(alice, "permission_profiles/user_alice"), { grants: { "financeiro.acessar": true } })),
    );
    await runCase(results, "coleção sem regra explícita continua negada (negação padrão)", () => assertFails(getDoc(doc(alice, "settings/qualquer"))));

    for (const r of results) console.log(`${r.ok ? "OK  " : "FALHA"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nRegras do Firestore: ${results.length - failed}/${results.length} casos OK`);
    await env.clearFirestore();
    if (failed > 0) process.exitCode = 1;
  } finally {
    await env?.cleanup();
  }
}

main().catch((error) => {
  console.error("[test-rules] falha ao executar contra o emulador:", error);
  process.exit(1);
});
