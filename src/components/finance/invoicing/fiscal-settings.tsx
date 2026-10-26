"use client";

import * as React from "react";
import { Pencil, Save } from "lucide-react";
import type { FiscalProductRow } from "@/server/finance/invoices";
import { saveFiscalSettingsAction, saveProductFiscalAction } from "@/server/finance/invoice-actions";
import {
  BILLING_TYPE_FISCAL_LABELS,
  BILLING_TYPES_FISCAL,
  DEFAULT_INVOICE_MESSAGE,
  FISCAL_REGIME_LABELS,
  FISCAL_REGIMES,
  INVOICE_MOMENT_LABELS,
  INVOICE_RULE_LABELS,
  INVOICE_RULES,
  PRODUCT_FISCAL_NATURE_LABELS,
  PRODUCT_FISCAL_NATURES,
  type FiscalSettings,
  type InvoiceRule,
} from "@/domain/fiscal";
import type { ProductFiscalNature } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";

const num = (v: number | undefined) => (v === undefined ? "" : String(v).replace(".", ","));

/** Configuração fiscal: o Hércules ajusta uma vez e o sistema para de perguntar. */
export function FiscalSettingsForm({ settings, canEdit }: { settings: FiscalSettings; canEdit: boolean }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [form, setForm] = React.useState({
    enabled: settings.enabled,
    regime: settings.regime ?? "",
    municipalRegistration: settings.municipalRegistration ?? "",
    stateRegistration: settings.stateRegistration ?? "",
    cnae: settings.cnae ?? "",
    defaultServiceCode: settings.defaultServiceCode ?? "",
    defaultIssRate: num(settings.defaultIssRate),
    defaultNcm: settings.defaultNcm ?? "",
    defaultCfop: settings.defaultCfop ?? "",
    rules: { ...settings.rules },
    moment: settings.moment,
    leadDays: String(settings.leadDays),
    since: settings.since,
    messageTemplate: settings.messageTemplate ?? DEFAULT_INVOICE_MESSAGE,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const disabled = !canEdit;

  const save = () =>
    void run(
      () =>
        saveFiscalSettingsAction({
          ...form,
          regime: form.regime || undefined,
          defaultIssRate: form.defaultIssRate || undefined,
          messageTemplate: form.messageTemplate.trim() === DEFAULT_INVOICE_MESSAGE ? undefined : form.messageTemplate,
        }),
      "Configuração fiscal salva",
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Configuração fiscal
          {!settings.stored ? (
            <Badge variant="warning" size="sm">
              Ainda não salva: usando os padrões
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>Que nota cada cobrança pede, quando ela entra na fila «A faturar» e os dados da empresa para emitir.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit) save();
          }}
        >
          <Switch
            label="Controlar notas fiscais no INTEROS"
            description="Desligado, nenhuma cobrança pede nota e a fila fica vazia."
            checked={form.enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            disabled={disabled}
          />

          <fieldset className="grid gap-3" disabled={disabled}>
            <legend className="mb-2 text-sm font-medium">Nota por tipo de cobrança</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {BILLING_TYPES_FISCAL.map((t) => (
                <FormField key={t} label={BILLING_TYPE_FISCAL_LABELS[t]} htmlFor={`${id}-r-${t}`}>
                  <Select
                    id={`${id}-r-${t}`}
                    value={form.rules[t]}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        rules: {
                          ...f.rules,
                          [t]: e.target.value as InvoiceRule,
                        },
                      }))
                    }
                    className="h-11 md:h-9"
                  >
                    {INVOICE_RULES.map((r) => (
                      <option key={r} value={r}>
                        {INVOICE_RULE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3" disabled={disabled}>
            <legend className="mb-2 text-sm font-medium sm:col-span-3">Quando a cobrança entra na fila «A faturar»</legend>
            <FormField label="Momento" htmlFor={`${id}-m`}>
              <Select id={`${id}-m`} value={form.moment} onChange={set("moment")} className="h-11 md:h-9">
                {(["vencimento", "pagamento"] as const).map((m) => (
                  <option key={m} value={m}>
                    {INVOICE_MOMENT_LABELS[m]}
                  </option>
                ))}
              </Select>
            </FormField>
            {form.moment === "vencimento" ? (
              <FormField label="Dias antes do vencimento" htmlFor={`${id}-l`} hint="0 a 60">
                <Input id={`${id}-l`} type="number" min={0} max={60} value={form.leadDays} onChange={set("leadDays")} className="h-11 md:h-9" />
              </FormField>
            ) : (
              <div />
            )}
            <FormField label="Controlar a partir de" htmlFor={`${id}-s`} hint="Cobranças com vencimento anterior não entram na fila">
              <Input id={`${id}-s`} type="date" value={form.since} onChange={set("since")} className="h-11 md:h-9" />
            </FormField>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" disabled={disabled}>
            <legend className="mb-2 text-sm font-medium sm:col-span-2 lg:col-span-4">Dados fiscais da empresa</legend>
            <FormField label="Regime tributário" htmlFor={`${id}-rg`}>
              <Select id={`${id}-rg`} value={form.regime} onChange={set("regime")} className="h-11 md:h-9">
                <option value="">Não informado</option>
                {FISCAL_REGIMES.map((r) => (
                  <option key={r} value={r}>
                    {FISCAL_REGIME_LABELS[r]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Inscrição municipal" htmlFor={`${id}-im`}>
              <Input id={`${id}-im`} value={form.municipalRegistration} onChange={set("municipalRegistration")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Inscrição estadual" htmlFor={`${id}-ie`}>
              <Input id={`${id}-ie`} value={form.stateRegistration} onChange={set("stateRegistration")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="CNAE principal" htmlFor={`${id}-cn`}>
              <Input id={`${id}-cn`} value={form.cnae} onChange={set("cnae")} className="h-11 md:h-9" />
            </FormField>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" disabled={disabled}>
            <legend className="mb-2 text-sm font-medium sm:col-span-2 lg:col-span-4">Códigos padrão (quando o produto não tem os próprios)</legend>
            <FormField label="Código de serviço (NFS-e)" htmlFor={`${id}-sc`} hint="Ex.: 1.05">
              <Input id={`${id}-sc`} value={form.defaultServiceCode} onChange={set("defaultServiceCode")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Alíquota de ISS (%)" htmlFor={`${id}-iss`}>
              <Input id={`${id}-iss`} value={form.defaultIssRate} onChange={set("defaultIssRate")} inputMode="decimal" className="h-11 md:h-9" />
            </FormField>
            <FormField label="NCM (NF-e)" htmlFor={`${id}-ncm`} hint="8 dígitos">
              <Input id={`${id}-ncm`} value={form.defaultNcm} onChange={set("defaultNcm")} inputMode="numeric" className="h-11 md:h-9" />
            </FormField>
            <FormField label="CFOP (NF-e)" htmlFor={`${id}-cfop`} hint="Ex.: 5102">
              <Input id={`${id}-cfop`} value={form.defaultCfop} onChange={set("defaultCfop")} inputMode="numeric" className="h-11 md:h-9" />
            </FormField>
          </fieldset>

          <FormField label="Mensagem de envio da nota" htmlFor={`${id}-msg`} hint="Variáveis: {cliente}, {nota}, {valor}, {cobranca}, {linkPortal}">
            <Textarea id={`${id}-msg`} value={form.messageTemplate} onChange={set("messageTemplate")} className="min-h-[90px]" disabled={disabled} maxLength={1000} />
          </FormField>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" loading={pending} className="h-11 md:h-9">
                <Save /> Salvar configuração
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">Só a diretoria ou o gestor do Financeiro altera esta configuração.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Perfil fiscal de cada produto: natureza e códigos que vão na nota. */
export function ProductFiscalTable({ rows, canEdit }: { rows: FiscalProductRow[]; canEdit: boolean }) {
  const [editing, setEditing] = React.useState<FiscalProductRow | null>(null);
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Perfil fiscal dos produtos</CardTitle>
        <CardDescription>Software e serviço saem na NFS-e (código de serviço); equipamento sai na NF-e (NCM e CFOP).</CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y divide-border" data-testid="product-fiscal-list">
        {rows.map((p) => {
          const f = p.fiscal;
          return (
            <li key={p.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {p.name}
                  {!p.active ? (
                    <Badge variant="muted" size="sm">
                      Inativo
                    </Badge>
                  ) : null}
                  {f ? (
                    <Badge variant="info" size="sm">
                      {PRODUCT_FISCAL_NATURE_LABELS[f.nature]}
                    </Badge>
                  ) : (
                    <Badge variant="warning" size="sm">
                      Sem perfil fiscal
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {[p.hasSetup && "adesão", p.hasMonthly && "mensalidade", p.hasHardware && "hardware"].filter(Boolean).join(" · ") || "sem valores"}
                  {f
                    ? ` · ${[f.serviceCode && `serviço ${f.serviceCode}`, f.issRate !== undefined && `ISS ${num(f.issRate)}%`, f.ncm && `NCM ${f.ncm}`, f.cfop && `CFOP ${f.cfop}`].filter(Boolean).join(" · ") || "usa os códigos padrão"}`
                    : ""}
                </p>
              </div>
              {canEdit ? (
                <Button variant="outline" size="sm" className="h-10 self-start md:h-8 md:self-center" onClick={() => setEditing(p)} aria-label={`Editar perfil fiscal de ${p.name}`}>
                  <Pencil /> Editar
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editing ? <ProductFiscalDialog row={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function ProductFiscalDialog({ row, onClose }: { row: FiscalProductRow; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const f = row.fiscal;
  const [form, setForm] = React.useState({
    nature: (f?.nature ?? (row.hasHardware && !row.hasMonthly ? "equipamento" : "software")) as ProductFiscalNature,
    serviceCode: f?.serviceCode ?? "",
    issRate: num(f?.issRate),
    ncm: f?.ncm ?? "",
    cfop: f?.cfop ?? "",
    invoiceDescription: f?.invoiceDescription ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((x) => ({ ...x, [k]: e.target.value }));
  const goods = form.nature === "equipamento" || row.hasHardware;
  const service = form.nature !== "equipamento" || row.hasSetup || row.hasMonthly;
  const save = async () => {
    // Só os campos visíveis: os escondidos pela natureza não vão para o cadastro.
    const payload = {
      productId: row.id,
      nature: form.nature,
      invoiceDescription: form.invoiceDescription,
      ...(service ? { serviceCode: form.serviceCode, issRate: form.issRate || undefined } : {}),
      ...(goods ? { ncm: form.ncm, cfop: form.cfop } : {}),
    };
    const ok = await run(() => saveProductFiscalAction(payload), `Perfil fiscal de ${row.name} salvo`);
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Perfil fiscal · {row.name}</DialogTitle>
          <DialogDescription>Campos vazios usam os códigos padrão da configuração fiscal.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody className="grid gap-3 py-2 sm:grid-cols-2">
            <FormField label="Natureza" htmlFor={`${id}-n`} required className="sm:col-span-2">
              <Select id={`${id}-n`} value={form.nature} onChange={set("nature")} className="h-11 md:h-9">
                {PRODUCT_FISCAL_NATURES.map((n) => (
                  <option key={n} value={n}>
                    {PRODUCT_FISCAL_NATURE_LABELS[n]}
                  </option>
                ))}
              </Select>
            </FormField>
            {service ? (
              <>
                <FormField label="Código de serviço (NFS-e)" htmlFor={`${id}-sc`} hint="Ex.: 1.05 (licenciamento de software)">
                  <Input id={`${id}-sc`} value={form.serviceCode} onChange={set("serviceCode")} className="h-11 md:h-9" />
                </FormField>
                <FormField label="Alíquota de ISS (%)" htmlFor={`${id}-iss`}>
                  <Input id={`${id}-iss`} value={form.issRate} onChange={set("issRate")} inputMode="decimal" className="h-11 md:h-9" />
                </FormField>
              </>
            ) : null}
            {goods ? (
              <>
                <FormField label="NCM (NF-e)" htmlFor={`${id}-ncm`} hint="8 dígitos">
                  <Input id={`${id}-ncm`} value={form.ncm} onChange={set("ncm")} inputMode="numeric" className="h-11 md:h-9" />
                </FormField>
                <FormField label="CFOP (NF-e)" htmlFor={`${id}-cfop`} hint="Ex.: 5102">
                  <Input id={`${id}-cfop`} value={form.cfop} onChange={set("cfop")} inputMode="numeric" className="h-11 md:h-9" />
                </FormField>
              </>
            ) : null}
            <FormField label="Descrição na nota" htmlFor={`${id}-d`} className="sm:col-span-2" hint="Vazio = nome do produto">
              <Input id={`${id}-d`} value={form.invoiceDescription} onChange={set("invoiceDescription")} maxLength={200} className="h-11 md:h-9" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} className="h-11 md:h-9">
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
