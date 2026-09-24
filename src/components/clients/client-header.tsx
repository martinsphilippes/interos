import { CalendarClock, Globe, Mail, MapPin, MessageCircle, Phone, Tag } from "lucide-react";
import type { Client360, ClientFormOptions } from "@/server/clients/queries";
import { segmentLabel } from "@/server/clients/schemas";
import { formatCurrency, formatDate, formatDocument, formatPhone, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClientActions } from "./client-actions";
import { ClientStatusBadge, HealthIndicator, UserCell } from "./client-badges";
import { JourneyProgress } from "./journey-progress";
import { telHref, whatsappHref } from "./contact-event-dialog";

export interface ClientHeaderProps {
  data: Client360;
  options: ClientFormOptions;
}

function Metric({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="label-caps truncate">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

/** Cabeçalho da Ficha 360º: identificação, jornada, indicadores-chave, responsáveis e ações. */
export function ClientHeader({ data, options }: ClientHeaderProps) {
  const { client, contacts, workflow, users, financial, availableProducts, ownedCategories } = data;
  const now = new Date().toISOString();
  const nextOverdue = Boolean(client.nextInteractionAt && client.nextInteractionAt < now);
  const mrr = financial.mrr || client.mrr || 0;
  const addressLine = [
    [client.address?.street, client.address?.number].filter(Boolean).join(", "),
    client.address?.district,
    [client.address?.city, client.address?.state].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");
  const wa = whatsappHref(client.whatsapp);
  const tel = telHref(client.phone);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Operação" }, { label: "Clientes 360º", href: "/clientes" }, { label: client.tradeName }]}
        title={client.tradeName}
        badge={<ClientStatusBadge status={client.status} size="md" />}
        description={[client.legalName, client.document ? formatDocument(client.document) : null, client.segment ? segmentLabel(client.segment) : null].filter(Boolean).join(" · ")}
        actions={<ClientActions client={client} contacts={contacts} availableProducts={availableProducts} ownedCategories={ownedCategories} options={options} />}
        className="mb-4"
      />

      <Card>
        <CardContent className="flex flex-col gap-5 py-4 md:py-5">
          <div>
            <p className="label-caps mb-2">Jornada do cliente</p>
            <JourneyProgress currentStage={client.currentStage} instanceId={workflow.instance?.id ?? client.workflowInstanceId} steps={workflow.steps} />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="MRR">
              <span className="tabular-nums">{mrr > 0 ? formatCurrency(mrr) : "—"}</span>
            </Metric>
            <Metric label="Saúde">
              <HealthIndicator score={client.healthScore} level={client.healthLevel} showLabel />
            </Metric>
            <Metric label="Última interação">
              {client.lastInteractionAt ? <span title={formatDate(client.lastInteractionAt, "dd/MM/yyyy HH:mm")}>{formatRelative(client.lastInteractionAt)}</span> : "—"}
            </Metric>
            <Metric label="Próxima interação">
              {client.nextInteractionAt ? (
                <span className={cn("inline-flex items-center gap-1", nextOverdue && "text-danger-fg")} title={formatDate(client.nextInteractionAt, "dd/MM/yyyy HH:mm")}>
                  <CalendarClock className="size-3.5" aria-hidden /> {formatRelative(client.nextInteractionAt)}
                  {nextOverdue ? <span className="text-xs font-normal">(vencida)</span> : null}
                </span>
              ) : (
                "—"
              )}
            </Metric>
            <Metric label={client.activatedAt ? "Cliente desde" : "Cadastrado em"}>{formatDate(client.activatedAt ?? client.createdAt)}</Metric>
            <Metric label="Origem">{client.origin ? (options.leadSources.find((s) => s.key === client.origin)?.name ?? client.origin) : "—"}</Metric>
          </div>

          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <Metric label="Comercial">
              <UserCell users={users} id={client.ownerSalesId} size="md" withSubtitle />
            </Metric>
            <Metric label="Customer Success">
              <UserCell users={users} id={client.ownerCsId} size="md" withSubtitle />
            </Metric>
            <Metric label="Implantação">
              <UserCell users={users} id={client.ownerImplementationId} size="md" withSubtitle />
            </Metric>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted md:flex-row md:flex-wrap md:items-center md:gap-x-5">
            {client.phone ? (
              <a href={tel ?? undefined} className="inline-flex min-h-[32px] items-center gap-1.5 hover:text-foreground md:min-h-0">
                <Phone className="size-4 shrink-0" aria-hidden /> {formatPhone(client.phone)}
              </a>
            ) : null}
            {client.whatsapp ? (
              <a href={wa ?? undefined} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center gap-1.5 hover:text-foreground md:min-h-0">
                <MessageCircle className="size-4 shrink-0" aria-hidden /> {formatPhone(client.whatsapp)}
              </a>
            ) : null}
            {client.email ? (
              <a href={`mailto:${client.email}`} className="inline-flex min-h-[32px] min-w-0 items-center gap-1.5 hover:text-foreground md:min-h-0">
                <Mail className="size-4 shrink-0" aria-hidden /> <span className="truncate">{client.email}</span>
              </a>
            ) : null}
            {client.website ? (
              <a href={client.website} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] min-w-0 items-center gap-1.5 hover:text-foreground md:min-h-0">
                <Globe className="size-4 shrink-0" aria-hidden /> <span className="truncate">{client.website.replace(/^https?:\/\//, "")}</span>
              </a>
            ) : null}
            {addressLine ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="size-4 shrink-0" aria-hidden /> <span className="truncate">{addressLine}</span>
              </span>
            ) : null}
            {client.tags?.length ? (
              <span className="inline-flex flex-wrap items-center gap-1 md:ml-auto">
                <Tag className="size-3.5 text-muted-light" aria-hidden />
                {client.tags.map((tag) => (
                  <Badge key={tag} variant="muted" size="sm">
                    {tag}
                  </Badge>
                ))}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
