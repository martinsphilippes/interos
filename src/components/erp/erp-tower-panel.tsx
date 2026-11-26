"use client";

import * as React from "react";
import { History, RefreshCw } from "lucide-react";
import { TOWER_BLOCK_STATE_LABELS, type TowerBlockState } from "@/domain/erp/tower";
import { loadErpTowerAction } from "@/server/erp/actions";
import type { ErpTowerView, ErpUsageView } from "@/server/erp/tower-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Skeleton } from "@/components/ui/skeleton";
import { type BadgeVariant, fmtDate, fmtDateTime, fmtTower } from "./erp-format";

const BLOCK_BADGE: Record<TowerBlockState, BadgeVariant> = {
  ativo: "success",
  sem_movimento: "default",
  desativado: "warning",
  nao_contratado: "muted",
  indisponivel: "danger",
};

export interface ErpTowerCounts {
  units: number;
  contracted: number;
  configured: number;
  active: number;
}

interface Props {
  clientId: string;
  counts: ErpTowerCounts;
  usage: { loading: boolean; data: ErpUsageView | null };
  onLoadUsage: () => void;
}

type Period = { de: string; ate: string };

export function ErpTowerPanel({ clientId, counts, usage, onLoadUsage }: Props) {
  const [period, setPeriod] = React.useState<Period | null>(null);
  const [draftPeriod, setDraftPeriod] = React.useState<Period | null>(null);
  const [view, setView] = React.useState<ErpTowerView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    loadErpTowerAction({ clientId, de: period?.de ?? null, ate: period?.ate ?? null }).then(
      (res) => {
        if (!alive) return;
        setLoading(false);
        if (res.ok) {
          setView(res.data);
          setError(null);
          setDraftPeriod((prev) => prev ?? res.data.period);
        } else setError(res.error);
      },
      () => {
        if (!alive) return;
        setLoading(false);
        setError("Não foi possível ler a Torre de Controle agora.");
      },
    );
    return () => {
      alive = false;
    };
  }, [clientId, period, nonce]);

  const reload = (next: Period | null) => {
    setLoading(true);
    if (next && (next.de !== period?.de || next.ate !== period?.ate)) setPeriod(next);
    else setNonce((n) => n + 1);
  };
  const shown = draftPeriod ?? view?.period ?? null;
  const validPeriod = Boolean(shown && shown.de && shown.ate && shown.de <= shown.ate);

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Módulos da empresa">
        <Counter label="Unidades contratáveis" value={counts.units} />
        <Counter label="Contratadas" value={counts.contracted} />
        <Counter label="Configuradas" value={counts.configured} hint="Ligadas e sem configuração pendente no ERP" />
        <Counter label="Ativas no ERP" value={counts.active} />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          De
          <DateInput value={shown?.de ?? ""} onChange={(e) => setDraftPeriod((p) => ({ de: e.target.value, ate: p?.ate ?? shown?.ate ?? "" }))} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Até
          <DateInput value={shown?.ate ?? ""} onChange={(e) => setDraftPeriod((p) => ({ de: p?.de ?? shown?.de ?? "", ate: e.target.value }))} className="w-40" />
        </label>
        <Button variant="outline" size="md" onClick={() => reload(shown)} loading={loading} disabled={!validPeriod}>
          <RefreshCw aria-hidden /> Atualizar
        </Button>
        {view?.meta ? <p className="ml-auto text-xs text-muted-light">Gerado pelo ERP em {fmtDateTime(view.meta.geradoEm)} · fuso {view.meta.fuso}</p> : null}
      </div>

      {error ? <p className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
      {view && !view.configured ? <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted">A leitura da Torre de Controle não está configurada neste ambiente.</p> : null}
      {view?.error ? <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-fg">{view.error} Os blocos abaixo mostram só o que se sabe pelo contrato.</p> : null}

      {loading && !view ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : view && view.blocks.length ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Blocos da Torre de Controle">
          {view.blocks.map((b) => (
            <li key={b.key} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{b.label}</h3>
                <Badge variant={BLOCK_BADGE[b.state]} size="sm">
                  {TOWER_BLOCK_STATE_LABELS[b.state]}
                </Badge>
              </div>
              {b.indicators.length ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {b.indicators.map((i) => (
                    <div key={i.label} className="min-w-0">
                      <dt className="truncate text-xs text-muted">{i.label}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{fmtTower(i.value, i.unit, i.text)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {b.note ? <p className="text-xs text-muted">{b.note}</p> : null}
              {b.state === "desativado" && b.offSince && b.historyReadable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    const ate = b.offSince!.slice(0, 10);
                    const de = new Date(Date.parse(`${ate}T12:00:00Z`) - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                    setDraftPeriod({ de, ate });
                    reload({ de, ate });
                  }}
                >
                  <History aria-hidden /> Ver os 30 dias antes de {fmtDate(b.offSince)}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {view?.adoption ? (
        <section className="rounded-xl border border-border bg-surface p-4" aria-label="Adoção">
          <h3 className="mb-2 text-sm font-semibold">Adoção</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Usuários ativos (30 dias)" value={view.adoption.usuariosAtivos.ultimos30Dias} />
            <Stat label="Usuários (total)" value={view.adoption.usuarios.total} />
            <Stat label="Convites pendentes" value={view.adoption.usuarios.convitesPendentes} />
            <Stat label="Terminais ativos" value={view.adoption.terminais.ativos} />
          </dl>
          <p className="mt-2 text-xs text-muted">
            Última venda: {fmtDateTime(view.adoption.atividadeOperacional.ultimaVenda?.em)} · último acesso: {fmtDateTime(view.adoption.ultimoAcesso.em)}
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-4" aria-label="Uso e limites">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-semibold">Uso e limites (últimos 30 dias)</h3>
          {!usage.data ? (
            <Button variant="outline" size="sm" onClick={onLoadUsage} loading={usage.loading}>
              Ler no ERP
            </Button>
          ) : null}
        </div>
        {usage.data?.error ? <p className="mt-2 text-sm text-muted">{usage.data.error}</p> : null}
        {usage.data && !usage.data.error ? <UsageView usage={usage.data} /> : null}
      </section>
    </div>
  );
}

function UsageView({ usage }: { usage: ErpUsageView }) {
  const limits = usage.limits;
  const rows: { label: string; used: number | null; max: number | null }[] = limits
    ? [
        { label: "Usuários", used: limits.used?.users ?? null, max: limits.contracted?.users ?? null },
        { label: "Terminais", used: limits.used?.devices ?? null, max: limits.contracted?.devices ?? null },
        { label: "Unidades (lojas)", used: limits.used?.branches ?? null, max: limits.contracted?.branches ?? null },
      ]
    : [];
  const top = Object.entries(usage.byUnit)
    .sort((a, b) => b[1].operations - a[1].operations)
    .slice(0, 8);
  return (
    <div className="mt-2 flex flex-col gap-3 text-sm">
      {rows.length ? (
        <dl className="grid grid-cols-3 gap-x-4">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs text-muted">{r.label}</dt>
              <dd className={r.max !== null && r.used !== null && r.used > r.max ? "font-semibold text-danger-fg" : "font-semibold"}>
                {r.used ?? "—"}
                {r.max !== null ? <span className="font-normal text-muted"> / {r.max}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {top.length ? (
        <ul className="flex flex-col gap-1 text-xs">
          {top.map(([unit, u]) => (
            <li key={unit} className="flex items-center gap-2">
              <span className="w-12 font-mono text-muted">{unit}</span>
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="tabular-nums">{u.operations.toLocaleString("pt-BR")} op.</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Sem uso medido no período.</p>
      )}
    </div>
  );
}

function Counter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}
