"use client";

import * as React from "react";
import { CalendarDays, History, Package, Pencil, Plus, Power, PowerOff, Scale, UserRound } from "lucide-react";
import type { RuleRow, RulesWorkspace } from "@/server/commissions/queries";
import { saveCommissionPaymentDayAction, saveCommissionRuleAction, setCommissionRuleActiveAction } from "@/server/commissions/actions";
import { COMMISSION_BASE_LABELS, COMMISSION_REVENUE_LABELS, COMMISSION_SCOPE_LABELS, COMMISSION_TRIGGER_LABELS } from "@/domain/commissions";
import type { CommissionTrigger } from "@/domain/types";
import { cn } from "@/lib/utils";
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
import { HistoryList, ReasonDialog } from "./commission-ui";

type Scope = RuleRow["scope"];
type Form = RuleRow["form"];

const SECTIONS: { scope: Scope; title: string; description: string; icon: React.ReactNode }[] = [
  { scope: "contrato", title: "Exceções por contrato", description: "Valem só para o contrato indicado e têm precedência sobre todas as outras. Exigem motivo.", icon: <Scale className="size-4 text-muted" /> },
  { scope: "vendedor", title: "Regras por vendedor", description: "Valem para as vendas do vendedor (opcionalmente só para um produto ou categoria).", icon: <UserRound className="size-4 text-muted" /> },
  { scope: "padrao", title: "Regras padrão", description: "Valem para todos os vendedores quando não há regra mais específica.", icon: <Package className="size-4 text-muted" /> },
];

const TRIGGERS = Object.keys(COMMISSION_TRIGGER_LABELS) as CommissionTrigger[];
const RECURRING: CommissionTrigger[] = ["pagamento", "pagamento_e_permanencia", "mensalidade_n"];

const emptyForm = (scope: Scope = "padrao"): Form => ({
  id: "",
  name: "",
  scope,
  revenueType: "setup",
  mode: "percentual",
  value: 10,
  trigger: "pagamento",
  baseSource: "recebido",
  minTenureDays: 0,
  recurringCompetences: 12,
  releaseInstallment: 1,
  overridesDefault: true,
  active: true,
});

export function RulesWorkspaceView({ ws }: { ws: RulesWorkspace }) {
  const [editing, setEditing] = React.useState<Form | null>(null);
  const [toggling, setToggling] = React.useState<RuleRow | null>(null);
  const { pending, run } = useFinanceAction();

  React.useEffect(() => {
    if (!ws.selectedId) return;
    document.getElementById(`regra-${ws.selectedId}`)?.scrollIntoView({ block: "center" });
  }, [ws.selectedId]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        {ws.canManage ? (
          <div className="flex justify-end">
            <Button className="h-11 md:h-9" onClick={() => setEditing(emptyForm())}>
              <Plus /> Nova regra
            </Button>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted">Somente admin, diretoria ou gestor do Financeiro alteram regras. Você está vendo em modo leitura.</p>
        )}
        {SECTIONS.map((section) => {
          const rules = ws.rules.filter((r) => r.scope === section.scope);
          return (
            <Card key={section.scope} data-section={section.scope}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    {section.icon} {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </div>
                {ws.canManage ? (
                  <Button variant="outline" size="sm" className="h-10 shrink-0 md:h-8" onClick={() => setEditing(emptyForm(section.scope))} aria-label={`Nova regra: ${section.title}`}>
                    <Plus /> Nova
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="pt-0">
                {rules.length === 0 ? (
                  <EmptyState size="sm" title="Nenhuma regra nesta categoria" description={section.scope === "contrato" ? "Crie uma exceção quando um contrato tiver condição comercial especial." : undefined} />
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {rules.map((r) => (
                      <li key={r.id} id={`regra-${r.id}`} data-rule={r.name} className={cn("flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between", ws.selectedId === r.id && "rounded-lg bg-brand-soft/60 px-2")}>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5 font-medium">
                            <span className="break-words">{r.name}</span>
                            <Badge variant="outline" size="sm">
                              {COMMISSION_REVENUE_LABELS[r.revenueType]}
                            </Badge>
                            {!r.active ? (
                              <Badge variant="muted" size="sm">
                                Inativa
                              </Badge>
                            ) : null}
                            {!r.overridesDefault ? (
                              <Badge variant="info" size="sm">
                                Soma à padrão
                              </Badge>
                            ) : null}
                            {r.legacy ? (
                              <Badge variant="muted" size="sm">
                                Regra anterior ao motor v2
                              </Badge>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-sm text-muted">{r.description}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {[r.target, r.productLabel, r.validity ? `vigência ${r.validity}` : null, `${r.commissions} comissão(ões)`].filter(Boolean).join(" · ")}
                          </p>
                          {r.reason ? <p className="mt-0.5 text-xs text-muted">Motivo: {r.reason}</p> : null}
                        </div>
                        {ws.canManage ? (
                          <div className="flex shrink-0 gap-1.5">
                            <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setEditing({ ...r.form })} aria-label={`Editar ${r.name}`}>
                              <Pencil /> Editar
                            </Button>
                            <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setToggling(r)} aria-label={`${r.active ? "Desativar" : "Reativar"} ${r.name}`}>
                              {r.active ? <PowerOff /> : <Power />} {r.active ? "Desativar" : "Reativar"}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
        <ProductDefaultsCard ws={ws} />
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <PaymentDayCard value={ws.paymentDay} canManage={ws.canManage} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-muted" /> Histórico de alterações
            </CardTitle>
            <CardDescription>Criação, edição, exceções e desativações, com o valor anterior e o novo.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0" data-testid="rules-history">
            <HistoryList items={ws.history} />
          </CardContent>
        </Card>
      </aside>

      {editing ? <RuleDialog key={editing.id || `novo-${editing.scope}`} initial={editing} ws={ws} onClose={() => setEditing(null)} /> : null}
      <ReasonDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling ? `${toggling.active ? "Desativar" : "Reativar"} "${toggling.name}"?` : ""}
        description={toggling?.active ? "A regra deixa de valer para comissões ainda não adquiridas (elas são recalculadas agora). Comissões elegíveis ou pagas não mudam." : "A regra volta a valer e as comissões pendentes são recalculadas."}
        confirmLabel={toggling?.active ? "Desativar" : "Reativar"}
        destructive={toggling?.active}
        pending={pending}
        onConfirm={async (reason) => {
          if (!toggling) return false;
          const ok = await run(() => setCommissionRuleActiveAction({ id: toggling.id, active: !toggling.active, reason }), toggling.active ? "Regra desativada" : "Regra reativada");
          if (ok) setToggling(null);
          return ok;
        }}
      />
    </div>
  );
}

function ProductDefaultsCard({ ws }: { ws: RulesWorkspace }) {
  if (ws.productDefaults.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4 text-muted" /> Padrão do cadastro de produtos
        </CardTitle>
        <CardDescription>Usado só quando nenhuma regra acima se aplica (percentual sobre o contratado, liberado no recebimento; recorrência na mensalidade indicada). Editado no cadastro do produto.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {ws.productDefaults.map((p) => (
            <li key={p.id} className="flex min-w-0 justify-between gap-3">
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {p.setupPct}% · {p.recurringPct}% ({p.recurringReleaseInstallment}ª) · {p.hardwarePct}%
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Adesão · recorrência (mensalidade) · hardware.</p>
      </CardContent>
    </Card>
  );
}

function PaymentDayCard({ value, canManage }: { value: number; canManage: boolean }) {
  const id = React.useId();
  const [day, setDay] = React.useState(String(value));
  const { pending, run } = useFinanceAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted" /> Pagamento das comissões
        </CardTitle>
        <CardDescription>Vencimento dos títulos: este dia do mês seguinte à competência em que a comissão ficou elegível.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {canManage ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveCommissionPaymentDayAction({ diaPagamento: Number(day) }), "Dia de pagamento salvo");
            }}
          >
            <FormField label="Dia de pagamento" htmlFor={`${id}-dia`} className="flex-1">
              <Input id={`${id}-dia`} type="number" inputMode="numeric" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} />
            </FormField>
            <Button type="submit" variant="secondary" className="h-11 md:h-9" loading={pending} disabled={Number(day) === value}>
              Salvar
            </Button>
          </form>
        ) : (
          <p className="text-sm">
            Dia <span className="font-semibold">{value}</span> do mês seguinte
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RuleDialog({ initial, ws, onClose }: { initial: Form; ws: RulesWorkspace; onClose: () => void }) {
  const id = React.useId();
  const [f, setF] = React.useState<Form>(initial);
  const [competencesText, setCompetencesText] = React.useState(initial.recurringCompetences === null ? "" : String(initial.recurringCompetences));
  const { pending, run } = useFinanceAction();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const recurring = f.revenueType === "recorrencia";
  const triggers = recurring ? RECURRING : TRIGGERS;
  const editingExisting = Boolean(initial.id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...f,
      id: f.id || undefined,
      userId: f.scope === "vendedor" ? f.userId : undefined,
      contractId: f.scope === "contrato" ? f.contractId : undefined,
      trigger: recurring && !RECURRING.includes(f.trigger) ? "pagamento" : f.trigger,
      recurringCompetences: recurring ? (competencesText.trim() ? Number(competencesText) : null) : null,
      releaseInstallment: Number(f.releaseInstallment) || 1,
      value: Number(f.value),
      minTenureDays: Number(f.minTenureDays) || 0,
    };
    const ok = await run(() => saveCommissionRuleAction(payload), (d) => (d.created ? "Regra criada; comissões pendentes recalculadas" : "Regra salva; comissões pendentes recalculadas"));
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editingExisting ? "Editar regra de comissão" : "Nova regra de comissão"}</DialogTitle>
            <DialogDescription>Precedência: exceção do contrato → regra do vendedor → regra do produto → padrão. Comissões já elegíveis ou pagas não mudam.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome" htmlFor={`${id}-nome`} required className="sm:col-span-2">
              <Input id={`${id}-nome`} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Vinícius — adesão 10% no recebimento" />
            </FormField>
            <FormField label="Abrangência" htmlFor={`${id}-escopo`} required>
              <Select id={`${id}-escopo`} value={f.scope} onChange={(e) => set("scope", e.target.value as Scope)} disabled={editingExisting}>
                <option value="padrao">{COMMISSION_SCOPE_LABELS.padrao}</option>
                <option value="vendedor">{COMMISSION_SCOPE_LABELS.vendedor}</option>
                <option value="contrato">{COMMISSION_SCOPE_LABELS.contrato}</option>
              </Select>
            </FormField>
            {f.scope === "vendedor" ? (
              <FormField label="Vendedor" htmlFor={`${id}-vendedor`} required>
                <Select id={`${id}-vendedor`} value={f.userId ?? ""} onChange={(e) => set("userId", e.target.value || undefined)} placeholder="Escolha" options={ws.options.sellers} />
              </FormField>
            ) : f.scope === "contrato" ? (
              <FormField label="Contrato" htmlFor={`${id}-contrato`} required>
                <Select id={`${id}-contrato`} value={f.contractId ?? ""} onChange={(e) => set("contractId", e.target.value || undefined)} placeholder="Escolha" options={ws.options.contracts} disabled={editingExisting} />
              </FormField>
            ) : (
              <div className="hidden sm:block" />
            )}
            <FormField label="Tipo de receita" htmlFor={`${id}-tipo`} required>
              <Select id={`${id}-tipo`} value={f.revenueType} onChange={(e) => set("revenueType", e.target.value as Form["revenueType"])}>
                <option value="setup">{COMMISSION_REVENUE_LABELS.setup}</option>
                <option value="recorrencia">{COMMISSION_REVENUE_LABELS.recorrencia}</option>
                <option value="hardware">{COMMISSION_REVENUE_LABELS.hardware}</option>
              </Select>
            </FormField>
            <FormField label="Produto (opcional)" htmlFor={`${id}-produto`} hint="Vazio = todos os produtos">
              <Select id={`${id}-produto`} value={f.productId ?? ""} onChange={(e) => setF((p) => ({ ...p, productId: e.target.value || undefined, productCategory: e.target.value ? undefined : p.productCategory }))} placeholder="Todos os produtos" options={ws.options.products} />
            </FormField>
            {!f.productId ? (
              <FormField label="Categoria (opcional)" htmlFor={`${id}-categoria`}>
                <Select id={`${id}-categoria`} value={f.productCategory ?? ""} onChange={(e) => set("productCategory", e.target.value || undefined)} placeholder="Todas as categorias" options={ws.options.categories} />
              </FormField>
            ) : null}
            <FormField label="Forma de cálculo" htmlFor={`${id}-modo`} required>
              <Select id={`${id}-modo`} value={f.mode} onChange={(e) => set("mode", e.target.value as Form["mode"])}>
                <option value="percentual">Percentual sobre a base</option>
                <option value="valor">Valor fixo por unidade</option>
              </Select>
            </FormField>
            <FormField label={f.mode === "percentual" ? "Percentual (%)" : "Valor fixo (R$)"} htmlFor={`${id}-valor`} required>
              <Input id={`${id}-valor`} type="number" inputMode="decimal" min={0} step="0.01" value={String(f.value)} onChange={(e) => set("value", Number(e.target.value))} />
            </FormField>
            <FormField label="Base" htmlFor={`${id}-base`} required hint={f.baseSource === "recebido" ? "Valor efetivamente pago na cobrança (pagamento parcial reduz a base)" : "Itens do contrato, líquidos de desconto"}>
              <Select id={`${id}-base`} value={f.baseSource} onChange={(e) => set("baseSource", e.target.value as Form["baseSource"])}>
                <option value="contratado">{COMMISSION_BASE_LABELS.contratado}</option>
                <option value="recebido">{COMMISSION_BASE_LABELS.recebido}</option>
              </Select>
            </FormField>
            <FormField label="Gatilho" htmlFor={`${id}-gatilho`} required>
              <Select id={`${id}-gatilho`} value={recurring && !RECURRING.includes(f.trigger) ? "pagamento" : f.trigger} onChange={(e) => set("trigger", e.target.value as CommissionTrigger)}>
                {triggers.map((t) => (
                  <option key={t} value={t}>
                    {COMMISSION_TRIGGER_LABELS[t]}
                  </option>
                ))}
              </Select>
            </FormField>
            {recurring || f.trigger === "mensalidade_n" ? (
              <FormField label={recurring ? "A partir da mensalidade nº" : "Mensalidade paga nº (N)"} htmlFor={`${id}-parcela`} required hint={recurring ? "Mensalidades anteriores não geram comissão (ex.: 3 = só a partir da 3ª paga)" : "A comissão só é adquirida quando esta mensalidade é paga"}>
                <Input id={`${id}-parcela`} type="number" inputMode="numeric" min={1} max={60} value={String(f.releaseInstallment)} onChange={(e) => set("releaseInstallment", Number(e.target.value))} />
              </FormField>
            ) : null}
            {recurring ? (
              <FormField label="Competências" htmlFor={`${id}-competencias`} hint="Quantas mensalidades geram comissão. Vazio = enquanto o contrato estiver ativo">
                <Input id={`${id}-competencias`} type="number" inputMode="numeric" min={1} max={120} value={competencesText} onChange={(e) => setCompetencesText(e.target.value)} placeholder="Enquanto ativo" />
              </FormField>
            ) : null}
            <FormField label="Carência (dias)" htmlFor={`${id}-carencia`} hint="Contada do início do contrato; 0 = sem carência">
              <Input id={`${id}-carencia`} type="number" inputMode="numeric" min={0} max={730} value={String(f.minTenureDays)} onChange={(e) => set("minTenureDays", Number(e.target.value))} />
            </FormField>
            {f.scope !== "contrato" ? (
              <>
                <FormField label="Vigência — início" htmlFor={`${id}-de`} hint="Comparada com a data da venda">
                  <Input id={`${id}-de`} type="date" value={f.validFrom ?? ""} onChange={(e) => set("validFrom", e.target.value || undefined)} />
                </FormField>
                <FormField label="Vigência — fim" htmlFor={`${id}-ate`}>
                  <Input id={`${id}-ate`} type="date" value={f.validTo ?? ""} onChange={(e) => set("validTo", e.target.value || undefined)} />
                </FormField>
              </>
            ) : null}
            <div className="sm:col-span-2">
              <Switch
                checked={f.overridesDefault}
                onCheckedChange={(v) => set("overridesDefault", v)}
                label="Substitui a regra padrão"
                description={f.overridesDefault ? "Para este tipo de receita, as regras menos específicas deixam de valer." : "Soma-se às regras menos específicas (comissão adicional)."}
              />
            </div>
            <FormField
              label={f.scope === "contrato" ? "Motivo da exceção" : editingExisting ? "Motivo da alteração (opcional)" : "Observação (opcional)"}
              htmlFor={`${id}-motivo`}
              required={f.scope === "contrato"}
              hint={f.scope === "contrato" ? "Obrigatório (mín. 10 caracteres); fica na regra, na memória de cálculo e na auditoria" : "Fica registrado no histórico de alterações"}
              className="sm:col-span-2"
            >
              <Textarea id={`${id}-motivo`} value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} placeholder={f.scope === "contrato" ? "Ex.: condição negociada com a diretoria para cliente estratégico" : undefined} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {editingExisting ? "Salvar regra" : "Criar regra"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
