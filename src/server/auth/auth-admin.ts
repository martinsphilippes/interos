import "server-only";
import { autoId, docdb } from "../docdb";

/**
 * Gestão de logins no Supabase Auth pelo servidor (substitui o `adminAuth` do Firebase Admin).
 *
 * O id do usuário no INTEROS (documento em `users`, ex.: "user_igor") fica em auth.users.raw_app_meta_data.interos_uid;
 * o id do Supabase (uuid) nunca aparece no domínio. As operações chamam funções SQL restritas ao papel do servidor
 * (supabase/migrations/*_interos_docstore.sql), então não dependem da service role key.
 *
 * Erros mantêm os códigos do Firebase ("auth/user-not-found", "auth/email-already-exists"…), que as telas já traduzem.
 */

export class AuthAdminError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AuthAdminError";
  }
}

/** Erros levantados pelas funções SQL ("raise exception 'auth/…'") viram AuthAdminError com o mesmo código. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = (error as { message?: string }).message ?? "";
    const match = /^auth\/[a-z-]+$/.exec(message.trim());
    if (match) throw new AuthAdminError(match[0]);
    throw error;
  }
}

export interface CreateLoginInput {
  /** Id do usuário no INTEROS. Sem ele, um novo id é gerado (e devolvido). */
  uid?: string;
  email: string;
  password?: string;
  displayName?: string;
  disabled?: boolean;
}

export const authAdmin = {
  async createUser(input: CreateLoginInput): Promise<{ uid: string }> {
    const uid = input.uid ?? autoId();
    await call(
      () => docdb.sql()`select interos.auth_create_user(${uid}, ${input.email}, ${input.password ?? null}, ${input.displayName ?? null}, ${input.disabled ?? false})`,
    );
    return { uid };
  },

  async updateUser(uid: string, changes: { password?: string; displayName?: string; disabled?: boolean }): Promise<void> {
    await call(
      () => docdb.sql()`select interos.auth_update_user(${uid}, ${changes.password ?? null}, ${changes.displayName ?? null}, ${changes.disabled ?? null})`,
    );
    // Senha nova ou login desativado: sessões abertas do INTEROS também deixam de valer.
    if (changes.password !== undefined || changes.disabled === true) await markSessionsRevoked(uid);
  },

  async deleteUser(uid: string): Promise<void> {
    await call(() => docdb.sql()`select interos.auth_delete_user(${uid})`);
  },

  /**
   * Encerra as sessões: as do INTEROS (cookie emitido antes de agora deixa de valer — ver getCurrentUser) e as do
   * Supabase Auth. Mesmo sem login no Auth, as sessões do INTEROS são encerradas antes do erro auth/user-not-found.
   */
  async revokeRefreshTokens(uid: string): Promise<void> {
    await markSessionsRevoked(uid);
    await call(() => docdb.sql()`select interos.auth_revoke_sessions(${uid})`);
  },

  /** Logins existentes com o uid do INTEROS e o e-mail (seed). */
  async listUsers(): Promise<{ uid: string | null; email: string | null }[]> {
    const rows = await docdb.sql()<{ interos_uid: string | null; email: string | null }[]>`select interos_uid, email from interos.auth_list_users()`;
    return rows.map((r) => ({ uid: r.interos_uid, email: r.email }));
  },
};

/** Marca no documento do usuário o instante a partir do qual cookies de sessão anteriores são recusados. */
async function markSessionsRevoked(uid: string): Promise<void> {
  const ref = docdb.collection("users").doc(uid);
  const snap = await ref.get();
  if (snap.exists) await ref.update({ sessionsRevokedAt: new Date().toISOString() });
}
