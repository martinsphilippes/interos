"use client";

/**
 * Peças de interface da edição e do cancelamento em série (etapa CP/CR 5), comuns ao título a pagar e ao título a
 * receber avulso: aviso "este título faz parte de uma série" (N futuros calculados no servidor ao abrir, com a lista) e o
 * resultado persistente depois de salvar (quantos futuros foram alterados/cancelados e quantos ficaram fora, com o
 * motivo). Regras em src/domain/title-series.ts.
 */
import * as React from "react";
import { ChevronDown, ChevronUp, Repeat, X } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface SeriesFutureInfo {
  count: number;
  match: "serie" | "descricao";
  /** A pagar: futuros já aprovados/programados (o valor não muda neles). */
  amountLocked?: number;
  titles: { id: string; code: string; dueDate: string; amount: number | null }[];
}

/** Resultado de "este + N futuros" mostrado no painel até o usuário fechar. */
export interface SeriesResult {
  kind: "alterados" | "cancelados";
  count: number;
  skipped: { code: string; reason: string }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "N futuros alterados · M fora" — texto do toast e do resultado. */
export function seriesResultText(r: SeriesResult): string {
  const done = plural(r.count, `futuro ${r.kind === "alterados" ? "alterado" : "cancelado"}`, `futuros ${r.kind}`);
  return r.skipped.length ? `${done} · ${plural(r.skipped.length, "ficou fora", "ficaram fora")}` : done;
}

/** Aviso no diálogo: o título faz parte de uma série com N futuros iguais (e o que vai/não vai para eles). */
export function SeriesNotice({ info, mode, className }: { info: SeriesFutureInfo; mode: "editar" | "cancelar"; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const how = info.match === "serie" ? "da mesma série" : "com a mesma descrição (sem série)";
  return (
    <div className={cn("rounded-md border border-info/35 bg-info-soft px-3 py-2 text-sm text-info-fg", className)} data-testid="series-notice">
      <p className="flex items-start gap-2">
        <Repeat className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Este título tem <strong data-testid="series-count">{plural(info.count, "futuro", "futuros")}</strong> {how}, sem baixa e com vencimento a partir deste.{" "}
          {mode === "editar"
            ? "Em “este + futuros” vão descrição (com a parcela de cada um), valor, credor/pagador, classificação, conta prevista e observações; cada um mantém vencimento, competência, parcela e nº do documento. Mudar o dia do vencimento leva cada futuro a esse dia no próprio mês."
            : "Em “este + futuros” todos são cancelados com o mesmo motivo (nada é excluído)."}
        </span>
      </p>
      {mode === "editar" && info.amountLocked ? (
        <p className="mt-1 pl-6 text-xs" data-testid="series-amount-locked">
          Se mudar o valor, {plural(info.amountLocked, "título já aprovado ou programado fica", "títulos já aprovados ou programados ficam")} fora (o valor só muda em título previsto).
        </p>
      ) : null}
      <button type="button" className="mt-1 inline-flex min-h-[32px] items-center gap-1 pl-6 text-xs font-medium underline-offset-2 hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />} {open ? "Ocultar" : "Ver"} os {plural(info.count, "título", "títulos")}
      </button>
      {open ? (
        <ul className="mt-1 max-h-40 overflow-y-auto pl-6 text-xs" data-testid="series-titles">
          {info.titles.map((t) => (
            <li key={t.id} className="flex flex-wrap justify-between gap-x-3 py-0.5">
              <span className="font-medium">{t.code}</span>
              <span>vence {formatDate(t.dueDate)}</span>
              {t.amount !== null ? <span className="tabular-nums">{formatCurrency(t.amount)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Resultado persistente no painel: quantos futuros foram alterados/cancelados e quais ficaram fora (com o motivo). */
export function SeriesResultNotice({ result, onClose, className }: { result: SeriesResult; onClose: () => void; className?: string }) {
  const reasons = Array.from(result.skipped.reduce((m, s) => m.set(s.reason, [...(m.get(s.reason) ?? []), s.code]), new Map<string, string[]>()).entries());
  return (
    <div role="status" className={cn("relative rounded-md border px-3 py-2 pr-10 text-sm", result.skipped.length ? "border-warning/40 bg-warning-soft text-warning-fg" : "border-success/35 bg-success-soft text-success-fg", className)} data-testid="series-result">
      <p className="font-medium">
        Este título + {seriesResultText(result)}.
      </p>
      {reasons.map(([reason, codes]) => (
        <p key={reason} className="mt-1 text-xs" data-testid="series-skipped">
          {plural(codes.length, "ficou fora", "ficaram fora")} ({codes.join(", ")}): {reason}.
        </p>
      ))}
      <Button variant="ghost" size="sm" className="absolute right-1 top-1 h-8 w-8 p-0" onClick={onClose} aria-label="Fechar aviso">
        <X />
      </Button>
    </div>
  );
}
