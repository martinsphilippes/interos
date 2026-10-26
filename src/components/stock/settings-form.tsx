"use client";

import * as React from "react";
import { saveStockSettingsAction } from "@/server/stock/actions";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import type { StockSettings } from "@/domain/stock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFinanceAction } from "@/components/finance/use-finance-action";

/** Configuração do estoque: quem responde por ele e o que é automático. */
export function StockSettingsForm({ settings, canEdit }: { settings: StockSettings; canEdit: boolean }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [form, setForm] = React.useState({
    responsibleDepartment: settings.responsibleDepartment,
    reserveOnSign: settings.reserveOnSign,
    notifyLowStock: settings.notifyLowStock,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Configuração do estoque
          {!settings.stored ? (
            <Badge variant="warning" size="sm">
              Ainda não salva: usando os padrões
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>Departamento responsável (recebe os avisos de mínimo, falta e devolução) e as automações.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit) void run(() => saveStockSettingsAction(form), "Configuração do estoque salva");
          }}
        >
          <FormField label="Departamento responsável" htmlFor={`${id}-d`} hint="Compras e Estoque ficam no Administrativo por padrão; o gestor dele recebe os avisos.">
            <Select
              id={`${id}-d`}
              value={form.responsibleDepartment}
              onChange={(e) => setForm((f) => ({ ...f, responsibleDepartment: e.target.value as DepartmentKey }))}
              disabled={!canEdit}
              className="h-11 md:h-9"
            >
              {DEPARTMENT_KEYS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABELS[d]}
                </option>
              ))}
            </Select>
          </FormField>
          <Switch
            label="Reservar na assinatura do contrato"
            description="Contrato assinado por todos separa os equipamentos dos produtos vinculados; o que faltar é avisado."
            checked={form.reserveOnSign}
            onCheckedChange={(v) => setForm((f) => ({ ...f, reserveOnSign: v }))}
            disabled={!canEdit}
          />
          <Switch
            label="Avisar estoque abaixo do mínimo"
            description="Um aviso quando o disponível fica abaixo do mínimo do item; avisa de novo só depois de repor."
            checked={form.notifyLowStock}
            onCheckedChange={(v) => setForm((f) => ({ ...f, notifyLowStock: v }))}
            disabled={!canEdit}
          />
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
