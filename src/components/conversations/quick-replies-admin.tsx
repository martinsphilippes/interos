"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { saveQuickReplyAction } from "@/server/conversations/actions";
import type { QuickReply } from "@/domain/types";
import { MESSAGE_VARIABLES, type MessageVariableKey } from "@/domain/message-variables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

interface Draft {
  id?: string;
  shortcut: string;
  body: string;
  queueId: string;
  active: boolean;
}

/** Variáveis que fazem sentido numa conversa (as de cobrança dependem da parcela e ficam para a régua). */
const CONVERSATION_VARIABLES: MessageVariableKey[] = ["contato", "cliente", "operador", "atendimento"];

/**
 * Respostas rápidas: textos prontos que o operador chama digitando «/atalho» no campo de mensagem. As variáveis
 * ({contato}, {operador}…) são preenchidas na hora; o que não puder ser preenchido bloqueia o envio.
 */
export function QuickRepliesAdminView({ data, canEdit }: { data: { replies: QuickReply[]; queues: { id: string; name: string }[] }; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pending, startTransition] = React.useTransition();
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const queueName = new Map(data.queues.map((q) => [q.id, q.name]));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const insertVariable = (key: MessageVariableKey) => {
    if (!draft) return;
    const el = textRef.current;
    const token = `{${key}}`;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    set("body", draft.body.slice(0, start) + token + draft.body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = () =>
    startTransition(async () => {
      if (!draft) return;
      const r = await saveQuickReplyAction({ ...draft, queueId: draft.queueId || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success(draft.id ? "Resposta atualizada" : "Resposta criada");
      setDraft(null);
      router.refresh();
    });

  const replies = [...data.replies].sort((a, b) => Number(b.active) - Number(a.active) || (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.shortcut.localeCompare(b.shortcut, "pt-BR"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">
          Textos prontos para o dia a dia. Na conversa, digite <kbd className="rounded border border-border px-1 font-mono text-xs">/</kbd> e o atalho. Valem dentro da janela de 24 h do WhatsApp; fora dela, use um modelo aprovado.
        </p>
        {canEdit ? (
          <Button onClick={() => setDraft({ shortcut: "", body: "", queueId: "", active: true })}>
            <Plus /> Nova resposta
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Atalho</TableHead>
              <TableHead>Texto</TableHead>
              <TableHead>Quem vê</TableHead>
              <TableHead>Usos</TableHead>
              {canEdit ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {replies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted">
                  Nenhuma resposta rápida ainda.
                </TableCell>
              </TableRow>
            ) : null}
            {replies.map((r) => (
              <TableRow key={r.id} className={r.active ? undefined : "opacity-60"}>
                <TableCell>
                  <span className="font-mono text-[13px]">/{r.shortcut}</span>
                  {!r.active ? (
                    <Badge size="sm" variant="muted" className="ml-2">
                      Desativada
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <p className="max-w-[420px] truncate text-sm" title={r.body}>
                    {r.body}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{r.queueId ? (queueName.get(r.queueId) ?? "Fila removida") : "Toda a empresa"}</TableCell>
                <TableCell className="tabular-nums">{r.usageCount ?? 0}</TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button size="icon" variant="ghost" aria-label={`Editar /${r.shortcut}`} onClick={() => setDraft({ id: r.id, shortcut: r.shortcut, body: r.body, queueId: r.queueId ?? "", active: r.active })}>
                      <Pencil />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(v) => (!v ? setDraft(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Resposta /${draft.shortcut}` : "Nova resposta rápida"}</DialogTitle>
            <DialogDescription>O operador revisa o texto antes de enviar.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <DialogBody className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Atalho" htmlFor="qr-shortcut" required hint="Sem espaços: segunda-via">
                  <Input id="qr-shortcut" value={draft.shortcut} onChange={(e) => set("shortcut", e.target.value)} placeholder="segunda-via" />
                </FormField>
                <FormField label="Quem vê" htmlFor="qr-queue">
                  <Select id="qr-queue" value={draft.queueId} onChange={(e) => set("queueId", e.target.value)} options={[{ value: "", label: "Toda a empresa" }, ...data.queues.map((q) => ({ value: q.id, label: `Só a fila ${q.name}` }))]} />
                </FormField>
              </div>
              <FormField label="Texto" htmlFor="qr-body" required>
                <Textarea ref={textRef} id="qr-body" rows={5} value={draft.body} onChange={(e) => set("body", e.target.value)} placeholder="Olá, {contato}! Aqui é {operador}…" />
              </FormField>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Inserir:</span>
                {CONVERSATION_VARIABLES.map((k) => (
                  <Button key={k} size="sm" variant="outline" onClick={() => insertVariable(k)} title={`Exemplo: ${MESSAGE_VARIABLES[k].example}`}>
                    {MESSAGE_VARIABLES[k].label}
                  </Button>
                ))}
              </div>
              <Switch checked={draft.active} onCheckedChange={(v) => set("active", v)} label="Ativa" />
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} loading={pending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
