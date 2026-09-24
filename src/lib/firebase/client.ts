"use client";

/**
 * Inicialização do SDK do Firebase para o navegador.
 *
 * - Singleton: `getApps()` evita inicializar duas vezes no Fast Refresh.
 * - Lazy: nada é criado até a primeira chamada, então importar este módulo
 *   em um Server Component não dispara efeitos colaterais.
 * - Emuladores: com NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true, Auth, Firestore
 *   e Storage apontam para as portas definidas em firebase.json.
 *
 * Este módulo é somente para código que roda no cliente. Para acesso
 * privilegiado no servidor (Route Handlers, Server Actions) use o Admin SDK
 * com uma service account, nunca este arquivo.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";
import { getFirebaseConfig, useFirebaseEmulators } from "./config";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORTS = { auth: 9099, firestore: 8080, storage: 9199 } as const;

let cachedApp: FirebaseApp | undefined;
let cachedAuth: Auth | undefined;
let cachedDb: Firestore | undefined;
let cachedStorage: FirebaseStorage | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  cachedApp = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
  return cachedApp;
}

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getFirebaseApp());
  if (useFirebaseEmulators) {
    connectAuthEmulator(
      cachedAuth,
      `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`,
      { disableWarnings: true },
    );
  }
  return cachedAuth;
}

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getFirebaseApp());
  if (useFirebaseEmulators) {
    connectFirestoreEmulator(cachedDb, EMULATOR_HOST, EMULATOR_PORTS.firestore);
  }
  return cachedDb;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (cachedStorage) return cachedStorage;
  cachedStorage = getStorage(getFirebaseApp());
  if (useFirebaseEmulators) {
    connectStorageEmulator(cachedStorage, EMULATOR_HOST, EMULATOR_PORTS.storage);
  }
  return cachedStorage;
}
