import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth } from "../firebase-admin";
import { getById } from "../db";
import { COLLECTIONS, type CurrentUser, type User } from "@/domain/types";
import { MODULE_ACCESS, type RoleKey } from "@/domain/constants";

export const SESSION_COOKIE = "interos_session";
const SESSION_DAYS = 14;

export interface CreateSessionOptions {
  /**
   * "Lembrar meu acesso" (padrão true): cookie persistente por SESSION_DAYS. Com false o cookie não tem
   * maxAge e dura só a sessão do navegador (o session cookie do Firebase continua expirando em SESSION_DAYS).
   */
  remember?: boolean;
}

/** Cria o cookie de sessão a partir do ID token emitido pelo Firebase Auth no navegador. */
export async function createSession(idToken: string, options: CreateSessionOptions = {}): Promise<{ uid: string }> {
  const decoded = await adminAuth.verifyIdToken(idToken);
  const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(options.remember === false ? {} : { maxAge: expiresIn / 1000 }),
  });
  return { uid: decoded.uid };
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

function decorate(user: User): CurrentUser {
  return {
    ...user,
    isAdmin: user.role === "admin",
    isManager: user.role === "gestor" || user.role === "admin" || user.role === "diretoria",
    isDirector: user.role === "diretoria" || user.role === "admin",
  };
}

/** Usuário autenticado da requisição, ou null. Memoizado por requisição. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifySessionCookie(token, true);
    const user = await getById<User>(COLLECTIONS.users, decoded.uid);
    if (!user || user.active === false) return null;
    return decorate(user);
  } catch {
    return null;
  }
});

/** Exige usuário autenticado; redireciona para /login quando não há sessão. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Exige um dos papéis informados (admin sempre passa). */
export async function requireRole(...roles: RoleKey[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.isAdmin || roles.includes(user.role)) return user;
  redirect("/meu-dia?erro=sem-permissao");
}

export function canAccessModule(user: Pick<CurrentUser, "role" | "isAdmin">, moduleKey: string): boolean {
  if (user.isAdmin) return true;
  const allowed = MODULE_ACCESS[moduleKey];
  if (!allowed) return false;
  if (allowed === "all") return true;
  return allowed.includes(user.role);
}
