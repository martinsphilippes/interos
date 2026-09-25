import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { listUsersForAdmin } from "@/server/admin/queries";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { NewUserDialog } from "@/components/admin/new-user-dialog";
import { UserDrawer } from "@/components/admin/user-drawer";
import { UsersTable } from "@/components/admin/users-table";

export const metadata: Metadata = { title: "Usuários" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Admin edita; gestor e diretoria veem em modo leitura. ?usuario=<id> abre o drawer. */
export default async function UsuariosPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole("admin", "gestor", "diretoria");
  const sp = await searchParams;
  const selectedId = first(sp.usuario);
  const { users, departments } = await listUsersForAdmin();
  const selected = selectedId ? (users.find((u) => u.id === selectedId) ?? null) : null;
  const canEdit = user.isAdmin;

  const active = users.filter((u) => u.active !== false).length;
  const inactive = users.length - active;
  const admins = users.filter((u) => u.role === "admin" && u.active !== false).length;
  const managers = users.filter((u) => u.role === "gestor" && u.active !== false).length;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Usuários"
        description="Quem acessa o INTEROS, com papel, departamento, gestor e metas."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Usuários" }]}
        badge={!canEdit ? <Badge variant="muted">Somente leitura</Badge> : null}
        actions={canEdit ? <Suspense fallback={null}><NewUserDialog users={users} departments={departments} /></Suspense> : null}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ativos" value={formatNumber(active)} icon={<UserCheck />} tone="success" href="/admin/usuarios?ativo=1" hint={`${formatNumber(users.length)} no total`} compact />
        <StatCard label="Inativos" value={formatNumber(inactive)} icon={<UserX />} tone={inactive > 0 ? "warning" : "neutral"} href="/admin/usuarios?ativo=0" compact />
        <StatCard label="Administradores" value={formatNumber(admins)} icon={<ShieldCheck />} tone={admins === 0 ? "danger" : "info"} href="/admin/usuarios?papel=admin&ativo=1" compact />
        <StatCard label="Gestores" value={formatNumber(managers)} icon={<Users />} tone="neutral" href="/admin/usuarios?papel=gestor&ativo=1" compact />
      </div>

      <Suspense fallback={null}>
        <UsersTable users={users} departments={departments} currentUserId={user.id} />
        <UserDrawer user={selected} users={users} departments={departments} canEdit={canEdit} currentUserId={user.id} />
      </Suspense>
    </PageContainer>
  );
}
