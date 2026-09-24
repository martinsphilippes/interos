"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import type { ActionResult, SlaRule } from "@/domain/types";
import { SLA_APPLIES_TO, type SlaRuleInput } from "@/server/admin/schemas";
import { deleteSlaRule, upsertSlaRule } from "@/server/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { numberToInput, parseNumber, SLA_APPLIES_TO_LABELS } from "./admin-model";
import { FormError } from "./form-error";

function hoursLabel(hours: number | undefined): string {
  if (hours === undefined) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${numberToInput(hours)} h`;
}

/** Tabela editável das regras de SLA (sla_rules): cada linha salva pela própria action. */
export function SettingsSlaRules({ rules }: { rules: SlaRule[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<{ rule: SlaRule | null } | null>(null);
  const [toDelete, setToDelete] = React.useState<SlaRule | null>(null);

  const run = (action: () => Promise<ActionResult<unknown>>, successMessage: string, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      after?.();
      router.refresh();
    });

  const toggle = (rule: SlaRule, active: boolean) =>
    run(
      () =>
        upsertSlaRule({
          id: rule.id,
          key: rule.key,
          name: rule.name,
          appliesTo: rule.appliesTo,
          department: rule.department,
          responseHours: rule.responseHours,
          resolutionHours: rule.resolutionHours,
          businessHoursOnly: rule.businessHoursOnly,
          attentionPct: rule.attentionPct,
          riskPct: rule.riskPct,
          active,
        } satisfies SlaRuleInput),
      active ? "Regra ativada" : "Regra desativada",
    );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Regras de SLA</CardTitle>
          <CardDescription>Prazos de resposta e resolução por tipo de entidade. A chave é referenciada por workflows, chamados e tarefas (ex.: suporte.critico).</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing({ rule: null })} className="shrink-0">
          <Plus /> Nova regra
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rules.length === 0 ? (
          <EmptyState icon={<Timer />} title="Nenhuma regra de SLA" description="Sem regras, os prazos usam o padrão de 24 horas úteis." size="sm" />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Regra</TableHead>
                    <TableHead>Aplica-se a</TableHead>
                    <TableHead>Departamento</TableHead>
                    <TableHead className="text-right">Resposta</TableHead>
                    <TableHead className="text-right">Resolução</TableHead>
                    <TableHead>Horário</TableHead>
                    <TableHead className="text-right">Atenção</TableHead>
                    <TableHead className="text-right">Risco</TableHead>
                    <TableHead>Ativa</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.id} className={cn(!r.active && "opacity-70")}>
                      <TableCell className="max-w-[300px]">
                        <span className="block truncate font-medium">{r.name}</span>
                        <span className="block truncate font-mono text-xs text-muted">{r.key}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{SLA_APPLIES_TO_LABELS[r.appliesTo]}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.department ? DEPARTMENT_LABELS[r.department] : <span className="text-muted-light">—</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{hoursLabel(r.responseHours)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{hoursLabel(r.resolutionHours)}</TableCell>
                      <TableCell>
                        <Badge variant={r.businessHoursOnly ? "info" : "warning"} size="sm">
                          {r.businessHoursOnly ? "Horas úteis" : "24×7"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.attentionPct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{r.riskPct}%</TableCell>
                      <TableCell>
                        <Switch size="sm" checked={r.active} onCheckedChange={(next) => toggle(r, next)} disabled={pending} aria-label={r.active ? `Desativar ${r.name}` : `Ativar ${r.name}`} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => setEditing({ rule: r })}>
                            <Pencil /> Editar
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 text-danger hover:bg-danger-soft hover:text-danger-fg" aria-label={`Excluir ${r.name}`} onClick={() => setToDelete(r)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile */}
            <ul className="flex flex-col gap-2 px-4 pb-4 md:hidden">
              {rules.map((r) => (
                <li key={r.id} className={cn("rounded-lg border border-border p-3", !r.active && "opacity-70")}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="truncate font-mono text-xs text-muted">{r.key}</p>
                      <p className="mt-1 text-xs text-muted">
                        {SLA_APPLIES_TO_LABELS[r.appliesTo]}
                        {r.department ? ` · ${DEPARTMENT_LABELS[r.department]}` : ""} · resposta {hoursLabel(r.responseHours)} · resolução {hoursLabel(r.resolutionHours)} · {r.businessHoursOnly ? "horas úteis" : "24×7"}
                      </p>
                    </div>
                    <Switch size="sm" checked={r.active} onCheckedChange={(next) => toggle(r, next)} disabled={pending} aria-label={r.active ? `Desativar ${r.name}` : `Ativar ${r.name}`} />
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-9 text-danger" onClick={() => setToDelete(r)}>
                      <Trash2 /> Excluir
                    </Button>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => setEditing({ rule: r })}>
                      <Pencil /> Editar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent size="lg">{editing ? <SlaRuleForm key={editing.rule?.id ?? "new"} rule={editing.rule} onClose={() => setEditing(null)} /> : null}</DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Excluir regra de SLA?"
        description={toDelete ? `Instâncias já iniciadas com "${toDelete.name}" mantêm seus prazos; novas instâncias que referenciem a chave ${toDelete.key} usarão o padrão. Prefira desativar se a regra puder voltar.` : undefined}
        confirmLabel="Excluir"
        destructive
        onConfirm={() => (toDelete ? run(() => deleteSlaRule({ id: toDelete.id }), "Regra excluída") : undefined)}
      />
    </Card>
  );
}

interface FormState {
  key: string;
  name: string;
  appliesTo: SlaRule["appliesTo"];
  department: string;
  responseHours: string;
  resolutionHours: string;
  businessHoursOnly: boolean;
  attentionPct: string;
  riskPct: string;
  active: boolean;
}

function SlaRuleForm({ rule, onClose }: { rule: SlaRule | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>({
    key: rule?.key ?? "",
    name: rule?.name ?? "",
    appliesTo: rule?.appliesTo ?? "tarefa",
    department: rule?.department ?? "",
    responseHours: numberToInput(rule?.responseHours),
    resolutionHours: numberToInput(rule?.resolutionHours),
    businessHoursOnly: rule?.businessHoursOnly ?? true,
    attentionPct: numberToInput(rule?.attentionPct ?? 50),
    riskPct: numberToInput(rule?.riskPct ?? 80),
    active: rule?.active ?? true,
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const resolution = parseNumber(form.resolutionHours);
    const response = form.responseHours.trim() ? parseNumber(form.responseHours) : undefined;
    const attention = parseNumber(form.attentionPct);
    const risk = parseNumber(form.riskPct);
    if (Number.isNaN(resolution) || (response !== undefined && Number.isNaN(response)) || Number.isNaN(attention) || Number.isNaN(risk)) {
      setError("Informe números válidos em horas e percentuais");
      return;
    }
    const input: SlaRuleInput = {
      id: rule?.id,
      key: form.key,
      name: form.name,
      appliesTo: form.appliesTo,
      department: form.department ? (form.department as DepartmentKey) : undefined,
      responseHours: response,
      resolutionHours: resolution,
      businessHoursOnly: form.businessHoursOnly,
      attentionPct: attention,
      riskPct: risk,
      active: form.active,
    };
    startTransition(async () => {
      const result = await upsertSlaRule(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(rule ? "Regra salva" : "Regra criada");
      onClose();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{rule ? "Editar regra de SLA" : "Nova regra de SLA"}</DialogTitle>
        <DialogDescription>Horas em tempo útil (quando &ldquo;só horário comercial&rdquo; está ligado) ou corrido. Use fração para minutos: 0,25 h = 15 min.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 py-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Chave" htmlFor="sr-key" required hint={rule ? "A chave identifica a regra; alterar exige atualizar quem a referencia." : "Ex.: suporte.critico, workflow.vendas."}>
            <Input id="sr-key" value={form.key} onChange={(e) => set("key", e.target.value)} required minLength={2} maxLength={60} className="font-mono" placeholder="area.nome" autoFocus={!rule} />
          </FormField>
          <FormField label="Nome" htmlFor="sr-name" required>
            <Input id="sr-name" value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} placeholder="Ex.: Suporte — Crítico (sistema parado)" />
          </FormField>
          <FormField label="Aplica-se a" htmlFor="sr-applies" required>
            <Select id="sr-applies" value={form.appliesTo} onChange={(e) => set("appliesTo", e.target.value as SlaRule["appliesTo"])}>
              {SLA_APPLIES_TO.map((a) => (
                <option key={a} value={a}>
                  {SLA_APPLIES_TO_LABELS[a]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Departamento" htmlFor="sr-department">
            <Select id="sr-department" value={form.department} onChange={(e) => set("department", e.target.value)}>
              <option value="">Qualquer departamento</option>
              {DEPARTMENT_KEYS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABELS[d]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Resposta (horas)" htmlFor="sr-response" hint="Opcional: prazo da primeira resposta.">
            <Input id="sr-response" type="number" inputMode="decimal" min={0} step="0.25" value={form.responseHours} onChange={(e) => set("responseHours", e.target.value)} className="tabular-nums" />
          </FormField>
          <FormField label="Resolução (horas)" htmlFor="sr-resolution" required>
            <Input id="sr-resolution" type="number" inputMode="decimal" min={0.25} step="0.25" value={form.resolutionHours} onChange={(e) => set("resolutionHours", e.target.value)} required className="tabular-nums" />
          </FormField>
          <FormField label="Atenção a partir de (% do prazo)" htmlFor="sr-attention" required>
            <Input id="sr-attention" type="number" inputMode="numeric" min={1} max={99} step={1} value={form.attentionPct} onChange={(e) => set("attentionPct", e.target.value)} required className="tabular-nums" />
          </FormField>
          <FormField label="Risco a partir de (% do prazo)" htmlFor="sr-risk" required>
            <Input id="sr-risk" type="number" inputMode="numeric" min={1} max={99} step={1} value={form.riskPct} onChange={(e) => set("riskPct", e.target.value)} required className="tabular-nums" />
          </FormField>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Switch label="Só horário comercial" description="Conta apenas horas úteis (expediente e feriados)." checked={form.businessHoursOnly} onCheckedChange={(v) => set("businessHoursOnly", v)} className="rounded-lg border border-border px-3 py-2" />
          <Switch label="Regra ativa" description="Inativa não inicia novas instâncias." checked={form.active} onCheckedChange={(v) => set("active", v)} className="rounded-lg border border-border px-3 py-2" />
        </div>
        <FormError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {rule ? "Salvar" : "Criar regra"}
        </Button>
      </DialogFooter>
    </form>
  );
}
