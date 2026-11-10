"use client";

/**
 * Escolher comprovantes do consentimento LGPD: botão, arrastar e soltar e colar print (Ctrl+V). Usado no "Novo lead"
 * (os arquivos sobem depois de salvar) e na ficha do lead (sobem na hora). Regras em src/domain/consent-evidence.ts.
 */
import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { CONSENT_EVIDENCE_ACCEPT, CONSENT_EVIDENCE_MAX_BYTES, CONSENT_EVIDENCE_MAX_FILES, consentEvidenceMimeType, consentEvidenceProblem } from "@/domain/consent-evidence";
import { formatBytes } from "@/domain/stored-files";
import { FileDropZone, FileKindIcon, FileThumb } from "@/components/files/file-drop-zone";
import { normalizeEvidenceFile, thumbnailOf, type TransferProgress } from "./consent-evidence-transfer";

export { filesFromPaste, useLeaveGuard } from "@/components/files/file-drop-zone";

export interface PendingEvidence {
  key: string;
  file: File;
  /** Miniatura (imagens), gerada ao escolher. */
  thumbnail?: string;
}

export function EvidenceKindIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  return <FileKindIcon mimeType={mimeType} className={className} />;
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
  return (
    <FileDropZone
      onFiles={onFiles}
      disabled={disabled}
      label={label}
      accept={`${CONSENT_EVIDENCE_ACCEPT},image/*,audio/*,video/*`}
      hint={`Print da conversa, termo assinado (PDF), áudio da ligação, vídeo ou e-mail. Vários arquivos, até ${formatBytes(CONSENT_EVIDENCE_MAX_BYTES)} cada.`}
      className={className}
    >
      {children}
    </FileDropZone>
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
  return <FileThumb thumbnail={thumbnail} mimeType={mimeType} className={className} />;
}
