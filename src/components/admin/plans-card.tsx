"use client";

import * as React from "react";
import { Layers3, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { savePlanAction, setPlanActiveAction } from "@/server/plans/actions";
import type { CommercialPlan } from "@/domain/types";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";

interface PlanForm {
  id?: string;
  code: string;
  name: string;
  productId: string;
  description: string;
  setupPrice: string;
  monthlyPrice: string;
  active: boolean;
}

const toForm = (p?: CommercialPlan): PlanForm => ({
  id: p?.id,
  code: p?.code ?? "",
  name: p?.name ?? "",
  productId: p?.productId ?? "",
  description: p?.description ?? "",
  setupPrice: p?.setupPrice !== undefined ? String(p.setupPrice) : "",
  monthlyPrice: p?.monthlyPrice !== undefined ? String(p.monthlyPrice) : "",
  active: p?.active ?? true,
});
const price = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/**
 * Planos comerciais (COM.07): ex.: ERP › Star. Escolhidos em cada item da proposta/venda e usados pelas regras de
 * comissão por plano. Botões por permissão calculada no servidor.
 */
export function PlansCard({ plans, products, can }: { plans: CommercialPlan[]; products: { id: string; name: string }[]; can: { create: boolean; edit: boolean; toggle: boolean } }) {
  const [editing, setEditing] = React.useState<PlanForm | null>(null);
  const { pending, run } = useFinanceAction();
  const productName = (id?: string) => (id ? (products.find((p) => p.id === id)?.name ?? "Produto removido") : "Qualquer produto");
  return (
    <Card className="mt-5" data-testid="plans-card">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Layers3 className="size-4 text-muted" /> Planos comerciais
          </CardTitle>
          <CardDescription>Planos vendidos sobre um produto (ex.: Star). Aparecem no item da proposta e nas regras de comissão por plano.</CardDescription>
        </div>
        {can.create ? (
          <Button variant="outline" size="sm" className="h-10 shrink-0 md:h-8" onClick={() => setEditing(toForm())}>
            <Plus /> Novo plano
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        {plans.length === 0 ? (
          <EmptyState size="sm" title="Nenhum plano cadastrado" description="Cadastre os planos (ex.: Star) para usar regras de comissão por plano." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    {p.name}
                    <Badge variant="muted" size="sm">
                      {p.code}
                    </Badge>
                    {!p.active ? (
                      <Badge variant="muted" size="sm">
                        Inativo
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    {[productName(p.productId), p.setupPrice !== undefined ? `adesão ${formatCurrency(p.setupPrice)}` : null, p.monthlyPrice !== undefined ? `mensalidade ${formatCurrency(p.monthlyPrice)}` : null, p.description].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {can.edit ? (
                    <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setEditing(toForm(p))} aria-label={`Editar ${p.name}`}>
                      <Pencil /> Editar
                    </Button>
                  ) : null}
                  {can.toggle ? (
                    <Button variant="outline" size="sm" className="h-10 md:h-8" loading={pending} onClick={() => run(() => setPlanActiveAction({ id: p.id, active: !p.active }), p.active ? "Plano desativado" : "Plano reativado")} aria-label={`${p.active ? "Desativar" : "Reativar"} ${p.name}`}>
                      {p.active ? <PowerOff /> : <Power />} {p.active ? "Desativar" : "Reativar"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing ? <PlanDialog initial={editing} products={products} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function PlanDialog({ initial, products, onClose }: { initial: PlanForm; products: { id: string; name: string }[]; onClose: () => void }) {
  const id = React.useId();
  const [f, setF] = React.useState(initial);
  const { pending, run } = useFinanceAction();
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => savePlanAction({ id: f.id, code: f.code, name: f.name, productId: f.productId || undefined, description: f.description, setupPrice: price(f.setupPrice), monthlyPrice: price(f.monthlyPrice), active: f.active }),
      (d) => (d.created ? "Plano criado" : "Plano salvo"),
    );
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{f.id ? "Editar plano" : "Novo plano comercial"}</DialogTitle>
            <DialogDescription>Desativar não apaga: contratos e comissões que citam o plano continuam com ele.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nome" htmlFor={`${id}-nome`} required>
              <Input id={`${id}-nome`} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Star" />
            </FormField>
            <FormField label="Código" htmlFor={`${id}-cod`} required>
              <Input id={`${id}-cod`} value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="Ex.: STAR" className="uppercase" maxLength={30} />
            </FormField>
            <FormField label="Produto" htmlFor={`${id}-prod`} hint="Vazio = vale para qualquer produto" className="sm:col-span-2">
              <Select id={`${id}-prod`} value={f.productId} onChange={(e) => set("productId", e.target.value)} placeholder="Qualquer produto" options={products.map((p) => ({ value: p.id, label: p.name }))} />
            </FormField>
            <FormField label="Adesão de referência (R$)" htmlFor={`${id}-ades`} hint="Sugerida na proposta">
              <Input id={`${id}-ades`} type="number" inputMode="decimal" min={0} step="0.01" value={f.setupPrice} onChange={(e) => set("setupPrice", e.target.value)} />
            </FormField>
            <FormField label="Mensalidade de referência (R$)" htmlFor={`${id}-mens`}>
              <Input id={`${id}-mens`} type="number" inputMode="decimal" min={0} step="0.01" value={f.monthlyPrice} onChange={(e) => set("monthlyPrice", e.target.value)} />
            </FormField>
            <FormField label="Descrição" htmlFor={`${id}-desc`} className="sm:col-span-2">
              <Textarea id={`${id}-desc`} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </FormField>
            <div className="sm:col-span-2">
              <Switch checked={f.active} onCheckedChange={(v) => set("active", v)} label="Plano ativo" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {f.id ? "Salvar plano" : "Criar plano"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
