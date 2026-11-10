"use client";

/**
 * Ficha do lead → "Comprovantes do consentimento (LGPD)": lista (miniatura, quem anexou, quando, SHA-256), abrir,
 * baixar, anexar mais (sobe na hora, em partes) e remover com motivo (fica o registro). Botões conforme as chaves
 * (useMarketingAccess); o servidor confere tudo de novo.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, ExternalLink, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { CONSENT_EVIDENCE_MAX_FILES, CONSENT_EVIDENCE_REASON_MIN } from "@/domain/consent-evidence";
import { formatBytes } from "@/domain/stored-files";
import { removeLeadConsentEvidenceAction } from "@/server/marketing/actions";
import { EvidenceDropZone, EvidenceThumb, PendingEvidenceList, acceptEvidenceFiles, loadThumbnails, useLeaveGuard, type EvidenceUploadState, type PendingEvidence } from "./consent-evidence-input";
import { evidenceUrl, fetchEvidenceBlob, isDirectEvidence, saveBlob, uploadConsentEvidence, type ConsentEvidenceRow, type TransferProgress } from "./consent-evidence-transfer";
import { useMarketingAccess } from "./marketing-access";

function shortHash(sha256: string): string {
  const hex = sha256.replace(/^sha256:/, "");
  return `${hex.slice(0, 8)}…${hex.slice(-8)}`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ConsentEvidenceSection({ leadId, rows, consent }: { leadId: string; rows: readonly ConsentEvidenceRow[]; consent: boolean }) {
  const router = useRouter();
  const caps = useMarketingAccess().leads;
  const active = rows.filter((r) => r.status === "ativo");
  const removed = rows.filter((r) => r.status === "removido");
  const [queue, setQueue] = React.useState<PendingEvidence[]>([]);
  const [states, setStates] = React.useState<Record<string, EvidenceUploadState>>({});
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState<Record<string, TransferProgress>>({});
  const [removing, setRemoving] = React.useState<ConsentEvidenceRow | null>(null);
  const thumbs = React.useRef(new Map<string, string>());
  useLeaveGuard(busy);

  const setState = (key: string, state: EvidenceUploadState) => setStates((s) => ({ ...s, [key]: state }));

  /** Envia um por vez; os enviados saem da fila (a lista do servidor passa a mostrá-los), os que falharam ficam com o erro. */
  const upload = async (items: PendingEvidence[]) => {
    setBusy(true);
    const sent = new Set<string>();
    for (const item of items) {
      setState(item.key, { status: "enviando", progress: { done: 0, total: item.file.size } });
      try {
        await uploadConsentEvidence(leadId, item.file, { thumbnail: thumbs.current.get(item.key), onProgress: (progress) => setState(item.key, { status: "enviando", progress }) });
        sent.add(item.key);
        setState(item.key, { status: "enviado" });
      } catch (error) {
        setState(item.key, { status: "erro", error: errorText(error, "Falha no envio.") });
      }
    }
    setBusy(false);
    setQueue((q) => q.filter((p) => !sent.has(p.key)));
    if (sent.size) {
      toast.success(sent.size === 1 ? "Comprovante anexado" : `${sent.size} comprovantes anexados`, { description: "Guardado no INTEROS com o SHA-256 do arquivo e registrado no histórico do lead." });
      router.refresh();
    }
  };

  const add = (files: File[]) => {
    const room = CONSENT_EVIDENCE_MAX_FILES - active.length - queue.length;
    const accepted = acceptEvidenceFiles(files, queue, Math.max(0, room));
    if (!accepted.length) return;
    setQueue((q) => [...q, ...accepted]);
    setStates((s) => ({ ...s, ...Object.fromEntries(accepted.map((a) => [a.key, { status: "aguardando" } as EvidenceUploadState])) }));
    loadThumbnails(accepted, (key, thumbnail) => {
      thumbs.current.set(key, thumbnail);
      setQueue((q) => q.map((p) => (p.key === key ? { ...p, thumbnail } : p)));
    });
    void upload(accepted);
  };

  const retry = () => {
    const failed = queue.filter((p) => states[p.key]?.status === "erro");
    if (failed.length) void upload(failed);
  };

  const dismiss = (key: string) => setQueue((q) => q.filter((p) => p.key !== key));

  /** Arquivo grande: remonta parte a parte (com progresso) e abre numa aba nova ou baixa. */
  const openLarge = async (row: ConsentEvidenceRow, mode: "abrir" | "baixar") => {
    const win = mode === "abrir" ? window.open("", "_blank") : null;
    if (win) win.document.write(`<p style="font-family:system-ui,sans-serif;padding:24px">Carregando o comprovante…</p>`);
    setLoading((l) => ({ ...l, [row.id]: { done: 0, total: row.size } }));
    try {
      const blob = await fetchEvidenceBlob(leadId, row, (progress) => setLoading((l) => ({ ...l, [row.id]: progress })));
      if (win && !win.closed) {
        const url = URL.createObjectURL(blob);
        win.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
      } else {
        saveBlob(blob, row.name);
      }
    } catch (error) {
      win?.close();
      toast.error(errorText(error, "Não foi possível abrir o comprovante."));
    } finally {
      setLoading((l) => {
        const next = { ...l };
        delete next[row.id];
        return next;
      });
    }
  };

  const failedCount = queue.filter((p) => states[p.key]?.status === "erro").length;

  return (
    <section aria-labelledby="lead-consent-evidence">
      <h3 id="lead-consent-evidence" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-muted" /> Comprovantes do consentimento (LGPD)
        {active.length ? (
          <Badge variant="outline" size="sm">
            {active.length}
          </Badge>
        ) : null}
      </h3>

      {consent && !active.length ? (
        <p className="mb-2 flex items-start gap-2 text-xs text-warning-fg">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Consentimento marcado sem comprovante. Anexe o print, o termo, o áudio ou o e-mail em que o contato autoriza.
        </p>
      ) : null}

      {caps.attachConsent ? (
        <EvidenceDropZone onFiles={add} disabled={busy || active.length >= CONSENT_EVIDENCE_MAX_FILES} label={active.length ? "Anexar mais" : "Anexar comprovante"} className="mb-3">
          {queue.length ? (
            <>
              <PendingEvidenceList items={queue} states={states} onRemove={busy ? undefined : dismiss} disabled={busy} />
              {failedCount && !busy ? (
                <div>
                  <Button type="button" size="sm" variant="outline" onClick={retry}>
                    <RotateCcw /> Tentar de novo ({failedCount})
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </EvidenceDropZone>
      ) : null}

      {active.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {active.map((row) => {
            const progress = loading[row.id];
            const direct = isDirectEvidence(row);
            const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
            return (
              <li key={row.id} className="flex gap-3 rounded-lg border border-border p-2.5">
                {row.inline && direct ? (
                  <a href={evidenceUrl(leadId, row.id)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${row.name}`} className="shrink-0">
                    <EvidenceThumb thumbnail={row.thumbnail} mimeType={row.mimeType} className="size-14" />
                  </a>
                ) : (
                  <EvidenceThumb thumbnail={row.thumbnail} mimeType={row.mimeType} className="size-14" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={row.name}>
                    {row.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatBytes(row.size)} · {row.uploadedByName} · {formatDateTime(row.completedAt)}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-light" title={`SHA-256 (identificador do conteúdo): ${row.sha256.replace(/^sha256:/, "")}`}>
                    SHA-256 {shortHash(row.sha256)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {row.inline ? (
                      direct ? (
                        <a href={evidenceUrl(leadId, row.id)} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-xs font-medium hover:bg-surface-hover">
                          <ExternalLink className="size-3.5" /> Abrir
                        </a>
                      ) : (
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={Boolean(progress)} onClick={() => void openLarge(row, "abrir")}>
                          <ExternalLink /> Abrir
                        </Button>
                      )
                    ) : null}
                    {direct ? (
                      <a href={evidenceUrl(leadId, row.id, true)} download={row.name} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-xs font-medium hover:bg-surface-hover">
                        <Download className="size-3.5" /> Baixar
                      </a>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={Boolean(progress)} onClick={() => void openLarge(row, "baixar")}>
                        <Download /> Baixar
                      </Button>
                    )}
                    {row.removable ? (
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-danger-fg" onClick={() => setRemoving(row)}>
                        <Trash2 /> Remover
                      </Button>
                    ) : null}
                  </div>
                  {progress ? <Progress value={pct} size="sm" className="mt-1.5" aria-label={`Carregando ${row.name}`} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : !caps.attachConsent ? (
        <p className="text-sm text-muted">Nenhum comprovante anexado.</p>
      ) : null}

      {removed.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-muted">
            {removed.length === 1 ? "1 comprovante removido" : `${removed.length} comprovantes removidos`} (registro)
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {removed.map((row) => (
              <li key={row.id} className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
                <p className="font-medium">{row.name}</p>
                <p className="text-muted">
                  Anexado por {row.uploadedByName} em {formatDateTime(row.completedAt)} · removido por {row.removedByName ?? "—"}
                  {row.removedAt ? ` em ${formatDateTime(row.removedAt)}` : ""}
                </p>
                {row.removedReason ? <p className="text-muted">Motivo: {row.removedReason}</p> : null}
                <p className="truncate font-mono text-[11px] text-muted-light" title={row.sha256}>
                  SHA-256 {shortHash(row.sha256)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <RemoveEvidenceDialog
        leadId={leadId}
        row={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          router.refresh();
        }}
      />
    </section>
  );
}

function RemoveEvidenceDialog({ leadId, row, onClose, onRemoved }: { leadId: string; row: ConsentEvidenceRow | null; onClose: () => void; onRemoved: () => void }) {
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [prevRow, setPrevRow] = React.useState(row);
  if (row !== prevRow) {
    setPrevRow(row);
    setReason("");
  }
  const valid = reason.trim().length >= CONSENT_EVIDENCE_REASON_MIN;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!row || !valid) return;
    startTransition(async () => {
      const result = await removeLeadConsentEvidenceAction({ leadId, fileId: row.id, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Comprovante removido", { description: "O arquivo foi apagado; o registro da remoção fica no histórico do lead." });
      onRemoved();
    });
  };

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Remover comprovante</DialogTitle>
            <DialogDescription>
              {row ? `"${row.name}" será apagado do INTEROS. ` : ""}Ficam registrados no histórico do lead o nome do arquivo, o SHA-256, quem removeu, quando e o motivo.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Motivo da remoção" htmlFor="remove-evidence-reason" required hint="Ex.: arquivo de outro contato anexado por engano.">
              <Textarea id="remove-evidence-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[72px]" autoFocus />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" loading={pending} disabled={!valid}>
              Remover
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
