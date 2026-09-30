import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { ROLE_KEYS, type RoleKey } from "@/domain/constants";
import { PROTECTED_KEYS } from "@/domain/permissions";
import { can, requireScreen } from "@/server/auth/session";
import { NEVER_DENIED_KEYS } from "@/server/auth/invariants";
import { listUsersForAdmin } from "@/server/admin/queries";
import { getModulesTabData, getProfilesTabData, getUserAccessView, loadAccessState, userAccessCapabilities } from "@/server/admin/access";
import { buildAccessTree, buildModuleInfo, buildScopeOptions, inactiveModulesFrom } from "@/server/auth/access-admin";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { NewUserDialog } from "@/components/admin/new-user-dialog";
import { UserDrawer, type UserAbilities, type UserAccessData } from "@/components/admin/user-drawer";
import { UsersTable } from "@/components/admin/users-table";
import { UsersPageTabs, type UsersPageTab } from "@/components/admin/users-page-tabs";
import { ProfilesPanel } from "@/components/admin/profiles-panel";
import { ModulesPanel } from "@/components/admin/modules-panel";

export const metadata: Metadata = { title: "Usuários" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Usuários e acessos (A10): abas "Usuários", "Perfis e acessos" e "Módulos da empresa" (?aba=). Cada aba e cada
 * botão aparecem pelas permissões do catálogo calculadas aqui no servidor; a lista respeita o escopo de dados da
 * tela. ?usuario=<id> abre o drawer (com Exceções de acesso, Acesso efetivo e Histórico quando permitido).
 */
export default async function UsuariosPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("admin.usuarios");
  const sp = await searchParams;
  const canProfiles = can(user, "admin.acessos.perfis.ver");
  const canModules = can(user, "admin.acessos.modulos.ver");
  const canManage = can(user, "admin.acessos.gerir");
  const requested = first(sp.aba);
  const tab: UsersPageTab = requested === "perfis" && canProfiles ? "perfis" : requested === "modulos" && canModules ? "modulos" : "usuarios";
  const visibleTabs: UsersPageTab[] = ["usuarios", ...(canProfiles ? (["perfis"] as const) : []), ...(canModules ? (["modulos"] as const) : [])];

  const header = (subtitle: string, badge: React.ReactNode, actions?: React.ReactNode) => (
    <PageHeader title="Usuários" description={subtitle} breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Usuários" }]} badge={badge} actions={actions} />
  );

  if (tab === "perfis") {
    const data = await getProfilesTabData();
    const requestedRole = first(sp.perfil);
    const initialRole = (ROLE_KEYS as readonly string[]).includes(requestedRole ?? "") ? (requestedRole as RoleKey) : "vendas";
    return (
      <PageContainer size="full">
        {header("Perfis e acessos: o que cada papel vê e faz, tela a tela, e o escopo de dados de cada tela.", !canManage ? <Badge variant="muted">Somente leitura</Badge> : null)}
        <UsersPageTabs current={tab} visible={visibleTabs} />
        <Suspense fallback={null}>
          <ProfilesPanel catalog={data.catalog} profiles={data.profiles} recent={data.recent} canManage={canManage} protectedKeys={[...PROTECTED_KEYS]} neverDenied={[...NEVER_DENIED_KEYS]} initialRole={initialRole} />
        </Suspense>
      </PageContainer>
    );
  }

  if (tab === "modulos") {
    const modules = await getModulesTabData();
    return (
      <PageContainer>
        {header("Módulos contratados pela empresa: desligar esconde o módulo de todos sem apagar dados.", !canManage ? <Badge variant="muted">Somente leitura</Badge> : null)}
        <UsersPageTabs current={tab} visible={visibleTabs} />
        <Suspense fallback={null}>
          <ModulesPanel modules={modules} canManage={canManage} />
        </Suspense>
      </PageContainer>
    );
  }

  const selectedId = first(sp.usuario);
  const { users, departments } = await listUsersForAdmin(user);
  const selected = selectedId ? (users.find((u) => u.id === selectedId) ?? null) : null;
  const abilities: UserAbilities = {
    edit: can(user, "admin.usuarios.editar"),
    changeRole: can(user, "admin.usuarios.alterar-papel"),
    assignAdmin: canManage,
    activate: can(user, "admin.usuarios.ativar"),
    resetPassword: can(user, "admin.usuarios.redefinir-senha"),
    remove: can(user, "admin.usuarios.excluir"),
    seeSalary: can(user, "admin.usuarios.remuneracao.ver"),
    editSalary: can(user, "admin.usuarios.remuneracao.editar"),
  };
  const canCreate = can(user, "admin.usuarios.criar");
  const assignableRoles: RoleKey[] = abilities.changeRole ? ROLE_KEYS.filter((r) => r !== "admin" || canManage) : ["colaborador"];

  // Seções de acesso do drawer: só são lidas quando o drawer está aberto e o perfil pode vê-las.
  let access: UserAccessData | null = null;
  if (selected) {
    const caps = userAccessCapabilities(user);
    if (caps.exceptions || caps.effective || caps.history) {
      const loaded = await loadAccessState();
      const view = await getUserAccessView(user, selected, caps, loaded);
      if (view) {
        access = {
          view,
          caps,
          neverDenied: [...NEVER_DENIED_KEYS],
          catalog: { tree: buildAccessTree(), scopes: buildScopeOptions(), modules: buildModuleInfo(), inactiveModules: inactiveModulesFrom(loaded.state.activeModules) },
        };
      }
    }
  }

  const active = users.filter((u) => u.active !== false).length;
  const inactive = users.length - active;
  const admins = users.filter((u) => u.role === "admin" && u.active !== false).length;
  const managers = users.filter((u) => u.role === "gestor" && u.active !== false).length;

  return (
    <PageContainer size="full">
      {header(
        "Quem acessa o INTEROS, com papel, departamento, gestor e metas.",
        !abilities.edit ? <Badge variant="muted">Somente leitura</Badge> : null,
        canCreate ? (
          <Suspense fallback={null}>
            <NewUserDialog users={users} departments={departments} assignableRoles={assignableRoles} />
          </Suspense>
        ) : null,
      )}
      <UsersPageTabs current={tab} visible={visibleTabs} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ativos" value={formatNumber(active)} icon={<UserCheck />} tone="success" href="/admin/usuarios?ativo=1" hint={`${formatNumber(users.length)} no total`} compact />
        <StatCard label="Inativos" value={formatNumber(inactive)} icon={<UserX />} tone={inactive > 0 ? "warning" : "neutral"} href="/admin/usuarios?ativo=0" compact />
        <StatCard label="Administradores" value={formatNumber(admins)} icon={<ShieldCheck />} tone={admins === 0 ? "danger" : "info"} href="/admin/usuarios?papel=admin&ativo=1" compact />
        <StatCard label="Gestores" value={formatNumber(managers)} icon={<Users />} tone="neutral" href="/admin/usuarios?papel=gestor&ativo=1" compact />
      </div>

      <Suspense fallback={null}>
        <UsersTable users={users} departments={departments} currentUserId={user.id} />
        <UserDrawer user={selected} users={users} departments={departments} abilities={abilities} currentUserId={user.id} access={access} />
      </Suspense>
    </PageContainer>
  );
}
