import { cache } from "react";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
export { PermissionError, AuthenticationError, BusinessError, failAction, isUserFacingError, ACCESS_DENIED_MESSAGE } from "./errors";
export { resolvePermissionsForUser } from "./permission-store";

export const SESSION_COOKIE = "interos_session";
const SESSION_DAYS = 14;

/** Destino padrão de acesso negado em páginas (o Meu Dia mostra o aviso). */
export const ACCESS_DENIED_REDIRECT = "/meu-dia?erro=sem-permissao";

export interface CreateSessionOptions {
  /**
   * "Lembrar meu acesso" (padrão true): cookie persistente por SESSION_DAYS. Com false o cookie não tem
   * maxAge e dura só a sessão do navegador (a assinatura continua expirando em SESSION_DAYS).
   */
  remember?: boolean;
}

/*
 * Cookie de sessão do INTEROS: "<payload base64url>.<HMAC-SHA256 base64url>", payload { uid, iat, exp } (segundos).
 * Emitido só pelo servidor depois que o Supabase Auth confirma a identidade (/api/auth/session) ou no acesso rápido
 * do modo demonstração. Revogação: cookies emitidos antes de users.sessionsRevokedAt são recusados (authAdmin).
 */
interface SessionPayload {
  uid: string;
  iat: number;
  exp: number;
}

function sessionKey(): Buffer {
  const secret = process.env.SESSION_COOKIE_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("SESSION_COOKIE_SECRET não configurado");
  // Chave derivada com rótulo próprio: o mesmo segredo assina os tokens do CSAT sem que um sirva para o outro.
  return createHmac("sha256", secret ?? "dev-only-secret").update("interos-session-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

export function encodeSession(uid: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload = Buffer.from(JSON.stringify({ uid, iat, exp: iat + SESSION_DAYS * 24 * 60 * 60 } satisfies SessionPayload)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Payload de um cookie válido (assinatura e validade), ou null. */
export function decodeSession(token: string, nowMs = Date.now()): SessionPayload | null {
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof data.uid !== "string" || typeof data.iat !== "number" || typeof data.exp !== "number") return null;
    if (data.exp * 1000 <= nowMs) return null;
    return data as SessionPayload;
  } catch {
    return null;
  }
}

/** Grava o cookie de sessão do usuário (identidade já verificada pelo chamador). */
export async function createSession(uid: string, options: CreateSessionOptions = {}): Promise<{ uid: string }> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(uid), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(options.remember === false ? {} : { maxAge }),
  });
  return { uid };
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
  // Cookie adulterado ou expirado = sem sessão (validação local, sem ida ao Auth).
  const session = decodeSession(token);
  if (!session) return null;
  const uid = session.uid;
  let user: User | null;
  try {
    user = await getById<User>(COLLECTIONS.users, uid);
  } catch (error) {
    // Banco indisponível (ex.: cota do Firestore esgotada) não pode virar "sem sessão": /login com cookie volta para
    // /meu-dia e o navegador entra em laço de redirecionamento. Lança para a tela de erro mostrar o aviso.
    console.error("[sessao] falha ao ler o usuário da sessão", error);
    throw new Error(SESSION_UNAVAILABLE_MESSAGE);
  }
  // Sessão estrita: só usuário explicitamente ativo (documento sem `active` não entra).
  if (!user || user.active !== true) return null;
  // Sessões encerradas pelo administrador (troca de papel, senha redefinida, "encerrar sessões").
  if (user.sessionsRevokedAt && session.iat * 1000 < Date.parse(user.sessionsRevokedAt)) return null;
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
  // ?sessao=expirada: o proxy apaga o cookie inválido e deixa o /login abrir (sem isso, cookie inválido = laço).
  if (!user) redirect("/login?sessao=expirada");
  return user;
}

const SESSION_UNAVAILABLE_MESSAGE = "Sistema temporariamente indisponível. Tente novamente em alguns minutos.";

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
