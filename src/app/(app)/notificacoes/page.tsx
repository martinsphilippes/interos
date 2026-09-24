import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/notifications";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { NotificationsToolbar, parseKindFilter, parseReadFilter } from "@/components/notifications/notifications-toolbar";
import { toNotificationItem } from "@/components/notifications/model";

export const metadata: Metadata = { title: "Notificações" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Central de notificações: filtros por leitura e tipo (URL), agrupadas por dia. */
export default async function NotificacoesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const readFilter = parseReadFilter(first(sp.filtro));
  const kindFilter = parseKindFilter(first(sp.tipo));

  const now = new Date();
  const all = (await listNotifications(user.id)).map((n) => toNotificationItem(n, now));
  const unread = all.filter((n) => !n.readAt).length;
  const items = all.filter((n) => (readFilter === "nao-lidas" ? !n.readAt : true)).filter((n) => (kindFilter ? n.kind === kindFilter : true));

  return (
    <PageContainer size="narrow">
      <PageHeader title="Notificações" description={unread > 0 ? `${unread} não lida${unread === 1 ? "" : "s"} de ${all.length}.` : "Você está em dia com suas notificações."}>
        <NotificationsToolbar readFilter={readFilter} kindFilter={kindFilter} totals={{ all: all.length, unread }} />
      </PageHeader>
      <Card>
        <CardContent className="px-3 py-3 md:px-4">
          <NotificationsList
            items={items}
            variant="full"
            emptyTitle={readFilter === "nao-lidas" ? "Nenhuma notificação não lida" : "Nenhuma notificação"}
            emptyDescription={kindFilter ? "Nenhuma notificação desse tipo com o filtro atual." : "As notificações de tarefas, SLAs, workflow e clientes aparecem aqui."}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
