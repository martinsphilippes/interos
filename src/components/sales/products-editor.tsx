"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductOption } from "@/server/sales/queries";
import { netItem, proposalTotals } from "./model";

export interface EditableLine {
  key: string;
  productId: string;
  productName: string;
  quantity: number;
  setupValue: number;
  monthlyValue: number;
  hardwareValue: number;
  discountPct: number;
  /** Plano comercial do item (usado pelas regras de comissão por plano). */
  planId?: string;
  planName?: string;
}

let seq = 0;
export function toEditableLines(lines: { productId: string; productName: string; quantity: number; setupValue: number; monthlyValue: number; hardwareValue: number; discountPct?: number; planId?: string; planName?: string }[]): EditableLine[] {
  return lines.map((l) => ({ ...l, discountPct: l.discountPct ?? 0, key: `l${++seq}` }));
}

/** Linhas sem a chave local (formato aceito pelas actions). */
export function toPayloadLines(lines: EditableLine[], withDiscount = false) {
  return lines.map(({ key: _key, discountPct, ...rest }) => {
    void _key;
    return withDiscount ? { ...rest, discountPct } : rest;
  });
}

export interface ProductsEditorProps {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  products: ProductOption[];
  /** Mostra a coluna de desconto (%) — editor de proposta. */
  withDiscount?: boolean;
  disabled?: boolean;
  className?: string;
}

const numberValue = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Editor de produtos (oportunidade, ganho, proposta): valores por linha já multiplicados pela
 * quantidade; mudar a quantidade reescala os valores pelo valor unitário atual. Totais recalculados.
 */
export function ProductsEditor({ lines, onChange, products, withDiscount, disabled, className }: ProductsEditorProps) {
  const [adding, setAdding] = React.useState("");
  const totals = proposalTotals(lines);
  const available = products.filter((p) => !lines.some((l) => l.productId === p.id));

  const patch = (key: string, next: Partial<EditableLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const changeQuantity = (line: EditableLine, raw: string) => {
    const quantity = Math.max(1, Math.round(numberValue(raw)) || 1);
    const unit = (v: number) => (line.quantity > 0 ? v / line.quantity : v);
    patch(line.key, {
      quantity,
      setupValue: Math.round(unit(line.setupValue) * quantity * 100) / 100,
      monthlyValue: Math.round(unit(line.monthlyValue) * quantity * 100) / 100,
      hardwareValue: Math.round(unit(line.hardwareValue) * quantity * 100) / 100,
    });
  };

  const add = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    onChange([...lines, ...toEditableLines([{ productId: p.id, productName: p.name, quantity: 1, setupValue: p.setupPrice, monthlyValue: p.monthlyPrice, hardwareValue: p.hardwarePrice, discountPct: 0 }])]);
    setAdding("");
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {lines.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong px-3 py-5 text-center text-sm text-muted">Nenhum produto. Adicione do catálogo abaixo.</p> : null}
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const net = netItem(line);
          return (
            <li key={line.key} className="rounded-lg border border-border bg-surface-muted p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {line.productName}
                  {line.planName && !(products.find((p) => p.id === line.productId)?.plans?.length) ? <span className="ml-1.5 text-xs font-normal text-muted">plano {line.planName}</span> : null}
                </p>
                {!disabled ? (
                  <Button variant="ghost" size="icon" className="-mr-1 -mt-1 size-9 text-muted hover:text-danger" onClick={() => onChange(lines.filter((l) => l.key !== line.key))} aria-label={`Remover ${line.productName}`}>
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <PlanPicker line={line} plans={products.find((p) => p.id === line.productId)?.plans ?? []} disabled={disabled} onChange={(next) => patch(line.key, next)} />
              <div className={cn("mt-2 grid grid-cols-2 gap-2", withDiscount ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
                <LineField label="Qtd.">
                  <Input type="number" inputMode="numeric" min={1} step={1} value={line.quantity} disabled={disabled} onChange={(e) => changeQuantity(line, e.target.value)} />
                </LineField>
                <LineField label="Adesão (R$)">
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={line.setupValue} disabled={disabled} onChange={(e) => patch(line.key, { setupValue: numberValue(e.target.value) })} />
                </LineField>
                <LineField label="Mensal (R$)">
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={line.monthlyValue} disabled={disabled} onChange={(e) => patch(line.key, { monthlyValue: numberValue(e.target.value) })} />
                </LineField>
                <LineField label="Hardware (R$)">
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={line.hardwareValue} disabled={disabled} onChange={(e) => patch(line.key, { hardwareValue: numberValue(e.target.value) })} />
                </LineField>
                {withDiscount ? (
                  <LineField label="Desconto (%)">
                    <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={line.discountPct} disabled={disabled} onChange={(e) => patch(line.key, { discountPct: Math.min(100, numberValue(e.target.value)) })} />
                  </LineField>
                ) : null}
              </div>
              {withDiscount && line.discountPct > 0 ? (
                <p className="mt-1.5 text-xs text-muted tabular-nums">
                  Com desconto: {formatCurrency(net.setupTotal)} adesão · {formatCurrency(net.monthlyTotal)}/mês{net.hardwareTotal > 0 ? ` · ${formatCurrency(net.hardwareTotal)} hardware` : ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!disabled && available.length > 0 ? (
        <div className="flex items-center gap-2">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Adicionar produto do catálogo…" aria-label="Adicionar produto do catálogo" options={available.map((p) => ({ value: p.id, label: p.name }))} />
          <Button variant="outline" onClick={() => add(adding)} disabled={!adding} className="min-h-[44px] md:min-h-0">
            <Plus /> Adicionar
          </Button>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-surface-hover p-3 text-sm sm:grid-cols-4">
        <Total label="Adesão" value={totals.setupTotal} />
        <Total label="Mensalidade" value={totals.monthlyTotal} />
        <Total label="Hardware" value={totals.hardwareTotal} />
        {withDiscount ? <Total label="Descontos" value={totals.discountTotal} /> : <Total label="1º ano" value={totals.setupTotal + totals.monthlyTotal * 12 + totals.hardwareTotal} />}
      </dl>
    </div>
  );
}

/**
 * Plano do item (só quando o produto tem planos ativos). Escolher um plano aplica os preços de referência dele (quando
 * cadastrados) × quantidade; os valores continuam editáveis.
 */
function PlanPicker({ line, plans, disabled, onChange }: { line: EditableLine; plans: NonNullable<ProductOption["plans"]>; disabled?: boolean; onChange: (next: Partial<EditableLine>) => void }) {
  if (plans.length === 0) return null;
  const known = plans.some((p) => p.id === line.planId);
  return (
    <label className="mt-2 flex flex-col gap-1 sm:max-w-xs">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Plano</span>
      <Select
        value={line.planId ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const plan = plans.find((p) => p.id === e.target.value);
          if (!plan) return onChange({ planId: undefined, planName: undefined });
          const q = Math.max(1, line.quantity);
          onChange({
            planId: plan.id,
            planName: plan.name,
            ...(plan.setupPrice !== undefined ? { setupValue: Math.round(plan.setupPrice * q * 100) / 100 } : {}),
            ...(plan.monthlyPrice !== undefined ? { monthlyValue: Math.round(plan.monthlyPrice * q * 100) / 100 } : {}),
          });
        }}
        placeholder="Sem plano"
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {line.planId && !known ? <option value={line.planId}>{line.planName ?? "Plano inativo"}</option> : null}
      </Select>
    </label>
  );
}

function LineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{formatCurrency(value)}</dd>
    </div>
  );
}
