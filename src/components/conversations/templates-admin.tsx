"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { saveTemplateAction, syncTemplatesAction } from "@/server/conversations/actions";
import type { TemplatesAdmin } from "@/server/conversations/queries";
import { TEMPLATE_CATEGORIES, TEMPLATE_CONTEXTS, type MessageTemplate, type TemplateCategory, type TemplateContext, type TemplateStatus } from "@/domain/types";
import { MESSAGE_VARIABLES, fillTemplate, placeholderCount, variablesFor, type MessageVariableKey } from "@/domain/message-variables";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

const STATUS: Record<TemplateStatus, { label: string; variant: "success" | "info" | "danger" | "warning" | "muted" }> = {
  aprovado: { label: "Aprovado", variant: "success" },
  em_analise: { label: "Em análise", variant: "info" },
  rejeitado: { label: "Rejeitado", variant: "danger" },
  pausado: { label: "Pausado pela Meta", variant: "warning" },
  desativado: { label: "Desativado", variant: "muted" },
  rascunho: { label: "Rascunho (não enviado)", variant: "muted" },
};
const CATEGORY: Record<TemplateCategory, string> = { utilidade: "Utilidade", marketing: "Marketing" };
const CONTEXT: Record<TemplateContext, string> = { conversa: "Central (conversa)", cobranca: "Cobrança (régua)" };

interface Draft {
  id?: string;
  name: string;
  category: TemplateCategory;
  context: TemplateContext;
  body: string;
  footer: string;
  variables: string[];
}

const EMPTY: Draft = { name: "", category: "utilidade", context: "conversa", body: "Olá, {{1}}! Aqui é {{2}}, da Intercert. Podemos continuar o seu atendimento? Responda esta mensagem.", footer: "", variables: ["contato", "operador"] };

/**
 * Modelos do WhatsApp: o que a Meta aprovou (sincronizado), em que tela cada um é usado e qual variável do INTEROS
 * preenche cada {{n}}. Modelo aprovado não muda o texto: para mudar, crie uma versão nova.
 */
export function TemplatesAdminView({ data, canEdit }: { data: TemplatesAdmin; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pending, startTransition] = React.useTransition();
  const editing = Boolean(draft?.id);
  const n = draft ? placeholderCount(draft.body) : 0;
  const options = draft ? variablesFor(draft.context) : [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const sync = () =>
    startTransition(async () => {
      const r = await syncTemplatesAction({});
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.total} modelo(s) lidos da Meta (${r.data.created} novo(s))`);
      router.refresh();
    });

  const save = () =>
    startTransition(async () => {
      if (!draft) return;
      const r = await saveTemplateAction({ ...draft, footer: draft.footer || undefined });
      if (!r.ok) return void toast.error(r.error);
      if (editing) toast.success("Modelo atualizado");
      else if (r.data.sentToMeta) toast.success("Modelo enviado para análise da Meta");
      else toast.warning(`Salvo como rascunho: ${r.data.error ?? "a conta do WhatsApp Business não está configurada"}`);
      setDraft(null);
      router.refresh();
    });

  const edit = (t: MessageTemplate) => setDraft({ id: t.id, name: t.name, category: t.category, context: t.context, body: t.body, footer: t.footer ?? "", variables: [...t.variables] });

  return (
    <div className="flex flex-col gap-4">
      {data.reguaWithoutTemplate.length > 0 ? (
        <p role="note" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          <strong>Régua de cobrança:</strong> {data.reguaWithoutTemplate.length} etapa(s) por WhatsApp sem modelo ({data.reguaWithoutTemplate.join(", ")}). Com o WhatsApp conectado, a Meta recusa o texto livre quando o cliente não escreveu
          nas últimas 24 h. Ligue cada etapa a um modelo de cobrança aprovado em Administração › Configurações › Cobrança.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">
          Mensagens pré-aprovadas pela Meta — as únicas aceitas quando o cliente não escreveu nas últimas 24 h. {data.metaConfigured ? "Sincronizadas com a Meta a cada hora." : "A conta do WhatsApp Business ainda não está configurada: dá para preparar rascunhos."}
        </p>
        {canEdit ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={sync} loading={pending} disabled={!data.metaConfigured} title={data.metaConfigured ? undefined : "Configure WHATSAPP_BUSINESS_ACCOUNT_ID"}>
              <RefreshCw /> Sincronizar agora
            </Button>
            <Button onClick={() => setDraft({ ...EMPTY })}>
              <Plus /> Novo modelo
            </Button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead>Modelo</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Situação na Meta</TableHead>
              <TableHead>Usado em</TableHead>
              <TableHead>Envios 30 d</TableHead>
              {canEdit ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted">
                  Nenhum modelo ainda.
                </TableCell>
              </TableRow>
            ) : null}
            {data.templates.map((t) => {
              const unmapped = t.variables.slice(0, placeholderCount(t.body)).some((v) => !(v in MESSAGE_VARIABLES)) || t.variables.length < placeholderCount(t.body);
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    <span className="font-mono text-[13px]">{t.name}</span>
                    <p className="max-w-[360px] truncate text-xs text-muted" title={t.body}>
                      {t.body}
                    </p>
                    {unmapped ? <p className="text-xs font-medium text-danger-fg">ligue as variáveis para usar</p> : null}
                  </TableCell>
                  <TableCell>{CATEGORY[t.category]}</TableCell>
                  <TableCell>
                    <Badge size="sm" variant={STATUS[t.status].variant}>
                      {STATUS[t.status].label}
                    </Badge>
                    {t.rejectedReason ? <p className="mt-1 max-w-[220px] text-xs text-muted">{t.rejectedReason}</p> : null}
                    {t.quality && t.quality !== "GREEN" && t.quality !== "UNKNOWN" ? <p className="mt-1 text-xs text-warning-fg">qualidade {t.quality === "RED" ? "baixa" : "média"}</p> : null}
                    {t.syncedAt ? <p className="mt-1 text-[11px] text-muted">lido {formatDateTime(t.syncedAt)}</p> : null}
                  </TableCell>
                  <TableCell>{CONTEXT[t.context]}</TableCell>
                  <TableCell className="tabular-nums">{t.usage30d}</TableCell>
                  {canEdit ? (
                    <TableCell>
                      <Button size="icon" variant="ghost" aria-label={`Editar ${t.name}`} onClick={() => edit(t)}>
                        <Pencil />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(v) => (!v ? setDraft(null) : null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Modelo · ${draft?.name}` : "Novo modelo"}</DialogTitle>
            <DialogDescription>{editing ? "O texto aprovado não muda aqui. Ajuste onde ele é usado e qual informação preenche cada {{n}}." : "Vai para análise da Meta (normalmente de minutos a 24 h). Use {{1}}, {{2}}… onde entra informação do cliente."}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <DialogBody className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Nome" htmlFor="tpl-name" required hint="Minúsculas, números e _">
                  <Input id="tpl-name" value={draft.name} disabled={editing} onChange={(e) => set("name", e.target.value)} placeholder="retomar_atendimento" />
                </FormField>
                <FormField label="Categoria" htmlFor="tpl-cat" hint="Define o preço da Meta">
                  <Select id="tpl-cat" value={draft.category} disabled={editing} onChange={(e) => set("category", e.target.value as TemplateCategory)} options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY[c] }))} />
                </FormField>
                <FormField label="Usado em" htmlFor="tpl-ctx">
                  <Select id="tpl-ctx" value={draft.context} onChange={(e) => set("context", e.target.value as TemplateContext)} options={TEMPLATE_CONTEXTS.map((c) => ({ value: c, label: CONTEXT[c] }))} />
                </FormField>
              </div>
              <FormField label="Texto" htmlFor="tpl-body" required>
                <Textarea id="tpl-body" rows={4} value={draft.body} disabled={editing} onChange={(e) => set("body", e.target.value)} />
              </FormField>
              {!editing ? (
                <FormField label="Rodapé (opcional)" htmlFor="tpl-footer">
                  <Input id="tpl-footer" value={draft.footer} onChange={(e) => set("footer", e.target.value)} placeholder="Intercert · Certificação digital" />
                </FormField>
              ) : null}
              {n > 0 ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-xs text-muted">O que entra em cada variável</legend>
                  {Array.from({ length: n }, (_, i) => (
                    <div key={i} className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2">
                      <span className="font-mono text-sm text-muted">{`{{${i + 1}}}`}</span>
                      <Select
                        aria-label={`Variável {{${i + 1}}}`}
                        value={draft.variables[i] ?? ""}
                        onChange={(e) => {
                          const next = [...draft.variables];
                          next[i] = e.target.value;
                          set("variables", next);
                        }}
                        options={[{ value: "", label: "Escolha…" }, ...options.map((k) => ({ value: k, label: MESSAGE_VARIABLES[k].label }))]}
                      />
                    </div>
                  ))}
                </fieldset>
              ) : null}
              <div className="rounded-lg border border-border bg-surface-muted p-3">
                <p className="mb-1 text-xs text-muted">Prévia</p>
                <p className="whitespace-pre-line text-sm">
                  {fillTemplate(
                    draft.body,
                    Array.from({ length: n }, (_, i) => {
                      const k = draft.variables[i] as MessageVariableKey;
                      return k && k in MESSAGE_VARIABLES ? MESSAGE_VARIABLES[k].example : `{{${i + 1}}}`;
                    }),
                  )}
                </p>
                {draft.footer ? <p className="mt-1 text-xs text-muted">{draft.footer}</p> : null}
              </div>
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} loading={pending}>
              {editing ? "Salvar" : data.metaConfigured ? "Enviar para análise" : "Salvar rascunho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
