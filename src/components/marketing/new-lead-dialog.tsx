"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { checkLeadDuplicates, createLeadAction } from "@/server/marketing/actions";
import type { LeadDuplicate } from "@/server/marketing/service";
import { LeadFormFields, emptyLeadForm, leadFormPayload, type LeadFormState } from "./lead-form-fields";
import { LEAD_STATUS_LABELS, TEMPERATURE_LABELS, type MarketingOptions } from "./marketing-model";
import { useUrlFlag } from "@/lib/use-url-flag";

interface DuplicateState {
  leads: LeadDuplicate[];
  client: { id: string; tradeName: string; reasons: string[] } | null;
}

/** "Novo lead" com detecção de duplicidade em tempo real (telefone, e-mail e empresa). */
export function NewLeadDialog({ options, currentUserId, openOnUrlFlag }: { options: MarketingOptions; currentUserId: string; /** Abre com ?novo=1 (ações rápidas). */ openOnUrlFlag?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const defaultOwner = options.users.some((u) => u.id === currentUserId && u.departmentId === "marketing") ? currentUserId : "";
  const [form, setForm] = React.useState<LeadFormState>(() => emptyLeadForm(defaultOwner));
  const [dups, setDups] = React.useState<DuplicateState>({ leads: [], client: null });
  const [checking, setChecking] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = React.useRef(0);
  // Ações rápidas: ?novo=1 abre o formulário (ajuste de estado durante a renderização, sem effect).
  const flag = useUrlFlag("novo");
  const urlOpen = Boolean(openOnUrlFlag) && flag.active;
  const [urlSeen, setUrlSeen] = React.useState(false);
  if (urlOpen !== urlSeen) {
    setUrlSeen(urlOpen);
    if (urlOpen) setOpen(true);
  }
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next && urlOpen) flag.clear();
  };

  const scheduleCheck = (next: LeadFormState) => {
    if (timer.current) clearTimeout(timer.current);
    const phoneDigits = next.phone.replace(/\D/g, "");
    const hasKey = phoneDigits.length >= 10 || /\S+@\S+\.\S+/.test(next.email) || next.company.trim().length >= 4;
    if (!hasKey) {
      requestId.current++;
      setChecking(false);
      setDups({ leads: [], client: null });
      return;
    }
    timer.current = setTimeout(async () => {
      const current = ++requestId.current;
      setChecking(true);
      const result = await checkLeadDuplicates({ phone: phoneDigits.length >= 10 ? next.phone : undefined, email: /\S+@\S+\.\S+/.test(next.email) ? next.email : undefined, company: next.company || undefined });
      if (current !== requestId.current) return;
      setChecking(false);
      if (result.ok) setDups(result.data);
    }, 450);
  };

  const change = (patch: Partial<LeadFormState>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if ("phone" in patch || "email" in patch || "company" in patch) scheduleCheck(next);
  };

  const reset = () => {
    setForm(emptyLeadForm(defaultOwner));
    setDups({ leads: [], client: null });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createLeadAction(leadFormPayload(form));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Lead cadastrado · score ${result.data.score} (${TEMPERATURE_LABELS[result.data.temperature].toLowerCase()})`, {
        description: result.data.temperature === "quente" ? "Lead quente: tarefa de contato imediato criada para o responsável." : undefined,
      });
      setOpen(false);
      reset();
      router.push(`/marketing/leads?lead=${result.data.id}`, { scroll: false });
    });
  };

  const hasDups = dups.leads.length > 0 || dups.client !== null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Novo lead
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && changeOpen(v)}>
        <DialogContent size="lg">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>Novo lead</DialogTitle>
              <DialogDescription>O score e a temperatura são calculados pelas regras de lead scoring ao salvar.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              {hasDups || checking ? (
                <div className="rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm" role="status" aria-live="polite">
                  {checking && !hasDups ? (
                    <Spinner size="sm" label="Procurando duplicidades…" />
                  ) : (
                    <>
                      <p className="mb-1.5 flex items-center gap-2 font-semibold text-warning-fg">
                        <AlertTriangle className="size-4" /> Possível duplicidade
                      </p>
                      <ul className="flex flex-col gap-1">
                        {dups.leads.map((d) => (
                          <li key={d.id}>
                            Lead{" "}
                            <Link href={`/marketing/leads?lead=${d.id}`} target="_blank" className="font-medium text-brand hover:underline">
                              {d.name}
                              {d.company ? ` · ${d.company}` : ""}
                            </Link>{" "}
                            <span className="text-muted">
                              ({LEAD_STATUS_LABELS[d.status].toLowerCase()} · {d.reasons.join(", ")})
                            </span>
                          </li>
                        ))}
                        {dups.client ? (
                          <li>
                            Cliente{" "}
                            <Link href={`/clientes/${dups.client.id}`} target="_blank" className="font-medium text-brand hover:underline">
                              {dups.client.tradeName}
                            </Link>{" "}
                            <span className="text-muted">({dups.client.reasons.join(", ")}) — ao qualificar, o lead será vinculado a ele.</span>
                          </li>
                        ) : null}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
              <LeadFormFields value={form} onChange={change} options={options} idPrefix="new-lead" />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                {hasDups ? "Salvar mesmo assim" : "Cadastrar lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
