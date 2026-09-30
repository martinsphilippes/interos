/**
 * Leitura dos ajustes de acesso (A6): perfil do papel (`role_<papel>`), exceções do usuário (`user_<uid>`) e módulos
 * ativos da organização, numa só ida ao Firestore (getAll). Qualquer falha → matriz padrão + todos os módulos
 * ativos (A4.6): nunca desloga nem devolve null — só verifySessionCookie e o documento do usuário decidem a sessão.
 */
import { cache } from "react";
import { COLLECTIONS, type Organization, type PermissionProfile, type User } from "@/domain/types";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import type { EffectivePermissions } from "@/domain/permissions";
import { firestore } from "../firebase-admin";
import { col, getById, ORG_ID } from "../db";
import { resolvePermissions, sanitizeAdjustments, type PermissionAdjustments } from "./permissions";

export const roleProfileId = (role: string) => `role_${role}`;
export const userOverrideId = (uid: string) => `user_${uid}`;

export interface AccessDocs {
  roleProfile: PermissionAdjustments | null;
  userOverride: PermissionAdjustments | null;
  organization: Pick<Organization, "activeModules"> | null;
  degraded: boolean;
}

function ownDoc<T>(snap: DocumentSnapshot): T | null {
  const data = snap.data();
  // Mesmo isolamento de getById: documento sem organizationId ou de outra organização é ignorado.
  if (!data || data.organizationId !== ORG_ID) return null;
  return { ...(data as T), id: snap.id } as T;
}

/** Lê os 3 documentos de ajuste do usuário; em erro, loga e devolve a matriz padrão (degraded). */
export async function loadAccessDocs(user: Pick<User, "id" | "role">): Promise<AccessDocs> {
  try {
    const [roleSnap, userSnap, orgSnap] = await firestore.getAll(
      col(COLLECTIONS.permissionProfiles).doc(roleProfileId(user.role)),
      col(COLLECTIONS.permissionProfiles).doc(userOverrideId(user.id)),
      col(COLLECTIONS.organizations).doc(ORG_ID),
    );
    const roleProfile = ownDoc<PermissionProfile>(roleSnap);
    const userOverride = ownDoc<PermissionProfile>(userSnap);
    const organization = ownDoc<Organization>(orgSnap);
    return {
      // Saneados: só chaves próprias do catálogo com valor booleano e escopos válidos (nada vem do protótipo).
      roleProfile: roleProfile ? sanitizeAdjustments(roleProfile) : null,
      userOverride: userOverride ? sanitizeAdjustments(userOverride) : null,
      organization: organization ? { activeModules: Array.isArray(organization.activeModules) ? organization.activeModules : undefined } : null,
      degraded: false,
    };
  } catch (error) {
    console.error("[permissoes] falha ao ler perfis/organização; usando a matriz padrão", error);
    return { roleProfile: null, userOverride: null, organization: null, degraded: true };
  }
}

/** Permissões efetivas de um usuário já carregado. */
export async function permissionsForUser(user: Pick<User, "id" | "role" | "departmentId">): Promise<EffectivePermissions> {
  const docs = await loadAccessDocs(user);
  return resolvePermissions(user, docs);
}

const permissionsById = cache(async (userId: string): Promise<EffectivePermissions | null> => {
  const user = await getById<User>(COLLECTIONS.users, userId);
  if (!user) return null;
  return permissionsForUser(user);
});

const permissionsByUser = cache(async (userId: string, role: User["role"], departmentId: User["departmentId"]): Promise<EffectivePermissions> =>
  permissionsForUser({ id: userId, role, departmentId }),
);

/**
 * Permissões efetivas de OUTRO usuário (A28): transferir oportunidade, destinatários de atribuição/notificação.
 * Memoizado por requisição. Recebe o id (lê o documento) ou o próprio usuário. Usuário inexistente → null.
 */
export async function resolvePermissionsForUser(userOrId: string | Pick<User, "id" | "role" | "departmentId">): Promise<EffectivePermissions | null> {
  if (typeof userOrId === "string") return permissionsById(userOrId);
  if ("permissions" in userOrId && (userOrId as { permissions?: EffectivePermissions }).permissions) return (userOrId as { permissions: EffectivePermissions }).permissions;
  return permissionsByUser(userOrId.id, userOrId.role, userOrId.departmentId);
}
