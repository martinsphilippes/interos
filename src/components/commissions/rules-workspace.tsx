"use client";

import * as React from "react";
import { Calculator, CalendarDays, ChevronDown, History, Package, Pencil, Plus, Power, PowerOff, Scale, Trash2, UserRound } from "lucide-react";
import type { RuleRow, RulesWorkspace } from "@/server/commissions/queries";
import { saveCommissionPaymentDayAction, saveCommissionRuleAction, setCommissionRuleActiveAction } from "@/server/commissions/actions";
import { COMMISSION_BASE_KIND_LABELS, COMMISSION_BASE_LABELS, COMMISSION_REVENUE_LABELS, COMMISSION_SCOPE_LABELS, COMMISSION_TRIGGER_LABELS } from "@/domain/commissions";
import type { CommissionTrigger } from "@/domain/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { HistoryList, ReasonDialog } from "./commission-ui";
import { CommissionRuleSimulator } from "./commission-rule-simulator";
import { emptyRuleForm, ONE_OFF_TRIGGERS, parseInstallments, RECURRING_TRIGGERS, ruleTags, rulePayload, type RuleForm as Form, type RuleScope as Scope } from "./rules-model";

const SECTIONS: { scope: Scope; title: string; description: string; icon: React.ReactNode }[] = [
  { scope: "contrato", title: "Exceções por contrato", description: "Valem só para o contrato indicado e têm precedência sobre todas as outras. Exigem motivo.", icon: <Scale className="size-4 text-muted" /> },
  { scope: "vendedor", title: "Regras por vendedor", description: "Valem para as vendas do vendedor, sozinhas ou combinadas com produto, serviço ou plano (COM.08).", icon: <UserRound className="size-4 text-muted" /> },
  { scope: "padrao", title: "Regras gerais, por produto, serviço e plano", description: "Valem para todos os vendedores quando não há regra mais prioritária.", icon: <Package className="size-4 text-muted" /> },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Regras de comissão. Botões por permissão (calculadas no servidor, a interface só esconde; as actions revalidam):
 * criar/editar = "Alterar regras"; ativar/desativar = "Ativar/desativar regra"; exceção por contrato exige também
 * "Criar exceção"; reaplicar às pendentes = "Reaplicar regra" (diretoria); simular = quem vê as regras. Sem nenhuma, leitura.
 */
export function RulesWorkspaceView({ ws }: { ws: RulesWorkspace }) {
  const [editing, setEditing] = React.useState<Form | null>(null);
  const [toggling, setToggling] = React.useState<RuleRow | null>(null);
  const [reapplyToggle, setReapplyToggle] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [onlyActive, setOnlyActive] = React.useState(false);
  const { pending, run } = useFinanceAction();
  const allowsScope = (scope: Scope) => scope !== "contrato" || ws.can.exception;
  const canEdit = (scope: Scope) => ws.can.edit && allowsScope(scope);
  const canToggle = (scope: Scope) => ws.can.toggle && allowsScope(scope);
  const serviceIds = React.useMemo(() => new Set(ws.options.services.map((s) => s.value)), [ws.options.services]);
  const isService = React.useCallback((id: string) => serviceIds.has(id), [serviceIds]);

  React.useEffect(() => {
    if (!ws.selectedId) return;
    document.getElementById(`regra-${ws.selectedId}`)?.scrollIntoView({ block: "center" });
  }, [ws.selectedId]);

  const q = norm(query.trim());
  const visible = ws.rules.filter((r) => (!onlyActive || r.active) && (!q || norm([r.name, r.code, r.target, r.productLabel, r.planLabel].filter(Boolean).join(" ")).includes(q)));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nome, código, vendedor, produto ou plano…" className="sm:max-w-sm" aria-label="Buscar regras" />
            <Switch checked={onlyActive} onCheckedChange={setOnlyActive} label="Só ativas" size="sm" className="sm:w-auto" />
          </div>
          {ws.can.edit ? (
            <Button className="h-11 md:h-9" onClick={() => setEditing(emptyRuleForm())}>
              <Plus /> Nova regra
            </Button>
          ) : null}
        </div>
        {!ws.can.edit && !ws.can.toggle ? <p className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted">Seu perfil não altera regras de comissão. Você está vendo em modo leitura.</p> : null}
        {SECTIONS.map((section) => {
          const rules = visible.filter((r) => r.scope === section.scope);
          return (
            <Card key={section.scope} data-section={section.scope}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    {section.icon} {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </div>
                {canEdit(section.scope) ? (
                  <Button variant="outline" size="sm" className="h-10 shrink-0 md:h-8" onClick={() => setEditing(emptyRuleForm(section.scope))} aria-label={`Nova regra: ${section.title}`}>
                    <Plus /> Nova
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="pt-0">
                {rules.length === 0 ? (
                  <EmptyState size="sm" title={q || onlyActive ? "Nenhuma regra com esse filtro" : "Nenhuma regra nesta categoria"} description={section.scope === "contrato" && !q ? "Crie uma exceção quando um contrato tiver condição comercial especial." : undefined} />
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {rules.map((r) => (
                      <RuleItem
                        key={r.id}
                        r={r}
                        selected={ws.selectedId === r.id}
                        tags={ruleTags(r.form, isService)}
                        onEdit={canEdit(r.scope) ? () => setEditing({ ...r.form }) : undefined}
                        onToggle={
                          canToggle(r.scope)
                            ? () => {
                                setReapplyToggle(false);
                                setToggling(r);
                              }
                            : undefined
                        }
                      />
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
        {ws.can.simulate ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="size-4 text-muted" /> Simulador de comissões
              </CardTitle>
              <CardDescription>Regras vigentes na data da venda. Nada é gravado.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <CommissionRuleSimulator options={ws.options} />
            </CardContent>
          </Card>
        ) : null}
        <PaymentDayCard value={ws.paymentDay} canManage={ws.can.configure} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-muted" /> Histórico de alterações
            </CardTitle>
            <CardDescription>Criação, edição, exceções e desativações, com o valor anterior, o novo e a versão.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0" data-testid="rules-history">
            <HistoryList items={ws.history} />
          </CardContent>
        </Card>
      </aside>

      {editing ? <RuleDialog key={editing.id || `novo-${editing.scope}`} initial={editing} ws={ws} isService={isService} onClose={() => setEditing(null)} /> : null}
      <ReasonDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling ? `${toggling.active ? "Desativar" : "Reativar"} "${toggling.name}"?` : ""}
        description={`${toggling?.active ? "A regra deixa de valer para vendas a partir de agora." : "A regra volta a valer para vendas a partir de agora."} Comissões de vendas anteriores mantêm a versão em que nasceram.`}
        extra={
          ws.can.reapply ? (
            <Switch checked={reapplyToggle} onCheckedChange={setReapplyToggle} label="Reaplicar às comissões pendentes de vendas anteriores" description="Retroativo: só comissões ainda não adquiridas (previstas, em carência ou aguardando). Elegíveis e pagas nunca mudam." />
          ) : null
        }
        confirmLabel={toggling?.active ? "Desativar" : "Reativar"}
        destructive={toggling?.active}
        pending={pending}
        onConfirm={async (reason) => {
          if (!toggling) return false;
          const ok = await run(() => setCommissionRuleActiveAction({ id: toggling.id, active: !toggling.active, reason, applyToPending: reapplyToggle }), toggling.active ? "Regra desativada" : "Regra reativada");
          if (ok) setToggling(null);
          return ok;
        }}
      />
    </div>
  );
}

function RuleItem({ r, selected, tags, onEdit, onToggle }: { r: RuleRow; selected: boolean; tags: string[]; onEdit?: () => void; onToggle?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li id={`regra-${r.id}`} data-rule={r.name} className={cn("flex flex-col gap-2 py-3 first:pt-0 last:pb-0", selected && "rounded-lg bg-brand-soft/60 px-2")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            <span className="break-words">{r.name}</span>
            {r.code ? (
              <Badge variant="muted" size="sm">
                {r.code}
              </Badge>
            ) : null}
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
                Cumulativa
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
            {[r.target, r.productLabel, r.planLabel ? `plano ${r.planLabel}` : null, `prioridade ${r.priority}${r.priorityAuto ? " (automática)" : ""}`, r.validity ? `vigência ${r.validity}` : null, `v${r.version}`, `${r.commissions} comissão(ões)`].filter(Boolean).join(" · ")}
          </p>
          {tags.length ? (
            <p className="mt-1 flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" size="sm">
                  {t}
                </Badge>
              ))}
            </p>
          ) : null}
          {r.notes ? <p className="mt-1 text-xs text-muted">{r.notes}</p> : null}
          {r.reason ? <p className="mt-0.5 text-xs text-muted">Motivo: {r.reason}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {r.versions.length ? (
            <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Versões de ${r.name}`}>
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> Versões
            </Button>
          ) : null}
          {onEdit ? (
            <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={onEdit} aria-label={`Editar ${r.name}`}>
              <Pencil /> Editar
            </Button>
          ) : null}
          {onToggle ? (
            <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={onToggle} aria-label={`${r.active ? "Desativar" : "Reativar"} ${r.name}`}>
              {r.active ? <PowerOff /> : <Power />} {r.active ? "Desativar" : "Reativar"}
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <ol className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-muted p-3 text-xs" data-testid="rule-versions">
          {r.versions.map((v) => (
            <li key={v.version}>
              <span className="font-medium">v{v.version}</span> · {formatDate(v.at)}
              {v.by ? ` · ${v.by}` : ""} · {v.retroactive ? "reaplicada às pendentes" : "vendas a partir desta data"}
              {v.summary ? <span className="block text-muted">{v.summary}</span> : null}
              {v.reason ? <span className="block text-muted">Motivo: {v.reason}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
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

type Receita = Form["revenueType"];

function RuleDialog({ initial, ws, isService, onClose }: { initial: Form; ws: RulesWorkspace; isService: (id: string) => boolean; onClose: () => void }) {
  const id = React.useId();
  const [f, setF] = React.useState<Form>(initial);
  const [competencesText, setCompetencesText] = React.useState(initial.recurringCompetences === null ? "" : String(initial.recurringCompetences));
  const [installmentsMode, setInstallmentsMode] = React.useState<"lista" | "faixa">(initial.installments.length || !initial.id ? "lista" : "faixa");
  const [installmentsText, setInstallmentsText] = React.useState(initial.installments.join(", "));
  const [applyToPending, setApplyToPending] = React.useState(false);
  const [simOpen, setSimOpen] = React.useState(false);
  const { pending, run } = useFinanceAction();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const recurring = f.revenueType === "recorrencia";
  const triggers = recurring ? RECURRING_TRIGGERS : ONE_OFF_TRIGGERS;
  const trigger = recurring && !RECURRING_TRIGGERS.includes(f.trigger) ? "pagamento" : f.trigger;
  const editingExisting = Boolean(initial.id);
  const plans = ws.options.plans.filter((p) => !p.productId || !f.productId || p.productId === f.productId);
  const productKind: "todos" | "produto" | "servico" = f.productId ? (isService(f.productId) ? "servico" : "produto") : "todos";
  const lista = recurring && installmentsMode === "lista";

  const payload = () => rulePayload({ ...f, installments: lista ? parseInstallments(installmentsText) : [] }, { applyToPending, installmentsMode, competencesText });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => saveCommissionRuleAction(payload()),
      (d) => `${d.created ? "Regra criada" : "Regra salva"} · ${applyToPending ? "reaplicada às comissões pendentes" : "vale para vendas a partir de agora"}`,
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editingExisting ? "Editar regra de comissão" : "Nova regra de comissão"}</DialogTitle>
            <DialogDescription>Os campos mudam conforme o tipo. Alterar uma regra cria uma nova versão: comissões de vendas anteriores não mudam, salvo reaplicação autorizada.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Group title="Identificação">
              <FormField label="Nome" htmlFor={`${id}-nome`} required className="sm:col-span-2">
                <Input id={`${id}-nome`} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: ERP Star — 3ª mensalidade" />
              </FormField>
              <FormField label="Código" htmlFor={`${id}-codigo`} hint="Único; ex.: COM-ERP-STAR-03">
                <Input id={`${id}-codigo`} value={f.code ?? ""} onChange={(e) => set("code", e.target.value || undefined)} maxLength={40} className="uppercase" />
              </FormField>
              <FormField label="Descrição" htmlFor={`${id}-desc`} className="sm:col-span-3">
                <Input id={`${id}-desc`} value={f.description ?? ""} onChange={(e) => set("description", e.target.value || undefined)} placeholder="Para que serve a regra (aparece na lista)" maxLength={500} />
              </FormField>
            </Group>

            <Group title="Onde se aplica">
              <FormField label="Receita" htmlFor={`${id}-tipo`} required className="sm:col-span-3">
                <SegmentedControl<Receita>
                  aria-label="Tipo de receita"
                  value={f.revenueType}
                  onChange={(v) => setF((p) => ({ ...p, revenueType: v, trigger: v === "recorrencia" && !RECURRING_TRIGGERS.includes(p.trigger) ? "pagamento" : p.trigger }))}
                  options={[
                    { value: "setup", label: "Adesão" },
                    { value: "recorrencia", label: "Mensalidade" },
                    { value: "hardware", label: "Hardware / venda" },
                  ]}
                />
              </FormField>
              <FormField label="Abrangência" htmlFor={`${id}-escopo`} required>
                <Select id={`${id}-escopo`} value={f.scope} onChange={(e) => set("scope", e.target.value as Scope)} disabled={editingExisting}>
                  <option value="padrao">Todos os vendedores</option>
                  <option value="vendedor">{COMMISSION_SCOPE_LABELS.vendedor}</option>
                  {ws.can.exception || f.scope === "contrato" ? <option value="contrato">{COMMISSION_SCOPE_LABELS.contrato}</option> : null}
                </Select>
              </FormField>
              {f.scope === "vendedor" ? (
                <FormField label="Vendedor ou colaborador" htmlFor={`${id}-vendedor`} required>
                  <Select id={`${id}-vendedor`} value={f.userId ?? ""} onChange={(e) => set("userId", e.target.value || undefined)} placeholder="Escolha" options={ws.options.sellers} />
                </FormField>
              ) : f.scope === "contrato" ? (
                <FormField label="Contrato" htmlFor={`${id}-contrato`} required>
                  <Select id={`${id}-contrato`} value={f.contractId ?? ""} onChange={(e) => set("contractId", e.target.value || undefined)} placeholder="Escolha" options={ws.options.contracts} disabled={editingExisting} />
                </FormField>
              ) : (
                <div className="hidden sm:block" />
              )}
              <div className="hidden sm:block" />
              <FormField label="Produto ou serviço" htmlFor={`${id}-produto`} hint={productKind === "todos" ? "Vazio = todos" : productKind === "servico" ? "Serviço (COM.06)" : "Produto (COM.05)"}>
                <Select
                  id={`${id}-produto`}
                  value={f.productId ?? ""}
                  onChange={(e) => {
                    const productId = e.target.value || undefined;
                    setF((p) => {
                      const plan = ws.options.plans.find((x) => x.value === p.planId);
                      return { ...p, productId, productCategory: productId ? undefined : p.productCategory, planId: plan?.productId && productId && plan.productId !== productId ? undefined : p.planId };
                    });
                  }}
                  placeholder="Todos"
                >
                  {ws.options.products.length ? (
                    <optgroup label="Produtos">
                      {ws.options.products.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {ws.options.services.length ? (
                    <optgroup label="Serviços">
                      {ws.options.services.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
              </FormField>
              {!f.productId ? (
                <FormField label="Categoria" htmlFor={`${id}-categoria`}>
                  <Select id={`${id}-categoria`} value={f.productCategory ?? ""} onChange={(e) => set("productCategory", e.target.value || undefined)} placeholder="Todas" options={ws.options.categories} />
                </FormField>
              ) : (
                <div className="hidden sm:block" />
              )}
              <FormField label="Plano (COM.07)" htmlFor={`${id}-plano`} hint={plans.length === 0 ? "Cadastre planos em Administração › Produtos" : "Vazio = qualquer plano"}>
                <Select id={`${id}-plano`} value={f.planId ?? ""} onChange={(e) => set("planId", e.target.value || undefined)} placeholder="Qualquer plano" options={plans} disabled={plans.length === 0 && !f.planId} />
              </FormField>
            </Group>

            <Group title="Cálculo">
              <FormField label="Forma" htmlFor={`${id}-modo`} required>
                <Select id={`${id}-modo`} value={f.mode} onChange={(e) => set("mode", e.target.value as Form["mode"])}>
                  <option value="percentual">Percentual</option>
                  <option value="valor">Valor fixo por unidade</option>
                </Select>
              </FormField>
              <FormField label={f.mode === "percentual" ? "Percentual de comissão (%)" : "Valor fixo de comissão (R$)"} htmlFor={`${id}-valor`} required>
                <Input id={`${id}-valor`} type="number" inputMode="decimal" min={0} step="0.01" value={String(f.value)} onChange={(e) => set("value", Number(e.target.value))} />
              </FormField>
              <FormField label="Valor de origem" htmlFor={`${id}-origem`} required hint={f.baseSource === "recebido" ? "O que foi efetivamente pago (pagamento parcial reduz a base)" : "Itens do contrato, depois do desconto"}>
                <Select id={`${id}-origem`} value={f.baseSource} onChange={(e) => set("baseSource", e.target.value as Form["baseSource"])}>
                  <option value="contratado">{COMMISSION_BASE_LABELS.contratado}</option>
                  <option value="recebido" disabled={trigger === "faturamento"}>
                    {COMMISSION_BASE_LABELS.recebido}
                  </option>
                </Select>
              </FormField>
              {f.mode === "percentual" ? (
                <FormField label="Base de cálculo (COM.04)" htmlFor={`${id}-natureza`} required>
                  <Select id={`${id}-natureza`} value={f.baseKind} onChange={(e) => setF((p) => ({ ...p, baseKind: e.target.value as Form["baseKind"], deductions: e.target.value === "liquido" ? p.deductions : [] }))}>
                    <option value="liquido">{COMMISSION_BASE_KIND_LABELS.liquido}</option>
                    <option value="bruto">{COMMISSION_BASE_KIND_LABELS.bruto} (antes do desconto)</option>
                    <option value="referencia">{COMMISSION_BASE_KIND_LABELS.referencia}</option>
                  </Select>
                </FormField>
              ) : null}
              {f.mode === "percentual" && f.baseKind === "referencia" ? (
                <FormField label="Valor de referência por unidade (R$)" htmlFor={`${id}-ref`} required>
                  <Input id={`${id}-ref`} type="number" inputMode="decimal" min={0} step="0.01" value={f.referenceValue ?? ""} onChange={(e) => set("referenceValue", e.target.value === "" ? null : Number(e.target.value))} />
                </FormField>
              ) : null}
              {f.mode === "percentual" ? (
                <FormField label="Teto da base de cálculo (R$)" htmlFor={`${id}-tetobase`} hint="Base = menor entre a base elegível e o teto (COM.02)">
                  <Input id={`${id}-tetobase`} type="number" inputMode="decimal" min={0} step="0.01" value={f.baseCap ?? ""} onChange={(e) => set("baseCap", e.target.value === "" ? null : Number(e.target.value))} placeholder="Sem teto" />
                </FormField>
              ) : null}
              <FormField label="Teto do valor final da comissão (R$)" htmlFor={`${id}-tetocom`} hint="Independente do teto da base">
                <Input id={`${id}-tetocom`} type="number" inputMode="decimal" min={0} step="0.01" value={f.amountCap ?? ""} onChange={(e) => set("amountCap", e.target.value === "" ? null : Number(e.target.value))} placeholder="Sem teto" />
              </FormField>
              {f.mode === "percentual" && f.baseKind === "liquido" ? <DeductionsEditor value={f.deductions} onChange={(d) => set("deductions", d)} /> : null}
            </Group>

            <Group title="Evento que gera a comissão">
              {recurring ? (
                <FormField label="Mensalidades comissionáveis" htmlFor={`${id}-modo-parc`} className="sm:col-span-3">
                  <SegmentedControl
                    aria-label="Quais mensalidades"
                    size="sm"
                    value={installmentsMode}
                    onChange={setInstallmentsMode}
                    options={[
                      { value: "lista", label: "Mensalidades específicas" },
                      { value: "faixa", label: "Faixa contínua" },
                    ]}
                  />
                </FormField>
              ) : null}
              {lista ? (
                <FormField label="Quais mensalidades (COM.03)" htmlFor={`${id}-parcelas`} required className="sm:col-span-2" hint={parseInstallments(installmentsText).length ? `Geram comissão: ${parseInstallments(installmentsText).map((n) => `${n}ª`).join(", ")}` : "Ex.: 1, 3, 6 — as demais não geram"}>
                  <Input id={`${id}-parcelas`} value={installmentsText} onChange={(e) => setInstallmentsText(e.target.value)} placeholder="1, 3, 6" />
                </FormField>
              ) : null}
              <FormField label={lista ? "Gerar a comissão" : "Gatilho"} htmlFor={`${id}-gatilho`} required>
                <Select id={`${id}-gatilho`} value={trigger} onChange={(e) => set("trigger", e.target.value as CommissionTrigger)}>
                  {triggers
                    .filter((t) => !(lista && t === "mensalidade_n"))
                    .map((t) => (
                      <option key={t} value={t} disabled={t === "faturamento" && f.baseSource === "recebido"}>
                        {lista && t === "faturamento" ? "No faturamento da mensalidade" : lista && t === "pagamento" ? "Após o pagamento da mensalidade" : COMMISSION_TRIGGER_LABELS[t]}
                      </option>
                    ))}
                </Select>
              </FormField>
              {(recurring && !lista) || trigger === "mensalidade_n" ? (
                <FormField label={recurring && trigger !== "mensalidade_n" ? "A partir da mensalidade nº" : "Mensalidade paga nº (N)"} htmlFor={`${id}-parcela`} required>
                  <Input id={`${id}-parcela`} type="number" inputMode="numeric" min={1} max={60} value={String(f.releaseInstallment)} onChange={(e) => set("releaseInstallment", Number(e.target.value))} />
                </FormField>
              ) : null}
              {recurring && !lista ? (
                <FormField label="Competências" htmlFor={`${id}-competencias`} hint="Vazio = enquanto o contrato estiver ativo">
                  <Input id={`${id}-competencias`} type="number" inputMode="numeric" min={1} max={120} value={competencesText} onChange={(e) => setCompetencesText(e.target.value)} placeholder="Enquanto ativo" />
                </FormField>
              ) : null}
              <FormField label="Carência (dias)" htmlFor={`${id}-carencia`} hint="Do início do contrato; 0 = sem">
                <Input id={`${id}-carencia`} type="number" inputMode="numeric" min={0} max={730} value={String(f.minTenureDays)} onChange={(e) => set("minTenureDays", Number(e.target.value))} />
              </FormField>
            </Group>

            <Group title="Vigência, prioridade e status">
              {f.scope !== "contrato" ? (
                <>
                  <FormField label="Vigência inicial" htmlFor={`${id}-de`} hint="Comparada com a data da venda">
                    <Input id={`${id}-de`} type="date" value={f.validFrom ?? ""} onChange={(e) => set("validFrom", e.target.value || undefined)} />
                  </FormField>
                  <FormField label="Vigência final" htmlFor={`${id}-ate`}>
                    <Input id={`${id}-ate`} type="date" value={f.validTo ?? ""} onChange={(e) => set("validTo", e.target.value || undefined)} />
                  </FormField>
                </>
              ) : null}
              <FormField label="Prioridade" htmlFor={`${id}-prio`} hint="Menor = avaliada antes. Vazio = automática (vendedor 10–15, plano 20, produto 30, geral 40)">
                <Input id={`${id}-prio`} type="number" inputMode="numeric" min={0} max={999} value={f.priority ?? ""} onChange={(e) => set("priority", e.target.value === "" ? null : Number(e.target.value))} placeholder="Automática" />
              </FormField>
              <div className="flex flex-col gap-2 sm:col-span-3">
                <Switch
                  checked={!f.overridesDefault}
                  onCheckedChange={(v) => set("overridesDefault", !v)}
                  label="Cumulativa"
                  description={f.overridesDefault ? "Exclusiva: ao se aplicar, as regras de prioridade menor não valem para este tipo de receita." : "Soma-se às regras seguintes (comissão adicional). Uma mesma regra nunca paga duas vezes o mesmo evento."}
                />
                <Switch checked={f.reverseOnCancel} onCheckedChange={(v) => set("reverseOnCancel", v)} label="Estornar no cancelamento do contrato" description="Vale para comissões geradas por esta versão em diante: já liberadas são estornadas; se já pagas, vira título a recuperar." />
                <Switch checked={f.active} onCheckedChange={(v) => set("active", v)} label="Regra ativa" disabled={editingExisting && !ws.can.toggle} />
                {ws.can.reapply ? (
                  <Switch checked={applyToPending} onCheckedChange={setApplyToPending} label="Reaplicar às comissões pendentes de vendas anteriores" description="Retroativo, exige autorização: só comissões ainda não adquiridas. Elegíveis e pagas nunca mudam." />
                ) : null}
              </div>
              <FormField
                label={f.scope === "contrato" ? "Motivo da exceção" : editingExisting ? "Motivo da alteração" : "Observação"}
                htmlFor={`${id}-motivo`}
                required={f.scope === "contrato"}
                hint={f.scope === "contrato" ? "Obrigatório (mín. 10 caracteres)" : "Fica registrado na versão e no histórico"}
                className="sm:col-span-3"
              >
                <Textarea id={`${id}-motivo`} value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
              </FormField>
            </Group>

            {ws.can.simulate ? (
              <section className="rounded-lg border border-border">
                <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium" onClick={() => setSimOpen((o) => !o)} aria-expanded={simOpen}>
                  <span className="flex items-center gap-2">
                    <Calculator className="size-4 text-muted" /> Simular esta regra antes de salvar
                  </span>
                  <ChevronDown className={cn("size-4 transition-transform", simOpen && "rotate-180")} />
                </button>
                {simOpen ? (
                  <div className="border-t border-border p-3">
                    <CommissionRuleSimulator
                      options={ws.options}
                      draft={payload}
                      defaults={{ sellerId: f.scope === "vendedor" ? (f.userId ?? "") : "", productId: f.productId ?? "", planId: f.planId ?? "", installment: lista && parseInstallments(installmentsText)[0] ? String(parseInstallments(installmentsText)[0]) : "1" }}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {editingExisting ? "Salvar nova versão" : "Criar regra"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="label-caps mb-1 text-muted">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function DeductionsEditor({ value, onChange }: { value: Form["deductions"]; onChange: (v: Form["deductions"]) => void }) {
  const patch = (i: number, next: Partial<Form["deductions"][number]>) => onChange(value.map((d, j) => (j === i ? { ...d, ...next } : d)));
  return (
    <div className="flex flex-col gap-2 sm:col-span-3" data-testid="deductions">
      <p className="text-sm font-medium">
        Deduções da base líquida <span className="font-normal text-muted">(impostos, taxas, descontos — aplicadas sobre a base, nesta ordem)</span>
      </p>
      {value.map((d, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_7rem_auto] items-center gap-2">
          <Input aria-label="Nome da dedução" value={d.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Ex.: ISS" />
          <Select aria-label="Tipo da dedução" value={d.mode} onChange={(e) => patch(i, { mode: e.target.value as "percentual" | "valor" })} size="sm">
            <option value="percentual">%</option>
            <option value="valor">R$</option>
          </Select>
          <Input aria-label="Valor da dedução" type="number" inputMode="decimal" min={0} step="0.01" value={String(d.value)} onChange={(e) => patch(i, { value: Number(e.target.value) })} />
          <Button type="button" variant="ghost" size="icon" className="size-9 text-muted hover:text-danger" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remover ${d.label || "dedução"}`}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-10 self-start md:h-8" onClick={() => onChange([...value, { label: "", mode: "percentual", value: 0 }])} disabled={value.length >= 10}>
        <Plus /> Adicionar dedução
      </Button>
    </div>
  );
}
