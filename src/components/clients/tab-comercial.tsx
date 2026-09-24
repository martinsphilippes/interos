import Link from "next/link";
import { ExternalLink, Target, TrendingUp } from "lucide-react";
import type { Client360, ClientFormOptions } from "@/server/clients/queries";
import { formatCurrency, formatDate, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { UserCell } from "./client-badges";
import { OPPORTUNITY_KIND_LABELS, OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGE_VARIANT, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_VARIANT, TEMPERATURE_LABELS } from "./labels";
import { UpsellDialog } from "./upsell-dialog";

const LEAD_STATUS_LABELS: Record<string, string> = { novo: "Novo", em_contato: "Em contato", qualificado: "Qualificado (MQL)", desqualificado: "Desqualificado", convertido: "Convertido" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label-caps">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Aba Comercial: origem, lead, vendedor, oportunidades e propostas. */
export function TabComercial({ data, options }: { data: Client360; options: ClientFormOptions }) {
  const { client, lead, campaign, opportunities, proposals, users, availableProducts, ownedCategories } = data;
  const now = new Date().toISOString();
  const originName = client.origin ? (options.leadSources.find((s) => s.key === client.origin)?.name ?? client.origin) : "—";
  const openOpps = opportunities.filter((o) => o.stage !== "ganho" && o.stage !== "perdido");
  const pipelineMonthly = openOpps.reduce((s, o) => s + o.monthlyTotal, 0);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Origem e qualificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-0 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Origem">{originName}</Field>
          <Field label="Campanha">{campaign ? campaign.name : "—"}</Field>
          <Field label="Vendedor responsável">
            <UserCell users={users} id={client.ownerSalesId} size="md" withSubtitle />
          </Field>
          <Field label="Score do lead">
            {lead ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">{lead.score}</span>
                <Badge variant={lead.temperature === "quente" ? "danger" : lead.temperature === "morno" ? "warning" : "info"} size="sm">
                  {TEMPERATURE_LABELS[lead.temperature]}
                </Badge>
              </span>
            ) : (
              "—"
            )}
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="label-caps mb-2">Lead vinculado</p>
            {lead ? (
              <div className="grid gap-3 rounded-md border border-border bg-surface-muted p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="font-medium">{lead.name}</p>
                  <p className="text-xs text-muted">{lead.company ?? "—"}</p>
                </div>
                <div className="text-muted">
                  <p>{lead.phone ?? "—"}</p>
                  <p className="truncate">{lead.email ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Interesse</p>
                  <p>{lead.interest ?? "—"}</p>
                </div>
                <div className="flex flex-col items-start gap-1">
                  <Badge variant={lead.status === "convertido" || lead.status === "qualificado" ? "success" : lead.status === "desqualificado" ? "danger" : "info"} size="sm">
                    {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                  </Badge>
                  <span className="text-xs text-muted">
                    Recebido {formatRelative(lead.createdAt)}
                    {lead.consent ? " · consentimento LGPD" : ""}
                  </span>
                  <Link href={`/marketing/leads?lead=${lead.id}`} className="inline-flex items-center gap-1 text-xs text-secondary hover:underline">
                    Abrir lead <ExternalLink className="size-3" aria-hidden />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Sem lead vinculado: cliente cadastrado diretamente ou importado.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <section>
        <SectionTitle
          title="Oportunidades"
          count={opportunities.length}
          description={openOpps.length > 0 ? `${openOpps.length} em aberto · ${formatCurrency(pipelineMonthly)}/mês em negociação` : undefined}
          actions={
            <UpsellDialog
              clientId={client.id}
              clientName={client.tradeName}
              products={availableProducts}
              ownedCategories={ownedCategories}
              trigger={
                <Button size="sm">
                  <TrendingUp /> Nova oportunidade
                </Button>
              }
            />
          }
        />
        <Card className="overflow-hidden">
          {opportunities.length === 0 ? (
            <EmptyState size="sm" icon={<Target />} title="Nenhuma oportunidade" description="Gere uma oportunidade de venda para este cliente." />
          ) : (
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead>Próxima ação</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((o) => {
                  const overdue = Boolean(o.nextActionAt && o.nextActionAt < now && o.stage !== "ganho" && o.stage !== "perdido");
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="max-w-[280px]">
                        <p className="truncate font-medium">{o.title}</p>
                        <p className="truncate text-xs text-muted">
                          {o.products.map((p) => p.productName).join(", ")} · {TEMPERATURE_LABELS[o.temperature]} · {o.probability}%
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted">{OPPORTUNITY_KIND_LABELS[o.kind]}</TableCell>
                      <TableCell>
                        <Badge variant={OPPORTUNITY_STAGE_VARIANT[o.stage]} size="sm">
                          {OPPORTUNITY_STAGE_LABELS[o.stage]}
                        </Badge>
                        {o.stage === "perdido" && o.lossReason ? <p className="mt-0.5 text-xs text-muted">{o.lossReason}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(o.monthlyTotal)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(o.setupTotal)}</TableCell>
                      <TableCell className="max-w-[220px]">
                        {o.nextAction ? (
                          <>
                            <p className="truncate">{o.nextAction}</p>
                            {o.nextActionAt ? <p className={cn("text-xs", overdue ? "text-danger-fg" : "text-muted")}>{overdue ? "Vencida " : ""}{formatRelative(o.nextActionAt)}</p> : null}
                          </>
                        ) : (
                          <span className="text-muted-light">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <UserCell users={users} id={o.ownerId} />
                      </TableCell>
                      <TableCell>
                        <Link href={`/vendas/oportunidades?oportunidade=${o.id}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Abrir oportunidade">
                          <ExternalLink className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle title="Propostas" count={proposals.length} />
        <Card className="overflow-hidden">
          {proposals.length === 0 ? (
            <EmptyState size="sm" title="Nenhuma proposta" description="As propostas enviadas ao cliente aparecem aqui." />
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead>Enviada</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {p.number} <span className="text-xs text-muted">v{p.version}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={PROPOSAL_STATUS_VARIANT[p.status]} size="sm">
                        {PROPOSAL_STATUS_LABELS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.monthlyTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.setupTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDate(p.sentAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDate(p.validUntil)}</TableCell>
                    <TableCell>
                      <UserCell users={users} id={p.ownerId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
