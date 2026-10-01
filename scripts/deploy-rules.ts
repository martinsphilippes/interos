/**
 * Publica firestore.rules pela API Firebase Rules (firebaserules.googleapis.com).
 *
 * Por que existe: o `firebase deploy` consulta antes a API Service Usage
 * (serviceusage.services.get), e a service account padrão do Admin SDK não tem esse papel — o deploy
 * falha com 403 antes de publicar. A API Firebase Rules não depende dessa consulta e é coberta pelo papel
 * da service account do Firebase.
 *
 * Uso: GOOGLE_APPLICATION_CREDENTIALS=<sa.json> npx tsx scripts/deploy-rules.ts [projeto]
 * Cria um ruleset com o conteúdo atual de firestore.rules e aponta a release "cloud.firestore" para ele.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";

const API = "https://firebaserules.googleapis.com/v1";

async function main() {
  const project = process.argv[2] ?? "interos-crm";
  const content = readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"] });
  const client = await auth.getClient();

  const created = await client.request<{ name: string }>({
    url: `${API}/projects/${project}/rulesets`,
    method: "POST",
    data: { source: { files: [{ name: "firestore.rules", content }] } },
  });
  const rulesetName = created.data.name;
  console.log(`Ruleset criado: ${rulesetName}`);

  const releaseName = `projects/${project}/releases/cloud.firestore`;
  try {
    await client.request({ url: `${API}/${releaseName}`, method: "PATCH", data: { release: { name: releaseName, rulesetName } } });
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status !== 404) throw error;
    await client.request({ url: `${API}/projects/${project}/releases`, method: "POST", data: { name: releaseName, rulesetName } });
  }

  const release = await client.request<{ rulesetName: string; updateTime: string }>({ url: `${API}/${releaseName}` });
  if (release.data.rulesetName !== rulesetName) throw new Error(`A release aponta para ${release.data.rulesetName}, esperado ${rulesetName}`);
  console.log(`Regras do Firestore publicadas em ${project} (${release.data.updateTime}).`);
}

main().catch((error) => {
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  console.error("Falha ao publicar as regras:", response ? `${response.status} ${JSON.stringify(response.data)}` : error);
  process.exit(1);
});
