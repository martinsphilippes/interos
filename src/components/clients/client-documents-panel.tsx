"use client";

/**
 * Aba Documentos do Cliente 360º: enviar arquivos (vários de uma vez, em partes, com nome e categoria sugeridos pelo
 * nome do arquivo), registrar link, conferir os documentos de cadastro (contrato social, cartão CNPJ), abrir, baixar e
 * remover com motivo (fica o registro). Botões conforme as chaves; o servidor confere tudo de novo.
 * Regras em src/domain/client-documents.ts; servidor em src/server/clients/documents.ts.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Download, ExternalLink, FileText, Link2, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SectionTitle } from "@/components/ui/section-title";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_CATEGORIES,
  CLIENT_DOCUMENT_MAX_BATCH,
  CLIENT_DOCUMENT_MAX_BYTES,
  CLIENT_DOCUMENT_REASON_MIN,
  CLIENT_DOCUMENT_THUMB_MAX_CHARS,
  CLIENT_DOCUMENT_TITLE_MAX,
  CLIENT_DOCUMENT_TITLE_MIN,
  CLIENT_ESSENTIAL_DOCUMENTS,
  clientDocumentExtensionFor,
  clientDocumentMimeType,
  clientDocumentProblem,
  suggestDocumentCategory,
  suggestDocumentTitle,
} from "@/domain/client-documents";
import { formatBytes } from "@/domain/stored-files";
import { removeClientDocumentAction } from "@/server/clients/actions";
import type { ClientDocumentRow } from "@/server/clients/documents";
import { FileDropZone, FileKindIcon, FileThumb, useLeaveGuard } from "@/components/files/file-drop-zone";
import { TransferError, imageThumbnail, normalizePickedFile, sha256OfBlob, uploadInParts, type TransferProgress } from "@/components/files/stored-file-transfer";
import { DocumentLinkForm } from "./document-form";

interface PendingDocument {
  key: string;
  file: File;
  mimeType: string;
  title: string;
  category: string;
  thumbnail?: string;
}

interface UploadState {
  status: "aguardando" | "enviando" | "enviado" | "erro";
  progress?: TransferProgress;
  error?: string;
  /** Vale tentar de novo (rede, conexão parada, cancelado); regra de negócio não. */
  retryable?: boolean;
  /** Documento criado (envio concluído). */
  docId?: string;
}

interface UserName {
  name: string;
}

let keySeq = 0;

/**
 * Valida e prepara os arquivos escolhidos: nome final (print colado ganha data), tipo e tamanho aceitos, sem repetir um
 * já escolhido e até o limite por vez; nome e categoria sugeridos pelo nome do arquivo (ou a categoria do atalho).
 */
function acceptDocumentFiles(files: readonly File[], current: readonly PendingDocument[], presetCategory: string | null): { accepted: PendingDocument[]; problems: string[] } {
  const problems: string[] = [];
  const accepted: PendingDocument[] = [];
  const seen = new Set(current.map((p) => `${p.file.name}|${p.file.size}|${p.file.lastModified}`));
  let room = CLIENT_DOCUMENT_MAX_BATCH - current.length;
  for (const raw of files) {
    const file = normalizePickedFile(raw, clientDocumentMimeType, clientDocumentExtensionFor);
    const problem = clientDocumentProblem(file);
    if (problem) {
      problems.push(`${file.name}: ${problem}`);
      continue;
    }
    const id = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(id)) continue;
    if (room <= 0) {
      problems.push(`${file.name}: escolha até ${CLIENT_DOCUMENT_MAX_BATCH} arquivos por vez.`);
      continue;
    }
    seen.add(id);
    room -= 1;
    keySeq += 1;
    // Pelo atalho do cadastro ("Falta contrato social"), o nome é o da categoria; senão, vem do nome do arquivo.
    const category = presetCategory ?? suggestDocumentCategory(file.name);
    accepted.push({
      key: `doc-${keySeq}`,
      file,
      mimeType: clientDocumentMimeType(file.name) ?? "",
      title: presetCategory ?? suggestDocumentTitle(file.name, category),
      category,
    });
  }
  return { accepted, problems };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function apiBase(clientId: string): string {
  return `/api/clientes/${encodeURIComponent(clientId)}/documentos`;
}

function titleProblem(title: string): string | null {
  const length = title.trim().length;
  if (length < CLIENT_DOCUMENT_TITLE_MIN) return "Informe o nome do documento.";
  if (length > CLIENT_DOCUMENT_TITLE_MAX) return `Nome muito longo (máximo de ${CLIENT_DOCUMENT_TITLE_MAX} caracteres).`;
  return null;
}

export interface ClientDocumentsPanelProps {
  clientId: string;
  clientName: string;
  rows: readonly ClientDocumentRow[];
  users: Readonly<Record<string, UserName>>;
  canAttach: boolean;
}

export function ClientDocumentsPanel({ clientId, clientName, rows, users, canAttach }: ClientDocumentsPanelProps) {
  const router = useRouter();
  const active = rows.filter((r) => r.status === "ativo");
  const removed = rows.filter((r) => r.status === "removido");
  const [mode, setMode] = React.useState<"arquivos" | "link">("arquivos");
  const [queue, setQueue] = React.useState<PendingDocument[]>([]);
  const [states, setStates] = React.useState<Record<string, UploadState>>({});
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<ClientDocumentRow | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  /** Categoria escolhida no atalho "Enviar contrato social": vale para os arquivos escolhidos em seguida. */
  const preset = React.useRef<string | null>(null);
  useLeaveGuard(busy);

  const setState = (key: string, state: UploadState) => setStates((s) => ({ ...s, [key]: state }));
  // Enviados continuam na fila até a lista do servidor trazê-los (não somem por um instante entre as duas listas).
  const shownQueue = queue.filter((p) => {
    const docId = states[p.key]?.docId;
    return !docId || !rows.some((r) => r.id === docId);
  });
  const toSend = shownQueue.filter((p) => !states[p.key] || (states[p.key].status === "erro" && states[p.key].retryable));
  const blocked = shownQueue.filter((p) => states[p.key]?.status === "erro" && !states[p.key]?.retryable);

  const add = (files: File[]) => {
    const presetCategory = preset.current;
    preset.current = null;
    const { accepted, problems } = acceptDocumentFiles(files, shownQueue, presetCategory);
    if (problems.length) toast.error(problems.length === 1 ? "Arquivo não incluído" : `${problems.length} arquivos não incluídos`, { description: problems.slice(0, 4).join(" · ") });
    if (!accepted.length) return;
    setQueue((q) => [...q, ...accepted]);
    // Miniaturas das imagens, uma de cada vez (fotos grandes não disputam a memória).
    void (async () => {
      for (const item of accepted) {
        const thumbnail = await imageThumbnail(item.file, item.mimeType, CLIENT_DOCUMENT_THUMB_MAX_CHARS);
        if (thumbnail) setQueue((q) => q.map((p) => (p.key === item.key ? { ...p, thumbnail } : p)));
      }
    })();
  };

  const edit = (key: string, patch: Partial<Pick<PendingDocument, "title" | "category">>) => setQueue((q) => q.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const dismiss = (key: string) => setQueue((q) => q.filter((p) => p.key !== key));

  /**
   * Envia um por vez (cada arquivo em partes de 2 MB). Os que falharam ficam com o erro (e "Tentar de novo" quando
   * adianta); o resultado sempre vira aviso.
   */
  const send = async (items: PendingDocument[]) => {
    const invalid = items.map((p) => ({ p, problem: titleProblem(p.title) })).filter((x) => x.problem);
    if (invalid.length) {
      toast.error("Confira o nome dos documentos", { description: invalid.map((x) => `${x.p.file.name}: ${x.problem}`).slice(0, 3).join(" · ") });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setStates((s) => ({ ...s, ...Object.fromEntries(items.map((p) => [p.key, { status: "aguardando" } as UploadState])) }));
    let sent = 0;
    const failures: string[] = [];
    for (const item of items) {
      if (controller.signal.aborted) {
        setState(item.key, { status: "erro", error: "Envio cancelado.", retryable: true });
        continue;
      }
      setState(item.key, { status: "enviando", progress: { done: 0, total: item.file.size } });
      try {
        const sha256 = await sha256OfBlob(item.file);
        const row = await uploadInParts<ClientDocumentRow>(
          apiBase(clientId),
          item.file,
          { name: item.file.name, size: item.file.size, sha256 },
          { complete: { title: item.title.trim(), category: item.category }, signal: controller.signal, onProgress: (progress) => setState(item.key, { status: "enviando", progress }) },
        );
        sent += 1;
        setState(item.key, { status: "enviado", docId: row.id });
      } catch (error) {
        const message = errorText(error, "Falha no envio.");
        failures.push(`${item.file.name}: ${message}`);
        setState(item.key, { status: "erro", error: message, retryable: !(error instanceof TransferError) || error.retryable });
      }
    }
    abort.current = null;
    setBusy(false);
    if (sent) {
      toast.success(sent === 1 ? `Documento enviado para ${clientName}` : `${sent} documentos enviados para ${clientName}`, {
        description: "Guardado no INTEROS e registrado no histórico do cliente.",
      });
      router.refresh();
    }
    if (failures.length) {
      toast.error(failures.length === 1 ? "Um documento não foi enviado" : `${failures.length} documentos não foram enviados`, { description: failures.slice(0, 3).join(" · "), duration: 12_000 });
    }
  };

  /** Atalho do que falta no cadastro: abre o seletor já com a categoria. */
  const pickFor = (category: string) => {
    preset.current = category;
    setMode("arquivos");
    // O seletor só existe no modo "arquivos": espera a tela trocar de modo antes de abrir.
    requestAnimationFrame(() => picker.current?.click());
  };

  const essentials = CLIENT_ESSENTIAL_DOCUMENTS.map((category) => ({
    category,
    done: active.some((r) => r.category === category),
    queued: shownQueue.some((p) => p.category === category),
  }));

  return (
    <div className="flex flex-col gap-5">
      {canAttach ? (
        <Card className="p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight">
                <UploadCloud className="size-4 text-muted" aria-hidden /> Adicionar documentos
              </h2>
              <p className="mt-0.5 text-xs text-muted">Contrato social, cartão CNPJ, documentos dos sócios, comprovantes, contratos… Vários arquivos de uma vez.</p>
            </div>
            <SegmentedControl
              size="sm"
              aria-label="Como adicionar"
              value={mode}
              onChange={setMode}
              options={[
                { value: "arquivos", label: "Enviar arquivos", icon: <UploadCloud /> },
                { value: "link", label: "Registrar link", icon: <Link2 /> },
              ]}
            />
          </div>

          {mode === "link" ? (
            <>
              <p className="mb-3 text-xs text-muted">Para arquivos que ficam em outro sistema (Google Drive, plataforma de assinatura, ERP): o documento fica referenciado pelo link.</p>
              <DocumentLinkForm clientId={clientId} />
            </>
          ) : (
            <FileDropZone
              onFiles={add}
              disabled={busy}
              label={shownQueue.length ? "Escolher mais arquivos" : "Escolher arquivos"}
              accept={`${CLIENT_DOCUMENT_ACCEPT},image/*`}
              hint={`PDF, imagem, Word, Excel, XML, ZIP ou e-mail · até ${formatBytes(CLIENT_DOCUMENT_MAX_BYTES)} cada. O nome e a categoria vêm do nome do arquivo; ajuste antes de enviar.`}
              inputRef={picker}
            >
              {shownQueue.length ? (
                <>
                  <ul className="flex flex-col gap-2" aria-label="Arquivos escolhidos">
                    {shownQueue.map((item) => (
                      <PendingRow key={item.key} item={item} state={states[item.key]} disabled={busy} onEdit={(patch) => edit(item.key, patch)} onRemove={busy ? undefined : () => dismiss(item.key)} />
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2">
                    {busy ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => abort.current?.abort()}>
                        <X /> Cancelar envio
                      </Button>
                    ) : toSend.length ? (
                      <Button type="button" size="sm" onClick={() => void send(toSend)}>
                        {toSend.some((p) => states[p.key]?.status === "erro") ? <RotateCcw /> : <UploadCloud />}
                        {toSend.some((p) => states[p.key]?.status === "erro")
                          ? `Tentar de novo (${toSend.length})`
                          : toSend.length === 1
                            ? "Enviar documento"
                            : `Enviar ${toSend.length} documentos`}
                      </Button>
                    ) : null}
                    {!busy && blocked.length ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setQueue((q) => q.filter((p) => !blocked.includes(p)))}>
                        Tirar os não enviados ({blocked.length})
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </FileDropZone>
          )}
        </Card>
      ) : null}

      <section aria-labelledby="client-documents-title">
        <SectionTitle title={<span id="client-documents-title">Documentos</span>} count={active.length} />
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" aria-label="Documentos de cadastro">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Cadastro</span>
          {essentials.map((e) =>
            e.done ? (
              <span key={e.category} className="inline-flex items-center gap-1 text-success-fg">
                <CheckCircle2 className="size-4" aria-hidden /> {e.category}
              </span>
            ) : canAttach && !e.queued ? (
              <button key={e.category} type="button" onClick={() => pickFor(e.category)} disabled={busy} className="inline-flex items-center gap-1 text-warning-fg hover:underline disabled:opacity-60">
                <CircleDashed className="size-4" aria-hidden /> Falta {e.category.toLowerCase()} · enviar
              </button>
            ) : (
              <span key={e.category} className="inline-flex items-center gap-1 text-muted">
                <CircleDashed className="size-4" aria-hidden /> {e.queued ? `${e.category} na fila` : `Falta ${e.category.toLowerCase()}`}
              </span>
            ),
          )}
        </div>
        <Card className="overflow-hidden">
          {active.length === 0 ? (
            <EmptyState size="sm" icon={<FileText />} title="Nenhum documento" description="Contrato social, cartão CNPJ, contratos, propostas e comprovantes do cliente ficam aqui, com versão e histórico." />
          ) : (
            <ul className="divide-y divide-border">
              {active.map((row) => (
                <DocumentRow key={row.id} row={row} uploader={users[row.uploadedBy]?.name} onRemove={() => setRemoving(row)} />
              ))}
            </ul>
          )}
        </Card>
        {removed.length ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-muted">{removed.length === 1 ? "1 documento removido" : `${removed.length} documentos removidos`} (registro)</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {removed.map((row) => (
                <li key={row.id} className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
                  <p className="font-medium">
                    {row.name}
                    {row.version > 1 ? ` (v${row.version})` : ""}
                    {row.category ? <span className="font-normal text-muted"> · {row.category}</span> : null}
                  </p>
                  <p className="text-muted">
                    {row.kind === "arquivo" ? `Arquivo ${row.fileName ?? ""}${row.size ? ` (${formatBytes(row.size)})` : ""}` : "Link"} enviado por {users[row.uploadedBy]?.name ?? "—"} em {formatDateTime(row.createdAt)} · removido por{" "}
                    {row.removedByName ?? "—"}
                    {row.removedAt ? ` em ${formatDateTime(row.removedAt)}` : ""}
                  </p>
                  {row.removedReason ? <p className="text-muted">Motivo: {row.removedReason}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <RemoveDocumentDialog
        clientId={clientId}
        row={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function PendingRow({
  item,
  state,
  disabled,
  onEdit,
  onRemove,
}: {
  item: PendingDocument;
  state?: UploadState;
  disabled: boolean;
  onEdit: (patch: Partial<Pick<PendingDocument, "title" | "category">>) => void;
  onRemove?: () => void;
}) {
  const id = React.useId();
  const pct = state?.progress && state.progress.total > 0 ? Math.round((state.progress.done / state.progress.total) * 100) : 0;
  const locked = disabled || state?.status === "enviando" || state?.status === "enviado";
  const categories: readonly string[] = CLIENT_DOCUMENT_CATEGORIES.includes(item.category as (typeof CLIENT_DOCUMENT_CATEGORIES)[number]) ? CLIENT_DOCUMENT_CATEGORIES : [item.category, ...CLIENT_DOCUMENT_CATEGORIES];
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-surface p-2.5">
      <FileThumb thumbnail={item.thumbnail} mimeType={item.mimeType} className="mt-5 hidden sm:flex" />
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
        <FormField label="Nome do documento" htmlFor={`${id}-title`} className="min-w-0">
          <Input id={`${id}-title`} value={item.title} maxLength={CLIENT_DOCUMENT_TITLE_MAX} disabled={locked} onChange={(e) => onEdit({ title: e.target.value })} />
        </FormField>
        <FormField label="Categoria" htmlFor={`${id}-category`}>
          <Select id={`${id}-category`} value={item.category} disabled={locked} onChange={(e) => onEdit({ category: e.target.value })} options={categories.map((c) => ({ value: c, label: c }))} />
        </FormField>
        <div className="min-w-0 sm:col-span-2">
          <p className="truncate text-xs text-muted" title={item.file.name}>
            {item.file.name} · {formatBytes(item.file.size)}
            {state?.status === "enviando" ? ` · enviando ${pct}%` : state?.status === "enviado" ? " · enviado" : state?.status === "aguardando" ? " · na fila" : ""}
          </p>
          {state?.status === "enviando" ? <Progress value={pct} size="sm" className="mt-1" aria-label={`Enviando ${item.file.name}`} /> : null}
          {state?.status === "erro" ? <p className="text-xs text-danger-fg">{state.error}</p> : null}
        </div>
      </div>
      {onRemove && (!state || state.status === "erro") ? (
        <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" onClick={onRemove} aria-label={`Tirar ${item.file.name}`}>
          <X />
        </Button>
      ) : null}
    </li>
  );
}

function DocumentRow({ row, uploader, onRemove }: { row: ClientDocumentRow; uploader?: string; onRemove: () => void }) {
  const isFile = row.kind === "arquivo";
  const meta = [
    row.category,
    isFile ? `${(row.fileName?.split(".").pop() ?? "").toUpperCase()}${row.size ? ` · ${formatBytes(row.size)}` : ""}` : "Link externo",
    uploader ? `por ${uploader}` : undefined,
    formatDateTime(row.createdAt),
  ].filter(Boolean);
  const action = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-xs font-medium hover:bg-surface-hover";
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-muted">
          {isFile ? <FileKindIcon mimeType={row.mimeType ?? ""} className="size-4" /> : <Link2 className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-words text-sm font-medium">{row.name}</span>
            {row.version > 1 ? (
              <Badge variant="muted" size="sm">
                v{row.version}
              </Badge>
            ) : null}
            {row.linkedTo ? (
              <Badge variant="outline" size="sm">
                {row.linkedTo}
              </Badge>
            ) : null}
          </p>
          <p className="text-xs text-muted">{meta.join(" · ")}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5 pl-12 sm:pl-0">
        {row.inline ? (
          <a href={row.url} target="_blank" rel="noopener noreferrer" className={action}>
            <ExternalLink className="size-3.5" aria-hidden /> Abrir
          </a>
        ) : null}
        {isFile && row.downloadUrl ? (
          <a href={row.downloadUrl} download={row.fileName} className={action}>
            <Download className="size-3.5" aria-hidden /> Baixar
          </a>
        ) : null}
        {row.removable ? (
          <Button type="button" size="sm" variant="ghost" className={cn("h-8 px-2.5 text-xs text-danger-fg")} onClick={onRemove}>
            <Trash2 /> Remover
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function RemoveDocumentDialog({ clientId, row, onClose, onRemoved }: { clientId: string; row: ClientDocumentRow | null; onClose: () => void; onRemoved: () => void }) {
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [prevRow, setPrevRow] = React.useState(row);
  if (row !== prevRow) {
    setPrevRow(row);
    setReason("");
  }
  const valid = reason.trim().length >= CLIENT_DOCUMENT_REASON_MIN;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!row || !valid) return;
    startTransition(async () => {
      const result = await removeClientDocumentAction({ clientId, documentId: row.id, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Documento removido", { description: row.kind === "arquivo" ? "O arquivo foi apagado; o registro da remoção fica no histórico do cliente." : "O link saiu da lista; o registro fica no histórico do cliente." });
      onRemoved();
    });
  };

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Remover documento</DialogTitle>
            <DialogDescription>
              {row ? `"${row.name}"${row.kind === "arquivo" ? " será apagado do INTEROS" : " sairá da lista"}. ` : ""}Ficam registrados no histórico do cliente o nome, quem removeu, quando e o motivo.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Motivo da remoção" htmlFor="remove-document-reason" required hint={`Mínimo de ${CLIENT_DOCUMENT_REASON_MIN} caracteres. Ex.: arquivo de outro cliente enviado por engano.`}>
              <Textarea id="remove-document-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[72px]" autoFocus />
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
