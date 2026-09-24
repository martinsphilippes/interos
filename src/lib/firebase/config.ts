/**
 * Leitura e validação da configuração pública do Firebase.
 *
 * As variáveis NEXT_PUBLIC_* são substituídas em tempo de build pelo Next.js,
 * por isso cada uma precisa ser referenciada literalmente (sem acesso dinâmico
 * a process.env).
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

const rawConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
} as const;

const REQUIRED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
] as const;

/** Nomes das variáveis de ambiente obrigatórias que estão vazias. */
export function missingFirebaseEnvVars(): string[] {
  return REQUIRED_KEYS.filter((key) => !rawConfig[key]).map(
    (key) => `NEXT_PUBLIC_FIREBASE_${camelToScreamingSnake(key)}`,
  );
}

/** Verdadeiro quando todas as variáveis obrigatórias estão preenchidas. */
export function isFirebaseConfigured(): boolean {
  return missingFirebaseEnvVars().length === 0;
}

/**
 * Retorna a configuração validada ou lança um erro descritivo listando o que falta.
 * Chame apenas onde o Firebase é de fato necessário, para que páginas que não
 * dependem dele continuem funcionando em builds sem as variáveis.
 */
export function getFirebaseConfig(): FirebaseWebConfig {
  const missing = missingFirebaseEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Configuração do Firebase incompleta. Defina: ${missing.join(", ")}. ` +
        "Veja .env.example para o modelo.",
    );
  }
  return {
    apiKey: rawConfig.apiKey!,
    authDomain: rawConfig.authDomain!,
    projectId: rawConfig.projectId!,
    storageBucket: rawConfig.storageBucket!,
    messagingSenderId: rawConfig.messagingSenderId!,
    appId: rawConfig.appId!,
    measurementId: rawConfig.measurementId || undefined,
  };
}

export const useFirebaseEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

function camelToScreamingSnake(value: string): string {
  return value.replace(/([A-Z])/g, "_$1").toUpperCase();
}
