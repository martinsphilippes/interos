"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ChannelEventsAdmin } from "@/server/conversations/queries";
import type { ChannelEvent, ChannelEventResult } from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const RESULT: Record<ChannelEventResult, { label: string; variant: "success" | "info" | "danger" | "warning" | "muted" }> = {
  processado: { label: "Processado", variant: "success" },
  duplicado: { label: "Duplicado", variant: "info" },
  ignorado: { label: "Ignorado", variant: "muted" },
  falha: { label: "Falha", variant: "danger" },
  recusado: { label: "Recusado", variant: "warning" },
};
const KIND: Record<ChannelEvent["kind"], string> = { mensagem_recebida: "Mensagem recebida", status: "Status de entrega", envio: "Envio", autenticacao: "Assinatura" };

/**
 * Registros técnicos dos canais (últimos 30 dias): o que o provedor avisou e o que o INTEROS fez com cada aviso.
 * Serve para responder «o cliente diz que mandou e não chegou». Contato sempre mascarado.
 */
export function ChannelEventsLog({ data }: { data: ChannelEventsAdmin }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("aba", "registros");
    router.replace(`${pathname}?${next.toString()}`);
  };

  const s = data.summary;
  const tiles = [
    { label: "Mensagens recebidas", value: s.received, tone: "" },
    { label: "Duplicadas (ignoradas)", value: s.duplicates, tone: "" },
    { label: "Falhas", value: s.failures, tone: s.failures > 0 ? "text-danger-fg" : "" },
    { label: "Recusadas (assinatura)", value: s.rejected, tone: s.rejected > 0 ? "text-warning-fg" : "" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Últimas 24 horas">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface p-3 shadow-card">
            <p className="text-xs text-muted">{t.label} · 24 h</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <FilterBar className="mb-0">
        <FilterField label="Canal" htmlFor="ev-channel">
          <Select
            id="ev-channel"
            value={sp.get("canal") ?? ""}
            onChange={(e) => setParam("canal", e.target.value)}
            options={[
              { value: "", label: "Todos" },
              { value: "whatsapp", label: "WhatsApp" },
              { value: "email", label: "E-mail" },
            ]}
          />
        </FilterField>
        <FilterField label="Resultado" htmlFor="ev-result">
          <Select id="ev-result" value={sp.get("resultado") ?? ""} onChange={(e) => setParam("resultado", e.target.value)} options={[{ value: "", label: "Todos" }, ...Object.entries(RESULT).map(([k, v]) => ({ value: k, label: v.label }))]} />
        </FilterField>
        <FilterField label="Buscar" htmlFor="ev-q" className="min-w-[240px] flex-1">
          <SearchInput id="ev-q" value={sp.get("q") ?? ""} onChange={(v) => setParam("q", v)} debounceMs={400} placeholder="Final do número, código do erro, id da mensagem…" />
        </FilterField>
      </FilterBar>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Quando</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>O que aconteceu</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted">
                  Nenhum registro com esses filtros nos últimos 30 dias.
                </TableCell>
              </TableRow>
            ) : null}
            {data.events.map((e) => {
              const open = openId === e.id;
              return (
                <React.Fragment key={e.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpenId(open ? null : e.id)}>
                    <TableCell>
                      <button type="button" aria-expanded={open} aria-label={open ? "Fechar detalhes" : "Ver detalhes"} className="text-muted">
                        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatDateTime(e.occurredAt)}</TableCell>
                    <TableCell className="text-sm">{e.channel === "whatsapp" ? "WhatsApp" : "E-mail"}</TableCell>
                    <TableCell className="text-sm">{KIND[e.kind]}</TableCell>
                    <TableCell className="font-mono text-[13px]">{e.contactMasked ?? "—"}</TableCell>
                    <TableCell>
                      <Badge size="sm" variant={RESULT[e.result].variant}>
                        {RESULT[e.result].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[360px] truncate text-sm" title={e.detail}>
                        {e.detail}
                      </p>
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow className="bg-surface-muted/60">
                      <TableCell />
                      <TableCell colSpan={6}>
                        <dl className="grid gap-x-6 gap-y-1 py-1 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
                          <dt className="text-muted">Detalhe</dt>
                          <dd className="whitespace-pre-line">{e.detail}</dd>
                          {e.providerCode ? (
                            <>
                              <dt className="text-muted">Código do provedor</dt>
                              <dd className="font-mono">{e.providerCode}</dd>
                            </>
                          ) : null}
                          {e.externalId ? (
                            <>
                              <dt className="text-muted">Id no provedor</dt>
                              <dd className="break-all font-mono text-xs">{e.externalId}</dd>
                            </>
                          ) : null}
                          {typeof e.durationMs === "number" ? (
                            <>
                              <dt className="text-muted">Tempo de processamento</dt>
                              <dd className="tabular-nums">{e.durationMs} ms</dd>
                            </>
                          ) : null}
                          {e.conversationId ? (
                            <>
                              <dt className="text-muted">Conversa</dt>
                              <dd>
                                <Link href={`/comunicacao?conversa=${e.conversationId}`} className="text-brand-fg underline-offset-2 hover:underline" onClick={(ev) => ev.stopPropagation()}>
                                  Abrir na Central
                                </Link>
                              </dd>
                            </>
                          ) : null}
                        </dl>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted">Mostra os 200 mais recentes. Registros com mais de 30 dias são apagados automaticamente.</p>
    </div>
  );
}
