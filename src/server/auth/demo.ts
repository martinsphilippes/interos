import "server-only";
import { adminAuth } from "../firebase-admin";
import { getById, list } from "../db";
import { COLLECTIONS, type User } from "@/domain/types";
import { ROLE_KEYS, type DepartmentKey, type RoleKey } from "@/domain/constants";

/**
 * Acesso rápido da fase de testes: cards com os usuários na tela de login que entram com um clique.
 * Ligado por NEXT_PUBLIC_DEMO_MODE=true (Vercel: Production e Preview). Com a flag desligada, a lista vem vazia
 * e a emissão de token recusa, então desligar a variável e publicar remove o recurso por completo.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  jobTitle?: string;
}

/** Usuários ativos da organização, da diretoria para a operação (ordem de ROLE_KEYS) e por nome. */
export async function listDemoUsers(): Promise<DemoUser[]> {
  if (!isDemoMode()) return [];
  const users = await list<User>(COLLECTIONS.users, { where: [["active", "==", true]] });
  const rank = (role: RoleKey) => ROLE_KEYS.indexOf(role);
  return users
    .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name, "pt-BR"))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, departmentId: u.departmentId, jobTitle: u.jobTitle }));
}

/** Token customizado do Firebase Auth para entrar como o usuário escolhido (só em modo demonstração). */
export async function createDemoToken(userId: string): Promise<string> {
  if (!isDemoMode()) throw new Error("Acesso rápido desativado neste ambiente.");
  const user = await getById<User>(COLLECTIONS.users, userId);
  if (!user || user.active === false) throw new Error("Usuário não encontrado ou desativado.");
  return adminAuth.createCustomToken(user.id);
}
