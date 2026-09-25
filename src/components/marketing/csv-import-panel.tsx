"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Copy, FileUp, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { ImportReport } from "@/server/marketing/service";

/** Campo de CSV: colar texto ou carregar arquivo (lido no navegador com FileReader). */
export function CsvInput({ value, onChange, example }: { value: string; onChange: (value: string) => void; example: string }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result ?? ""));
    reader.onerror = () => toast.error("Não foi possível ler o arquivo");
    reader.readAsText(file, "utf-8");
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={example} className="min-h-[160px] font-mono text-xs" spellCheck={false} aria-label="Conteúdo CSV" />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <FileUp /> Carregar arquivo .csv
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(example);
          }}
        >
          <Copy /> Usar modelo
        </Button>
        <span className="text-xs text-muted">Separador vírgula ou ponto e vírgula; 1ª linha = cabeçalho.</span>
      </div>
    </div>
  );
}

/** Relatório de importação: criados, duplicados e inválidos (com a linha do CSV). */
export function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Summary icon={<CheckCircle2 className="text-success" />} label="Criados" value={report.created.length} />
        <Summary icon={<AlertTriangle className="text-warning" />} label="Duplicados" value={report.duplicates.length} />
        <Summary icon={<XCircle className="text-danger" />} label="Inválidos" value={report.invalid.length} />
      </div>
      {report.duplicates.length > 0 ? (
        <Details title="Ignorados por duplicidade">
          {report.duplicates.map((d) => (
            <li key={`d${d.line}`}>
              Linha {d.line}: <strong>{d.name}</strong> — {d.reason}
            </li>
          ))}
        </Details>
      ) : null}
      {report.invalid.length > 0 ? (
        <Details title="Linhas com erro">
          {report.invalid.map((d) => (
            <li key={`i${d.line}`}>
              Linha {d.line}: {d.error}
            </li>
          ))}
        </Details>
      ) : null}
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border p-3 [&_svg]:size-5">
      {icon}
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted">{label}</span>
      </div>
    </div>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-sm scrollbar-thin">{children}</ul>
    </div>
  );
}
