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

/** Cliques em "Cancelar envio" logo depois de enviar são o segundo clique de um clique duplo: ignorados. */
const CANCEL_GRACE_MS = 800;

let keySeq = 0;

/**
 * Valida e prepara os arquivos escolhidos: nome final (print colado ganha data), tipo e tamanho aceitos, sem repetir um
 * já escolhido e até o limite por vez; nome e categoria sugeridos pelo nome do arquivo. Pelo atalho do cadastro
 * ("Falta: Contrato social"), só o PRIMEIRO arquivo leva o nome e a categoria do atalho.
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
    const preset = accepted.length === 0 ? presetCategory : null;
    const category = preset ?? suggestDocumentCategory(file.name);
    accepted.push({
      key: `doc-${keySeq}`,
      file,
      mimeType: clientDocumentMimeType(file.name) ?? "",
      title: preset ?? suggestDocumentTitle(file.name, category),
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

/** Documento de cadastro presente: pela categoria ou, nos antigos (categoria "Contrato"…), pelo nome. */
function hasEssential(rows: readonly ClientDocumentRow[], category: string): boolean {
  return rows.some((r) => r.category === category || suggestDocumentCategory(r.name) === category);
}

/** Aviso ao fechar/recarregar a página, preso ao envio (vale mesmo se a pessoa trocou de aba no meio dele). */
function holdLeaveGuard(): () => void {
  const handler = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}

export interface ClientDocumentsPanelProps {
  clientId: string;
  clientName: string;
  rows: readonly ClientDocumentRow[];
  users: Readonly<Record<string, UserName>>;
  canAttach: boolean;
  /** Pessoa jurídica (ou sem documento informado): confere contrato social e cartão CNPJ. CPF não confere. */
  checkCompanyDocuments: boolean;
}

export function ClientDocumentsPanel({ clientId, clientName, rows, users, canAttach, checkCompanyDocuments }: ClientDocumentsPanelProps) {
  const router = useRouter();
  const active = rows.filter((r) => r.status === "ativo");
  const removed = rows.filter((r) => r.status === "removido");
  const [mode, setMode] = React.useState<"arquivos" | "link">("arquivos");
  const [queue, setQueue] = React.useState<PendingDocument[]>([]);
  const [states, setStates] = React.useState<Record<string, UploadState>>({});
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<ClientDocumentRow | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  /** Momento do clique em "Enviar" (`event.timeStamp`), para reconhecer o segundo clique de um clique duplo. */
  const sendStartedAt = React.useRef(0);
  const shortcutInput = React.useRef<HTMLInputElement>(null);
  /** Categoria do atalho: vale só para o seletor aberto por ele (consumida no `change`, apagada no `cancel`). */
  const shortcutCategory = React.useRef<string | null>(null);
  const listHeading = React.useRef<HTMLHeadingElement>(null);

  const setState = (key: string, state: UploadState) => setStates((s) => ({ ...s, [key]: state }));
  // Enviados continuam na fila até a lista do servidor trazê-los (não somem por um instante entre as duas listas).
  const listed = (p: PendingDocument) => {
    const docId = states[p.key]?.docId;
    return Boolean(docId && rows.some((r) => r.id === docId));
  };
  const shownQueue = queue.filter((p) => !listed(p));
  const toSend = shownQueue.filter((p) => !states[p.key] || (states[p.key].status === "erro" && states[p.key].retryable));
  const blocked = shownQueue.filter((p) => states[p.key]?.status === "erro" && !states[p.key]?.retryable);
  const retryOnly = toSend.length > 0 && toSend.every((p) => states[p.key]?.status === "erro");
  // Arquivos escolhidos e ainda não enviados também se perdem ao fechar a página.
  useLeaveGuard(!busy && toSend.length > 0);

  React.useEffect(() => {
    const input = shortcutInput.current;
    if (!input) return;
    const clear = () => {
      shortcutCategory.current = null;
    };
    input.addEventListener("cancel", clear);
    return () => input.removeEventListener("cancel", clear);
  }, [canAttach]);

  /** Tira da fila (e da memória) os que já estão na lista do servidor. */
  const prune = () => {
    const done = new Set(queue.filter(listed).map((p) => p.key));
    if (!done.size) return;
    setQueue((q) => q.filter((p) => !done.has(p.key)));
    setStates((s) => Object.fromEntries(Object.entries(s).filter(([key]) => !done.has(key))));
  };

  const add = (files: File[], presetCategory: string | null = null) => {
    prune();
    const { accepted, problems } = acceptDocumentFiles(files, shownQueue, presetCategory);
    if (problems.length) toast.error(problems.length === 1 ? "Arquivo não incluído" : `${problems.length} arquivos não incluídos`, { description: problems.slice(0, 4).join(" · ") });
    if (!accepted.length) return;
    setQueue((q) => [...q, ...accepted]);
    if (presetCategory) setFocusKey(accepted[0].key);
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
   * adianta); o resultado sempre vira aviso e a lista é recarregada (também quando a pessoa já trocou de aba: o envio
   * continua e o aviso de fechar a página vale até o fim).
   */
  const send = async (items: PendingDocument[]) => {
    const invalid = items.map((p) => ({ p, problem: titleProblem(p.title) })).filter((x) => x.problem);
    if (invalid.length) {
      toast.error("Confira o nome dos documentos", { description: invalid.map((x) => `${x.p.file.name}: ${x.problem}`).slice(0, 3).join(" · ") });
      return;
    }
    prune();
    const controller = new AbortController();
    abort.current = controller;
    const releaseGuard = holdLeaveGuard();
    setBusy(true);
    setStates((s) => ({ ...s, ...Object.fromEntries(items.map((p) => [p.key, { status: "aguardando" } as UploadState])) }));
    let sent = 0;
    const failures: string[] = [];
    try {
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
    } finally {
      releaseGuard();
      abort.current = null;
      setBusy(false);
    }
    // Recarrega sempre: um envio cancelado no fim pode ter sido concluído no servidor.
    router.refresh();
    if (sent) {
      toast.success(sent === 1 ? `Documento enviado para ${clientName}` : `${sent} documentos enviados para ${clientName}`, {
        description: "Guardado no INTEROS e registrado no histórico do cliente.",
      });
    }
    if (failures.length) {
      toast.error(failures.length === 1 ? "Um documento não foi enviado" : `${failures.length} documentos não foram enviados`, { description: failures.slice(0, 3).join(" · "), duration: 12_000 });
    }
  };

  const cancel = (event: React.MouseEvent) => {
    // Clique duplo em "Enviar": o segundo clique cai aqui (o botão troca de lugar) e não pode cancelar.
    if (event.detail > 1 || event.timeStamp - sendStartedAt.current < CANCEL_GRACE_MS) return;
    abort.current?.abort();
  };

  /** Atalho do que falta no cadastro: abre o seletor (no próprio clique) já com a categoria e o nome. */
  const pickFor = (category: string) => {
    shortcutCategory.current = category;
    setMode("arquivos");
    shortcutInput.current?.click();
  };

  const essentials = CLIENT_ESSENTIAL_DOCUMENTS.map((category) => ({
    category,
    done: hasEssential(active, category),
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

          {/* Os dois modos ficam montados: trocar de modo não perde o link digitado nem esconde um envio em andamento. */}
          <div className={cn(mode !== "link" && "hidden")}>
            <p className="mb-3 text-xs text-muted">Para arquivos que ficam em outro sistema (Google Drive, plataforma de assinatura, ERP): o documento fica referenciado pelo link.</p>
            <DocumentLinkForm clientId={clientId} />
          </div>
          <div className={cn(mode !== "arquivos" && "hidden")}>
            <FileDropZone
              onFiles={(files) => add(files)}
              disabled={busy}
              label={shownQueue.length ? "Escolher mais arquivos" : "Escolher arquivos"}
              accept={`${CLIENT_DOCUMENT_ACCEPT},image/*`}
              hint={`PDF, imagem, Word, Excel, XML, ZIP ou e-mail · até ${formatBytes(CLIENT_DOCUMENT_MAX_BYTES)} cada. O nome e a categoria vêm do nome do arquivo; ajuste antes de enviar.`}
            >
              {shownQueue.length ? (
                <>
                  <ul className="flex flex-col gap-2" aria-label="Arquivos escolhidos">
                    {shownQueue.map((item) => (
                      <PendingRow
                        key={item.key}
                        item={item}
                        state={states[item.key]}
                        disabled={busy}
                        autoFocus={item.key === focusKey}
                        onEdit={(patch) => edit(item.key, patch)}
                        onRemove={busy ? undefined : () => dismiss(item.key)}
                      />
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2">
                    {busy ? (
                      <Button type="button" variant="outline" size="sm" onClick={cancel}>
                        <X /> Cancelar envio
                      </Button>
                    ) : toSend.length ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={(e) => {
                          sendStartedAt.current = e.timeStamp;
                          void send(toSend);
                        }}
                      >
                        {retryOnly ? <RotateCcw /> : <UploadCloud />}
                        {retryOnly ? `Tentar de novo (${toSend.length})` : toSend.length === 1 ? "Enviar documento" : `Enviar ${toSend.length} documentos`}
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
          </div>
          {/* Seletor do atalho do cadastro: aberto no próprio clique (gesto do usuário) e só ele usa a categoria do atalho. */}
          <input
            ref={shortcutInput}
            type="file"
            multiple
            accept={`${CLIENT_DOCUMENT_ACCEPT},image/*`}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              const category = shortcutCategory.current;
              shortcutCategory.current = null;
              if (files.length) add(files, category);
            }}
          />
        </Card>
      ) : null}

      <section aria-labelledby="client-documents-title">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="client-documents-title" ref={listHeading} tabIndex={-1} className="text-base font-semibold leading-tight tracking-tight text-foreground outline-none">
            Documentos
          </h2>
          <span className="rounded-md border border-border bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{active.length}</span>
        </div>
        {checkCompanyDocuments ? (
          <div role="group" aria-label="Documentos de cadastro da empresa" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted" aria-hidden>
              Cadastro
            </span>
            {essentials.map((e) =>
              e.done ? (
                <span key={e.category} className="inline-flex items-center gap-1 text-success-fg">
                  <CheckCircle2 className="size-4" aria-hidden /> {e.category}
                </span>
              ) : e.queued ? (
                <span key={e.category} className="inline-flex items-center gap-1 text-muted">
                  <CircleDashed className="size-4" aria-hidden /> {e.category}: escolhido, falta enviar
                </span>
              ) : canAttach ? (
                <button key={e.category} type="button" onClick={() => pickFor(e.category)} disabled={busy} className="inline-flex items-center gap-1 text-warning-fg hover:underline disabled:opacity-60">
                  <CircleDashed className="size-4" aria-hidden /> Falta: {e.category} · enviar
                </button>
              ) : (
                <span key={e.category} className="inline-flex items-center gap-1 text-muted">
                  <CircleDashed className="size-4" aria-hidden /> Falta: {e.category}
                </span>
              ),
            )}
          </div>
        ) : null}
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
                <li key={row.id} className="min-w-0 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs [overflow-wrap:anywhere]">
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
          // O botão "Remover" sumiu com a linha: o foco vai para o título da lista.
          requestAnimationFrame(() => listHeading.current?.focus());
        }}
      />
    </div>
  );
}

function PendingRow({
  item,
  state,
  disabled,
  autoFocus,
  onEdit,
  onRemove,
}: {
  item: PendingDocument;
  state?: UploadState;
  disabled: boolean;
  autoFocus?: boolean;
  onEdit: (patch: Partial<Pick<PendingDocument, "title" | "category">>) => void;
  onRemove?: () => void;
}) {
  const id = React.useId();
  const pct = state?.progress && state.progress.total > 0 ? Math.round((state.progress.done / state.progress.total) * 100) : 0;
  const locked = disabled || state?.status === "enviando" || state?.status === "enviado";
  const categories: readonly string[] = CLIENT_DOCUMENT_CATEGORIES.includes(item.category as (typeof CLIENT_DOCUMENT_CATEGORIES)[number]) ? CLIENT_DOCUMENT_CATEGORIES : [item.category, ...CLIENT_DOCUMENT_CATEGORIES];
  const status = !state
    ? " · pronto para enviar"
    : state.status === "enviando"
      ? ` · enviando ${pct}%`
      : state.status === "enviado"
        ? " · enviado"
        : state.status === "aguardando"
          ? " · na fila"
          : "";
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-surface p-2.5">
      <FileThumb thumbnail={item.thumbnail} mimeType={item.mimeType} className="mt-5 hidden sm:flex" />
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
        <FormField label="Nome do documento" htmlFor={`${id}-title`} className="min-w-0">
          <Input
            id={`${id}-title`}
            value={item.title}
            maxLength={CLIENT_DOCUMENT_TITLE_MAX}
            disabled={locked}
            autoFocus={autoFocus}
            aria-describedby={`${id}-file`}
            onChange={(e) => onEdit({ title: e.target.value })}
          />
        </FormField>
        <FormField label="Categoria" htmlFor={`${id}-category`}>
          <Select id={`${id}-category`} value={item.category} disabled={locked} aria-describedby={`${id}-file`} onChange={(e) => onEdit({ category: e.target.value })} options={categories.map((c) => ({ value: c, label: c }))} />
        </FormField>
        <div className="min-w-0 sm:col-span-2">
          <p id={`${id}-file`} className="truncate text-xs text-muted" title={item.file.name}>
            {item.file.name} · {formatBytes(item.file.size)}
            {status}
          </p>
          {state?.status === "enviando" ? <Progress value={pct} size="sm" className="mt-1" aria-label={`Enviando ${item.file.name}`} /> : null}
          {state?.status === "erro" ? (
            <p className="text-xs text-danger-fg" role="alert">
              {state.error}
            </p>
          ) : null}
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
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{row.name}</span>
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
          <p className="text-xs text-muted [overflow-wrap:anywhere]">{meta.join(" · ")}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5 pl-12 sm:pl-0">
        {row.inline ? (
          <a href={row.url} target="_blank" rel="noopener noreferrer" className={action} aria-label={`Abrir ${row.name}`}>
            <ExternalLink className="size-3.5" aria-hidden /> Abrir
          </a>
        ) : null}
        {isFile && row.downloadUrl ? (
          // Sem o atributo `download`: o servidor já manda baixar, e um erro (sessão expirada, arquivo removido) aparece
          // como página legível em vez de um download cancelado.
          <a href={row.downloadUrl} className={action} aria-label={`Baixar ${row.name}`}>
            <Download className="size-3.5" aria-hidden /> Baixar
          </a>
        ) : null}
        {row.removable ? (
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-danger-fg" onClick={onRemove} aria-label={`Remover ${row.name}`}>
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
