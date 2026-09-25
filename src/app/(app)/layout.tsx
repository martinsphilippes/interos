import { NAVIGATION, QUICK_ACTIONS, type RoleKey } from "@/domain/constants";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/notifications";
import { AppShell, type ShellUser } from "@/components/layout/app-shell";

/** Papéis que veem o seletor de presença na top bar (telas operacionais), além dos gestores. */
const PRESENCE_ROLES: readonly RoleKey[] = ["vendas", "suporte", "cs", "implantacao"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = NAVIGATION.filter((section) => canAccessModule(user, section.key));
  const quickActions = QUICK_ACTIONS.filter(
    (action) => canAccessModule(user, action.module) && (user.isAdmin || !action.roles || action.roles.includes(user.role)),
  );
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
