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
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, setLogLevel, updateDoc } from "firebase/firestore";

const PROJECT_ID = "interos-rules-test";
/** Id de um link do portal: sha256 do token em hex (64 caracteres). */
const PORTAL_LINK_ID = "a".repeat(64);
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
      await setDoc(doc(db, "financial_accounts/fa_1"), { name: "Conta corrente", type: "corrente", initialBalance: 1000, currency: "BRL", archived: false, organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" });
      await setDoc(doc(db, "cost_centers/cc_1"), { name: "Comercial", archived: false, organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" });
      await setDoc(doc(db, "finance_categories/fc_1"), { name: "Aluguel", type: "despesa", parentId: null, costCenterId: "cc_1", archived: false, organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" });
      await setDoc(doc(db, `portal_links/${PORTAL_LINK_ID}`), { clientId: "client_001", origin: "manual", expiresAt: "2099-01-01T00:00:00.000Z", accessCount: 0, createdBy: "bob", organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z" });
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
    // Portal do Cliente (D31): nem o visitante sem login (o portal é público) nem um usuário do sistema leem, listam,
    // criam, renovam ou revogam links pelo SDK cliente — tudo passa pelo servidor.
    await runCase(results, "visitante sem login NÃO lê portal_links/{hash}", () => assertFails(getDoc(doc(anonymous, `portal_links/${PORTAL_LINK_ID}`))));
    await runCase(results, "visitante sem login NÃO lista portal_links", () => assertFails(getDocs(collection(anonymous, "portal_links"))));
    await runCase(results, "usuário autenticado NÃO lê portal_links/{hash}", () => assertFails(getDoc(doc(alice, `portal_links/${PORTAL_LINK_ID}`))));
    await runCase(results, "usuário autenticado NÃO cria portal_links", () =>
      assertFails(setDoc(doc(alice, `portal_links/${"b".repeat(64)}`), { clientId: "client_001", origin: "manual", expiresAt: "2099-01-01T00:00:00.000Z", accessCount: 0, organizationId: "intercert" })),
    );
    await runCase(results, "visitante sem login NÃO estende a validade nem conta acessos (update)", () =>
      assertFails(updateDoc(doc(anonymous, `portal_links/${PORTAL_LINK_ID}`), { expiresAt: "2199-01-01T00:00:00.000Z", accessCount: 99 })),
    );
    await runCase(results, "usuário autenticado NÃO revoga nem apaga portal_links", () => assertFails(deleteDoc(doc(alice, `portal_links/${PORTAL_LINK_ID}`))));
    // Cadastros financeiros (etapa CP/CR 1): saldo inicial e classificação só pelo servidor (Admin SDK).
    for (const [path, sample] of [
      ["financial_accounts/fa_1", { name: "Conta X", type: "corrente", initialBalance: 999999, currency: "BRL", archived: false, organizationId: "intercert" }],
      ["cost_centers/cc_1", { name: "Centro X", archived: false, organizationId: "intercert" }],
      ["finance_categories/fc_1", { name: "Categoria X", type: "despesa", parentId: null, costCenterId: "cc_1", archived: false, organizationId: "intercert" }],
    ] as const) {
      const collectionName = path.split("/")[0];
      await runCase(results, `usuário autenticado NÃO lê ${path}`, () => assertFails(getDoc(doc(alice, path))));
      await runCase(results, `visitante sem login NÃO lista ${collectionName}`, () => assertFails(getDocs(collection(anonymous, collectionName))));
      await runCase(results, `usuário autenticado NÃO lista ${collectionName}`, () => assertFails(getDocs(collection(alice, collectionName))));
      await runCase(results, `usuário autenticado NÃO cria em ${collectionName}`, () => assertFails(setDoc(doc(alice, `${collectionName}/novo`), sample)));
      await runCase(results, `usuário autenticado NÃO altera ${path}`, () => assertFails(updateDoc(doc(alice, path), { archived: true })));
      await runCase(results, `usuário autenticado NÃO apaga ${path}`, () => assertFails(deleteDoc(doc(alice, path))));
    }
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
