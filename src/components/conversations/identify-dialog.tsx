"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { identityCandidatesAction, linkConversationIdentityAction } from "@/server/conversations/actions";
import type { IdentityCandidate } from "@/server/conversations/identity";
import type { ConversationDetail } from "@/server/conversations/queries";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Choice = { kind: IdentityCandidate["kind"]; id: string } | { kind: "novo_lead" } | { kind: "nenhum" };

const KIND_LABEL: Record<IdentityCandidate["kind"], string> = { contato: "contato", cliente: "cliente", lead: "lead" };

/**
 * «Quem é este número?»: sugestões pelo mesmo telefone/e-mail (inclusive o celular sem o 9) e pelo nome do perfil;
 * vincular a contato, cliente ou lead, criar lead novo ou deixar sem identificar.
 */
export function IdentifyDialog({ detail, open, onOpenChange }: { detail: ConversationDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const c = detail.conversation;
  const [candidates, setCandidates] = React.useState<IdentityCandidate[] | null>(null);
  const [choice, setChoice] = React.useState<Choice | null>(null);
  const [name, setName] = React.useState(c.displayName ?? "");
  const [fixPhone, setFixPhone] = React.useState(true);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    identityCandidatesAction({ conversationId: c.id }).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        toast.error(r.error);
        setCandidates([]);
        return;
      }
      setCandidates(r.data);
      const first = r.data.find((x) => x.reason !== "nome parecido");
      setChoice(first ? { kind: first.kind, id: first.id } : null);
    });
    return () => {
      alive = false;
    };
  }, [open, c.id]);

  const selected = choice && "id" in choice ? candidates?.find((x) => x.kind === choice.kind && x.id === choice.id) : undefined;

  const submit = () =>
    startTransition(async () => {
      if (!choice) return;
      const r = await linkConversationIdentityAction({
        conversationId: c.id,
        kind: choice.kind,
        id: "id" in choice ? choice.id : undefined,
        name: choice.kind === "novo_lead" ? name : undefined,
        fixPhone: Boolean(selected?.phoneWithoutNine && fixPhone),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(choice.kind === "nenhum" ? "Conversa segue sem identificação" : choice.kind === "novo_lead" ? "Lead criado e vinculado" : "Contato identificado");
      onOpenChange(false);
      router.refresh();
    });

  const isChosen = (k: Choice["kind"], id?: string) => choice?.kind === k && (!id || ("id" in choice && choice.id === id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Quem é {c.channel === "whatsapp" ? formatPhone(c.address.replace(/^\+?55/, "")) : c.address}?</DialogTitle>
          <DialogDescription>As mensagens já trocadas passam para o histórico do cadastro escolhido.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {candidates === null ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Procurando parecidos…
            </p>
          ) : candidates.length > 0 ? (
            <p className="text-sm text-muted">Encontramos parecidos:</p>
          ) : (
            <p className="text-sm text-muted">Nenhum cadastro com este {c.channel === "whatsapp" ? "telefone" : "e-mail"} ou nome.</p>
          )}
          {candidates?.map((x) => (
            <label key={`${x.kind}_${x.id}`} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm", isChosen(x.kind, x.id) ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-hover")}>
              <input type="radio" name="identity" className="mt-1" checked={isChosen(x.kind, x.id)} onChange={() => setChoice({ kind: x.kind, id: x.id })} />
              <span className="min-w-0">
                <span className="font-medium">{x.name}</span>
                <span className="text-muted">
                  {" "}
                  · {KIND_LABEL[x.kind]}
                  {x.company ? ` de ${x.company}` : ""}
                </span>
                <span className="block text-xs text-muted">
                  {x.reason}
                  {x.phoneWithoutNine ? " (cadastrado sem o 9)" : ""}
                </span>
              </span>
            </label>
          ))}
          {detail.capabilities.createLead ? (
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm", isChosen("novo_lead") ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-hover")}>
              <input type="radio" name="identity" className="mt-1" checked={isChosen("novo_lead")} onChange={() => setChoice({ kind: "novo_lead" })} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">Criar lead novo</span>
                <span className="block text-xs text-muted">origem {c.channel === "whatsapp" ? "WhatsApp" : "e-mail"}</span>
                {isChosen("novo_lead") ? <Input className="mt-2" aria-label="Nome do lead" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do contato" /> : null}
              </span>
            </label>
          ) : null}
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm", isChosen("nenhum") ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-hover")}>
            <input type="radio" name="identity" className="mt-1" checked={isChosen("nenhum")} onChange={() => setChoice({ kind: "nenhum" })} />
            <span>
              <span className="font-medium">Deixar sem identificar</span>
              <span className="block text-xs text-muted">a conversa continua; dá para vincular depois</span>
            </span>
          </label>
          {selected?.phoneWithoutNine ? <Checkbox checked={fixPhone} onCheckedChange={(v) => setFixPhone(v === true)} label="Atualizar o telefone do cadastro para o número com 9 dígitos" /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!choice || (choice.kind === "novo_lead" && name.trim().length < 2)}>
            <UserCheck /> Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
