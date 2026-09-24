import { NAVIGATION } from "@/domain/constants";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/notifications";
import { AppShell, type ShellUser } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = NAVIGATION.filter((section) => canAccessModule(user, section.key));

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
  };

  return (
    <AppShell user={shellUser} sections={sections} unreadCount={unreadCount}>
      {children}
    </AppShell>
  );
}
