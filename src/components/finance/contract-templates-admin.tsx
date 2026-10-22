"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, FilePlus2, FileText, FileUp, Link2, Pencil, Star } from "lucide-react";
import type { ContractTemplate, ContractTemplateVariable } from "@/domain/types";
import { CONTRACT_FIELDS, extractVariables, fieldLabel, mergeVariables, suggestUnbound, unmappedVariables } from "@/domain/contract-templates";
import { saveInterosTemplateAction, saveTemplateVariablesAction, setTemplateStateAction } from "@/server/finance/signature-actions";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useFinanceAction } from "./use-finance-action";

export type TemplateRow = Pick<ContractTemplate, "id" | "name" | "kind" | "description" | "active" | "isDefault" | "version" | "title" | "clauses" | "fileName" | "fileSize" | "variables" | "updatedAt" | "createdByName" | "updatedByName" | "providerTemplateKey">;

/** Texto inicial de um modelo novo: exemplo para adaptar (revisar com o jurídico antes de usar). */
const STARTER = `CLÁUSULA PRIMEIRA – DO OBJETO

O presente contrato tem por objeto o licenciamento de uso e a prestação dos serviços descritos neste documento ({{contrato.itens}}), pela CONTRATADA à CONTRATANTE, {{contratante.razao_social}}, inscrita no CNPJ/CPF sob o nº {{contratante.cnpj_cpf}}.

CLÁUSULA SEGUNDA – DO PRAZO

O contrato vigora por {{contrato.prazo_meses}}, a contar da assinatura.

CLÁUSULA TERCEIRA – DO PREÇO E DO PAGAMENTO

A CONTRATANTE pagará a adesão de {{valores.adesao_extenso}} e a mensalidade de {{valores.mensalidade_extenso}}, com vencimento todo dia {{contrato.dia_vencimento}}, por {{contrato.forma_pagamento}}.

CLÁUSULA QUARTA – DO FORO

Fica eleito o foro da comarca de Juazeiro do Norte/CE para dirimir as questões oriundas deste contrato.

E, por estarem de acordo, as partes assinam eletronicamente, em {{contrato.data_emissao}}.`;

const GROUPS = ["Contratante", "Contratada", "Contrato", "Valores"] as const;

function fieldOptions() {
  return [{ value: "", label: "— texto fixo / deixar em branco —" }, ...GROUPS.flatMap((g) => CONTRACT_FIELDS.filter((f) => f.group === g).map((f) => ({ value: f.key, label: `${g} · ${f.label}` })))];
}

/** Modelos de contrato: gerado pelo INTEROS (cláusulas com variáveis) ou Word da Clicksign (arquivo .docx). */
export function ContractTemplatesAdmin({ templates, canEdit }: { templates: TemplateRow[]; canEdit: boolean }) {
  const [editing, setEditing] = React.useState<TemplateRow | "new" | null>(null);
  const [uploading, setUploading] = React.useState<TemplateRow | "new" | null>(null);
  const [mapping, setMapping] = React.useState<TemplateRow | null>(null);
  const { pending, run } = useFinanceAction();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted md:flex-row md:items-center md:justify-between">
        <p>
          Use <span className="font-medium text-foreground">{"{{variáveis}}"}</span> no texto (ex.: {"{{contratante.razao_social}}"}). Ao gerar o documento, o INTEROS troca cada variável pelo dado do contrato. O modelo padrão vale para
          todo contrato que não escolher outro.
        </p>
        {canEdit ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => setUploading("new")}>
              <FileUp /> Enviar Word da Clicksign
            </Button>
            <Button onClick={() => setEditing("new")}>
              <FilePlus2 /> Novo modelo
            </Button>
          </div>
        ) : null}
      </div>

      {templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="Nenhum modelo de contrato"
            description="Sem modelo, o documento sai com os dados do contrato (partes, itens, valores e condições), sem cláusulas. Crie um modelo com as cláusulas da Intercert ou envie o Word que vocês usam na Clicksign."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => {
            const missing = unmappedVariables(t.variables);
            return (
              <li key={t.id}>
                <Card className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{t.name}</p>
                      <p className="text-xs text-muted">
                        {t.kind === "word" ? `Word · ${t.fileName ?? "arquivo"}` : "Gerado pelo INTEROS"} · versão {t.version} · alterado {formatRelative(t.updatedAt)}
                        {t.updatedByName || t.createdByName ? ` por ${t.updatedByName ?? t.createdByName}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {t.isDefault ? (
                        <Badge variant="info" size="sm">
                          <Star /> Padrão
                        </Badge>
                      ) : null}
                      {!t.active ? (
                        <Badge variant="muted" size="sm">
                          Inativo
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {t.description ? <p className="text-sm text-muted">{t.description}</p> : null}
                  <p className="text-sm">
                    {t.variables.length} variável(is)
                    {missing.length > 0 ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-warning-fg">
                        <AlertTriangle className="size-3.5" /> {missing.length} sem campo (sai em branco)
                      </span>
                    ) : null}
                  </p>
                  {t.kind === "word" ? <p className="text-xs text-muted">{t.providerTemplateKey ? "Registrado na Clicksign." : "Será registrado na Clicksign quando a integração estiver conectada."}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2">
                    {canEdit ? (
                      <>
                        {t.kind === "interos" ? (
                          <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                            <Pencil /> Editar texto
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setUploading(t)}>
                            <FileUp /> Trocar arquivo
                          </Button>
                        )}
                        {t.variables.length > 0 ? (
                          <Button size="sm" variant="outline" onClick={() => setMapping(t)}>
                            <Link2 /> Ligar variáveis
                          </Button>
                        ) : null}
                        {t.active && !t.isDefault ? (
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run(() => setTemplateStateAction({ templateId: t.id, isDefault: true }), `"${t.name}" agora é o modelo padrão`)}>
                            <Star /> Tornar padrão
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run(() => setTemplateStateAction({ templateId: t.id, active: !t.active }), t.active ? "Modelo desativado" : "Modelo ativado")}>
                          {t.active ? "Desativar" : "Ativar"}
                        </Button>
                      </>
                    ) : null}
                    {t.kind === "word" ? (
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/api/financeiro/modelos/${t.id}/arquivo`}>
                          <Download /> Baixar Word
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? <InterosTemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {uploading ? <WordUploadDialog template={uploading === "new" ? null : uploading} onClose={() => setUploading(null)} /> : null}
      {mapping ? <VariablesDialog template={mapping} onClose={() => setMapping(null)} /> : null}
    </div>
  );
}

function InterosTemplateDialog({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const area = React.useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = React.useState({ name: template?.name ?? "", description: template?.description ?? "", title: template?.title ?? "Contrato de licenciamento e serviços", clauses: template?.clauses ?? STARTER });
  const variables = extractVariables(`${form.title}\n${form.clauses}`);
  const [field, setField] = React.useState("");

  const insert = (key: string) => {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el) return setForm((f) => ({ ...f, clauses: `${f.clauses}${token}` }));
    const start = el.selectionStart ?? form.clauses.length;
    const end = el.selectionEnd ?? start;
    const next = `${form.clauses.slice(0, start)}${token}${form.clauses.slice(end)}`;
    setForm((f) => ({ ...f, clauses: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    const ok = await run(() => saveInterosTemplateAction({ id: template?.id, ...form, variables: mergeVariables(variables, template?.variables) }), (d) => `Modelo salvo (versão ${d.version})`);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{template ? `Editar "${template.name}"` : "Novo modelo de contrato"}</DialogTitle>
          <DialogDescription>As cláusulas entram no PDF depois dos dados do contrato. Separe os parágrafos com uma linha em branco. Mudar o texto cria uma nova versão; documentos já gerados não mudam.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Nome do modelo" htmlFor={`${id}-n`} required>
              <Input id={`${id}-n`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Contrato padrão de licenciamento" />
            </FormField>
            <FormField label="Título no documento" htmlFor={`${id}-t`}>
              <Input id={`${id}-t`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Descrição (uso interno)" htmlFor={`${id}-d`}>
            <Input id={`${id}-d`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Quando usar este modelo" />
          </FormField>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <FormField label="Inserir campo do contrato no cursor" htmlFor={`${id}-f`} className="flex-1">
              <Select id={`${id}-f`} value={field} onChange={(e) => setField(e.target.value)} options={fieldOptions().slice(1)} placeholder="Escolha o campo" />
            </FormField>
            <Button variant="outline" disabled={!field} onClick={() => field && insert(field)}>
              Inserir
            </Button>
          </div>
          <FormField label="Cláusulas" htmlFor={`${id}-c`} required hint={`${variables.length} variável(is) no texto. Exemplo inicial: revise com o jurídico antes de usar.`}>
            <Textarea ref={area} id={`${id}-c`} value={form.clauses} onChange={(e) => setForm({ ...form, clauses: e.target.value })} rows={16} className="font-mono text-xs" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending} disabled={form.name.trim().length < 3 || form.clauses.trim().length < 20}>
            Salvar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WordUploadDialog({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  const id = React.useId();
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState(template?.name ?? "");
  const [busy, setBusy] = React.useState(false);

  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("arquivo", file);
      if (template) body.set("templateId", template.id);
      if (name.trim()) body.set("nome", name.trim());
      const res = await fetch("/api/financeiro/modelos", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { variables: ContractTemplateVariable[] } } | null;
      if (!json?.ok) {
        toast.error(json?.error ?? "Não foi possível enviar o arquivo");
        return;
      }
      const vars = json.data?.variables ?? [];
      const missing = unmappedVariables(vars).length;
      toast.success(vars.length === 0 ? "Modelo salvo. Nenhuma {{variável}} encontrada no Word." : `Modelo salvo com ${vars.length} variável(is)${missing ? `; ${missing} sem campo: confira em "Ligar variáveis"` : ", todas ligadas"}.`);
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? `Trocar o arquivo de "${template.name}"` : "Enviar modelo Word"}</DialogTitle>
          <DialogDescription>O mesmo .docx usado na Clicksign, com as variáveis entre chaves duplas: {"{{razao_social}}"}, {"{{valor_mensal}}"}… O INTEROS acha as variáveis e sugere o campo de cada uma.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <FormField label="Arquivo Word (.docx, até 4 MB)" htmlFor={`${id}-f`} required>
            <Input id={`${id}-f`} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </FormField>
          <FormField label="Nome do modelo" htmlFor={`${id}-n`} hint={template ? undefined : "Vazio: o nome do arquivo."}>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={send} loading={busy} disabled={!file}>
            <FileUp /> Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariablesDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const { pending, run } = useFinanceAction();
  const [vars, setVars] = React.useState<ContractTemplateVariable[]>(template.variables);
  // Sugestão pelo nome para o que está sem ligação (bairro → Bairro do cliente): mostrada, nunca aplicada sozinha —
  // deixar sem campo pode ser escolha, e salvar por outro motivo não pode gravar ligações que ninguém pediu.
  const suggestions = React.useMemo(
    () => new Map(suggestUnbound(template.variables).flatMap((v, i) => (!template.variables[i].field && !template.variables[i].fixed?.trim() && v.field ? [[v.name, v.field] as const] : []))),
    [template.variables],
  );
  const pendingSuggestions = vars.filter((v) => !v.field && !v.fixed?.trim() && suggestions.has(v.name));
  const options = React.useMemo(() => fieldOptions(), []);
  const set = (name: string, patch: Partial<ContractTemplateVariable>) => setVars((list) => list.map((v) => (v.name === name ? { ...v, ...patch } : v)));
  const applySuggestion = (names: string[]) => setVars((list) => list.map((v) => (names.includes(v.name) && suggestions.has(v.name) ? { ...v, field: suggestions.get(v.name), fixed: undefined } : v)));
  const save = async () => {
    const ok = await run(() => saveTemplateVariablesAction({ templateId: template.id, variables: vars.map((v) => ({ name: v.name, field: v.field || undefined, fixed: v.field ? undefined : v.fixed || undefined })) }), "Variáveis salvas");
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Variáveis de «{template.name}»</DialogTitle>
          <DialogDescription>
            Cada variável do modelo puxa um dado do contrato ou um texto fixo. Sem nada, sai uma lacuna (________) para preencher à mão. Variáveis sem ligação mostram uma sugestão pelo nome: use-a ou escolha outro campo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          <ul className="flex flex-col divide-y divide-border">
            {vars.map((v) => (
              <li key={v.name} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{`{{${v.name}}}`}</p>
                  {v.field ? (
                    <p className="text-xs text-muted">{fieldLabel(v.field)}</p>
                  ) : v.fixed ? (
                    <p className="text-xs text-warning-fg">Texto fixo</p>
                  ) : suggestions.has(v.name) ? (
                    <p className="text-xs text-warning-fg">
                      Sem campo · sugestão: {fieldLabel(suggestions.get(v.name)!)}{" "}
                      <button type="button" className="font-medium underline" onClick={() => applySuggestion([v.name])}>
                        usar
                      </button>
                    </p>
                  ) : (
                    <p className="text-xs text-warning-fg">Sem campo</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Select aria-label={`Campo de ${v.name}`} value={v.field ?? ""} onChange={(e) => set(v.name, { field: e.target.value || undefined })} options={options} size="sm" />
                  {!v.field ? <Input aria-label={`Texto fixo de ${v.name}`} value={v.fixed ?? ""} onChange={(e) => set(v.name, { fixed: e.target.value })} placeholder="Texto fixo (opcional)" className="h-8" /> : null}
                </div>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          {pendingSuggestions.length > 0 ? (
            <Button variant="outline" onClick={() => applySuggestion(pendingSuggestions.map((v) => v.name))} disabled={pending}>
              Usar {pendingSuggestions.length === 1 ? "a sugestão" : `as ${pendingSuggestions.length} sugestões`}
            </Button>
          ) : null}
          <Button onClick={save} loading={pending}>
            Salvar ligações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
