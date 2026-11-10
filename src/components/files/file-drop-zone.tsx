"use client";

/**
 * Escolher arquivos (genérico): botão (vários arquivos), arrastar e soltar e colar print (Ctrl+V), ícone/miniatura do
 * tipo e aviso antes de sair da página no meio de um envio. Usado nos comprovantes LGPD e nos documentos do cliente.
 */
import * as React from "react";
import { FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Mail, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Ícone pelo tipo do arquivo. */
export function FileKindIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = mimeType.startsWith("image/")
    ? FileImage
    : mimeType.startsWith("audio/")
      ? FileAudio
      : mimeType.startsWith("video/")
        ? FileVideo
        : mimeType === "message/rfc822" || mimeType === "application/vnd.ms-outlook"
          ? Mail
          : mimeType === "application/zip"
            ? FileArchive
            : /spreadsheet|ms-excel|text\/csv/.test(mimeType)
              ? FileSpreadsheet
              : FileText;
  return <Icon className={className} aria-hidden />;
}

/** Miniatura da imagem ou ícone do tipo. */
export function FileThumb({ thumbnail, mimeType, className }: { thumbnail?: string; mimeType: string; className?: string }) {
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted text-muted", className)}>
      {thumbnail ? (
        // Miniatura em data URL (gerada no navegador): o otimizador de imagens do Next não se aplica.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" className="size-full object-cover" />
      ) : (
        <FileKindIcon mimeType={mimeType} className="size-5" />
      )}
    </span>
  );
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

export interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Texto do botão. */
  label: string;
  /** Linha de ajuda (o que enviar e o limite). */
  hint: React.ReactNode;
  /** `accept` do seletor de arquivos. */
  accept: string;
  className?: string;
  children?: React.ReactNode;
}

/** Área de anexar: botão (vários arquivos), arrastar e soltar e colar print quando o foco está aqui. */
export function FileDropZone({ onFiles, disabled, label, hint, accept, className, children }: FileDropZoneProps) {
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
      <p className="text-xs text-muted">{hint}</p>
      <input
        ref={input}
        id={inputId}
        type="file"
        multiple
        accept={accept}
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
