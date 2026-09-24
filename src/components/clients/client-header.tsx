import { CalendarDays, CalendarClock, DollarSign, HeartPulse, MapPin, Receipt, UserRound } from "lucide-react";
import type { Client360, ClientFormOptions } from "@/server/clients/queries";
import type { NewTicketOptions } from "@/components/support/new-ticket-dialog";
import { CLIENT_STATUS_LABELS, type ClientStatus } from "@/domain/constants";
import { formatCurrency, formatDate, formatDocument, initials } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { StatCard } from "@/components/ui/stat-card";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ClientActions } from "./client-actions";
import { HEALTH_LABELS } from "./client-badges";
import { JourneyProgress } from "./journey-progress";
import { accountManager, buildUpcoming } from "./overview-model";

export interface ClientHeaderProps {
  data: Client360;
  options: ClientFormOptions;
  ticketOptions: NewTicketOptions | null;
}

const STATUS_VARIANT: Record<ClientStatus, NonNullable<BadgeProps["variant"]>> = {
  lead: "muted",
  prospect: "info",
  em_implantacao: "warning",
  ativo: "success",
  inativo: "outline",
  cancelado: "danger",
};
const STATUS_TEXT: Partial<Record<ClientStatus, string>> = { ativo: "Cliente ativo", inativo: "Cliente inativo", cancelado: "Cliente cancelado" };

function HeaderFact({ icon, label, children, className }: { icon: React.ReactNode; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="shrink-0 text-muted [&_svg]:size-5" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <div className="truncate text-sm font-medium text-foreground">{children}</div>
      </div>
    </div>
  );
}

/** Cabeçalho da Ficha 360º (padrão 12): identificação, gestor da conta, desde, cidade, ações e jornada. */
export function ClientHeader({ data, options, ticketOptions }: ClientHeaderProps) {
  const { client, contacts, workflow, users, availableProducts, ownedCategories } = data;
  const manager = accountManager(client, users);
  const city = [client.address?.city, client.address?.state].filter(Boolean).join(" — ");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Operação" }, { label: "Clientes 360º", href: "/clientes" }, { label: client.tradeName }]}
        title="Cliente 360º"
        description="Visão completa do relacionamento com o cliente"
        className="mb-4"
      />
      <Card className="p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden
              className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-secondary/30 bg-gradient-to-br from-secondary/35 to-info/15 text-xl font-bold tracking-tight text-foreground md:size-20 md:text-2xl"
            >
              {initials(client.tradeName)}
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground md:text-2xl">{client.tradeName}</h2>
              <p className="mt-0.5 truncate text-sm text-muted">{[client.legalName !== client.tradeName ? client.legalName : null, client.document ? formatDocument(client.document) : null].filter(Boolean).join(" · ")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant={STATUS_VARIANT[client.status]} size="md">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {STATUS_TEXT[client.status] ?? CLIENT_STATUS_LABELS[client.status]}
                </Badge>
                {client.tags?.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="muted" size="sm">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <ClientActions client={client} contacts={contacts} availableProducts={availableProducts} ownedCategories={ownedCategories} options={options} ticketOptions={ticketOptions} />
        </div>

        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-3 sm:divide-x sm:divide-border lg:grid-cols-[repeat(3,minmax(0,16rem))] [&>*]:sm:pl-4 [&>*:first-child]:sm:pl-0">
          <HeaderFact icon={<UserRound />} label={`Gestor da conta · ${manager.area}`}>
            {manager.user ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={manager.user.name} src={manager.user.avatarUrl} size="xs" />
                {manager.user.name}
              </span>
            ) : (
              <span className="text-muted-light">Sem responsável</span>
            )}
          </HeaderFact>
          <HeaderFact icon={<CalendarDays />} label={client.activatedAt ? "Cliente desde" : "Cadastrado em"}>
            {formatDate(client.activatedAt ?? client.createdAt, "MMM yyyy")}
          </HeaderFact>
          <HeaderFact icon={<MapPin />} label="Cidade">
            {city || <span className="text-muted-light">—</span>}
          </HeaderFact>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="label-caps mb-2">Jornada do cliente</p>
          <JourneyProgress currentStage={client.currentStage} instanceId={workflow.instance?.id ?? client.workflowInstanceId} steps={workflow.steps} />
        </div>
      </Card>
    </>
  );
}

/** Indicadores do cliente (MRR, em aberto, próximo vencimento, saúde), cada um levando à aba de detalhe. */
export function ClientKpis({ data }: { data: Client360 }) {
  const { client, financial } = data;
  const base = `/clientes/${client.id}`;
  const mrr = financial.mrr || client.mrr || 0;
  const openTotal = financial.openAmount + financial.overdueAmount;
  const next = buildUpcoming(data)[0];
  const health = data.healthScore?.score ?? client.healthScore;
  const level = data.healthScore?.level ?? client.healthLevel;
  const healthTone = level === "saudavel" ? "success" : level === "atencao" ? "warning" : level === "risco" ? "danger" : "neutral";

  // Celular: grade 2x2 com cards compactos; a partir de md, cards completos (padrão 12).
  const cards = (compact: boolean) => (
    <>
      <StatCard compact={compact} label="Receita mensal" value={mrr > 0 ? formatCurrency(mrr) : "—"} icon={<DollarSign />} tone="brand" href={`${base}?aba=financeiro`} hint="Ver detalhes" />
      <StatCard
        compact={compact}
        label="Em aberto"
        value={formatCurrency(openTotal)}
        icon={<Receipt />}
        tone={financial.overdueCount > 0 ? "danger" : "info"}
        valueTone={financial.overdueCount > 0}
        href={`${base}?aba=financeiro`}
        hint={financial.overdueCount > 0 ? `${formatCurrency(financial.overdueAmount)} vencido` : `${financial.openCount} cobrança${financial.openCount === 1 ? "" : "s"} a vencer`}
      />
      <StatCard
        compact={compact}
        label="Próximo vencimento"
        value={next ? formatDate(next.date) : "—"}
        icon={<CalendarClock />}
        tone="purple"
        href={`${base}?aba=financeiro`}
        hint={next ? `${next.title}${next.amount ? ` · ${formatCurrency(next.amount)}` : ""}` : "Nada a vencer"}
      />
      <StatCard
        compact={compact}
        label="Saúde do cliente"
        value={
          health !== undefined ? (
            <span className="inline-flex items-baseline gap-2">
              {health}
              {level ? <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", healthTone === "success" ? "bg-success-soft text-success-fg" : healthTone === "warning" ? "bg-warning-soft text-warning-fg" : "bg-danger-soft text-danger-fg")}>{HEALTH_LABELS[level]}</span> : null}
            </span>
          ) : (
            "—"
          )
        }
        icon={<HeartPulse />}
        tone={healthTone}
        href={`${base}?aba=cs`}
        hint={health !== undefined ? "Ver detalhes" : "Calculada após a ativação"}
      />
    </>
  );
  return (
    <>
      <KpiStrip columns={4} mobileColumns={2} className="mt-4 md:hidden">
        {cards(true)}
      </KpiStrip>
      <KpiStrip columns={4} className="mt-4 hidden md:grid">
        {cards(false)}
      </KpiStrip>
    </>
  );
}
