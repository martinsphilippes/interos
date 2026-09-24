"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Flag, Pencil, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateInput, isoToDateValue } from "@/components/ui/date-input";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { saveCampaign } from "@/server/marketing/actions";
import { CampaignStatusBadge } from "./lead-badges";
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUS_LABELS, campaignChannelLabel, leadsHref, type CampaignRow, type UserOption } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";

function Period({ c }: { c: CampaignRow }) {
  return (
    <span className="tabular-nums">
      {formatDate(c.startDate)} – {c.endDate ? formatDate(c.endDate) : "em aberto"}
    </span>
  );
}

function Spend({ c }: { c: CampaignRow }) {
  const pct = c.budget > 0 ? (c.spent / c.budget) * 100 : 0;
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <span className="text-sm tabular-nums">
        {formatCurrency(c.spent)} <span className="text-xs text-muted">de {formatCurrency(c.budget)}</span>
      </span>
      <Progress value={pct} size="sm" tone={pct > 100 ? "danger" : pct > 85 ? "warning" : "secondary"} />
    </div>
  );
}

/** Tabela de campanhas (métricas calculadas dos leads) + drawer de criação/edição (?campanha=<id>|nova). */
export function CampaignsView({ campaigns, editing, users, canEdit }: { campaigns: CampaignRow[]; editing: CampaignRow | "nova" | null; users: UserOption[]; canEdit: boolean }) {
  const { navigate } = useMarketingUrl();
  const edit = (id: string) => navigate({ campanha: id });

  return (
    <>
      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Flag />}
            title="Nenhuma campanha cadastrada"
            description="Cadastre campanhas para medir leads, MQLs e custo por lead de cada ação."
            action={
              canEdit ? (
                <Button onClick={() => navigate({ campanha: "nova" })}>
                  <Plus /> Nova campanha
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Investimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">MQLs</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className="block font-medium">{c.name}</span>
                      <span className="text-xs text-muted">{c.ownerName ?? "Sem responsável"}</span>
                    </TableCell>
                    <TableCell className="text-sm">{campaignChannelLabel(c.channel)}</TableCell>
                    <TableCell className="text-sm">
                      <Period c={c} />
                    </TableCell>
                    <TableCell>
                      <Spend c={c} />
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={leadsHref({ campaignId: c.id, sort: "data" })} className="font-medium tabular-nums text-brand hover:underline">
                        {formatNumber(c.leads)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={leadsHref({ campaignId: c.id, status: ["qualificado", "convertido"] })} className="tabular-nums hover:underline">
                        {formatNumber(c.mqls)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.cpl === null ? "—" : formatCurrency(c.cpl)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(c.conversion)}</TableCell>
                    <TableCell className="text-right">
                      {canEdit ? (
                        <Button variant="ghost" size="icon" onClick={() => edit(c.id)} aria-label={`Editar ${c.name}`}>
                          <Pencil />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <ul className="flex flex-col gap-2 md:hidden">
            {campaigns.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-surface p-3 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted">
                      {campaignChannelLabel(c.channel)} · <Period c={c} />
                    </p>
                  </div>
                  <CampaignStatusBadge status={c.status} />
                </div>
                <div className="mt-2">
                  <Spend c={c} />
                </div>
                <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <dt className="text-muted">Leads</dt>
                    <dd className="font-semibold tabular-nums">{c.leads}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">MQLs</dt>
                    <dd className="font-semibold tabular-nums">{c.mqls}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">CPL</dt>
                    <dd className="font-semibold tabular-nums">{c.cpl === null ? "—" : formatCurrency(c.cpl, true)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Conv.</dt>
                    <dd className="font-semibold tabular-nums">{formatPercent(c.conversion)}</dd>
                  </div>
                </dl>
                <div className="mt-2 flex gap-2">
                  <Button asChild variant="outline" size="sm" className="h-11 flex-1 md:h-8">
                    <Link href={leadsHref({ campaignId: c.id, sort: "data" })}>
                      <Users /> Ver leads <ChevronRight />
                    </Link>
                  </Button>
                  {canEdit ? (
                    <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => edit(c.id)}>
                      <Pencil /> Editar
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <CampaignDrawer editing={editing} users={users} onClose={() => navigate({ campanha: null }, { replace: true })} />
    </>
  );
}

export function NewCampaignButton() {
  const { navigate } = useMarketingUrl();
  return (
    <Button onClick={() => navigate({ campanha: "nova" })}>
      <Plus /> Nova campanha
    </Button>
  );
}

function CampaignDrawer({ editing, users, onClose }: { editing: CampaignRow | "nova" | null; users: UserOption[]; onClose: () => void }) {
  return (
    <Drawer open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="sm">{editing ? <CampaignForm key={editing === "nova" ? "nova" : editing.id} campaign={editing === "nova" ? null : editing} users={users} onDone={onClose} /> : null}</DrawerContent>
    </Drawer>
  );
}

function CampaignForm({ campaign, users, onDone }: { campaign: CampaignRow | null; users: UserOption[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState(() => ({
    name: campaign?.name ?? "",
    channel: campaign?.channel ?? "anuncio",
    startDate: isoToDateValue(campaign?.startDate) || new Date().toISOString().slice(0, 10),
    endDate: isoToDateValue(campaign?.endDate),
    budget: campaign ? String(campaign.budget) : "",
    spent: campaign ? String(campaign.spent) : "0",
    status: campaign?.status ?? "planejada",
    ownerId: campaign?.ownerId ?? "",
  }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const money = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveCampaign({
        id: campaign?.id,
        name: form.name,
        channel: form.channel,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        budget: money(form.budget || "0"),
        spent: money(form.spent || "0"),
        status: form.status,
        ownerId: form.ownerId || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(campaign ? "Campanha atualizada" : "Campanha criada");
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader>
        <DrawerTitle>{campaign ? "Editar campanha" : "Nova campanha"}</DrawerTitle>
        <DrawerDescription>{campaign ? `${campaign.leads} lead(s) e ${campaign.mqls} MQL(s) atribuídos até agora.` : "Leads vinculados à campanha alimentam o CPL e a conversão."}</DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <FormField label="Nome" htmlFor="camp-name" required>
          <Input id="camp-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={3} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Canal" htmlFor="camp-channel" required>
            <Select id="camp-channel" value={form.channel} onChange={(e) => set({ channel: e.target.value })}>
              {CAMPAIGN_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              {!CAMPAIGN_CHANNELS.some((c) => c.value === form.channel) ? <option value={form.channel}>{form.channel}</option> : null}
            </Select>
          </FormField>
          <FormField label="Status" htmlFor="camp-status" required>
            <Select id="camp-status" value={form.status} onChange={(e) => set({ status: e.target.value as CampaignRow["status"] })}>
              {Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Início" htmlFor="camp-start" required>
            <DateInput id="camp-start" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} required />
          </FormField>
          <FormField label="Fim" htmlFor="camp-end">
            <DateInput id="camp-end" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} min={form.startDate} />
          </FormField>
          <FormField label="Orçamento (R$)" htmlFor="camp-budget" required>
            <Input id="camp-budget" inputMode="decimal" value={form.budget} onChange={(e) => set({ budget: e.target.value })} required className="tabular-nums" />
          </FormField>
          <FormField label="Gasto até agora (R$)" htmlFor="camp-spent" required>
            <Input id="camp-spent" inputMode="decimal" value={form.spent} onChange={(e) => set({ spent: e.target.value })} required className="tabular-nums" />
          </FormField>
        </div>
        <FormField label="Responsável" htmlFor="camp-owner">
          <Select id="camp-owner" value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">Eu mesmo</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FormField>
        {campaign ? (
          <Link href={leadsHref({ campaignId: campaign.id, sort: "data" })} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            Ver os leads desta campanha <ChevronRight className="size-4" />
          </Link>
        ) : null}
      </DrawerBody>
      <DrawerFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {campaign ? "Salvar" : "Criar campanha"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
