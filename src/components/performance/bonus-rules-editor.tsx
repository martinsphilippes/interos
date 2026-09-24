"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, History, Pencil, Plus, Trash2 } from "lucide-react";
import type { BonusRule } from "@/domain/types";
import type { BonusRulesAdminData } from "@/server/performance/queries";
import { saveBonusRule } from "@/server/performance/actions";
import { sortTiers, type BonusRuleInput } from "@/server/performance/schemas";
import { formatKpiValue } from "@/server/kpis/schemas";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

type Kpis = BonusRulesAdminData["kpis"];

interface KpiRow {
  kpiKey: string;
  weight: string;
  target: string;
}
interface FormState {
  baseRuleId?: string;
  name: string;
  department: DepartmentKey | "";
  maxPctOfSalary: string;
  individualWeight: string;
  collectiveWeight: string;
  individualKpis: KpiRow[];
  collectiveKpis: KpiRow[];
  tiers: { minAttainment: string; payoutPct: string; label: string }[];
  blockers: { key: string; label: string }[];
  extras: { key: string; label: string; amount: string; unit: string }[];
}

function parseNumber(text: string): number {
  const t = text.trim();
  if (!t) return Number.NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}
const show = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

function isPercent(kpis: Kpis, key: string): boolean {
  return kpis.find((k) => k.key === key)?.unit === "percentual";
}

function toForm(rule: BonusRule | null, kpis: Kpis): FormState {
  if (!rule) {
    return {
      name: "",
      department: "",
      maxPctOfSalary: "20",
      individualWeight: "60",
      collectiveWeight: "40",
      individualKpis: [],
      collectiveKpis: [],
      tiers: [
        { minAttainment: "100", payoutPct: "100", label: "Meta batida" },
        { minAttainment: "90", payoutPct: "70", label: "90–99%" },
        { minAttainment: "80", payoutPct: "40", label: "80–89%" },
        { minAttainment: "0", payoutPct: "0", label: "Abaixo de 80%" },
      ],
      blockers: [],
      extras: [],
    };
  }
  const row = (k: BonusRule["individualKpis"][number]): KpiRow => ({ kpiKey: k.kpiKey, weight: show(k.weight), target: show(isPercent(kpis, k.kpiKey) ? k.target * 100 : k.target) });
  return {
    baseRuleId: rule.id,
    name: rule.name,
    department: rule.department,
    maxPctOfSalary: show(rule.maxPctOfSalary),
    individualWeight: show(rule.individualWeight),
    collectiveWeight: show(rule.collectiveWeight),
    individualKpis: rule.individualKpis.map(row),
    collectiveKpis: rule.collectiveKpis.map(row),
    tiers: sortTiers(rule.tiers).map((t) => ({ minAttainment: show(t.minAttainment * 100), payoutPct: show(t.payoutPct), label: t.label })),
    blockers: rule.blockers.map((b) => ({ ...b })),
    extras: rule.extras.map((e) => ({ key: e.key, label: e.label, amount: show(e.amount), unit: e.unit })),
  };
}

function toInput(form: FormState, kpis: Kpis): BonusRuleInput {
  const kpi = (r: KpiRow) => ({ kpiKey: r.kpiKey, weight: parseNumber(r.weight), target: isPercent(kpis, r.kpiKey) ? parseNumber(r.target) / 100 : parseNumber(r.target) });
  return {
    baseRuleId: form.baseRuleId,
    name: form.name,
    department: form.department as DepartmentKey,
    maxPctOfSalary: parseNumber(form.maxPctOfSalary),
    individualWeight: parseNumber(form.individualWeight),
    collectiveWeight: parseNumber(form.collectiveWeight),
    individualKpis: form.individualKpis.map(kpi),
    collectiveKpis: form.collectiveKpis.map(kpi),
    tiers: form.tiers.map((t) => ({ minAttainment: parseNumber(t.minAttainment) / 100, payoutPct: parseNumber(t.payoutPct), label: t.label })),
    blockers: form.blockers,
    extras: form.extras.map((e) => ({ key: e.key, label: e.label, amount: parseNumber(e.amount), unit: e.unit })),
  };
}

function KpiRowsEditor({ title, rows, kpis, onChange }: { title: string; rows: KpiRow[]; kpis: Kpis; onChange: (rows: KpiRow[]) => void }) {
  const options = kpis.map((k) => ({ value: k.key, label: `${k.name} · ${k.department}` }));
  const total = rows.reduce((s, r) => s + (parseNumber(r.weight) || 0), 0);
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold">
        {title} <span className="font-normal text-muted">· soma dos pesos {show(total)}</span>
      </legend>
      {rows.length === 0 ? <p className="text-xs text-muted">Nenhum indicador.</p> : null}
      {rows.map((r, i) => {
        const pct = isPercent(kpis, r.kpiKey);
        const direction = kpis.find((k) => k.key === r.kpiKey)?.direction;
        return (
          <div key={i} className="grid gap-2 rounded-md bg-surface-muted p-2 sm:grid-cols-[minmax(0,1fr)_80px_110px_auto] sm:items-end">
            <FormField label="Indicador">
              <Select value={r.kpiKey} placeholder="Escolha" onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, kpiKey: e.target.value } : x)))} options={options} />
            </FormField>
            <FormField label="Peso">
              <Input inputMode="decimal" value={r.weight} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
            </FormField>
            <FormField label={`Meta${pct ? " (%)" : ""}${direction === "menor_melhor" ? " máx." : ""}`}>
              <Input inputMode="decimal" value={r.target} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
            </FormField>
            <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Remover indicador" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...rows, { kpiKey: "", weight: "", target: "" }])}>
        <Plus /> Indicador
      </Button>
    </fieldset>
  );
}

function RuleCard({ rule, kpis, onEdit, versions }: { rule: BonusRule; kpis: Kpis; onEdit: () => void; versions: BonusRule[] }) {
  const name = (key: string) => kpis.find((k) => k.key === key)?.name ?? key;
  const target = (key: string, value: number) => {
    const k = kpis.find((x) => x.key === key);
    return formatKpiValue(value, k?.unit ?? "numero", k?.suffix);
  };
  return (
    <section className="rounded-lg border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">
            {DEPARTMENT_LABELS[rule.department]} · {rule.name}
          </p>
          <p className="text-xs text-muted">
            Versão {rule.version} · desde {formatDate(rule.createdAt)} · até {rule.maxPctOfSalary}% do salário · individual {rule.individualWeight} / coletivo {rule.collectiveWeight}
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-[44px] md:min-h-0" onClick={onEdit}>
          <Pencil /> Nova versão
        </Button>
      </header>
      <div className="grid gap-4 px-4 py-3 text-sm md:grid-cols-2">
        {(["individualKpis", "collectiveKpis"] as const).map((field) => (
          <div key={field}>
            <p className="mb-1 label-caps">{field === "individualKpis" ? "Individuais" : "Coletivos"}</p>
            <ul className="flex flex-col gap-0.5">
              {rule[field].map((k) => (
                <li key={k.kpiKey} className="flex justify-between gap-2">
                  <span className="truncate">{name(k.kpiKey)}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    peso {k.weight} · meta {target(k.kpiKey, k.target)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="mb-1 label-caps">Faixas</p>
          <p className="text-muted">{sortTiers(rule.tiers).map((t) => `${t.label} (≥ ${formatPercent(t.minAttainment)} → ${t.payoutPct}%)`).join(" · ")}</p>
        </div>
        <div>
          <p className="mb-1 label-caps">Bloqueadores e extras</p>
          <p className="text-muted">{rule.blockers.map((b) => b.label).join(" · ") || "Sem bloqueadores"}</p>
          <p className="text-muted">{rule.extras.map((e) => `${e.label}: ${formatCurrency(e.amount)} ${e.unit}`).join(" · ") || "Sem extras"}</p>
        </div>
      </div>
      {versions.length > 0 ? (
        <details className="border-t border-border px-4 py-2 text-xs">
          <summary className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 text-muted hover:text-foreground">
            <History className="size-3.5" aria-hidden /> Versões anteriores ({versions.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {versions.map((v) => (
              <li key={v.id}>
                v{v.version} · {v.name} · criada em {formatDate(v.createdAt)} · inativa
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** Editor das regras de bônus: cada salvamento publica uma nova versão e desativa a anterior (não retroage). */
export function BonusRulesEditor({ data }: { data: BonusRulesAdminData }) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const active = data.rules.filter((r) => r.active).sort((a, b) => DEPARTMENT_LABELS[a.department].localeCompare(DEPARTMENT_LABELS[b.department], "pt-BR"));
  const inactive = data.rules.filter((r) => !r.active);

  const open = (rule: BonusRule | null) => {
    setError(null);
    setForm(toForm(rule, data.kpis));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    startTransition(async () => {
      const result = await saveBonusRule(toInput(form, data.kpis));
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Regra publicada (versão ${result.data.version})`);
      setForm(null);
      router.refresh();
    });
  };

  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Regras vigentes por departamento. Competências já fechadas guardam a versão usada.</p>
        <Button className="min-h-[44px] md:min-h-0" onClick={() => open(null)}>
          <Plus /> Nova regra
        </Button>
      </div>
      {active.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="Nenhuma regra de bônus ativa" description="Crie a regra do departamento com indicadores, pesos, faixas, bloqueadores e extras." action={<Button onClick={() => open(null)}>Nova regra</Button>} />
        </div>
      ) : (
        active.map((rule) => <RuleCard key={rule.id} rule={rule} kpis={data.kpis} versions={inactive.filter((r) => r.department === rule.department)} onEdit={() => open(rule)} />)
      )}

      <Drawer open={form !== null} onOpenChange={(v) => !v && !pending && setForm(null)}>
        <DrawerContent size="lg">
          {form ? (
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <DrawerHeader>
                <DrawerTitle>{form.baseRuleId ? "Nova versão da regra" : "Nova regra de bônus"}</DrawerTitle>
                <DrawerDescription>Salvar publica uma nova versão e desativa a vigente do departamento. Metas percentuais em % (ex.: 95).</DrawerDescription>
              </DrawerHeader>
              <DrawerBody className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Nome" required>
                    <Input value={form.name} required onChange={(e) => patch({ name: e.target.value })} placeholder="Bônus de Suporte (até 20% do salário)" />
                  </FormField>
                  <FormField label="Departamento" required>
                    <Select value={form.department} required placeholder="Escolha" onChange={(e) => patch({ department: e.target.value as DepartmentKey })} options={data.departments.map((d) => ({ value: d.key, label: d.label }))} />
                  </FormField>
                  <FormField label="% máximo do salário" required>
                    <Input inputMode="decimal" value={form.maxPctOfSalary} onChange={(e) => patch({ maxPctOfSalary: e.target.value })} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Peso individual" required>
                      <Input inputMode="decimal" value={form.individualWeight} onChange={(e) => patch({ individualWeight: e.target.value })} />
                    </FormField>
                    <FormField label="Peso coletivo" required>
                      <Input inputMode="decimal" value={form.collectiveWeight} onChange={(e) => patch({ collectiveWeight: e.target.value })} />
                    </FormField>
                  </div>
                </div>

                <KpiRowsEditor title="Indicadores individuais" rows={form.individualKpis} kpis={data.kpis} onChange={(rows) => patch({ individualKpis: rows })} />
                <KpiRowsEditor title="Indicadores coletivos" rows={form.collectiveKpis} kpis={data.kpis} onChange={(rows) => patch({ collectiveKpis: rows })} />

                <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-semibold">Faixas de pagamento</legend>
                  {form.tiers.map((t, i) => (
                    <div key={i} className="grid gap-2 rounded-md bg-surface-muted p-2 sm:grid-cols-[110px_110px_minmax(0,1fr)_auto] sm:items-end">
                      <FormField label="Mínimo (%)">
                        <Input inputMode="decimal" value={t.minAttainment} onChange={(e) => patch({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, minAttainment: e.target.value } : x)) })} />
                      </FormField>
                      <FormField label="Paga (%)">
                        <Input inputMode="decimal" value={t.payoutPct} onChange={(e) => patch({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, payoutPct: e.target.value } : x)) })} />
                      </FormField>
                      <FormField label="Rótulo">
                        <Input value={t.label} onChange={(e) => patch({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                      </FormField>
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Remover faixa" onClick={() => patch({ tiers: form.tiers.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="self-start" onClick={() => patch({ tiers: [...form.tiers, { minAttainment: "", payoutPct: "", label: "" }] })}>
                    <Plus /> Faixa
                  </Button>
                </fieldset>

                <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-semibold">Bloqueadores (linhas vermelhas)</legend>
                  {form.blockers.map((b, i) => (
                    <div key={i} className="grid gap-2 rounded-md bg-surface-muted p-2 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
                      <FormField label="Chave">
                        <Input value={b.key} placeholder="reclamacao_formal" onChange={(e) => patch({ blockers: form.blockers.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                      </FormField>
                      <FormField label="Rótulo">
                        <Input value={b.label} onChange={(e) => patch({ blockers: form.blockers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                      </FormField>
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Remover bloqueador" onClick={() => patch({ blockers: form.blockers.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="self-start" onClick={() => patch({ blockers: [...form.blockers, { key: "", label: "" }] })}>
                    <Plus /> Bloqueador
                  </Button>
                </fieldset>

                <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-semibold">Extras</legend>
                  <p className="text-xs text-muted">A chave “upsell_suporte” é apurada automaticamente (oportunidades válidas originadas pelo colaborador). Outras chaves ficam como apuração manual.</p>
                  {form.extras.map((x, i) => (
                    <div key={i} className="grid gap-2 rounded-md bg-surface-muted p-2 sm:grid-cols-[150px_minmax(0,1fr)_100px_140px_auto] sm:items-end">
                      <FormField label="Chave">
                        <Input value={x.key} placeholder="upsell_suporte" onChange={(e) => patch({ extras: form.extras.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)) })} />
                      </FormField>
                      <FormField label="Rótulo">
                        <Input value={x.label} onChange={(e) => patch({ extras: form.extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
                      </FormField>
                      <FormField label="Valor (R$)">
                        <Input inputMode="decimal" value={x.amount} onChange={(e) => patch({ extras: form.extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)) })} />
                      </FormField>
                      <FormField label="Unidade">
                        <Input value={x.unit} placeholder="por oportunidade" onChange={(e) => patch({ extras: form.extras.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)) })} />
                      </FormField>
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Remover extra" onClick={() => patch({ extras: form.extras.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="self-start" onClick={() => patch({ extras: [...form.extras, { key: "", label: "", amount: "", unit: "" }] })}>
                    <Plus /> Extra
                  </Button>
                </fieldset>

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
                  <Copy /> Publicar nova versão
                </Button>
              </DrawerFooter>
            </form>
          ) : null}
        </DrawerContent>
      </Drawer>
      {inactive.length > 0 && active.length === 0 ? (
        <p className="text-xs text-muted">
          <Badge variant="muted" size="sm">
            {inactive.length}
          </Badge>{" "}
          versão(ões) inativa(s) sem regra vigente.
        </p>
      ) : null}
    </div>
  );
}
