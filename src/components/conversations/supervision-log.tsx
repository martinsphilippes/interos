"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SupervisionLogRow } from "@/server/conversations/supervision";
import { formatDurationShort } from "@/domain/conversation-history";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ACTION: Record<SupervisionLogRow["action"], { label: string; variant: "info" | "warning" | "danger" | "secondary" | "muted" }> = {
  acompanhar: { label: "Acompanhou", variant: "info" },
  sussurro: { label: "Sussurrou", variant: "warning" },
  assumir: { label: "Assumiu", variant: "secondary" },
  transferir: { label: "Transferiu", variant: "muted" },
  escalar: { label: "Escalou", variant: "danger" },
};

/** Registro de supervisão: quem acompanhou quem, quando e por quanto tempo (e sussurros, assumir, escalar). */
export function SupervisionLogView({ rows, supervisors, days }: { rows: SupervisionLogRow[]; supervisors: { id: string; name: string }[]; days: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("aba", "registro");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-4">
      <FilterBar className="mb-0">
        <FilterField label="Supervisor" htmlFor="sl-sup">
          <Select id="sl-sup" value={sp.get("supervisor") ?? ""} onChange={(e) => setParam("supervisor", e.target.value)} options={[{ value: "", label: "Todos" }, ...supervisors.map((s) => ({ value: s.id, label: s.name }))]} />
        </FilterField>
        <FilterField label="Período" htmlFor="sl-dias">
          <Select
            id="sl-dias"
            value={String(days)}
            onChange={(e) => setParam("dias", e.target.value === "7" ? "" : e.target.value)}
            options={[
              { value: "1", label: "Hoje e ontem" },
              { value: "7", label: "Últimos 7 dias" },
              { value: "30", label: "Últimos 30 dias" },
              { value: "90", label: "Últimos 90 dias" },
            ]}
          />
        </FilterField>
      </FilterBar>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Supervisor</TableHead>
              <TableHead>O que fez</TableHead>
              <TableHead>Operador</TableHead>
              <TableHead>Atendimento</TableHead>
              <TableHead>Duração / detalhe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted">
                  Nenhuma supervisão no período.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatDateTime(r.at)}</TableCell>
                <TableCell className="text-sm">{r.supervisorName}</TableCell>
                <TableCell>
                  <Badge size="sm" variant={ACTION[r.action].variant}>
                    {ACTION[r.action].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{r.operatorName ?? <span className="text-muted">—</span>}</TableCell>
                <TableCell className="text-sm">
                  <Link href={`/comunicacao?conversa=${r.conversationId}`} className="font-medium text-brand-fg hover:underline">
                    {r.conversationNumber ?? "abrir"}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-sm" title={r.detail}>
                  {r.durationMs !== undefined ? formatDurationShort(Math.max(r.durationMs, 60_000)) : (r.detail ?? "—")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted">Mostra até 300 registros. O tempo de «Acompanhou» conta enquanto a tela do gerente fica aberta na conversa.</p>
    </div>
  );
}
