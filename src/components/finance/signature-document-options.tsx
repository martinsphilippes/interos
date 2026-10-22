"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileDown, TriangleAlert } from "lucide-react";
import type { SignatureAuthMethod } from "@/domain/types";
import { FIELD_SOURCE_LABELS, SIGNATURE_AUTH_LABELS, type FieldSource, type TemplateDataGap } from "@/domain/contract-templates";
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

/** Variáveis do modelo efetivo e o que ainda falta para o documento sair completo (sem lacunas). */
export interface DocumentReadiness {
  templateName: string;
  variableCount: number;
  gaps: TemplateDataGap[];
}

/** Para onde ir para completar cada origem de dado. */
function fixLink(source: FieldSource | undefined, clientId: string): { href?: string; label: string } {
  switch (source) {
    case "cliente":
      return { href: `/clientes/${clientId}`, label: "cadastro do cliente ou dados de cobrança abaixo" };
    case "contato":
      return { href: `/clientes/${clientId}`, label: "contatos do cliente (CPF)" };
    case "signatario":
      return { label: "signatários acima" };
    case "intercert":
      return { href: "/financeiro/assinaturas?aba=configuracao", label: "configuração da assinatura" };
    case "contrato":
      return { label: "itens e condições do contrato" };
    default:
      return { label: "ligar variáveis em Assinaturas › Modelos" };
  }
}

/** Dados do modelo: "N de M preenchidas" e a lista do que falta, com onde corrigir. */
function DocumentReadinessPanel({ readiness, clientId }: { readiness: DocumentReadiness; clientId: string }) {
  const { gaps, variableCount, templateName } = readiness;
  if (variableCount === 0) return null;
  if (gaps.length === 0) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-success-fg">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Modelo «{templateName}»: as {variableCount} variáveis saem preenchidas com os dados do cliente e do contrato.
        </span>
      </p>
    );
  }
  const data = gaps.filter((g) => g.reason === "sem_dado");
  const unbound = gaps.filter((g) => g.reason === "sem_ligacao");
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs" role="status">
      <p className="flex items-start gap-1.5 font-medium text-warning-fg">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Modelo «{templateName}»: {variableCount - gaps.length} de {variableCount} variáveis preenchidas. O documento só é gerado quando tudo estiver completo.
        </span>
      </p>
      <ul className="mt-1.5 flex flex-col gap-1 pl-5">
        {data.map((g) => {
          const fix = fixLink(g.source, clientId);
          return (
            <li key={g.variable}>
              <span className="font-medium text-foreground">{g.label}</span> <span className="font-mono">{`{{${g.variable}}}`}</span> · preencha em{" "}
              {fix.href ? (
                <Link href={fix.href} className="underline">
                  {fix.label}
                </Link>
              ) : (
                fix.label
              )}
              {g.source ? <span className="text-muted"> ({FIELD_SOURCE_LABELS[g.source]})</span> : null}
            </li>
          );
        })}
        {unbound.map((g) => (
          <li key={g.variable}>
            <span className="font-mono">{`{{${g.variable}}}`}</span> sem campo nem texto fixo ·{" "}
            <Link href="/financeiro/assinaturas?aba=modelos" className="underline">
              ligar variáveis no modelo
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Modelo do documento, autenticação dos signatários, dados do modelo e download do PDF/Word do contrato. */
export function SignatureDocumentOptions({ contractId, clientId, info, readiness, canEdit }: { contractId: string; clientId: string; info: SignatureDocumentInfo; readiness?: DocumentReadiness; canEdit: boolean }) {
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
      {readiness ? <DocumentReadinessPanel readiness={readiness} clientId={clientId} /> : null}
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
