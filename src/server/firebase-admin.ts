import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Inicialização do Firebase Admin.
 *
 * Credenciais, em ordem de prioridade:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON — conteúdo do JSON da service account (produção na Vercel).
 * 2. GOOGLE_APPLICATION_CREDENTIALS — caminho para o JSON (uso local).
 * 3. Sem credencial — só funciona com os emuladores (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST).
 */
function createApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "interos-crm";
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const serviceAccount = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
    return initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
      }),
      projectId: serviceAccount.project_id,
    });
  }
  // Sem service account: o cliente do Firestore recorre às Application Default Credentials e sonda o servidor
  // de metadata do GCE. Fora do GCP essa sonda falha (com proxy, responde 403) e o google-auth-library emite um
  // MetadataLookupWarning a cada processo — aparece como erro no console do Next dev. Com emuladores a
  // credencial é irrelevante ("Bearer owner"), então desligamos a detecção antes da primeira chamada.
  if (process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.METADATA_SERVER_DETECTION ??= "none";
  }
  return initializeApp({ projectId });
}

export const adminApp = createApp();
export const adminAuth = getAuth(adminApp);
export const firestore = getFirestore(adminApp);
// O Next pode avaliar este módulo mais de uma vez no mesmo processo (build/coleta de dados) enquanto a
// instância do Firestore é compartilhada; settings() só pode ser chamado uma vez, então ignoramos a repetição.
try {
  firestore.settings({ ignoreUndefinedProperties: true });
} catch {
  /* já configurado */
}
