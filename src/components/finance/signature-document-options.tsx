"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Download, FileDown, TriangleAlert } from "lucide-react";
import type { SignatureAuthMethod } from "@/domain/types";
import { SIGNATURE_AUTH_LABELS, type TemplateDataGap } from "@/domain/contract-templates";
import { groupReadinessGaps, type FixGroup } from "@/domain/document-readiness";
import { isValidCpf } from "@/domain/documents";
import { goToSection } from "@/lib/go-to-section";
import { CONTRACT_SECTION_IDS } from "./contract-sections";
import { SIGNATURE_AUTH_METHODS } from "@/domain/types";
import { setContractSignatureOptionsAction } from "@/server/finance/signature-actions";
import { setRepresentativeDocumentAction } from "@/server/finance/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
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
  templateId: string;
  templateName: string;
  variableCount: number;
  gaps: TemplateDataGap[];
  /** Quem assina pelo cliente e se é um contato do cliente (de onde vem o CPF). */
  representative?: { name: string; email: string; contactFound: boolean; fromClient?: boolean; ambiguous?: "nome" | "outro_nome" | "cpf" | "empresa"; otherName?: string };
}

/** O que o usuário pode corrigir daqui (calculado no servidor e no cartão Assinatura). */
export interface ReadinessFixOptions {
  /** Informar o CPF de quem assina pelo cliente (grava no contato ou cadastra o contato). */
  canFixCpf: boolean;
  /** Abrir «Ligar variáveis» do modelo em Assinaturas › Modelos. */
  canEditTemplates: boolean;
  /** O cartão «Cliente e faturamento» do contrato tem o formulário (quem edita o contrato); senão, o cadastro do cliente. */
  canEditBilling?: boolean;
  /** Pode alterar quem assina pela Intercert (Assinaturas › Configuração). */
  canEditSignatureSettings?: boolean;
  /** Abre o formulário de novo signatário no cartão Assinatura (quem edita signatários). */
  onAddSigner?: () => void;
}

/** Botão que cabe na coluna estreita do cartão (quebra linha em vez de vazar). */
const FIX_CLASS = "h-auto min-h-9 max-w-full whitespace-normal py-1 text-left md:min-h-7";

function FixButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className={FIX_CLASS} onClick={onClick}>
      {children}
      <ArrowRight aria-hidden />
    </Button>
  );
}

function FixLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className={FIX_CLASS}>
      <Link href={href}>
        {children}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}

const labelsOf = (gaps: TemplateDataGap[]) =>
  gaps.map((g) => (
    <span key={g.variable}>
      {g.reason === "sem_ligacao" ? null : <span className="text-foreground">{g.label} </span>}
      {/* Nome de variável longo quebra em qualquer ponto (no celular não cabe numa linha). */}
      <span className="font-mono [overflow-wrap:anywhere]">{`{{${g.variable}}}`}</span>
    </span>
  ));

function joinNodes(nodes: React.ReactNode[]): React.ReactNode[] {
  return nodes.flatMap((n, i) => (i === 0 ? [n] : [<React.Fragment key={`s${i}`}>, </React.Fragment>, n]));
}

/** CPF de quem assina pelo cliente, informado aqui mesmo (grava no contato ou cadastra o contato). */
function RepresentativeCpfForm({ contractId, rep }: { contractId: string; rep: NonNullable<DocumentReadiness["representative"]> }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [cpf, setCpf] = React.useState("");
  const digits = cpf.replace(/\D/g, "");
  const invalid = digits.length === 11 && !isValidCpf(digits);
  const save = () =>
    void run(
      () => setRepresentativeDocumentAction({ contractId, document: digits, expected: { name: rep.name, email: rep.email } }),
      (d) => (d.created ? `${d.name} cadastrado como contato do cliente, com CPF` : `CPF de ${d.name} salvo`),
      () => setCpf(""),
    );
  return (
    <form
      className="mt-1.5 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (isValidCpf(digits)) save();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-cpf`} className="text-muted">
          {rep.contactFound ? `CPF de ${rep.name}` : `CPF de ${rep.name} (cadastra como contato do cliente)`}
        </label>
        <Input id={`${id}-cpf`} value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" className="h-9 w-44 md:h-8" aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-err` : undefined} />
      </div>
      <Button type="submit" size="sm" className="h-9 md:h-8" loading={pending} disabled={!isValidCpf(digits) || pending}>
        Salvar CPF
      </Button>
      {invalid ? (
        <p id={`${id}-err`} className="w-full text-danger-fg" role="alert">
          CPF inválido: confira os números.
        </p>
      ) : null}
    </form>
  );
}

/** Quem assina pelo cliente e o CPF dele: o que falta e o botão (ou formulário) para resolver. */
function RepresentativeFix({ group, readiness, contractId, clientId, fix }: { group: FixGroup; readiness: DocumentReadiness; contractId: string; clientId: string; fix: ReadinessFixOptions }) {
  const rep = readiness.representative;
  const contacts = `/clientes/${clientId}#contatos`;
  const seeSigners = <FixButton onClick={() => goToSection(CONTRACT_SECTION_IDS.signatarios)}>Ver signatários</FixButton>;
  if (!rep) {
    return (
      <>
        <p>Falta quem assina pelo cliente ({joinNodes(labelsOf(group.gaps))}).</p>
        <div className="mt-1.5 flex flex-wrap gap-2">{fix.onAddSigner ? <FixButton onClick={fix.onAddSigner}>Adicionar signatário</FixButton> : seeSigners}</div>
      </>
    );
  }
  if (rep.ambiguous === "nome") {
    return (
      <>
        <p>
          {joinNodes(labelsOf(group.gaps))}: {rep.email} é usado por mais de um contato do cliente e nenhum se chama {rep.name}. Escolha como signatário o contato certo ou corrija os contatos.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {seeSigners}
          <FixLink href={contacts}>Abrir contatos do cliente</FixLink>
        </div>
      </>
    );
  }
  if (rep.ambiguous === "empresa") {
    return (
      <>
        <p>
          {joinNodes(labelsOf(group.gaps))}: quem assina pelo cliente está com o nome do próprio cliente ({rep.name}). Se for empresa, escolha como signatário a pessoa que assina; se o cliente é pessoa física, informe o CPF dele nos dados do cliente.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {fix.onAddSigner ? <FixButton onClick={fix.onAddSigner}>Adicionar signatário</FixButton> : null}
          {seeSigners}
          {fix.canEditBilling ? <FixButton onClick={() => goToSection(CONTRACT_SECTION_IDS.cliente)}>Dados do cliente</FixButton> : <FixLink href={`/clientes/${clientId}`}>Cadastro do cliente</FixLink>}
        </div>
      </>
    );
  }
  if (rep.ambiguous === "outro_nome") {
    return (
      <>
        <p>
          {joinNodes(labelsOf(group.gaps))}: {rep.email} é o e-mail do contato {rep.otherName ?? "de outra pessoa"}, não de {rep.name}. Escolha como signatário a pessoa certa ou corrija os contatos do cliente.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {seeSigners}
          <FixLink href={contacts}>Abrir contatos do cliente</FixLink>
        </div>
      </>
    );
  }
  if (rep.ambiguous === "cpf") {
    return (
      <>
        <p>
          {joinNodes(labelsOf(group.gaps))}: há mais de um contato {rep.name} ({rep.email}) com CPFs diferentes. Corrija ou remova o duplicado.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <FixLink href={contacts}>Abrir contatos do cliente</FixLink>
        </div>
      </>
    );
  }
  return (
    <>
      <p>
        {joinNodes(labelsOf(group.gaps))}:{" "}
        {rep.contactFound
          ? `falta o CPF de ${rep.name} no cadastro do contato.`
          : `${rep.name} (${rep.email}) assina pelo cliente, mas não é contato dele.${fix.canFixCpf ? "" : " Escolha como signatário um contato do cliente com CPF."}`}
      </p>
      {fix.canFixCpf ? <RepresentativeCpfForm contractId={contractId} rep={rep} /> : null}
      <div className="mt-1.5 flex flex-wrap gap-2">
        {!rep.contactFound ? seeSigners : null}
        {!fix.canFixCpf && rep.contactFound ? <FixLink href={contacts}>Abrir contatos do cliente</FixLink> : null}
      </div>
    </>
  );
}

/** Dados do modelo: "N de M preenchidas" e, para cada lugar onde se corrige, o que falta e o botão que leva até lá. */
function DocumentReadinessPanel({ readiness, contractId, clientId, fix }: { readiness: DocumentReadiness; contractId: string; clientId: string; fix: ReadinessFixOptions }) {
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
  const groups = groupReadinessGaps(gaps);
  const templateHref = `/financeiro/assinaturas?aba=modelos&ligar=${encodeURIComponent(readiness.templateId)}`;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs" role="status">
      <p className="flex items-start gap-1.5 font-medium text-warning-fg">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Modelo «{templateName}»: {variableCount - gaps.length} de {variableCount} variáveis preenchidas. O documento só é gerado quando tudo estiver completo.
        </span>
      </p>
      <ul className="mt-2 flex flex-col gap-3 pl-5">
        {groups.map((group) => {
          let body: React.ReactNode;
          switch (group.target) {
            case "representante":
              body = <RepresentativeFix group={group} readiness={readiness} contractId={contractId} clientId={clientId} fix={fix} />;
              break;
            case "cliente":
              body = (
                <>
                  <p>Dados do cliente: {joinNodes(labelsOf(group.gaps))}.</p>
                  <div className="mt-1.5">
                    {fix.canEditBilling ? (
                      <FixButton onClick={() => goToSection(CONTRACT_SECTION_IDS.cliente)}>Completar dados do cliente</FixButton>
                    ) : (
                      <FixLink href={`/clientes/${clientId}`}>Corrigir no cadastro do cliente</FixLink>
                    )}
                  </div>
                </>
              );
              break;
            case "itens":
              body = (
                <>
                  <p>Itens e valores do contrato: {joinNodes(labelsOf(group.gaps))}.</p>
                  <div className="mt-1.5">
                    <FixButton onClick={() => goToSection(CONTRACT_SECTION_IDS.itens)}>Ir para os itens</FixButton>
                  </div>
                </>
              );
              break;
            case "condicoes":
              body = (
                <>
                  <p>Condições do contrato: {joinNodes(labelsOf(group.gaps))}.</p>
                  <div className="mt-1.5">
                    <FixButton onClick={() => goToSection(CONTRACT_SECTION_IDS.condicoes)}>Ir para as condições</FixButton>
                  </div>
                </>
              );
              break;
            case "intercert":
              body = (
                <>
                  <p>Quem assina pela Intercert: {joinNodes(labelsOf(group.gaps))}.</p>
                  <div className="mt-1.5">
                    {fix.canEditSignatureSettings ? (
                      <FixLink href="/financeiro/assinaturas?aba=configuracao">Abrir configuração</FixLink>
                    ) : (
                      <p className="text-muted">Peça a um gestor (Financeiro › Assinaturas › Configuração).</p>
                    )}
                  </div>
                </>
              );
              break;
            case "modelo": {
              const unbound = group.gaps.filter((g) => g.reason === "sem_ligacao");
              const after = group.gaps.filter((g) => g.reason !== "sem_ligacao");
              body = (
                <>
                  {unbound.length > 0 ? <p>No modelo, sem campo nem texto fixo: {joinNodes(labelsOf(unbound))}.</p> : null}
                  {after.length > 0 ? <p>{joinNodes(labelsOf(after))}: só existe(m) depois da liberação. Use texto fixo no modelo (ex.: «a data da assinatura»).</p> : null}
                  <div className="mt-1.5">
                    {fix.canEditTemplates ? <FixLink href={templateHref}>Ligar variáveis do modelo</FixLink> : <p className="text-muted">Peça a quem administra os modelos (Financeiro › Assinaturas › Modelos).</p>}
                  </div>
                </>
              );
              break;
            }
          }
          return <li key={group.target}>{body}</li>;
        })}
      </ul>
    </div>
  );
}

/** Modelo do documento, autenticação dos signatários, dados do modelo e download do PDF/Word do contrato. */
export function SignatureDocumentOptions({
  contractId,
  clientId,
  info,
  readiness,
  canEdit,
  fix = { canFixCpf: false, canEditTemplates: false },
}: {
  contractId: string;
  clientId: string;
  info: SignatureDocumentInfo;
  readiness?: DocumentReadiness;
  canEdit: boolean;
  fix?: ReadinessFixOptions;
}) {
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
      {readiness ? <DocumentReadinessPanel readiness={readiness} contractId={contractId} clientId={clientId} fix={fix} /> : null}
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
