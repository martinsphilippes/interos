"use client";

/**
 * Aba Simulador da Gestão de Produtos: monta pacote + módulos avulsos com as quantidades e calcula mensalidade e
 * implantação pela versão vigente na data, sem cobrança dupla (o que está no pacote não é cobrado de novo) e apontando
 * as dependências que faltam. O cálculo é o mesmo do domínio (`quote`), feito na própria tela.
 */
import * as React from "react";
import { ClipboardCopy, Plus, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PACKAGE_STATUS_LABELS, type CommercialModule } from "@/domain/products/commercial";
import { QUOTE_LINE_STATUS_LABELS, quote, type QuoteItem, type QuoteLineStatus, type QuoteUnit } from "@/domain/products/quote";
import type { ProductManagementView } from "@/server/products/queries";
import { formatCurrency, formatDateKey } from "@/lib/format";
import { CatalogSourceNotice } from "./catalog-source";

const LINE_VARIANT: Record<QuoteLineStatus, "success" | "info" | "warning" | "danger"> = {
  cobrado: "success",
  incluido: "info",
  sem_preco: "warning",
  indisponivel: "danger",
};

export function PriceSimulator({ view }: { view: ProductManagementView }) {
  const [date, setDate] = React.useState(view.today);
  const [packageId, setPackageId] = React.useState("");
  const [items, setItems] = React.useState<QuoteItem[]>([]);
  const [adding, setAdding] = React.useState("");
  const units = React.useMemo(() => new Map<string, QuoteUnit>(view.units.map((u) => [u.code, u])), [view.units]);
  const modules = React.useMemo(() => new Map<string, CommercialModule>(view.records.map((r) => [r.code, r])), [view.records]);
  const pkg = view.packages.find((p) => p.id === packageId) ?? null;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : view.today;
  const result = quote({ date: validDate, units, modules, pkg, items });
  const nameOf = (code: string) => modules.get(code)?.name ?? units.get(code)?.name ?? code;
  const available = view.units.filter((u) => !items.some((i) => i.code === u.code));

  const add = (code: string) => {
    if (!code || items.some((i) => i.code === code)) return;
    setItems((prev) => [...prev, { code, quantity: 1 }]);
    setAdding("");
  };

  const copy = async () => {
    const lines = result.lines.map((l) => `${l.kind === "pacote" ? "Pacote " : `${l.code} `}${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ""}: ${l.status === "cobrado" ? `${formatCurrency(l.monthly)}/mês${l.setup ? ` + ${formatCurrency(l.setup)} implantação` : ""}` : QUOTE_LINE_STATUS_LABELS[l.status].toLowerCase()}${l.note ? ` (${l.note})` : ""}`);
    const text = [`Simulação em ${formatDateKey(validDate)}`, ...lines, `Total: ${formatCurrency(result.monthly)}/mês + ${formatCurrency(result.setup)} de implantação${result.complete ? "" : " (incompleto: há itens sem preço)"}`].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Resumo copiado");
    } catch {
      toast.error("Não foi possível copiar; selecione o texto da tabela.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <CatalogSourceNotice catalog={view.catalog} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
        <FormField label="Pacote" htmlFor="sim-pkg">
          <Select id="sim-pkg" value={packageId} onChange={(e) => setPackageId(e.target.value)} options={[{ value: "", label: "Sem pacote (só avulsos)" }, ...view.packages.map((p) => ({ value: p.id, label: `${p.name}${p.status !== "a_venda" ? ` (${PACKAGE_STATUS_LABELS[p.status].toLowerCase()})` : ""}` }))]} />
        </FormField>
        <FormField label="Acrescentar módulo avulso" htmlFor="sim-add">
          <div className="flex gap-2">
            <Select id="sim-add" value={adding} onChange={(e) => setAdding(e.target.value)} options={[{ value: "", label: "Escolha um módulo…" }, ...available.map((u) => ({ value: u.code, label: `${u.code} ${nameOf(u.code)}` }))]} />
            <Button type="button" variant="outline" onClick={() => add(adding)} disabled={!adding} aria-label="Acrescentar o módulo escolhido">
              <Plus />
            </Button>
          </div>
        </FormField>
        <FormField label="Data dos preços" htmlFor="sim-date">
          <DateInput id="sim-date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>

      {items.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((i) => (
            <li key={i.code} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-[200px] flex-1 text-sm">
                <span className="tabular-nums text-muted">{i.code}</span> {nameOf(i.code)}
              </span>
              <label className="flex items-center gap-2 text-sm">
                Quantidade
                <Input type="number" inputMode="numeric" min={1} step={1} value={i.quantity} onChange={(e) => setItems((prev) => prev.map((x) => (x.code === i.code ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))} className="w-24 tabular-nums" aria-label={`Quantidade de ${i.code}`} />
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems((prev) => prev.filter((x) => x.code !== i.code))} aria-label={`Tirar ${i.code}`}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {result.lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Escolha um pacote e/ou acrescente módulos para ver o preço.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Resultado da simulação</caption>
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 text-right font-medium">Mensalidade</th>
                <th className="px-3 py-2 text-right font-medium">Implantação</th>
                <th className="px-3 py-2 font-medium">Observação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.lines.map((l) => (
                <tr key={`${l.kind}-${l.code}`}>
                  <td className="px-3 py-2">
                    {l.kind === "pacote" ? <span className="font-medium">Pacote {l.name}</span> : <><span className="tabular-nums text-muted">{l.code}</span> {l.name}</>}
                    {l.quantity > 1 ? <span className="text-muted"> × {l.quantity}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={LINE_VARIANT[l.status]} size="sm">
                      {QUOTE_LINE_STATUS_LABELS[l.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.status === "cobrado" ? formatCurrency(l.monthly) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.status === "cobrado" && l.setup ? formatCurrency(l.setup) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted">{l.note ?? (l.priceVersion ? `preço v${l.priceVersion}` : "")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border-strong bg-surface-muted font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>
                  Total{!result.complete ? <span className="ml-2 text-xs font-normal text-warning-fg">incompleto: há itens sem preço</span> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(result.monthly)}/mês</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(result.setup)}</td>
                <td className="px-3 py-2 text-right">
                  <Button type="button" size="sm" variant="ghost" onClick={copy}>
                    <ClipboardCopy /> Copiar resumo
                  </Button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {result.missingDependencies.length ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-fg">
          <p className="font-medium">Faltam dependências</p>
          <ul className="mt-1 flex flex-col gap-1">
            {result.missingDependencies.map((d) => (
              <li key={d.code} className="flex flex-wrap items-center gap-2">
                {d.code} {d.name}, exigido por {d.requiredBy.join(", ")}
                <Button type="button" size="sm" variant="outline" onClick={() => add(d.code)}>
                  <Plus /> Acrescentar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.warnings.length ? (
        <ul className="flex flex-col gap-1 text-xs text-warning-fg">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {result.packageComparison ? (
        <p className="text-xs text-muted">
          {result.packageComparison.unpriced.length
            ? `Comparação parcial: os módulos do pacote com preço avulso somam ${formatCurrency(result.packageComparison.monthly)}/mês, mas ${result.packageComparison.unpriced.length} não têm preço avulso (${result.packageComparison.unpriced.join(", ")}).`
            : result.packageComparison.savingPct === null
              ? ""
              : `Os módulos do pacote avulsos custariam ${formatCurrency(result.packageComparison.monthly)}/mês: ${result.packageComparison.savingMonthly >= 0 ? `economia de ${formatCurrency(result.packageComparison.savingMonthly)}/mês (${result.packageComparison.savingPct}%).` : `o pacote sai ${formatCurrency(-result.packageComparison.savingMonthly)}/mês mais caro.`}`}
        </p>
      ) : null}
    </div>
  );
}
