"use client";

import * as React from "react";
import { Download, FileDown } from "lucide-react";
import type { SignatureAuthMethod } from "@/domain/types";
import { SIGNATURE_AUTH_LABELS } from "@/domain/contract-templates";
import { SIGNATURE_AUTH_METHODS } from "@/domain/types";
import { setContractSignatureOptionsAction } from "@/server/finance/signature-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useFinanceAction } from "./use-finance-action";

export interface SignatureDocumentInfo {
  /** Modelos ativos que o contrato pode usar. */
  templates: { id: string; name: string; kind: "interos" | "word" }[];
  templateId?: string;
  /** Modelo padrão (quando o contrato não escolhe). */
  defaultTemplateName?: string;
  /** Modelo efetivo hoje: o fixado no documento gerado ou o que será usado. */
  effective?: { name: string; kind: "interos" | "word"; version: number; fixed: boolean; /** O modelo escolhido hoje é outro (ou outra versão): gerar de novo. */ stale: boolean };
  signatureAuth?: SignatureAuthMethod;
  defaultAuth: SignatureAuthMethod;
  /** Baixar PDF/Word (seção documentos + valores visíveis). */
  canDownload: boolean;
}

/** Modelo do documento, autenticação dos signatários e download do PDF/Word do contrato. */
export function SignatureDocumentOptions({ contractId, info, canEdit }: { contractId: string; info: SignatureDocumentInfo; canEdit: boolean }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const base = `/api/financeiro/contratos/${contractId}/documento`;
  const templateOptions = [{ value: "", label: info.defaultTemplateName ? `Padrão (${info.defaultTemplateName})` : "Padrão (sem cláusulas extras)" }, ...info.templates.map((t) => ({ value: t.id, label: `${t.name}${t.kind === "word" ? " · Word" : ""}` }))];
  const authOptions = SIGNATURE_AUTH_METHODS.map((m) => ({ value: m, label: `${SIGNATURE_AUTH_LABELS[m]}${m === info.defaultAuth ? " (padrão)" : ""}` }));
  const save = (patch: { templateId?: string; signatureAuth?: SignatureAuthMethod }) => run(() => setContractSignatureOptionsAction({ contractId, ...patch }), "Opções de assinatura salvas");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      {canEdit ? (
        <div className="grid gap-3">
          <FormField label="Modelo do documento" htmlFor={`${id}-t`}>
            <Select id={`${id}-t`} value={info.templateId ?? ""} disabled={pending} onChange={(e) => void save({ templateId: e.target.value })} options={templateOptions} />
          </FormField>
          <FormField label="Como o signatário prova quem é" htmlFor={`${id}-a`}>
            <Select id={`${id}-a`} value={info.signatureAuth ?? info.defaultAuth} disabled={pending} onChange={(e) => void save({ signatureAuth: e.target.value as SignatureAuthMethod })} options={authOptions} />
          </FormField>
        </div>
      ) : (
        <p className="text-xs text-muted">Autenticação: {SIGNATURE_AUTH_LABELS[info.signatureAuth ?? info.defaultAuth]}</p>
      )}
      {info.effective ? (
        <p className="text-xs text-muted">
          {info.effective.fixed ? "Documento gerado com o modelo" : "Será usado o modelo"} <span className="font-medium text-foreground">{info.effective.name}</span> (versão {info.effective.version}
          {info.effective.kind === "word" ? ", Word" : ""}).
          {info.effective.stale ? <span className="text-warning-fg"> Para usar este modelo, gere o documento de novo.</span> : null}
        </p>
      ) : null}
      {info.canDownload ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="h-10 md:h-8">
            <a href={`${base}?formato=pdf&download=1`}>
              <FileDown /> Baixar PDF
            </a>
          </Button>
          {info.effective?.kind === "word" ? (
            <Button asChild variant="outline" size="sm" className="h-10 md:h-8">
              <a href={`${base}?formato=docx`}>
                <Download /> Baixar Word preenchido
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
