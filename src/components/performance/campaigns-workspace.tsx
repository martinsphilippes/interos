"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Gift, Pencil, Plus, Sparkles, Target, Trash2, Trophy } from "lucide-react";
import type { CampaignFormOptions, CampaignProgress } from "@/server/performance/queries";
import { deleteCampaign, upsertCampaign } from "@/server/performance/actions";
import { CAMPAIGN_EVENT_OPTIONS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES, type CampaignInput } from "@/server/performance/schemas";
import { formatKpiValue } from "@/server/kpis/schemas";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import type { GamificationCampaign } from "@/domain/types";
import { formatDateKey, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AttainmentBar } from "@/components/kpis/attainment-bar";

type Filter = "todas" | GamificationCampaign["status"];

interface FormState {
  id?: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  departments: DepartmentKey[];
  metricKind: "kpi" | "evento";
  kpiKey: string;
  eventType: string;
  target: string;
  prize: string;
  participantIds: string[];
  status: GamificationCampaign["status"];
}

const dayKey = (iso: string) => iso.slice(0, 10);

function toForm(c: GamificationCampaign | null, today: string): FormState {
  if (!c) return { name: "", description: "", startDate: today, endDate: today, departments: [], metricKind: "evento", kpiKey: "", eventType: "", target: "", prize: "", participantIds: [], status: "planejada" };
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    startDate: dayKey(c.startDate),
    endDate: dayKey(c.endDate),
    departments: c.departments,
    metricKind: c.metric.kind,
    kpiKey: c.metric.kind === "kpi" ? c.metric.kpiKey : "",
    eventType: c.metric.kind === "evento" ? c.metric.eventType : "",
    target: String(c.target).replace(".", ","),
    prize: c.prize ?? "",
    participantIds: c.participantIds,
    status: c.status,
  };
}

function parseNumber(text: string): number {
  const t = text.trim();
  return t ? Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) : Number.NaN;
}

function metricText(item: CampaignProgress): string {
  if (item.campaign.metric.kind === "evento") {
    const type = item.campaign.metric.eventType;
    return CAMPAIGN_EVENT_OPTIONS.find((o) => o.value === type)?.label ?? item.metricLabel;
  }
  return item.metricLabel;
}

function CampaignCard({ item, canManage, onEdit, onDelete }: { item: CampaignProgress; canManage: boolean; onEdit: () => void; onDelete: () => void }) {
  const c = item.campaign;
  const fmt = (v: number | null) => (c.metric.kind === "evento" ? (v === null ? "—" : String(v)) : formatKpiValue(v, item.unit, item.suffix));
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? item.participants : item.participants.slice(0, 5);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{c.name}</h3>
            <Badge variant={CAMPAIGN_STATUS_TONES[c.status]} size="sm">
              {CAMPAIGN_STATUS_LABELS[c.status]}
            </Badge>
          </div>
          {c.description ? <p className="mt-0.5 text-sm text-muted">{c.description}</p> : null}
        </div>
        {canManage ? (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Editar ${c.name}`} onClick={onEdit}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Remover ${c.name}`} onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </header>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-1.5">
          <CalendarRange className="size-4 shrink-0 text-muted" aria-hidden />
          <dd>
            {formatDateKey(dayKey(c.startDate))} a {formatDateKey(dayKey(c.endDate))}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Target className="size-4 shrink-0 text-muted" aria-hidden />
          <dd>
            {metricText(item)} · meta {fmt(c.target)} por pessoa
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-4 shrink-0 text-muted" aria-hidden />
          <dd>{c.departments.map((d) => DEPARTMENT_LABELS[d]).join(", ")}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Gift className="size-4 shrink-0 text-muted" aria-hidden />
          <dd>{c.prize || "Sem prêmio definido"}</dd>
        </div>
      </dl>
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Progresso médio dos participantes</span>
          <span>
            {item.reachedCount} de {item.participants.length} atingiram a meta
          </span>
        </div>
        <AttainmentBar attainment={item.progress} status={item.progress === null ? null : item.progress >= 1 ? "atingida" : item.progress >= 0.85 ? "atencao" : "critico"} />
      </div>
      {item.mine ? (
        <p className="rounded-md bg-brand-soft px-3 py-2 text-sm text-brand-fg">
          Você está em {item.mine.position}º com {fmt(item.mine.value)} ({formatPercent(item.mine.attainment)} da meta){item.mine.reached ? " · meta atingida!" : ""}
        </p>
      ) : null}
      {item.participants.length === 0 ? (
        <p className="text-sm text-muted">Nenhum participante ativo nos departamentos escolhidos.</p>
      ) : (
        <ol className="divide-y divide-border rounded-md border border-border">
          {shown.map((p) => (
            <li key={p.userId} className="grid grid-cols-[32px_minmax(0,1fr)_80px] items-center gap-2 px-3 py-2 sm:grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_80px]">
              <span className={cn("text-sm font-bold tabular-nums", p.position <= 3 && "text-brand-fg")}>{p.position}º</span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{p.name}</span>
                <span className="block text-xs text-muted">{DEPARTMENT_LABELS[p.department]}</span>
              </span>
              <span className="hidden sm:block">
                <AttainmentBar attainment={p.attainment} status={p.status} size="sm" />
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {fmt(p.value)} {p.reached ? <Trophy className="inline size-3.5 text-warning" aria-label="Meta atingida" /> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
      {item.participants.length > 5 ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos" : `Ver todos (${item.participants.length})`}
        </Button>
      ) : null}
    </section>
  );
}

/** Campanhas e desafios de gamificação com progresso calculado; CRUD para gestor/diretoria/admin. */
export function CampaignsWorkspace({ items, options, canManage, today }: { items: CampaignProgress[]; options: CampaignFormOptions; canManage: boolean; today: string }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("todas");
  const [form, setForm] = React.useState<FormState | null>(null);
  const [toDelete, setToDelete] = React.useState<GamificationCampaign | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const counts: Record<Filter, number> = { todas: items.length, planejada: 0, ativa: 0, encerrada: 0 };
  for (const i of items) counts[i.campaign.status] += 1;
  const visible = items.filter((i) => filter === "todas" || i.campaign.status === filter);
  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    const input: CampaignInput = {
      id: form.id,
      name: form.name,
      description: form.description || undefined,
      startDate: form.startDate,
      endDate: form.endDate,
      departments: form.departments,
      metricKind: form.metricKind,
      kpiKey: form.metricKind === "kpi" ? form.kpiKey : undefined,
      eventType: form.metricKind === "evento" ? form.eventType : undefined,
      target: parseNumber(form.target),
      prize: form.prize || undefined,
      participantIds: form.participantIds,
      status: form.status,
    };
    startTransition(async () => {
      const result = await upsertCampaign(input);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(form.id ? "Campanha atualizada" : "Campanha criada");
      setForm(null);
      router.refresh();
    });
  };

  const onDelete = async () => {
    if (!toDelete) return;
    const result = await deleteCampaign({ id: toDelete.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Campanha removida");
    router.refresh();
  };

  const eligibleUsers = form ? options.users.filter((u) => form.departments.length === 0 || form.departments.includes(u.department)) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentedControl<Filter>
          aria-label="Filtrar campanhas"
          value={filter}
          onChange={setFilter}
          className="max-w-full overflow-x-auto"
          options={[
            { value: "todas", label: `Todas (${counts.todas})` },
            { value: "ativa", label: `Ativas (${counts.ativa})` },
            { value: "planejada", label: `Planejadas (${counts.planejada})` },
            { value: "encerrada", label: `Encerradas (${counts.encerrada})` },
          ]}
        />
        {canManage ? (
          <Button className="min-h-[44px] md:min-h-0" onClick={() => setForm(toForm(null, today))}>
            <Plus /> Nova campanha
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Trophy />}
            title="Nenhuma campanha"
            description={canManage ? "Crie desafios com meta por pessoa medida por um indicador do sistema ou pela contagem de eventos (ex.: chamados resolvidos, negócios ganhos)." : "Quando o gestor lançar uma campanha para o seu departamento, ela aparece aqui."}
            action={canManage ? <Button onClick={() => setForm(toForm(null, today))}>Nova campanha</Button> : null}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visible.map((item) => (
            <CampaignCard key={item.campaign.id} item={item} canManage={canManage} onEdit={() => setForm(toForm(item.campaign, today))} onDelete={() => setToDelete(item.campaign)} />
          ))}
        </div>
      )}

      <Drawer open={form !== null} onOpenChange={(v) => !v && !pending && setForm(null)}>
        <DrawerContent size="md">
          {form ? (
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <DrawerHeader>
                <DrawerTitle>{form.id ? "Editar campanha" : "Nova campanha"}</DrawerTitle>
                <DrawerDescription>Meta por participante. O progresso é calculado pelo motor de indicadores ou pela contagem de eventos no período.</DrawerDescription>
              </DrawerHeader>
              <DrawerBody className="flex flex-col gap-3">
                <FormField label="Nome" required>
                  <Input value={form.name} required onChange={(e) => patch({ name: e.target.value })} placeholder="Desafio SLA de outubro" />
                </FormField>
                <FormField label="Descrição">
                  <Textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} className="min-h-[64px]" />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Início" required>
                    <DateInput value={form.startDate} required onChange={(e) => patch({ startDate: e.target.value })} />
                  </FormField>
                  <FormField label="Fim" required>
                    <DateInput value={form.endDate} required onChange={(e) => patch({ endDate: e.target.value })} />
                  </FormField>
                </div>
                <FormField label="Departamentos" required>
                  <div className="grid grid-cols-2 gap-1">
                    {DEPARTMENT_KEYS.filter((d) => d !== "diretoria").map((d) => (
                      <Checkbox
                        key={d}
                        label={DEPARTMENT_LABELS[d]}
                        checked={form.departments.includes(d)}
                        onCheckedChange={(v) => patch({ departments: v === true ? [...form.departments, d] : form.departments.filter((x) => x !== d) })}
                      />
                    ))}
                  </div>
                </FormField>
                <FormField label="Métrica" required>
                  <SegmentedControl<"kpi" | "evento">
                    aria-label="Tipo de métrica"
                    value={form.metricKind}
                    onChange={(v) => patch({ metricKind: v })}
                    options={[
                      { value: "evento", label: "Contagem de eventos" },
                      { value: "kpi", label: "Indicador (KPI)" },
                    ]}
                  />
                </FormField>
                {form.metricKind === "kpi" ? (
                  <FormField label="Indicador" required>
                    <Select value={form.kpiKey} required placeholder="Escolha o indicador" onChange={(e) => patch({ kpiKey: e.target.value })} options={options.kpis.map((k) => ({ value: k.key, label: `${k.name} · ${k.department}` }))} />
                  </FormField>
                ) : (
                  <FormField label="Evento contado" required hint="Cada evento conta para o colaborador responsável (dono, atendente ou quem originou).">
                    <Select value={form.eventType} required placeholder="Escolha o evento" onChange={(e) => patch({ eventType: e.target.value })} options={CAMPAIGN_EVENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
                  </FormField>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Meta por pessoa" required hint={form.metricKind === "kpi" ? "Percentuais como fração (0,9 = 90%)" : undefined}>
                    <Input inputMode="decimal" value={form.target} required onChange={(e) => patch({ target: e.target.value })} />
                  </FormField>
                  <FormField label="Status" required>
                    <Select value={form.status} onChange={(e) => patch({ status: e.target.value as GamificationCampaign["status"] })} options={Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
                  </FormField>
                </div>
                <FormField label="Prêmio">
                  <Input value={form.prize} onChange={(e) => patch({ prize: e.target.value })} placeholder="Ex.: folga no dia do aniversário" />
                </FormField>
                <FormField label="Participantes" hint="Sem seleção, participam todos os colaboradores ativos dos departamentos escolhidos.">
                  {eligibleUsers.length === 0 ? (
                    <p className="text-xs text-muted">Escolha os departamentos para listar as pessoas.</p>
                  ) : (
                    <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                      {eligibleUsers.map((u) => (
                        <Checkbox
                          key={u.id}
                          label={u.name}
                          description={DEPARTMENT_LABELS[u.department]}
                          checked={form.participantIds.includes(u.id)}
                          onCheckedChange={(v) => patch({ participantIds: v === true ? [...form.participantIds, u.id] : form.participantIds.filter((x) => x !== u.id) })}
                        />
                      ))}
                    </div>
                  )}
                </FormField>
                {error ? (
                  <p className="text-sm text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </DrawerBody>
              <DrawerFooter>
                <Button variant="outline" onClick={() => setForm(null)} disabled={pending} className="min-h-[44px] md:min-h-0">
                  Cancelar
                </Button>
                <Button type="submit" loading={pending} className="min-h-[44px] md:min-h-0">
                  Salvar
                </Button>
              </DrawerFooter>
            </form>
          ) : null}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog open={toDelete !== null} onOpenChange={(v) => !v && setToDelete(null)} title="Remover campanha?" description={toDelete ? `"${toDelete.name}" e o seu ranking deixam de aparecer. Os pontos e eventos continuam no sistema.` : undefined} destructive confirmLabel="Remover" onConfirm={onDelete} />
    </div>
  );
}
