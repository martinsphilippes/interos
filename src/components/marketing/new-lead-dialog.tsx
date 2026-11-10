"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, RotateCcw } from "lucide-react";
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
import { TransferError, uploadConsentEvidence } from "./consent-evidence-transfer";
import { useMarketingAccess } from "./marketing-access";

interface DuplicateState {
  leads: LeadDuplicate[];
  client: { id: string; tradeName: string; reasons: string[] } | null;
}

/**
 * "Novo lead" com detecção de duplicidade em tempo real (telefone, e-mail e empresa) e comprovantes do consentimento
 * LGPD: escolhidos no formulário e enviados (em partes) logo depois de salvar. Com comprovantes, a janela passa para
 * "Lead cadastrado" e acompanha o envio; o que falhar fica na tela para tentar de novo (nada se perde ao fechar).
 */
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
  const canAttach = useMarketingAccess().leads.attachConsent;
  const [evidence, setEvidence] = React.useState<PendingEvidence[]>([]);
  const [uploadStates, setUploadStates] = React.useState<Record<string, EvidenceUploadState>>({});
  const [uploading, setUploading] = React.useState<{ index: number; count: number } | null>(null);
  /** Lead já cadastrado: a janela mostra o envio dos comprovantes (e o que falhou). */
  const [created, setCreated] = React.useState<{ id: string } | null>(null);
  const abort = React.useRef<AbortController | null>(null);
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
    setCreated(null);
  };

  /** Fecha e abre a ficha do lead recém-cadastrado. */
  const finish = (leadId: string) => {
    changeOpen(false);
    reset();
    router.push(`/marketing/leads?lead=${leadId}`, { scroll: false });
  };

  const addEvidence = (files: File[]) => {
    const accepted = acceptEvidenceFiles(files, evidence, CONSENT_EVIDENCE_MAX_FILES - evidence.length);
    if (!accepted.length) return;
    setEvidence((list) => [...list, ...accepted]);
    loadThumbnails(accepted, (key, thumbnail) => setEvidence((list) => list.map((p) => (p.key === key ? { ...p, thumbnail } : p))));
  };

  const setState = (key: string, state: EvidenceUploadState) => setUploadStates((s) => ({ ...s, [key]: state }));

  /** Envia os comprovantes, um por vez (cancelável). Devolve quantos foram enviados. */
  const runUploads = async (leadId: string, items: readonly PendingEvidence[]): Promise<number> => {
    const controller = new AbortController();
    abort.current = controller;
    setUploadStates((s) => ({ ...s, ...Object.fromEntries(items.map((item) => [item.key, { status: "aguardando" } as EvidenceUploadState])) }));
    let sent = 0;
    for (const [index, item] of items.entries()) {
      if (controller.signal.aborted) {
        setState(item.key, { status: "erro", error: "Envio cancelado.", retryable: true });
        continue;
      }
      setUploading({ index, count: items.length });
      setState(item.key, { status: "enviando", progress: { done: 0, total: item.file.size } });
      try {
        const row = await uploadConsentEvidence(leadId, item.file, { signal: controller.signal, onProgress: (progress) => setState(item.key, { status: "enviando", progress }) });
        setState(item.key, { status: "enviado", fileId: row.id });
        sent += 1;
      } catch (error) {
        setState(item.key, { status: "erro", error: error instanceof Error && error.message ? error.message : "Falha no envio.", retryable: !(error instanceof TransferError) || error.retryable });
      }
    }
    setUploading(null);
    abort.current = null;
    return sent;
  };

  /** Avisa o que foi enviado; tudo enviado → fecha e abre a ficha. Com falha, a janela fica para tentar de novo. */
  const afterUploads = (leadId: string, sent: number, allDone: boolean) => {
    if (sent) toast.success(sent === 1 ? "Comprovante do consentimento anexado" : `${sent} comprovantes do consentimento anexados`);
    if (allDone) finish(leadId);
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
      if (!evidence.length) {
        finish(result.data.id);
        return;
      }
      setCreated({ id: result.data.id });
      const sent = await runUploads(result.data.id, evidence);
      afterUploads(result.data.id, sent, sent === evidence.length);
    });
  };

  const failed = evidence.filter((p) => uploadStates[p.key]?.status === "erro");
  const retryable = failed.filter((p) => uploadStates[p.key]?.retryable);
  const retry = () => {
    if (!created || !retryable.length) return;
    const items = retryable;
    // Falhas que não adianta repetir (tipo, limite, já anexado) continuam na tela.
    const permanent = failed.length - retryable.length;
    startTransition(async () => {
      const sent = await runUploads(created.id, items);
      afterUploads(created.id, sent, sent === items.length && permanent === 0);
    });
  };

  const hasDups = dups.leads.length > 0 || dups.client !== null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Novo lead
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (pending) return;
          // Lead já cadastrado: fechar leva à ficha (os comprovantes que faltaram podem ser anexados lá).
          if (!v && created) finish(created.id);
          else changeOpen(v);
        }}
      >
        <DialogContent size="lg">
          {created ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <DialogHeader>
                <DialogTitle>Lead cadastrado</DialogTitle>
                <DialogDescription role="status" aria-live="polite">
                  {uploading
                    ? `Enviando os comprovantes do consentimento (${uploading.index + 1} de ${uploading.count})… Não feche a página.`
                    : failed.length
                      ? retryable.length
                        ? "Alguns comprovantes não foram enviados. Tente de novo ou anexe depois, na ficha do lead."
                        : "Alguns comprovantes não foram aceitos (veja o motivo). Você pode anexar outros na ficha do lead."
                      : "Comprovantes enviados."}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-3">
                <PendingEvidenceList items={evidence} states={uploadStates} onRemove={pending ? undefined : (key) => setEvidence((list) => list.filter((p) => p.key !== key))} disabled={pending} />
              </DialogBody>
              <DialogFooter>
                {pending ? (
                  <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
                    Cancelar envio
                  </Button>
                ) : (
                  <>
                    {retryable.length ? (
                      <Button type="button" variant="outline" onClick={retry}>
                        <RotateCcw /> Tentar de novo ({retryable.length})
                      </Button>
                    ) : null}
                    <Button type="button" onClick={() => finish(created.id)}>
                      Ir para o lead
                    </Button>
                  </>
                )}
              </DialogFooter>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="flex min-h-0 flex-1 flex-col"
              onPaste={(e) => {
                // Ctrl+V de um print em qualquer ponto do formulário vira comprovante (a área de comprovantes já trata o dela).
                if (!canAttach || pending || e.isDefaultPrevented()) return;
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
                          <PendingEvidenceList items={evidence} onRemove={(key) => setEvidence((list) => list.filter((p) => p.key !== key))} disabled={pending} />
                        </EvidenceDropZone>
                        {!form.consent && evidence.length ? (
                          <p className="text-xs text-warning-fg">O consentimento está desligado: os arquivos ficam guardados como registro do contato mesmo assim.</p>
                        ) : null}
                      </div>
                    ) : null
                  }
                />
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
