import type { RoleKey } from "@/domain/constants";
import { requireUser } from "@/server/auth/session";
import { visibleNavigation, visibleQuickActions } from "@/server/auth/navigation";
import { listNotifications } from "@/server/notifications";
import { AppShell, type ShellUser } from "@/components/layout/app-shell";

/** Papéis que veem o seletor de presença na top bar (telas operacionais), além dos gestores. */
const PRESENCE_ROLES: readonly RoleKey[] = ["vendas", "suporte", "cs", "implantacao"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Menu e atalhos pelas permissões efetivas (catálogo de acessos): tela visível ∧ regra do item/atalho.
  const sections = visibleNavigation(user);
  const quickActions = visibleQuickActions(user);
  const showPresence = user.isManager || PRESENCE_ROLES.includes(user.role);

  let unreadCount = 0;
  try {
    unreadCount = (await listNotifications(user.id, { unreadOnly: true })).length;
  } catch (error) {
    console.error("[layout] falha ao contar notificações", error);
  }

  // Só campos serializáveis chegam ao Client Component.
  const shellUser: ShellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    avatarUrl: user.avatarUrl,
    jobTitle: user.jobTitle,
    presence: user.presence,
  };

  return (
    <AppShell user={shellUser} sections={sections} unreadCount={unreadCount} quickActions={quickActions} showPresence={showPresence}>
      {children}
    </AppShell>
  );
}
