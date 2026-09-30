import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth } from "../firebase-admin";
import { getById } from "../db";
import { COLLECTIONS, type CurrentUser, type User } from "@/domain/types";
import type { RoleKey } from "@/domain/constants";
import {
  MODULE_KEYS,
  SCREEN_BY_KEY,
  NODE_BY_KEY,
  nodeViewKey,
  type EffectivePermissions,
  type ModuleKey,
  type PermissionKey,
  type ScreenNodeKey,
} from "@/domain/permissions";
import { can, canAny, resolvePermissions } from "./permissions";
import { loadAccessDocs, permissionsForUser } from "./permission-store";
import { ACCESS_DENIED_MESSAGE, PermissionError } from "./errors";

// Fachada única de identidade e autorização: páginas e actions importam daqui.
export { can, canAny, canSeeHref, resolvePermissions } from "./permissions";
export { PermissionError, AuthenticationError, failAction, ACCESS_DENIED_MESSAGE } from "./errors";
export { resolvePermissionsForUser } from "./permission-store";

export const SESSION_COOKIE = "interos_session";
const SESSION_DAYS = 14;

/** Destino padrão de acesso negado em páginas (o Meu Dia mostra o aviso). */
export const ACCESS_DENIED_REDIRECT = "/meu-dia?erro=sem-permissao";

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

/**
 * Único ponto que deriva as capacidades do papel (isAdmin/isManager/isDirector) e anexa as permissões efetivas.
 * Sem `permissions`, usa a matriz padrão do catálogo para o papel/departamento.
 */
export function decorate(user: User, permissions?: EffectivePermissions): CurrentUser {
  return {
    ...user,
    isAdmin: user.role === "admin",
    isManager: user.role === "gestor" || user.role === "admin" || user.role === "diretoria",
    isDirector: user.role === "diretoria" || user.role === "admin",
    permissions: permissions ?? resolvePermissions(user),
  };
}

/**
 * CurrentUser de OUTRO usuário (assistentes, relatórios em nome de alguém) com as permissões efetivas dele (A28),
 * lidas uma vez por requisição.
 */
export async function currentUserFor(user: User): Promise<CurrentUser> {
  return decorate(user, await permissionsForUser(user));
}

/** Usuário autenticado da requisição, ou null. Memoizado por requisição. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let user: User | null;
  try {
    const decoded = await adminAuth.verifySessionCookie(token, true);
    user = await getById<User>(COLLECTIONS.users, decoded.uid);
  } catch {
    return null;
  }
  // Sessão estrita: só usuário explicitamente ativo (documento sem `active` não entra).
  if (!user || user.active !== true) return null;
  // Perfis/exceções/módulos: falha na leitura NÃO desloga (A4.6) — loadAccessDocs já cai na matriz padrão.
  const docs = await loadAccessDocs(user);
  try {
    return decorate(user, resolvePermissions(user, docs));
  } catch (error) {
    console.error("[permissoes] falha ao resolver os ajustes de acesso; usando a matriz padrão", error);
    return decorate(user, resolvePermissions(user, { degraded: true }));
  }
});

/** Exige usuário autenticado; redireciona para /login quando não há sessão. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Exige um dos papéis informados (admin sempre passa). Mantido enquanto houver chamadores; as páginas migram para
 * requireScreen e as actions para requirePermission, chamada a chamada.
 */
export async function requireRole(...roles: RoleKey[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.isAdmin || roles.includes(user.role)) return user;
  redirect(ACCESS_DENIED_REDIRECT);
}

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Acesso ao módulo = `can(user, "<modulo>.acessar")` (fachada com a assinatura antiga). Com um CurrentUser valem o
 * perfil, as exceções e os módulos ativos; com outro objeto, a matriz padrão do papel.
 */
export function canAccessModule(user: Pick<CurrentUser, "role" | "isAdmin"> & { departmentId?: string; permissions?: EffectivePermissions }, moduleKey: string): boolean {
  if (!isModuleKey(moduleKey)) return false;
  return can(user, `${moduleKey}.acessar`);
}

// ---------------------------------------------------------------------------
// Guardas de página, action e API (A5)
// ---------------------------------------------------------------------------

export interface RequireScreenOptions {
  /** Destino quando negado (padrão: o da tela/seção no catálogo ou /meu-dia?erro=sem-permissao). */
  redirectTo?: string;
}

function deniedRedirectFor(node: ScreenNodeKey): string {
  const screen = SCREEN_BY_KEY.get(node);
  if (screen) return screen.redirectTo ?? ACCESS_DENIED_REDIRECT;
  for (const s of SCREEN_BY_KEY.values()) {
    const section = s.sections.find((x) => x.key === node);
    if (section) return section.redirectTo ?? s.redirectTo ?? ACCESS_DENIED_REDIRECT;
  }
  return ACCESS_DENIED_REDIRECT;
}

/** Chaves aceitas por uma tela: a própria ou, nas páginas compartilhadas, qualquer tela de `requireScreenAny`. */
function acceptedKeys(node: ScreenNodeKey): PermissionKey[] {
  const screen = SCREEN_BY_KEY.get(node);
  if (screen?.requireScreenAny) return screen.requireScreenAny.map((k) => `${k}.ver` as PermissionKey);
  return [nodeViewKey(node)];
}

/**
 * Página: exige a tela (ou seção com página própria). Sem sessão → /login; sem permissão → redirect (padrão
 * /meu-dia?erro=sem-permissao). Devolve o usuário.
 */
export async function requireScreen(node: ScreenNodeKey, options: RequireScreenOptions = {}): Promise<CurrentUser> {
  const user = await requireUser();
  if (canAny(user, acceptedKeys(node))) return user;
  redirect(options.redirectTo ?? deniedRedirectFor(node));
}

/** Página compartilhada por várias telas: aceita qualquer uma (a página filtra as abas por seção). */
export async function requireScreenAny(nodes: readonly ScreenNodeKey[], options: RequireScreenOptions = {}): Promise<CurrentUser> {
  const user = await requireUser();
  if (nodes.some((n) => canAny(user, acceptedKeys(n)))) return user;
  redirect(options.redirectTo ?? (nodes[0] ? deniedRedirectFor(nodes[0]) : ACCESS_DENIED_REDIRECT));
}

/**
 * Server Action: exige a permissão. Sem sessão → /login (como requireUser); sem permissão → lança PermissionError
 * (convertido por failAction em `{ ok: false, error }`).
 */
export async function requirePermission(key: PermissionKey, message?: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, key)) throw new PermissionError(message ?? ACCESS_DENIED_MESSAGE, key);
  return user;
}

/** Route Handler: devolve o usuário ou uma Response JSON 401 (sem sessão) / 403 (sem permissão). */
export async function requireApiPermission(key: PermissionKey): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sessão ausente ou expirada." }, { status: 401 });
  if (!can(user, key)) return Response.json({ ok: false, error: ACCESS_DENIED_MESSAGE }, { status: 403 });
  return user;
}

/** Rótulo de negócio de uma chave (mensagens e auditoria). */
export function permissionLabel(key: PermissionKey): string {
  return NODE_BY_KEY.get(key)?.label ?? key;
}
