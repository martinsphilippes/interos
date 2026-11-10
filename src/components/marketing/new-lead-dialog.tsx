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
import { ScreenLink } from "@/components/auth/access-provider";
import { CONSENT_EVIDENCE_MAX_FILES } from "@/domain/consent-evidence";
import { EvidenceDropZone, PendingEvidenceList, acceptEvidenceFiles, filesFromPaste, loadThumbnails, useLeaveGuard, type EvidenceUploadState, type PendingEvidence } from "./consent-evidence-input";
import { uploadConsentEvidence } from "./consent-evidence-transfer";
import { useMarketingAccess } from "./marketing-access";

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
  // Comprovantes do consentimento: escolhidos aqui, enviados (em partes) logo depois de salvar o lead.
  const canAttach = useMarketingAccess().leads.attachConsent;
  const [evidence, setEvidence] = React.useState<PendingEvidence[]>([]);
  const [uploadStates, setUploadStates] = React.useState<Record<string, EvidenceUploadState>>({});
  const [uploading, setUploading] = React.useState<{ index: number; count: number } | null>(null);
  const thumbs = React.useRef(new Map<string, string>());
  useLeaveGuard(uploading !== null);
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
    setEvidence([]);
    setUploadStates({});
    thumbs.current.clear();
  };

  const addEvidence = (files: File[]) => {
    const accepted = acceptEvidenceFiles(files, evidence, CONSENT_EVIDENCE_MAX_FILES - evidence.length);
    if (!accepted.length) return;
    setEvidence((list) => [...list, ...accepted]);
    loadThumbnails(accepted, (key, thumbnail) => {
      thumbs.current.set(key, thumbnail);
      setEvidence((list) => list.map((p) => (p.key === key ? { ...p, thumbnail } : p)));
    });
  };

  /** Envia os comprovantes do lead recém-criado, um por vez. Devolve os que falharam (nome: motivo). */
  const uploadEvidence = async (leadId: string): Promise<string[]> => {
    const failures: string[] = [];
    for (const [index, item] of evidence.entries()) {
      setUploading({ index, count: evidence.length });
      setUploadStates((s) => ({ ...s, [item.key]: { status: "enviando", progress: { done: 0, total: item.file.size } } }));
      try {
        await uploadConsentEvidence(leadId, item.file, {
          thumbnail: thumbs.current.get(item.key),
          onProgress: (progress) => setUploadStates((s) => ({ ...s, [item.key]: { status: "enviando", progress } })),
        });
        setUploadStates((s) => ({ ...s, [item.key]: { status: "enviado" } }));
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "Falha no envio.";
        failures.push(`${item.file.name}: ${message}`);
        setUploadStates((s) => ({ ...s, [item.key]: { status: "erro", error: message } }));
      }
    }
    setUploading(null);
    return failures;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createLeadAction(leadFormPayload(form));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const failures = evidence.length ? await uploadEvidence(result.data.id) : [];
      const sent = evidence.length - failures.length;
      toast.success(`Lead cadastrado · score ${result.data.score} (${TEMPERATURE_LABELS[result.data.temperature].toLowerCase()})`, {
        description:
          [result.data.temperature === "quente" ? "Lead quente: tarefa de contato imediato criada para o responsável." : "", sent ? (sent === 1 ? "1 comprovante do consentimento anexado." : `${sent} comprovantes do consentimento anexados.`) : ""]
            .filter(Boolean)
            .join(" ") || undefined,
      });
      if (failures.length) {
        toast.error(failures.length === 1 ? "Um comprovante não foi enviado" : `${failures.length} comprovantes não foram enviados`, {
          description: `${failures.slice(0, 3).join(" · ")} — anexe de novo na ficha do lead.`,
          duration: 12_000,
        });
      }
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
          <form
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col"
            onPaste={(e) => {
              // Ctrl+V de um print em qualquer ponto do formulário vira comprovante.
              if (!canAttach || pending) return;
              const files = filesFromPaste(e);
              if (!files.length) return;
              e.preventDefault();
              addEvidence(files);
            }}
            onDragOver={(e) => {
              if (canAttach && !pending && e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              // Arquivo solto em qualquer ponto do formulário (a área de comprovantes já trata o dela).
              if (!canAttach || pending || e.isDefaultPrevented()) return;
              const files = Array.from(e.dataTransfer.files ?? []);
              if (!files.length) return;
              e.preventDefault();
              addEvidence(files);
            }}
          >
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
                            {d.restricted ? (
                              // Fora do escopo do usuário: só o aviso (sem dados nem link).
                              <span className="font-medium">{d.name}</span>
                            ) : (
                              <Link href={`/marketing/leads?lead=${d.id}`} target="_blank" className="font-medium text-brand hover:underline">
                                {d.name}
                                {d.company ? ` · ${d.company}` : ""}
                              </Link>
                            )}{" "}
                            <span className="text-muted">
                              ({LEAD_STATUS_LABELS[d.status].toLowerCase()} · {d.reasons.join(", ")})
                            </span>
                          </li>
                        ))}
                        {dups.client ? (
                          <li>
                            Cliente{" "}
                            {dups.client.id ? (
                              <ScreenLink href={`/clientes/${dups.client.id}`} target="_blank" className="font-medium text-brand hover:underline" fallback={<span className="font-medium">{dups.client.tradeName}</span>}>
                                {dups.client.tradeName}
                              </ScreenLink>
                            ) : (
                              <span className="font-medium">{dups.client.tradeName}</span>
                            )}{" "}
                            <span className="text-muted">({dups.client.reasons.join(", ")}) — ao qualificar, o lead será vinculado a ele.</span>
                          </li>
                        ) : null}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
              <LeadFormFields
                value={form}
                onChange={change}
                options={options}
                idPrefix="new-lead"
                consentExtra={
                  canAttach ? (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[13px] font-medium">Comprovantes do consentimento</p>
                      <EvidenceDropZone onFiles={addEvidence} disabled={pending || evidence.length >= CONSENT_EVIDENCE_MAX_FILES}>
                        <PendingEvidenceList items={evidence} states={uploadStates} onRemove={(key) => setEvidence((list) => list.filter((p) => p.key !== key))} disabled={pending} />
                      </EvidenceDropZone>
                    </div>
                  ) : null
                }
              />
            </DialogBody>
            <DialogFooter>
              {uploading ? (
                <p className="mr-auto self-center text-xs text-muted" role="status" aria-live="polite">
                  Enviando comprovante {uploading.index + 1} de {uploading.count}…
                </p>
              ) : null}
              <Button variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                {uploading ? "Enviando comprovantes…" : hasDups ? "Salvar mesmo assim" : "Cadastrar lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
