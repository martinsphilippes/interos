"use client";

/**
 * Ficha de um módulo do ERP na Gestão de Produtos: ficha comercial (nome, texto para proposta, situação, segmentos,
 * dependências comerciais, observações), preço vigente com o histórico de versões (nova versão e cancelamento da que
 * ainda não começou), o que o catálogo do ERP diz da unidade e em que pacotes ela entra.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Boxes, ListTree, Plus, Save, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ERP_DEV_STATUS_LABELS } from "@/domain/erp/catalog";
import {
  COMMERCIAL_SEGMENTS,
  COMMERCIAL_SEGMENT_LABELS,
  COMMERCIAL_STATUSES,
  COMMERCIAL_STATUS_HINTS,
  COMMERCIAL_STATUS_LABELS,
  NOTES_MAX,
  PRICE_MODELS,
  PRICE_MODEL_HINTS,
  PRICE_MODEL_LABELS,
  QUANTITY_UNIT_SUGGESTIONS,
  SUMMARY_MAX,
  describePrice,
  describeTiers,
  monthlyFor,
  priceProblems,
  versionAt,
  versionState,
  type CommercialModule,
  type CommercialSegment,
  type CommercialStatus,
  type PriceModel,
  type PriceTier,
  type PriceVersion,
  type ProductPackage,
} from "@/domain/products/commercial";
import { addModulePriceAction, cancelModulePriceAction, loadUnitDetailAction, saveCommercialModuleAction } from "@/server/products/actions";
import type { CatalogUnitView } from "@/server/products/queries";
import type { UnitDetail } from "@/server/products/service";
import { formatCurrency, formatDateKey, formatDateTime } from "@/lib/format";
import { CommercialStatusBadge, NotSellableBadge, numberToInput, PackageStatusBadge, toNumber, VersionStateBadge } from "./shared";

/** Id de elemento a partir do código (sem o ponto, que atrapalha seletores). */
const uid = (code: string) => code.replace(/\./g, "-");

export interface ModulePermissions {
  edit: boolean;
  price: boolean;
}

export function ModuleDrawer({
  code,
  unit,
  record,
  units,
  packages,
  today,
  permissions,
  onClose,
}: {
  code: string | null;
  unit: CatalogUnitView | null;
  record: CommercialModule | null;
  units: readonly CatalogUnitView[];
  packages: readonly ProductPackage[];
  today: string;
  permissions: ModulePermissions;
  onClose: () => void;
}) {
  return (
    <Drawer open={code !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="lg">
        {code ? <DrawerInner key={`${code}-${record?.updatedAt ?? "novo"}`} code={code} unit={unit} record={record} units={units} packages={packages} today={today} permissions={permissions} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerInner({ code, unit, record, units, packages, today, permissions }: { code: string; unit: CatalogUnitView | null; record: CommercialModule | null; units: readonly CatalogUnitView[]; packages: readonly ProductPackage[]; today: string; permissions: ModulePermissions }) {
  const name = record?.name ?? unit?.name ?? code;
  const inPackages = packages.filter((p) => versionAt(p.versions, today)?.units.includes(code));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader>
        <DrawerTitle className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums text-muted">{code}</span> {name}
        </DrawerTitle>
        <DrawerDescription className="flex flex-wrap items-center gap-2">
          <CommercialStatusBadge status={record?.status ?? null} />
          {unit && !unit.sellable ? <NotSellableBadge /> : null}
          {unit ? <span>{unit.moduleName}</span> : <Badge variant="warning">Fora do catálogo em uso</Badge>}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-6">
        <CommercialForm code={code} unit={unit} record={record} units={units} canEdit={permissions.edit} />
        <PriceSection code={code} record={record} today={today} canPrice={permissions.price && Boolean(unit)} />
        <CatalogSection code={code} unit={unit} units={units} />
        <section aria-labelledby={`pk-${uid(code)}`} className="flex flex-col gap-2">
          <h3 id={`pk-${uid(code)}`} className="flex items-center gap-2 text-sm font-semibold">
            <Boxes className="size-4 text-muted" /> Em pacotes ({inPackages.length})
          </h3>
          {inPackages.length ? (
            <ul className="flex flex-wrap gap-2">
              {inPackages.map((p) => (
                <li key={p.id} className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm">
                  {p.name} <PackageStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Não entra em nenhum pacote vigente.</p>
          )}
        </section>
      </DrawerBody>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ficha comercial
// ---------------------------------------------------------------------------

function CommercialForm({ code, unit, record, units, canEdit }: { code: string; unit: CatalogUnitView | null; record: CommercialModule | null; units: readonly CatalogUnitView[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(record?.name ?? unit?.name ?? "");
  const [summary, setSummary] = React.useState(record?.summary ?? "");
  const [status, setStatus] = React.useState<CommercialStatus>(record?.status ?? "rascunho");
  const [segments, setSegments] = React.useState<CommercialSegment[]>(record?.segments ?? []);
  const [requires, setRequires] = React.useState<string[]>(record?.requiresCommercial ?? []);
  const [notes, setNotes] = React.useState(record?.notes ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const nameOf = (c: string) => units.find((u) => u.code === c)?.name ?? c;
  const options = units.filter((u) => u.code !== code && !requires.includes(u.code));
  const statusOptions = COMMERCIAL_STATUSES.filter((s) => s !== "a_venda" || unit?.sellable || record?.status === "a_venda");

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveCommercialModuleAction({ code, name, summary: summary || null, status, segments, requiresCommercial: requires, notes: notes || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Ficha comercial salva");
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-labelledby={`fc-${uid(code)}`}>
      <h3 id={`fc-${uid(code)}`} className="text-sm font-semibold">
        Ficha comercial
      </h3>
      {!record ? <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">Ainda sem ficha: salve para registrar como o módulo é vendido.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nome comercial" htmlFor={`fc-name-${uid(code)}`} required className="sm:col-span-2" hint={unit && name !== unit.name ? `No ERP: ${unit.name}` : undefined}>
          <Input id={`fc-name-${uid(code)}`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} disabled={!canEdit} />
        </FormField>
        <FormField label="Situação" htmlFor={`fc-status-${uid(code)}`} hint={COMMERCIAL_STATUS_HINTS[status]}>
          <Select id={`fc-status-${uid(code)}`} value={status} onChange={(e) => setStatus(e.target.value as CommercialStatus)} disabled={!canEdit} options={statusOptions.map((s) => ({ value: s, label: COMMERCIAL_STATUS_LABELS[s] }))} />
        </FormField>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">Segmentos</legend>
          {COMMERCIAL_SEGMENTS.map((s) => (
            <Checkbox
              key={s}
              id={`fc-seg-${uid(code)}-${s}`}
              checked={segments.includes(s)}
              onCheckedChange={(v) => setSegments((prev) => (v === true ? [...prev, s] : prev.filter((x) => x !== s)))}
              disabled={!canEdit}
              label={COMMERCIAL_SEGMENT_LABELS[s]}
            />
          ))}
          <span className="text-xs text-muted">Nenhum marcado = oferecido a todos.</span>
        </fieldset>
        <FormField label="Texto para proposta" htmlFor={`fc-summary-${uid(code)}`} className="sm:col-span-2" hint={`O que o cliente lê na proposta (até ${SUMMARY_MAX} caracteres).`}>
          <Textarea id={`fc-summary-${uid(code)}`} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={SUMMARY_MAX} rows={3} disabled={!canEdit} placeholder={unit?.description ?? "Ex.: Frente de caixa com TEF, sangria e fechamento."} />
        </FormField>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-sm font-medium">Dependências comerciais</span>
          <span className="text-xs text-muted">Além das técnicas do ERP: módulos que precisam ser vendidos junto (o simulador avisa quando faltam).</span>
          {requires.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {requires.map((c) => (
                <li key={c}>
                  <Badge variant="outline" className="gap-1">
                    {c} {nameOf(c)}
                    {canEdit ? (
                      <button type="button" onClick={() => setRequires((prev) => prev.filter((x) => x !== c))} aria-label={`Tirar ${c} das dependências`} className="ml-0.5 rounded hover:bg-surface-hover">
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit ? (
            <Select
              aria-label="Acrescentar dependência comercial"
              value=""
              onChange={(e) => e.target.value && setRequires((prev) => [...prev, e.target.value])}
              options={[{ value: "", label: "Acrescentar dependência…" }, ...options.map((u) => ({ value: u.code, label: `${u.code} ${u.name}` }))]}
            />
          ) : null}
        </div>
        <FormField label="Observações internas" htmlFor={`fc-notes-${uid(code)}`} className="sm:col-span-2" hint="Regras de venda e combinados (não vão para a proposta).">
          <Textarea id={`fc-notes-${uid(code)}`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={NOTES_MAX} rows={2} disabled={!canEdit} />
        </FormField>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" loading={pending}>
            <Save /> Salvar ficha
          </Button>
        </div>
      ) : null}
      {record ? <p className="text-xs text-muted">Última alteração: {record.updatedBy.name}, {formatDateTime(record.updatedAt)}</p> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Preço
// ---------------------------------------------------------------------------

function PriceSection({ code, record, today, canPrice }: { code: string; record: CommercialModule | null; today: string; canPrice: boolean }) {
  const [adding, setAdding] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<PriceVersion | null>(null);
  const prices = record?.prices ?? [];
  const current = versionAt(prices, today);
  const scheduled = prices.filter((p) => versionState(p, today) === "agendada");
  const history = [...prices].sort((a, b) => b.version - a.version);

  return (
    <section aria-labelledby={`pr-${uid(code)}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`pr-${uid(code)}`} className="text-sm font-semibold">
          Preço
        </h3>
        {canPrice ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Nova versão de preço
          </Button>
        ) : null}
      </div>
      <div className="rounded-lg border border-border p-3 text-sm">
        {current ? (
          <>
            <p className="font-medium">{describePrice(current, formatCurrency)}</p>
            {current.model === "por_faixa" ? (
              <ul className="mt-1 text-xs text-muted">
                {describeTiers(current.tiers, current.unitLabel, formatCurrency).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1 text-xs text-muted">
              Versão {current.version}, desde {formatDateKey(current.validFrom)}
              {current.validTo ? ` até ${formatDateKey(current.validTo)}` : ""}.
            </p>
          </>
        ) : (
          <p className="text-muted">Sem preço vigente hoje{record?.status === "a_venda" ? ": vendido só em pacote ou com preço a definir." : "."}</p>
        )}
        {scheduled.map((s) => (
          <p key={s.version} className="mt-2 text-xs text-info-fg">
            Agendado: {describePrice(s, formatCurrency)} a partir de {formatDateKey(s.validFrom)} (versão {s.version}).
          </p>
        ))}
      </div>
      {history.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Histórico de preços de {code}</caption>
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Versão</th>
                <th className="px-3 py-2 font-medium">Vigência</th>
                <th className="px-3 py-2 font-medium">Preço</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((p) => {
                const state = versionState(p, today);
                const cancellable = canPrice && !p.cancelledAt && p.validFrom >= today;
                return (
                  <tr key={p.version} className={state === "cancelada" ? "text-muted" : undefined}>
                    <td className="px-3 py-2 align-top">
                      <span className="tabular-nums">v{p.version}</span> <VersionStateBadge state={state} />
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      {formatDateKey(p.validFrom)}
                      {p.validTo ? ` → ${formatDateKey(p.validTo)}` : " → sem fim"}
                    </td>
                    <td className="px-3 py-2 align-top">{describePrice(p, formatCurrency)}</td>
                    <td className="px-3 py-2 align-top text-xs">
                      {p.reason}
                      <span className="block text-muted">
                        {p.createdBy.name}, {formatDateTime(p.createdAt)}
                      </span>
                      {p.cancelledAt ? (
                        <span className="block text-danger-fg">
                          Cancelada por {p.cancelledBy?.name}: {p.cancelReason}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {cancellable ? (
                        <Button type="button" size="sm" variant="ghost" className="text-danger-fg" onClick={() => setCancelling(p)} aria-label={`Cancelar a versão ${p.version}`}>
                          <Ban /> Cancelar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {adding ? <NewPriceDialog code={code} today={today} previous={current} onClose={() => setAdding(false)} /> : null}
      {cancelling ? <CancelVersionDialog title={`Cancelar a versão ${cancelling.version} do preço?`} description={`${describePrice(cancelling, formatCurrency)} a partir de ${formatDateKey(cancelling.validFrom)}. A versão fica no histórico como cancelada e a anterior volta a valer.`} onClose={() => setCancelling(null)} onConfirm={(reason) => cancelModulePriceAction({ code, version: cancelling.version, reason })} /> : null}
    </section>
  );
}

interface PriceForm {
  model: PriceModel;
  monthly: string;
  unitPrice: string;
  includedQuantity: string;
  unitLabel: string;
  tiers: { upTo: string; monthly: string }[];
  setup: string;
  validFrom: string;
  reason: string;
}

function initialPriceForm(previous: PriceVersion | null, today: string): PriceForm {
  return {
    model: previous?.model ?? "fixo",
    monthly: numberToInput(previous?.monthly ?? 0),
    unitPrice: numberToInput(previous?.unitPrice ?? 0),
    includedQuantity: numberToInput(previous?.includedQuantity ?? 1),
    unitLabel: previous?.unitLabel ?? "",
    tiers: previous?.tiers.length ? previous.tiers.map((t) => ({ upTo: t.upTo === null ? "" : String(t.upTo), monthly: String(t.monthly) })) : [{ upTo: "3", monthly: "0" }, { upTo: "", monthly: "0" }],
    setup: numberToInput(previous?.setup ?? 0),
    validFrom: today,
    reason: "",
  };
}

/** Converte o formulário no preço (null = algum número inválido). */
function formToPrice(f: PriceForm): Pick<PriceVersion, "model" | "monthly" | "unitPrice" | "includedQuantity" | "unitLabel" | "tiers" | "setup"> | null {
  const monthly = toNumber(f.monthly);
  const unitPrice = toNumber(f.unitPrice);
  const included = toNumber(f.includedQuantity);
  const setup = toNumber(f.setup);
  const tiers: PriceTier[] = [];
  for (const [i, t] of f.tiers.entries()) {
    const m = toNumber(t.monthly);
    const last = i === f.tiers.length - 1;
    const upTo = last ? null : toNumber(t.upTo);
    if (m === null || (!last && (upTo === null || upTo === 0))) return null;
    tiers.push({ upTo: last ? null : (upTo as number), monthly: m });
  }
  if (monthly === null || unitPrice === null || included === null || setup === null) return null;
  return { model: f.model, monthly, unitPrice, includedQuantity: Math.floor(included), unitLabel: f.unitLabel.trim() || null, tiers, setup };
}

function NewPriceDialog({ code, today, previous, onClose }: { code: string; today: string; previous: PriceVersion | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<PriceForm>(() => initialPriceForm(previous, today));
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof PriceForm>(key: K, value: PriceForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const price = formToPrice(form);
  const problems = price ? priceProblems(price) : ["Confira os valores: há um número inválido."];
  const examples = price && !problems.length ? [1, 3, 10].map((q) => `${q} → ${formatCurrency(monthlyFor(price, q))}`) : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!price || problems.length) return;
    setError(null);
    startTransition(async () => {
      const result = await addModulePriceAction({ code, ...price, validFrom: form.validFrom, reason: form.reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Versão ${result.data.version} do preço gravada`, { description: form.validFrom > today ? `Começa a valer em ${formatDateKey(form.validFrom)}.` : "Já vale a partir de hoje." });
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="md">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Nova versão de preço · {code}</DialogTitle>
            <DialogDescription>Uma versão nunca é reescrita: o preço novo vale a partir da data escolhida e o anterior fica no histórico.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Modelo</span>
              <SegmentedControl aria-label="Modelo de preço" value={form.model} onChange={(v) => set("model", v)} options={PRICE_MODELS.map((m) => ({ value: m, label: PRICE_MODEL_LABELS[m] }))} size="sm" />
              <span className="text-xs text-muted">{PRICE_MODEL_HINTS[form.model]}</span>
            </div>
            {form.model === "fixo" ? (
              <FormField label="Mensalidade (R$)" htmlFor="np-monthly" required>
                <Input id="np-monthly" type="number" inputMode="decimal" min={0} step="0.01" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} className="tabular-nums" />
              </FormField>
            ) : null}
            {form.model !== "fixo" ? (
              <FormField label="O que é contado" htmlFor="np-unit" required hint="Ex.: usuário, filial, terminal.">
                <Input id="np-unit" list="np-unit-list" value={form.unitLabel} onChange={(e) => set("unitLabel", e.target.value)} maxLength={40} />
                <datalist id="np-unit-list">
                  {QUANTITY_UNIT_SUGGESTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </FormField>
            ) : null}
            {form.model === "por_quantidade" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Mensalidade base (R$)" htmlFor="np-base">
                  <Input id="np-base" type="number" inputMode="decimal" min={0} step="0.01" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} className="tabular-nums" />
                </FormField>
                <FormField label="Incluídos na base" htmlFor="np-included">
                  <Input id="np-included" type="number" inputMode="numeric" min={0} step="1" value={form.includedQuantity} onChange={(e) => set("includedQuantity", e.target.value)} className="tabular-nums" />
                </FormField>
                <FormField label="Por unidade adicional (R$)" htmlFor="np-unit-price">
                  <Input id="np-unit-price" type="number" inputMode="decimal" min={0} step="0.01" value={form.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} className="tabular-nums" />
                </FormField>
              </div>
            ) : null}
            {form.model === "por_faixa" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Faixas</legend>
                {form.tiers.map((t, i) => {
                  const last = i === form.tiers.length - 1;
                  return (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <FormField label={last ? "Acima da faixa anterior" : `Faixa ${i + 1}: até`} htmlFor={`np-tier-up-${i}`} className="w-40">
                        <Input id={`np-tier-up-${i}`} type="number" inputMode="numeric" min={1} step="1" value={last ? "" : t.upTo} placeholder={last ? "sem limite" : undefined} disabled={last} onChange={(e) => set("tiers", form.tiers.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} className="tabular-nums" />
                      </FormField>
                      <FormField label="Mensalidade (R$)" htmlFor={`np-tier-m-${i}`} className="w-40">
                        <Input id={`np-tier-m-${i}`} type="number" inputMode="decimal" min={0} step="0.01" value={t.monthly} onChange={(e) => set("tiers", form.tiers.map((x, j) => (j === i ? { ...x, monthly: e.target.value } : x)))} className="tabular-nums" />
                      </FormField>
                      {form.tiers.length > 2 ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => set("tiers", form.tiers.filter((_, j) => j !== i))} aria-label={`Tirar a faixa ${i + 1}`}>
                          <X />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                {form.tiers.length < 12 ? (
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={() => set("tiers", [...form.tiers.slice(0, -1), { upTo: "", monthly: "0" }, form.tiers[form.tiers.length - 1]])}>
                      <Plus /> Faixa
                    </Button>
                  </div>
                ) : null}
              </fieldset>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Implantação (R$, uma vez)" htmlFor="np-setup">
                <Input id="np-setup" type="number" inputMode="decimal" min={0} step="0.01" value={form.setup} onChange={(e) => set("setup", e.target.value)} className="tabular-nums" />
              </FormField>
              <FormField label="Vale a partir de" htmlFor="np-from" required hint="Hoje ou uma data futura.">
                <DateInput id="np-from" value={form.validFrom} min={today} onChange={(e) => set("validFrom", e.target.value)} required />
              </FormField>
            </div>
            <FormField label="Motivo" htmlFor="np-reason" required hint="Ex.: tabela 2027, lançamento, reajuste anual.">
              <Input id="np-reason" value={form.reason} onChange={(e) => set("reason", e.target.value)} minLength={3} maxLength={300} required />
            </FormField>
            {problems.length ? (
              <ul className="text-xs text-warning-fg">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
                {price ? describePrice(price, formatCurrency) : ""}. Mensalidade por quantidade: {examples.join(" · ")}.
              </p>
            )}
            {error ? (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={problems.length > 0 || form.reason.trim().length < 3}>
              Gravar versão
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar uma versão (preço ou pacote) com motivo obrigatório. */
export function CancelVersionDialog({ title, description, onClose, onConfirm }: { title: string; description: string; onClose: () => void; onConfirm: (reason: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onConfirm(reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Versão cancelada");
      onClose();
      router.refresh();
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <FormField label="Motivo" htmlFor="cv-reason" required>
              <Input id="cv-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} required autoFocus />
            </FormField>
            {error ? (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" loading={pending} disabled={reason.trim().length < 3}>
              Cancelar versão
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Catálogo do ERP
// ---------------------------------------------------------------------------

function CatalogSection({ code, unit, units }: { code: string; unit: CatalogUnitView | null; units: readonly CatalogUnitView[] }) {
  const [detail, setDetail] = React.useState<UnitDetail | null>(null);
  const [loading, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  if (!unit) return <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">Este código não está no catálogo em uso. A ficha e os preços ficam guardados; revise quando o catálogo do ERP for atualizado.</p>;
  const nameOf = (c: string) => units.find((u) => u.code === c)?.name ?? c;
  const dependents = units.filter((u) => u.requires.includes(code));
  const load = () =>
    startTransition(async () => {
      const result = await loadUnitDetailAction({ code });
      if (result.ok) setDetail(result.data);
      else setError(result.error);
    });

  return (
    <section aria-labelledby={`ct-${uid(code)}`} className="flex flex-col gap-2 text-sm">
      <h3 id={`ct-${uid(code)}`} className="flex items-center gap-2 text-sm font-semibold">
        <ListTree className="size-4 text-muted" /> No catálogo do ERP
      </h3>
      <p className="text-muted">
        Situação técnica: {ERP_DEV_STATUS_LABELS[unit.devStatus] ?? unit.devStatus}
        {unit.description ? ` · ${unit.description}` : ""}
      </p>
      <p>
        <span className="text-muted">Exige: </span>
        {unit.requires.length ? unit.requires.map((c) => `${c} ${nameOf(c)}`).join(", ") : "nada"}
      </p>
      <p>
        <span className="text-muted">É exigido por: </span>
        {dependents.length ? dependents.map((u) => `${u.code} ${u.name}`).join(", ") : "nenhum"}
      </p>
      {detail ? (
        <details open className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">O que vem junto ({detail.includes.length} itens do catálogo)</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {detail.includes.map((i) => (
              <li key={i.code} className="text-xs">
                <span className="tabular-nums text-muted">{i.code}</span> {i.name}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" onClick={load} loading={loading}>
            <ListTree /> Mostrar o que vem junto
          </Button>
          {error ? <span className="ml-2 text-xs text-danger-fg">{error}</span> : null}
        </div>
      )}
    </section>
  );
}
