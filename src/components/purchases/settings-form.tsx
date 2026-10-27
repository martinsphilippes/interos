"use client";

import * as React from "react";
import { savePurchaseSettingsAction } from "@/server/purchases/actions";
import type { PurchaseSettings } from "@/domain/purchases";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFinanceAction } from "@/components/finance/use-finance-action";

/** Configuração de compras: aprovação acima de um valor e o título gerado no recebimento. */
export function PurchaseSettingsForm({ settings, categories, canEdit }: { settings: PurchaseSettings; categories: { value: string; label: string }[]; canEdit: boolean }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [form, setForm] = React.useState({
    approvalEnabled: settings.approvalEnabled,
    approvalThreshold: String(settings.approvalThreshold.toFixed(2)).replace(".", ","),
    payableCategory: settings.payableCategory,
    paymentDays: String(settings.paymentDays),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Configuração de compras
          {!settings.stored ? (
            <Badge variant="warning" size="sm">
              Ainda não salva: usando os padrões
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>Quem aprova: a diretoria ou o gestor do Administrativo.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit) void run(() => savePurchaseSettingsAction(form), "Configuração de compras salva");
          }}
        >
          <Switch
            label="Exigir aprovação acima de um valor"
            description="Desligado, todo pedido enviado já fica aprovado."
            checked={form.approvalEnabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, approvalEnabled: v }))}
            disabled={!canEdit}
          />
          {form.approvalEnabled ? (
            <FormField label="Aprovar pedidos acima de (R$)" htmlFor={`${id}-v`} hint="Até este valor o pedido segue direto; acima, espera a aprovação.">
              <Input id={`${id}-v`} inputMode="decimal" value={form.approvalThreshold} onChange={(e) => setForm((f) => ({ ...f, approvalThreshold: e.target.value }))} disabled={!canEdit} className="h-11 tabular-nums md:h-9" />
            </FormField>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Categoria do título a pagar" htmlFor={`${id}-c`} hint="Contas a Pagar › categorias">
              <Select id={`${id}-c`} value={form.payableCategory} onChange={(e) => setForm((f) => ({ ...f, payableCategory: e.target.value }))} disabled={!canEdit} className="h-11 md:h-9">
                {categories.some((c) => c.value === form.payableCategory) ? null : (
                  <option value={form.payableCategory} disabled>
                    {form.payableCategory} (não existe mais em Contas a pagar: escolha outra)
                  </option>
                )}
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Prazo padrão de pagamento (dias)" htmlFor={`${id}-p`} hint="Contados do recebimento; cada pedido pode mudar">
              <Input id={`${id}-p`} inputMode="numeric" value={form.paymentDays} onChange={(e) => setForm((f) => ({ ...f, paymentDays: e.target.value.replace(/\D/g, "") }))} disabled={!canEdit} className="h-11 tabular-nums md:h-9" />
            </FormField>
          </div>
          {canEdit ? (
            <div>
              <Button type="submit" loading={pending} className="h-11 md:h-9">
                Salvar configuração
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">Só a diretoria, o admin ou o gestor do Administrativo alteram esta configuração.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
