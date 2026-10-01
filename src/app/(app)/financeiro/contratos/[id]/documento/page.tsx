import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ACCESS_DENIED_REDIRECT, can, getCurrentUser, requireScreen } from "@/server/auth/session";
import { getById, ORG_ID } from "@/server/db";
import { getContract } from "@/server/finance/queries";
import { canSeeContractValues, contractAccessById } from "@/server/finance/access";
import { redactAmendment } from "@/server/finance/redact";
import { contractAtSnapshot } from "@/domain/contract-snapshot";
import { COLLECTIONS, type Organization } from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/sales/print-button";
import { AmendmentDocument, ContractDocument } from "@/components/finance/contract-document";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Título com o número só para quem abre o documento (seção + escopo, A30); os demais veem "Contrato". */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user || !can(user, "financeiro.contratos.documentos.ver") || (await contractAccessById(user, id)) !== "ok") return { title: "Contrato" };
  const detail = await getContract(id);
  return { title: detail ? `Contrato ${detail.contract.number} — documento` : "Contrato" };
}

/** Só o documento vai para a impressão; no papel, fundo branco e tinta escura (mesmo padrão da proposta). */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden !important; }
  #contrato-impressao, #contrato-impressao * { visibility: visible !important; }
  #contrato-impressao { position: absolute; inset: 0 auto auto 0; width: 100%; margin: 0; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .no-print { display: none !important; }
  #contrato-impressao {
    background: #ffffff !important;
    --color-surface: #ffffff;
    --color-surface-muted: #f8fafc;
    --color-foreground: #0f172a;
    --color-muted: #475569;
    --color-muted-light: #64748b;
    --color-border: #e2e8f0;
    --color-border-strong: #94a3b8;
    color: #0f172a !important;
  }
}
`;

/**
 * Documento do contrato a ser assinado (versão imprimível / salvar PDF). O código de integridade é o hash
 * SHA-256 do conteúdo canônico gravado ao gerar o documento para assinatura.
 * `?versao=N` renderiza o snapshot da versão N (somente leitura); `?aditivo=<id>` renderiza o termo aditivo (D25).
 * Acesso (catálogo): seção financeiro.contratos.documentos.ver (rota própria) + escopo do contrato; versão anterior
 * exige o Histórico e termo aditivo exige Aditivos; sem os valores do contrato, "Restrito" (o hash usa os dados reais).
 */
export default async function ContractDocumentPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.contratos.documentos.ver");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const access = await contractAccessById(user, id);
  if (access === "missing") notFound();
  if (access === "denied") redirect(ACCESS_DENIED_REDIRECT);
  const amendmentId = first(sp.aditivo);
  const versionParam = first(sp.versao);
  if ((amendmentId && !can(user, "financeiro.contratos.aditivos.ver")) || (versionParam && !can(user, "financeiro.contratos.historico.ver"))) redirect(ACCESS_DENIED_REDIRECT);
  const [detail, organization] = await Promise.all([getContract(id), getById<Organization>(COLLECTIONS.organizations, ORG_ID)]);
  if (!detail) notFound();
  const companyName = organization?.name ?? "Intercert";
  const hidden = !canSeeContractValues(user);

  if (amendmentId) {
    const amendment = detail.amendments.find((a) => a.id === amendmentId);
    if (!amendment) notFound();
    return (
      <Shell contractId={detail.contract.id}>
        <AmendmentDocument amendment={hidden ? redactAmendment(amendment) : amendment} contract={detail.contract} client={detail.client} billingData={detail.billingData} companyName={companyName} hidden={hidden} />
      </Shell>
    );
  }

  const requested = versionParam ? Number(versionParam) : undefined;
  const entry = requested && requested !== detail.contract.version ? detail.contract.previousVersions?.find((v) => v.version === requested) : undefined;
  if (requested && requested !== detail.contract.version && !entry) notFound();
  const contract = entry ? contractAtSnapshot(detail.contract, entry.snapshot) : detail.contract;
  return (
    <Shell contractId={detail.contract.id}>
      {entry ? (
        <p className="no-print mb-4 rounded-lg border border-info/35 bg-info-soft px-4 py-3 text-sm text-info-fg" data-testid="version-banner">
          Versão {entry.version} (histórico, somente leitura) · substituída em {formatDateTime(entry.at)} por {entry.kind === "aditivo" ? `aditivo` : "revisão antes da assinatura"}
          {entry.reason ? ` · ${entry.reason}` : ""} ·{" "}
          <Link href={`/financeiro/contratos/${detail.contract.id}/documento`} className="font-medium underline">
            ver versão atual (v{detail.contract.version})
          </Link>
        </p>
      ) : null}
      <ContractDocument
        contract={contract}
        historical={Boolean(entry)}
        client={detail.client}
        billingData={detail.billingData}
        sentAt={detail.sentAt}
        amendments={detail.amendments}
        summary={detail.summary}
        companyName={companyName}
        hidden={hidden}
        amendmentLinks={can(user, "financeiro.contratos.aditivos.ver")}
      />
    </Shell>
  );
}

function Shell({ contractId, children }: { contractId: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-4 md:px-6 md:py-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" asChild>
          <Link href={`/financeiro/contratos/${contractId}`}>
            <ArrowLeft /> Voltar ao contrato
          </Link>
        </Button>
        <PrintButton />
      </div>
      {children}
    </div>
  );
}
