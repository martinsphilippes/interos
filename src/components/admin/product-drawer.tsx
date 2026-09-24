"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, type ProductCategory } from "@/domain/constants";
import type { Product } from "@/domain/types";
import type { TemplateOption } from "@/server/admin/queries";
import type { CreateProductInput } from "@/server/admin/schemas";
import { BILLING_TYPES } from "@/server/admin/schemas";
import { createProduct, updateProduct } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { BILLING_TYPE_LABELS, numberToInput, parseNumber } from "./admin-model";
import { FormError } from "./form-error";

export type ProductDrawerState = { mode: "new" } | { mode: "edit"; id: string } | null;

export interface ProductDrawerProps {
  state: ProductDrawerState;
  /** Produto em edição (null em modo "new" ou se não encontrado). */
  product: Product | null;
  templates: TemplateOption[];
  onClose: () => void;
}

/** Drawer de criação/edição de produto com todos os campos de Product. */
export function ProductDrawer({ state, product, templates, onClose }: ProductDrawerProps) {
  const open = state?.mode === "new" || (state?.mode === "edit" && product !== null);
  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent size="lg">{open ? <ProductForm key={product ? `${product.id}-${product.updatedAt}` : "new"} product={state?.mode === "edit" ? product : null} templates={templates} onClose={onClose} /> : null}</DrawerContent>
    </Drawer>
  );
}

interface FormState {
  name: string;
  category: ProductCategory;
  description: string;
  setupPrice: string;
  monthlyPrice: string;
  hardwarePrice: string;
  billingType: Product["billingType"];
  setupPct: string;
  recurringPct: string;
  hardwarePct: string;
  recurringReleaseInstallment: string;
  implementationTemplateId: string;
  implementationDays: string;
  active: boolean;
  order: string;
}

function toForm(product: Product | null): FormState {
  return {
    name: product?.name ?? "",
    category: product?.category ?? "erp",
    description: product?.description ?? "",
    setupPrice: numberToInput(product?.setupPrice ?? 0),
    monthlyPrice: numberToInput(product?.monthlyPrice ?? 0),
    hardwarePrice: numberToInput(product?.hardwarePrice ?? 0),
    billingType: product?.billingType ?? "recorrente",
    setupPct: numberToInput(product?.commission.setupPct),
    recurringPct: numberToInput(product?.commission.recurringPct),
    hardwarePct: numberToInput(product?.commission.hardwarePct),
    recurringReleaseInstallment: numberToInput(product?.commission.recurringReleaseInstallment),
    implementationTemplateId: product?.implementationTemplateId ?? "",
    implementationDays: numberToInput(product?.implementationDays),
    active: product?.active ?? true,
    order: numberToInput(product?.order),
  };
}

function ProductForm({ product, templates, onClose }: { product: Product | null; templates: TemplateOption[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(() => toForm(product));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const number = (label: string, value: string, optional = false): number | undefined => {
    if (optional && !value.trim()) return undefined;
    const n = parseNumber(value);
    if (Number.isNaN(n)) throw new Error(`Informe um número válido em "${label}"`);
    return n;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let input: CreateProductInput;
    try {
      input = {
        name: form.name,
        category: form.category,
        description: form.description || undefined,
        setupPrice: number("Valor de setup", form.setupPrice) as number,
        monthlyPrice: number("Valor mensal", form.monthlyPrice) as number,
        hardwarePrice: number("Valor de hardware", form.hardwarePrice) as number,
        billingType: form.billingType,
        commission: {
          setupPct: number("Comissão de setup", form.setupPct) as number,
          recurringPct: number("Comissão de recorrência", form.recurringPct) as number,
          hardwarePct: number("Comissão de hardware", form.hardwarePct) as number,
          recurringReleaseInstallment: number("Parcela de liberação", form.recurringReleaseInstallment) as number,
        },
        implementationTemplateId: form.implementationTemplateId || undefined,
        implementationDays: number("Dias de implantação", form.implementationDays, true),
        active: form.active,
        order: number("Ordem", form.order, true),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dados inválidos");
      return;
    }
    startTransition(async () => {
      const result = product ? await updateProduct({ ...input, id: product.id }) : await createProduct(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(product ? "Produto salvo" : "Produto criado");
      onClose();
      router.refresh();
    });
  };

  const selectedTemplate = templates.find((t) => t.id === form.implementationTemplateId);

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader>
        <DrawerTitle>{product ? "Editar produto" : "Novo produto"}</DrawerTitle>
        <DrawerDescription>{product ? product.name : "Preços, comissão padrão e template de implantação usados em propostas, contratos e projetos."}</DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-5">
        <section className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome" htmlFor="pd-name" required className="sm:col-span-2">
              <Input id="pd-name" autoFocus={!product} value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} placeholder="Ex.: ERP Intersys" />
            </FormField>
            <FormField label="Categoria" htmlFor="pd-category" required>
              <Select id="pd-category" value={form.category} onChange={(e) => set("category", e.target.value as ProductCategory)}>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {PRODUCT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Tipo de cobrança" htmlFor="pd-billing" required>
              <Select id="pd-billing" value={form.billingType} onChange={(e) => set("billingType", e.target.value as Product["billingType"])}>
                {BILLING_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {BILLING_TYPE_LABELS[b]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Descrição" htmlFor="pd-description" className="sm:col-span-2">
              <Textarea id="pd-description" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={500} className="min-h-[72px]" placeholder="O que o produto entrega ao cliente." />
            </FormField>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="label-caps">Preços (R$)</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Setup / adesão" htmlFor="pd-setup" required>
              <Input id="pd-setup" type="number" inputMode="decimal" min={0} step="0.01" value={form.setupPrice} onChange={(e) => set("setupPrice", e.target.value)} required className="tabular-nums" />
            </FormField>
            <FormField label="Mensalidade" htmlFor="pd-monthly" required>
              <Input id="pd-monthly" type="number" inputMode="decimal" min={0} step="0.01" value={form.monthlyPrice} onChange={(e) => set("monthlyPrice", e.target.value)} required className="tabular-nums" />
            </FormField>
            <FormField label="Hardware" htmlFor="pd-hardware" required>
              <Input id="pd-hardware" type="number" inputMode="decimal" min={0} step="0.01" value={form.hardwarePrice} onChange={(e) => set("hardwarePrice", e.target.value)} required className="tabular-nums" />
            </FormField>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="label-caps">Comissão padrão (%)</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Setup" htmlFor="pd-c-setup" required>
              <Input id="pd-c-setup" type="number" inputMode="decimal" min={0} max={100} step="0.1" value={form.setupPct} onChange={(e) => set("setupPct", e.target.value)} required className="tabular-nums" />
            </FormField>
            <FormField label="Recorrência" htmlFor="pd-c-rec" required>
              <Input id="pd-c-rec" type="number" inputMode="decimal" min={0} max={100} step="0.1" value={form.recurringPct} onChange={(e) => set("recurringPct", e.target.value)} required className="tabular-nums" />
            </FormField>
            <FormField label="Hardware" htmlFor="pd-c-hw" required>
              <Input id="pd-c-hw" type="number" inputMode="decimal" min={0} max={100} step="0.1" value={form.hardwarePct} onChange={(e) => set("hardwarePct", e.target.value)} required className="tabular-nums" />
            </FormField>
            <FormField label="Libera na parcela" htmlFor="pd-c-inst" required hint="Mensalidade em que a comissão de recorrência é paga.">
              <Input id="pd-c-inst" type="number" inputMode="numeric" min={1} max={36} step={1} value={form.recurringReleaseInstallment} onChange={(e) => set("recurringReleaseInstallment", e.target.value)} required className="tabular-nums" />
            </FormField>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="label-caps">Implantação e catálogo</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Template de implantação" htmlFor="pd-template" hint={selectedTemplate ? `${selectedTemplate.totalDays} dias no template${selectedTemplate.active ? "" : " (template inativo)"}` : "Sem template: a implantação é criada sem fases automáticas."}>
              <Select id="pd-template" value={form.implementationTemplateId} onChange={(e) => set("implementationTemplateId", e.target.value)}>
                <option value="">Nenhum</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.active ? "" : " (inativo)"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Dias de implantação" htmlFor="pd-days" hint="Prazo padrão em dias úteis.">
              <Input id="pd-days" type="number" inputMode="numeric" min={0} max={365} step={1} value={form.implementationDays} onChange={(e) => set("implementationDays", e.target.value)} className="tabular-nums" />
            </FormField>
            <FormField label="Ordem no catálogo" htmlFor="pd-order" hint={product ? "Use as setas na lista para reordenar com precisão." : "Vazio: vai para o fim do catálogo."}>
              <Input id="pd-order" type="number" inputMode="numeric" min={1} max={999} step={1} value={form.order} onChange={(e) => set("order", e.target.value)} className="tabular-nums" />
            </FormField>
            <div className="flex items-end">
              <Switch label="Produto ativo" description="Inativos não aparecem em propostas novas." checked={form.active} onCheckedChange={(v) => set("active", v)} className="w-full rounded-lg border border-border px-3 py-2" />
            </div>
          </div>
        </section>

        <FormError message={error} />
      </DrawerBody>
      <DrawerFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {product ? "Salvar" : "Criar produto"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
