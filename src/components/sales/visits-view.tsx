"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, CheckCircle2, ExternalLink, MapPin, Navigation, RefreshCw, Target, XCircle } from "lucide-react";
import type { TimelineEvent } from "@/domain/types";
import { VISIT_KIND_LABELS } from "@/domain/sales-extra";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Timeline } from "@/components/timeline/timeline";
import { formatDateTime, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelVisitAction, completeVisitAction, rescheduleVisitAction } from "@/server/sales/actions";
import type { VisitRow } from "@/server/sales/queries";
import { VISIT_STATUS_LABELS, VISIT_STATUS_VARIANT, opportunityHref } from "./model";
import { useSalesUrl } from "./use-sales-url";

const PENDING = new Set<VisitRow["status"]>(["agendada", "remarcada"]);

function Distance({ visit }: { visit: Pick<VisitRow, "distanceKm" | "travelMinutes"> }) {
  if (visit.distanceKm === undefined) return null;
  const minutes = visit.travelMinutes ?? 0;
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted tabular-nums" title="Distância estimada a partir da sede (Juazeiro do Norte)">
      <Navigation className="size-3.5" aria-hidden />
      {visit.distanceKm.toLocaleString("pt-BR")} km · ~{time} da sede
    </span>
  );
}

/** Lista de visitas (pendentes primeiro) com filtro de status; clique abre o drawer (?visita=). */
export function VisitsList({ rows }: { rows: VisitRow[] }) {
  const { searchParams, setLocal, navigate } = useSalesUrl();
  const status = searchParams.get("status") ?? "pendentes";
  const filtered = rows.filter((v) => (status === "pendentes" ? PENDING.has(v.status) : status === "todas" ? true : v.status === status));
  const nowIso = new Date().toISOString();

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Select size="sm" aria-label="Status" value={status} onChange={(e) => setLocal({ status: e.target.value === "pendentes" ? null : e.target.value })} className="w-48">
          <option value="pendentes">Pendentes</option>
          <option value="realizada">Realizadas</option>
          <option value="cancelada">Canceladas</option>
          <option value="todas">Todas</option>
        </Select>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {filtered.length} de {rows.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<MapPin />} title="Nenhuma visita" description={status === "pendentes" ? "Sem visitas agendadas. Agende a próxima a partir de uma oportunidade ou pelo botão acima." : "Nada neste filtro."} />
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {filtered.map((v) => {
            const late = PENDING.has(v.status) && v.scheduledAt < nowIso;
            return (
              <li key={v.id}>
                <button type="button" onClick={() => navigate({ visita: v.id })} className="flex w-full gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-card transition-colors hover:border-border-strong active:bg-surface-hover">
                  <span className={cn("flex w-14 shrink-0 flex-col items-center justify-center rounded-md py-1 text-center", late ? "bg-danger-soft text-danger-fg" : "bg-secondary-soft text-secondary-fg")}>
                    <span className="text-[11px] font-semibold uppercase">{formatDay(v.scheduledAt)}</span>
                    <span className="text-sm font-bold tabular-nums">{formatTime(v.scheduledAt)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{v.clientName}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {v.kind === "tecnica" ? (
                          <Badge variant="purple" size="sm">
                            Técnica
                          </Badge>
                        ) : null}
                        <Badge variant={VISIT_STATUS_VARIANT[v.status]} size="sm">
                          {VISIT_STATUS_LABELS[v.status]}
                        </Badge>
                      </span>
                    </span>
                    <span className="block truncate text-sm text-muted">{v.objective}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Avatar name={v.sellerName} src={v.sellerAvatarUrl} size="xs" /> {v.sellerName}
                      </span>
                      <Distance visit={v} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function VisitDrawer({ detail }: { detail: { visit: VisitRow; activities: TimelineEvent[] } | null }) {
  const { navigate } = useSalesUrl();
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && navigate({ visita: null }, { replace: true })}>
      <DrawerContent size="md">{detail ? <VisitInner key={detail.visit.id} visit={detail.visit} activities={detail.activities} /> : null}</DrawerContent>
    </Drawer>
  );
}

function VisitInner({ visit, activities }: { visit: VisitRow; activities: TimelineEvent[] }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<"concluir" | "cancelar" | "remarcar" | null>(null);
  const [text, setText] = React.useState("");
  const [when, setWhen] = React.useState(isoToDateTimeLocal(visit.scheduledAt));
  const [pending, startTransition] = React.useTransition();
  const pendingVisit = PENDING.has(visit.status);

  const run = (kind: "concluir" | "cancelar" | "remarcar") =>
    startTransition(async () => {
      const result =
        kind === "concluir"
          ? await completeVisitAction({ visitId: visit.id, result: text })
          : kind === "cancelar"
            ? await cancelVisitAction({ visitId: visit.id, reason: text })
            : await rescheduleVisitAction({ visitId: visit.id, scheduledAt: dateValueToIso(when) ?? "", reason: text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(kind === "concluir" ? "Visita concluída e registrada na timeline" : kind === "cancelar" ? "Visita cancelada" : "Visita remarcada");
      setDialog(null);
      setText("");
      router.refresh();
    });

  const openDialog = (kind: "concluir" | "cancelar" | "remarcar") => {
    setText("");
    setDialog(kind);
  };

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={VISIT_STATUS_VARIANT[visit.status]} size="md">
            {VISIT_STATUS_LABELS[visit.status]}
          </Badge>
          <Badge variant={visit.kind === "tecnica" ? "purple" : "outline"} size="md">
            Visita {VISIT_KIND_LABELS[visit.kind ?? "comercial"].toLowerCase()}
          </Badge>
        </div>
        <DrawerTitle className="mt-1">{visit.objective}</DrawerTitle>
        <DrawerDescription asChild>
          <div className="flex flex-col gap-1.5 text-sm">
            {visit.clientId ? (
              <Link href={`/clientes/${visit.clientId}`} className="inline-flex items-center gap-1.5 font-medium text-secondary hover:underline">
                <Building2 className="size-4" /> {visit.clientName}
              </Link>
            ) : null}
            {visit.opportunityId ? (
              <Link href={opportunityHref(visit.opportunityId)} className="inline-flex items-center gap-1.5 text-muted hover:text-foreground hover:underline">
                <Target className="size-4" /> {visit.opportunityTitle ?? "Oportunidade"}
              </Link>
            ) : null}
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <CalendarClock className="size-4 text-muted" /> {formatDateTime(visit.scheduledAt)} · {visit.durationMinutes} min · {visit.sellerName}
            </span>
          </div>
        </DrawerDescription>
        {pendingVisit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="min-h-[44px] md:min-h-0" onClick={() => openDialog("concluir")}>
              <CheckCircle2 /> Concluir
            </Button>
            <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => openDialog("remarcar")}>
              <RefreshCw /> Remarcar
            </Button>
            <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => openDialog("cancelar")}>
              <XCircle className="text-danger" /> Cancelar
            </Button>
          </div>
        ) : null}
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-5">
        <section className="rounded-lg border border-border p-3">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="size-4 text-muted" /> Endereço
          </h4>
          <p className="text-sm">{visit.addressLine || "Sem endereço cadastrado"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Distance visit={visit} />
            {visit.mapsUrl ? (
              <Button variant="outline" size="sm" asChild className="min-h-[44px] md:min-h-0">
                <a href={visit.mapsUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> Abrir no Google Maps
                </a>
              </Button>
            ) : null}
          </div>
        </section>
        {visit.notes ? (
          <section>
            <h4 className="mb-1 text-sm font-semibold">Observações</h4>
            <p className="whitespace-pre-line text-sm text-muted">{visit.notes}</p>
          </section>
        ) : null}
        {visit.result ? (
          <section>
            <h4 className="mb-1 text-sm font-semibold">Resultado</h4>
            <p className="whitespace-pre-line text-sm">{visit.result}</p>
          </section>
        ) : null}
        <section>
          <h4 className="mb-2 text-sm font-semibold">Histórico</h4>
          <Timeline events={activities} showFilters={false} emptyTitle="Sem eventos" />
        </section>
      </DrawerBody>

      <Dialog open={dialog !== null} onOpenChange={(v) => !pending && !v && setDialog(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{dialog === "concluir" ? "Concluir visita" : dialog === "cancelar" ? "Cancelar visita" : "Remarcar visita"}</DialogTitle>
            <DialogDescription>{dialog === "concluir" ? "O resultado vai para a timeline do cliente." : dialog === "cancelar" ? "Informe o motivo do cancelamento." : "Escolha a nova data e hora."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {dialog === "remarcar" ? (
              <FormField label="Nova data e hora" htmlFor="visita-nova-data" required>
                <DateInput id="visita-nova-data" mode="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </FormField>
            ) : null}
            <FormField label={dialog === "concluir" ? "Resultado" : dialog === "cancelar" ? "Motivo" : "Motivo (opcional)"} htmlFor="visita-texto" required={dialog !== "remarcar"}>
              <Textarea id="visita-texto" value={text} onChange={(e) => setText(e.target.value)} placeholder={dialog === "concluir" ? "O que foi visto, combinado e os próximos passos" : ""} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              Voltar
            </Button>
            <Button variant={dialog === "cancelar" ? "destructive" : "primary"} onClick={() => dialog && run(dialog)} loading={pending} disabled={dialog !== "remarcar" && text.trim().length < 3}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
