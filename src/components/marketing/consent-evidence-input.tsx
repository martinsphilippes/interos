"use client";

/**
 * Escolher comprovantes do consentimento LGPD: botão, arrastar e soltar e colar print (Ctrl+V). Usado no "Novo lead"
 * (os arquivos sobem depois de salvar) e na ficha do lead (sobem na hora). Regras em src/domain/consent-evidence.ts.
 */
import * as React from "react";
import { FileAudio, FileImage, FileText, FileVideo, Mail, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CONSENT_EVIDENCE_ACCEPT, CONSENT_EVIDENCE_MAX_BYTES, CONSENT_EVIDENCE_MAX_FILES, consentEvidenceKind, consentEvidenceMimeType, consentEvidenceProblem, type ConsentEvidenceKind } from "@/domain/consent-evidence";
import { formatBytes } from "@/domain/stored-files";
import { normalizeEvidenceFile, thumbnailOf, type TransferProgress } from "./consent-evidence-transfer";

export interface PendingEvidence {
  key: string;
  file: File;
  /** Miniatura (imagens), gerada ao escolher. */
  thumbnail?: string;
}

const KIND_ICON: Record<ConsentEvidenceKind, React.ComponentType<{ className?: string }>> = {
  imagem: FileImage,
  pdf: FileText,
  audio: FileAudio,
  video: FileVideo,
  email: Mail,
  documento: FileText,
};

export function EvidenceKindIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = KIND_ICON[consentEvidenceKind(mimeType)];
  return <Icon className={className} aria-hidden />;
}

let keySeq = 0;

/**
 * Valida e prepara os arquivos escolhidos: nome final (print colado ganha data), tipo e tamanho aceitos, sem repetir
 * um já escolhido e dentro do limite (`room` = quantos ainda cabem). Avisa o que ficou de fora.
 */
export function acceptEvidenceFiles(files: readonly File[], current: readonly PendingEvidence[], room: number): PendingEvidence[] {
  const accepted: PendingEvidence[] = [];
  const problems: string[] = [];
  const seen = new Set(current.map((p) => `${p.file.name}|${p.file.size}|${p.file.lastModified}`));
  for (const raw of files) {
    const file = normalizeEvidenceFile(raw);
    const problem = consentEvidenceProblem(file);
    if (problem) {
      problems.push(`${file.name}: ${problem}`);
      continue;
    }
    const id = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(id)) continue;
    if (accepted.length >= room) {
      problems.push(`${file.name}: limite de ${CONSENT_EVIDENCE_MAX_FILES} comprovantes por lead.`);
      continue;
    }
    seen.add(id);
    keySeq += 1;
    accepted.push({ key: `ev-${keySeq}`, file });
  }
  if (problems.length) toast.error(problems.length === 1 ? "Arquivo não anexado" : `${problems.length} arquivos não anexados`, { description: problems.slice(0, 4).join(" · ") });
  return accepted;
}

/**
 * Gera as miniaturas das imagens escolhidas, uma de cada vez (fotos grandes não disputam a memória), e devolve cada
 * uma pelo callback (fora de effect). O envio reaproveita a mesma miniatura (thumbnailOf).
 */
export function loadThumbnails(items: readonly PendingEvidence[], onThumb: (key: string, thumbnail: string) => void): void {
  void (async () => {
    for (const item of items) {
      const thumbnail = await thumbnailOf(item.file);
      if (thumbnail) onThumb(item.key, thumbnail);
    }
  })();
}

/** Arquivos do Ctrl+V (print copiado). Texto colado num campo segue normal. */
export function filesFromPaste(event: React.ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (!files.length) return [];
  const target = event.target as HTMLElement | null;
  const typing = target?.closest("input, textarea, [contenteditable='true']");
  // Copiar de um editor traz texto + imagem: num campo de texto, vale o texto.
  if (typing && data.types.includes("text/plain")) return [];
  return files;
}

export interface EvidenceDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Texto do botão. */
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

/** Área de anexar: botão (vários arquivos), arrastar e soltar e colar print quando o foco está aqui. */
export function EvidenceDropZone({ onFiles, disabled, label = "Anexar comprovante", className, children }: EvidenceDropZoneProps) {
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const inputId = React.useId();

  // Arquivo solto FORA da área: o navegador abriria o arquivo e o formulário seria perdido. Enquanto a área existe,
  // soltar arquivo em outro ponto da página não faz nada (a área continua recebendo normalmente).
  React.useEffect(() => {
    const block = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  return (
    <div
      className={cn("flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3 transition-colors", over && "border-brand bg-brand-soft/40", disabled && "opacity-60", className)}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        onFiles(files);
      }}
      onPaste={(e) => {
        if (disabled) return;
        const files = filesFromPaste(e);
        if (!files.length) return;
        e.preventDefault();
        onFiles(files);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()} aria-controls={inputId}>
          <Paperclip /> {label}
        </Button>
        <span className="hidden text-xs text-muted sm:inline">ou arraste os arquivos para cá · cole um print (Ctrl+V)</span>
      </div>
      <p className="text-xs text-muted">
        Print da conversa, termo assinado (PDF), áudio da ligação, vídeo ou e-mail. Vários arquivos, até {formatBytes(CONSENT_EVIDENCE_MAX_BYTES)} cada.
      </p>
      <input
        ref={input}
        id={inputId}
        type="file"
        multiple
        accept={`${CONSENT_EVIDENCE_ACCEPT},image/*,audio/*,video/*`}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {children}
    </div>
  );
}

export interface EvidenceUploadState {
  status: "aguardando" | "enviando" | "enviado" | "erro";
  progress?: TransferProgress;
  error?: string;
  /** Vale tentar de novo (rede, conexão parada, cancelado); regra de negócio não. */
  retryable?: boolean;
  /** Comprovante criado (envio concluído). */
  fileId?: string;
}

/** Lista dos arquivos escolhidos (antes de enviar ou durante o envio). */
export function PendingEvidenceList({ items, states, onRemove, disabled }: { items: readonly PendingEvidence[]; states?: Record<string, EvidenceUploadState>; onRemove?: (key: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Comprovantes escolhidos">
      {items.map((item) => {
        const mimeType = consentEvidenceMimeType(item.file.name) ?? "";
        const state = states?.[item.key];
        const pct = state?.progress && state.progress.total > 0 ? Math.round((state.progress.done / state.progress.total) * 100) : 0;
        return (
          <li key={item.key} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-2.5 py-2">
            <EvidenceThumb thumbnail={item.thumbnail} mimeType={mimeType} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={item.file.name}>
                {item.file.name}
              </p>
              <p className="text-xs text-muted">
                {formatBytes(item.file.size)}
                {state?.status === "enviando" ? ` · enviando ${pct}%` : state?.status === "enviado" ? " · enviado" : state?.status === "aguardando" ? " · na fila" : ""}
              </p>
              {state?.status === "enviando" ? <Progress value={pct} size="sm" className="mt-1" aria-label={`Enviando ${item.file.name}`} /> : null}
              {state?.status === "erro" ? <p className="text-xs text-danger-fg">{state.error}</p> : null}
            </div>
            {onRemove && (!state || state.status === "erro") ? (
              <Button type="button" size="icon" variant="ghost" className="size-8" disabled={disabled} onClick={() => onRemove(item.key)} aria-label={`Tirar ${item.file.name}`}>
                <X />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Miniatura da imagem ou ícone do tipo. */
export function EvidenceThumb({ thumbnail, mimeType, className }: { thumbnail?: string; mimeType: string; className?: string }) {
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted text-muted", className)}>
      {thumbnail ? (
        // Miniatura em data URL (gerada no navegador): o otimizador de imagens do Next não se aplica.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" className="size-full object-cover" />
      ) : (
        <EvidenceKindIcon mimeType={mimeType} className="size-5" />
      )}
    </span>
  );
}

/** Avisa antes de fechar/recarregar a página enquanto há envio em andamento. */
export function useLeaveGuard(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
