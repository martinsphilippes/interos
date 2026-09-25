import Link from "next/link";
import { AlertTriangle, Ban, ChevronRight, CircleDollarSign, Info, Lock, Plus } from "lucide-react";
import type { BonusComputation, BonusKpiLine } from "@/server/performance/bonus";
import { sortTiers } from "@/server/performance/schemas";
import { formatKpiValue } from "@/server/kpis/schemas";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AttainmentBar } from "@/components/kpis/attainment-bar";
import { formatGap, statusFor } from "./bonus-status";

/** "95%" para percentuais, "8,5" para CSAT etc. */
function fmt(line: Pick<BonusKpiLine, "unit" | "suffix">, value: number | null): string {
  return formatKpiValue(value, line.unit, line.suffix);
}

function targetText(line: BonusKpiLine): string {
  const op = line.direction === "menor_melhor" ? "≤" : line.direction === "faixa" ? "≈" : "≥";
  return `${op} ${fmt(line, line.target)}`;
}

/** Texto do total com as ressalvas (bloqueio, sem salário). */
export function bonusTotalText(c: BonusComputation): string {
  if (c.blocked) return formatCurrency(0);
  if (c.totalAmount === null) return "—";
  return formatCurrency(c.totalAmount);
}

/** Alertas de bloqueio (confirmado/aberto), apuração incompleta e salário ausente. */
export function BonusAlerts({ c }: { c: BonusComputation }) {
  return (
    <div className="flex flex-col gap-2">
      {c.blocked ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg" role="alert">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Bônus do mês bloqueado (linha vermelha)</p>
            {c.blocks.map((b) => (
              <p key={b.id}>
                {b.blockerLabel}: {b.reason} · registrado por {b.responsibleName} em {formatDate(b.createdAt)}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {c.pendingBlocks.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-warning-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Bloqueio em análise</p>
            {c.pendingBlocks.map((b) => (
              <p key={b.id}>
                {b.blockerLabel}: {b.reason}. Ainda não afeta o valor; se confirmado, zera o bônus do mês.
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {c.incompleteReason ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{c.incompleteReason}</p>
        </div>
      ) : null}
      {c.rule && c.salary === null ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Salário base não cadastrado: o atingimento e a faixa são calculados, mas o valor em reais fica indisponível até o RH/administrador informar o salário.</p>
        </div>
      ) : null}
    </div>
  );
}

/** Cartão "Meu bônus do mês" (Meu Desempenho): projeção, faixa, quanto falta, bloqueios e extras. */
export function BonusSummaryCard({ c, href }: { c: BonusComputation; href: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-4 text-muted" aria-hidden /> Meu bônus do mês
          </CardTitle>
          <CardDescription>
            {c.period.label} · {c.rule ? `${c.rule.name} (v${c.rule.version})` : "sem regra vigente"}
          </CardDescription>
        </div>
        <Link href={href} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand hover:underline md:min-h-0">
          Detalhamento <ChevronRight className="size-4" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="label-caps">Projeção</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", c.blocked && "text-danger-fg")}>{bonusTotalText(c)}</p>
            <p className="text-xs text-muted">{c.maxAmount !== null ? `de até ${formatCurrency(c.maxAmount)} + extras` : "salário não cadastrado"}</p>
          </div>
          <div>
            <p className="label-caps">Atingimento geral</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPercent(c.overallAttainment)}</p>
            <p className="text-xs text-muted">
              Individual {formatPercent(c.individual.attainment)} · coletivo {formatPercent(c.collective.attainment)}
            </p>
          </div>
          <div>
            <p className="label-caps">Faixa atual</p>
            <p className="mt-1 text-lg font-semibold">{c.tier?.label ?? "—"}</p>
            <p className="text-xs text-muted">paga {c.payoutPct}% do bônus</p>
          </div>
          <div>
            <p className="label-caps">Próxima faixa</p>
            <p className="mt-1 text-lg font-semibold">{c.nextTier ? c.nextTier.label : c.tier ? "Faixa máxima" : "—"}</p>
            <p className="text-xs text-muted">{c.nextTier ? `faltam ${formatGap(c.nextTier.gap)} de atingimento geral` : ""}</p>
          </div>
        </div>
        <AttainmentBar attainment={c.overallAttainment} status={statusFor(c.overallAttainment)} />
        <BonusAlerts c={c} />
        {c.extras.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {c.extras.map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Plus className="size-3.5 shrink-0 text-success-fg" aria-hidden />
                  <span className="truncate">{e.label}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {e.quantity === null ? "apuração manual" : `${e.quantity} × ${formatCurrency(e.amount)} = ${formatCurrency(e.total)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LineRow({ line }: { line: BonusKpiLine }) {
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,2fr)_56px_88px_96px_minmax(0,1.4fr)_88px] md:items-center md:gap-3">
      <div className="min-w-0">
        <Link href={line.href} className="text-sm font-medium text-foreground hover:text-brand hover:underline">
          {line.name}
        </Link>
        <p className="text-xs text-muted">
          {line.scopeLabel}
          {line.value === null && line.note ? ` · ${line.note}` : ""}
        </p>
      </div>
      <p className="text-xs text-muted md:text-right md:text-sm md:text-foreground">
        <span className="md:hidden">Peso </span>
        <span className="tabular-nums">{line.weight}</span>
      </p>
      <p className="text-xs text-muted md:text-right md:text-sm md:text-foreground">
        <span className="md:hidden">Meta </span>
        <span className="tabular-nums">{targetText(line)}</span>
      </p>
      <p className="text-sm font-semibold tabular-nums md:text-right">{line.value === null ? <Badge variant="muted" size="sm">Sem dados</Badge> : fmt(line, line.value)}</p>
      <div className="min-w-0">
        {line.attainment === null ? <p className="text-xs text-muted">Fora do cálculo</p> : <AttainmentBar attainment={line.attainment} status={statusFor(line.attainment)} size="sm" />}
      </div>
      <p className="text-xs text-muted md:text-right md:text-sm md:text-foreground" title="Peso relativo × atingimento considerado (máx. 100%)">
        <span className="md:hidden">Contribuição </span>
        <span className="tabular-nums font-medium">{line.contribution === null ? "—" : formatPercent(line.contribution)}</span>
      </p>
    </li>
  );
}

function Block({ title, weight, block, explanation }: { title: string; weight: number; block: BonusComputation["individual"]; explanation: string }) {
  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted px-4 py-2.5">
        <h3 className="text-sm font-semibold">
          {title} <span className="font-normal text-muted">· peso {weight}</span>
        </h3>
        <span className="text-sm font-semibold tabular-nums">{formatPercent(block.attainment)}</span>
      </header>
      <div className="hidden grid-cols-[minmax(0,2fr)_56px_88px_96px_minmax(0,1.4fr)_88px] gap-3 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted md:grid">
        <span>Indicador</span>
        <span className="text-right">Peso</span>
        <span className="text-right">Meta</span>
        <span className="text-right">Valor</span>
        <span>Atingimento</span>
        <span className="text-right">Contribuição</span>
      </div>
      <ul className="divide-y divide-border">
        {block.lines.map((l) => (
          <LineRow key={`${l.scope}-${l.kpiKey}`} line={l} />
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted">{explanation}</p>
    </section>
  );
}

/** Explicação linha a linha do cálculo (transparência é requisito do negócio). */
export function BonusBreakdown({ c }: { c: BonusComputation }) {
  const rule = c.rule;
  if (!rule) return null;
  const tiers = sortTiers(rule.tiers);
  const sumText = (block: BonusComputation["individual"]) => {
    const counted = block.lines.filter((l) => l.contribution !== null);
    if (counted.length === 0) return "Nenhum indicador com dado neste bloco.";
    const weights = counted.reduce((s, l) => s + l.weight, 0);
    const excluded = block.lines.length - counted.length;
    return `Σ(peso × atingimento limitado a 100%) ÷ Σ pesos com dado (${weights}) = ${formatPercent(block.attainment)}.${excluded > 0 ? ` ${excluded} indicador(es) sem dados ficaram fora do cálculo.` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4">
        <li className="flex flex-col gap-1">
          <p className="text-sm font-semibold">1. Regra aplicada</p>
          <p className="text-sm text-muted">
            {rule.name} · versão {rule.version} · bônus de até {rule.maxPctOfSalary}% do salário base
            {c.maxAmount !== null ? ` (${formatCurrency(c.salary)} × ${rule.maxPctOfSalary}% = ${formatCurrency(c.maxAmount)})` : ""}.
          </p>
        </li>
        <li className="flex flex-col gap-2">
          <p className="text-sm font-semibold">2. Indicadores individuais</p>
          <Block title="Individual" weight={rule.individualWeight} block={c.individual} explanation={sumText(c.individual)} />
        </li>
        <li className="flex flex-col gap-2">
          <p className="text-sm font-semibold">3. Indicadores coletivos</p>
          <Block title="Coletivo" weight={rule.collectiveWeight} block={c.collective} explanation={`${sumText(c.collective)} Indicadores da própria área são apurados no departamento; os de outra área (ex.: churn da base), na empresa toda.`} />
        </li>
        <li className="flex flex-col gap-1">
          <p className="text-sm font-semibold">4. Atingimento geral</p>
          <p className="text-sm text-muted">
            {c.overallAttainment === null
              ? (c.incompleteReason ?? "Sem dados para apurar.")
              : `${formatPercent(c.individual.attainment)} × ${formatPercent(c.weights.individual)} (individual) + ${formatPercent(c.collective.attainment)} × ${formatPercent(c.weights.collective)} (coletivo) = ${formatPercent(c.overallAttainment)}.`}
          </p>
        </li>
        <li className="flex flex-col gap-2">
          <p className="text-sm font-semibold">5. Faixa de pagamento</p>
          <ul className="flex flex-wrap gap-2">
            {tiers.map((t) => {
              const current = c.tier && t.minAttainment === c.tier.minAttainment;
              return (
                <li key={t.minAttainment} className={cn("rounded-lg border px-3 py-2 text-xs", current ? "border-brand bg-brand-soft text-brand-fg" : "border-border text-muted")}>
                  <span className="block font-semibold">{t.label}</span>
                  <span>
                    a partir de {formatPercent(t.minAttainment)} → paga {t.payoutPct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
        <li className="flex flex-col gap-1">
          <p className="text-sm font-semibold">6. Valor da faixa</p>
          <p className="text-sm text-muted">
            {c.salary === null
              ? "Salário base não cadastrado: valor indisponível."
              : `${formatCurrency(c.salary)} × ${rule.maxPctOfSalary}% × ${c.payoutPct}% = ${formatCurrency(c.tierAmount)}.`}
          </p>
        </li>
        <li className="flex flex-col gap-2">
          <p className="text-sm font-semibold">7. Extras</p>
          {c.extras.length === 0 ? (
            <p className="text-sm text-muted">A regra não prevê extras.</p>
          ) : (
            c.extras.map((e) => (
              <div key={e.key} className="rounded-lg border border-border px-4 py-3 text-sm">
                <p className="font-medium">
                  {e.label}: {formatCurrency(e.amount)} {e.unit}
                </p>
                {e.quantity === null ? (
                  <p className="text-xs text-muted">Sem apuração automática: lançado pelo gestor fora do sistema.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted">
                      {e.quantity} × {formatCurrency(e.amount)} = {formatCurrency(e.total)}
                      {e.provisional > 0 ? ` · ${e.provisional} ainda provisória(s) (menos de 7 dias; se for descartada, sai da conta)` : ""}
                    </p>
                    {e.items.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {e.items.map((i) => (
                          <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
                            <Link href={i.href} className="min-w-0 truncate hover:underline">
                              {i.label}
                            </Link>
                            <span className="flex shrink-0 items-center gap-2 text-muted">
                              {i.detail}
                              <Badge size="sm" variant={i.status === "valida" ? "success" : i.status === "provisoria" ? "warning" : "muted"}>
                                {i.status === "valida" ? "Válida" : i.status === "provisoria" ? "Provisória" : "Não conta"}
                              </Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            ))
          )}
        </li>
        <li className="flex flex-col gap-1">
          <p className="text-sm font-semibold">8. Bloqueios e total</p>
          <p className="text-sm text-muted">
            {c.blocked
              ? `Bloqueio confirmado na competência: bônus e extras zerados. Total: ${formatCurrency(0)}.`
              : `Sem bloqueio confirmado. Total projetado: ${c.totalAmount === null ? "indisponível" : `${formatCurrency(c.tierAmount ?? 0)} + ${formatCurrency(c.extrasAmount)} = ${formatCurrency(c.totalAmount)}`}.`}
          </p>
        </li>
      </ol>
      <p className="text-xs text-muted">Valores recalculados a cada acesso pelo motor de indicadores; a competência fica gravada quando o gestor fecha o mês.</p>
    </div>
  );
}
