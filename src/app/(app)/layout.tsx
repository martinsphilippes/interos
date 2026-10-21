import { HELP_LINKS, SEARCH_CREATE_LINKS, SEARCH_SHORTCUTS, USER_MENU_LINKS, type RoleKey } from "@/domain/constants";
import { can, requireUser } from "@/server/auth/session";
import { filterMobileNav, filterNavigation, filterQuickActions, filterShellLinks, hrefAccessMap } from "@/server/auth/navigation";
import { listNotifications } from "@/server/notifications";
import { AppShell, type ShellLinks, type ShellUser } from "@/components/layout/app-shell";
import { getPauseReasons } from "@/server/conversations/ops-settings";
import { twilioConfigured } from "@/server/integrations/twilio";

/** Papéis que veem o seletor de presença na top bar (telas operacionais), além dos gestores. */
const PRESENCE_ROLES: readonly RoleKey[] = ["vendas", "suporte", "cs", "implantacao"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Menu, barra do celular, atalhos "+" e links fixos pelas permissões efetivas (catálogo de acessos): tela visível ∧
  // regra do item/atalho. O mapa de rotas vai ao cliente só para esconder links (ScreenLink/useCanSee).
  const sections = filterNavigation(user);
  const mobileNav = filterMobileNav(user);
  const quickActions = filterQuickActions(user);
  const links: ShellLinks = {
    search: filterShellLinks(user, SEARCH_SHORTCUTS, quickActions),
    searchCreate: filterShellLinks(user, SEARCH_CREATE_LINKS, quickActions),
    help: filterShellLinks(user, HELP_LINKS, quickActions),
    userMenu: filterShellLinks(user, USER_MENU_LINKS, quickActions),
  };
  const showPresence = user.isManager || PRESENCE_ROLES.includes(user.role);

  let unreadCount = 0;
  try {
    unreadCount = (await listNotifications(user.id, { unreadOnly: true })).length;
  } catch (error) {
    console.error("[layout] falha ao contar notificações", error);
  }

  async function loadPauseReasons() {
    try {
      return (await getPauseReasons()).filter((r) => r.active).map((r) => ({ key: r.key, label: r.label }));
    } catch (error) {
      console.error("[layout] falha ao ler os motivos de pausa", error);
      return [];
    }
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
    pauseReasonKey: user.pauseReasonKey,
    pauseReasons: showPresence ? await loadPauseReasons() : undefined,
    access: hrefAccessMap(user),
  };

  return (
    <AppShell user={shellUser} sections={sections} mobileNav={mobileNav} links={links} unreadCount={unreadCount} quickActions={quickActions} showPresence={showPresence} softphone={twilioConfigured() && can(user, "comunicacao.ligacoes.ligar")}>
      {children}
    </AppShell>
  );
}
