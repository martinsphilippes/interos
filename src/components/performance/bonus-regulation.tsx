import { History } from "lucide-react";
import type { BonusResult, BonusRule } from "@/domain/types";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { AUTOMATIC_EXTRAS, UPSELL_DISCARD_WINDOW_DAYS, sortTiers } from "@/server/performance/schemas";
import { formatKpiValue, type KpiUnit } from "@/server/kpis/schemas";
import { formatCompetence, formatCurrency, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export type KpiNames = Record<string, { name: string; unit: KpiUnit; suffix?: string; direction: "maior_melhor" | "menor_melhor" | "faixa" }>;

function targetText(names: KpiNames, key: string, target: number): string {
  const meta = names[key];
  const op = meta?.direction === "menor_melhor" ? "no máximo" : meta?.direction === "faixa" ? "em torno de" : "no mínimo";
  return `${op} ${formatKpiValue(target, meta?.unit ?? "numero", meta?.suffix)}`;
}

/** Regulamento gerado a partir da regra vigente (pesos, metas, faixas, bloqueadores, extras). */
export function BonusRegulation({ rule, names }: { rule: BonusRule; names: KpiNames }) {
  const tiers = sortTiers(rule.tiers);
  const totalWeight = rule.individualWeight + rule.collectiveWeight || 1;
  const list = (items: BonusRule["individualKpis"]) => {
    const sum = items.reduce((s, k) => s + k.weight, 0) || 1;
    return (
      <ul className="ml-5 list-disc space-y-1">
        {items.map((k) => (
          <li key={k.kpiKey}>
            <strong>{names[k.kpiKey]?.name ?? k.kpiKey}</strong>: peso {k.weight} ({formatPercent(k.weight / sum)} do bloco), meta {targetText(names, k.kpiKey, k.target)}.
          </li>
        ))}
      </ul>
    );
  };
  return (
    <article className="flex flex-col gap-4 text-sm leading-relaxed text-foreground">
      <header>
        <h2 className="text-base font-semibold">Regulamento · {rule.name}</h2>
        <p className="text-muted">
          Versão {rule.version} · departamento {DEPARTMENT_LABELS[rule.department]} · vigente desde {new Date(rule.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        </p>
      </header>
      <section>
        <h3 className="font-semibold">1. Elegibilidade e valor máximo</h3>
        <p>
          Participam os colaboradores ativos de {DEPARTMENT_LABELS[rule.department]}. O bônus mensal pode chegar a <strong>{rule.maxPctOfSalary}% do salário base</strong>, conforme a faixa de
          atingimento, mais os extras previstos abaixo.
        </p>
      </section>
      <section>
        <h3 className="font-semibold">2. Composição</h3>
        <p>
          Resultado individual vale <strong>{formatPercent(rule.individualWeight / totalWeight)}</strong> e o coletivo <strong>{formatPercent(rule.collectiveWeight / totalWeight)}</strong> do atingimento geral.
        </p>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-semibold">3. Indicadores individuais (apurados no colaborador)</h3>
        {rule.individualKpis.length > 0 ? list(rule.individualKpis) : <p className="text-muted">Nenhum.</p>}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-semibold">4. Indicadores coletivos</h3>
        <p className="text-muted">Indicadores da própria área são apurados no departamento; os de outra área (ex.: churn da base), na empresa toda.</p>
        {rule.collectiveKpis.length > 0 ? list(rule.collectiveKpis) : <p className="text-muted">Nenhum.</p>}
      </section>
      <section>
        <h3 className="font-semibold">5. Como o atingimento é calculado</h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>Cada indicador vem do motor de indicadores do INTEROS, a partir dos registros do sistema (com drill-down até a origem).</li>
          <li>O atingimento de cada indicador é limitado a 100%: superar uma meta não compensa outra.</li>
          <li>Indicador sem dado na competência não entra no cálculo (o peso é redistribuído no bloco). Se nenhum indicador de um bloco tiver dado, o mês não é apurado.</li>
          <li>Atingimento do bloco = soma(peso × atingimento) ÷ soma dos pesos com dado.</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">6. Faixas de pagamento</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {tiers.map((t) => (
            <li key={t.minAttainment} className="rounded-lg border border-border px-3 py-2">
              <span className="font-medium">{t.label}</span>: atingimento geral a partir de {formatPercent(t.minAttainment)} paga <strong>{t.payoutPct}%</strong> do bônus.
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-semibold">7. Linhas vermelhas (bloqueadores)</h3>
        {rule.blockers.length === 0 ? (
          <p className="text-muted">A regra não prevê bloqueadores.</p>
        ) : (
          <>
            <p>Qualquer ocorrência abaixo, registrada com evidência e confirmada pelo gestor ou administrador, zera o bônus do mês inteiro (inclusive extras):</p>
            <ul className="ml-5 list-disc space-y-1">
              {rule.blockers.map((b) => (
                <li key={b.key}>{b.label}</li>
              ))}
            </ul>
            <p className="text-muted">O colaborador é notificado na confirmação. Todo registro, confirmação e revogação fica na trilha de auditoria.</p>
          </>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-semibold">8. Extras</h3>
        {rule.extras.length === 0 ? (
          <p className="text-muted">A regra não prevê extras.</p>
        ) : (
          <ul className="ml-5 list-disc space-y-1">
            {rule.extras.map((e) => (
              <li key={e.key}>
                <strong>{e.label}</strong>: {formatCurrency(e.amount)} {e.unit}.{" "}
                {AUTOMATIC_EXTRAS[e.key] ? `${AUTOMATIC_EXTRAS[e.key]} Oportunidade aberta há menos de ${UPSELL_DISCARD_WINDOW_DAYS} dias conta como provisória.` : "Apuração manual pelo gestor."}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="font-semibold">9. Vigência</h3>
        <p>Alterações na regra geram uma nova versão e não retroagem: cada competência fechada guarda a regra e a versão usadas no cálculo.</p>
      </section>
    </article>
  );
}

type HistoryItem = BonusResult & { ruleVersion?: number; salary?: number };

/** Competências fechadas (bonus_results) do colaborador. */
export function BonusHistory({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) return <EmptyState size="sm" icon={<History />} title="Nenhuma competência fechada" description="Quando o gestor fechar o mês, o resultado aparece aqui com a regra usada." />;
  return (
    <ul className="divide-y divide-border">
      {items.map((r) => (
        <li key={r.id} className="grid gap-1 px-1 py-3 sm:grid-cols-[96px_minmax(0,1fr)_120px_120px] sm:items-center sm:gap-3">
          <span className="text-sm font-semibold capitalize">{formatCompetence(r.period)}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {r.tierLabel}
            <span className="text-xs text-muted">
              geral {formatPercent(r.overallAttainment)} · ind. {formatPercent(r.individualAttainment)} · col. {formatPercent(r.collectiveAttainment)} · paga {r.payoutPct}%
              {r.ruleVersion ? ` · regra v${r.ruleVersion}` : ""}
            </span>
            {r.blocked ? (
              <Badge variant="danger" size="sm" title={r.blockReason}>
                Bloqueado
              </Badge>
            ) : null}
          </span>
          <span className="text-sm tabular-nums text-muted sm:text-right">{r.extrasAmount > 0 ? `+ ${formatCurrency(r.extrasAmount)} extras` : "sem extras"}</span>
          <span className="text-sm font-semibold tabular-nums sm:text-right">{formatCurrency(r.blocked ? 0 : r.projectedAmount + r.extrasAmount)}</span>
        </li>
      ))}
    </ul>
  );
}
