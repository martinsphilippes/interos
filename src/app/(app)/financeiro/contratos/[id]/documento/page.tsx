import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getById, ORG_ID } from "@/server/db";
import { getContract } from "@/server/finance/queries";
import { RECURRENCE_LABELS } from "@/server/finance/schemas";
import { contractDocumentHash } from "@/server/finance/signature";
import type { ContractSigner } from "@/server/integrations/types";
import { HEADQUARTERS, formatAddressLine } from "@/server/sales/maps";
import { COLLECTIONS, type Organization } from "@/domain/types";
import { formatCurrency, formatDate, formatDateTime, formatDocument } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CONTRACT_STATUS_LABELS } from "@/components/clients/labels";
import { netItem } from "@/components/sales/model";
import { PrintButton } from "@/components/sales/print-button";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
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
 */
export default async function ContractDocumentPage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const { id } = await params;
  const [detail, organization] = await Promise.all([getContract(id), getById<Organization>(COLLECTIONS.organizations, ORG_ID)]);
  if (!detail) notFound();
  const { contract, client, billingData } = detail;
  const companyName = organization?.name ?? "Intercert";
  const currentHash = contractDocumentHash(contract);
  const generated = Boolean(contract.signatureEnvelopeId);
  const hashMatches = contract.documentHash === currentHash;
  const signers = contract.signers as ContractSigner[];
  const firstYear = contract.setupTotal + contract.hardwareTotal + (contract.recurrence === "unico" ? 0 : contract.monthlyTotal * Math.min(12, contract.termMonths));
  const address = formatAddressLine(billingData.address);

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-4 md:px-6 md:py-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" asChild>
          <Link href={`/financeiro/contratos?contrato=${contract.id}`}>
            <ArrowLeft /> Voltar
          </Link>
        </Button>
        <PrintButton />
      </div>
      {!generated ? (
        <p className="no-print mb-4 rounded-lg border border-warning/35 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          Prévia: o documento ainda não foi gerado para assinatura. Gere-o no contrato para fixar o código de integridade.
        </p>
      ) : !hashMatches ? (
        <p className="no-print mb-4 rounded-lg border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-fg">
          O conteúdo atual difere do documento gerado para assinatura. Gere uma nova versão antes de colher assinaturas.
        </p>
      ) : null}

      <article id="contrato-impressao" className="rounded-xl border border-border bg-surface p-6 text-[13px] leading-relaxed text-foreground shadow-card md:p-10">
        <header className="flex flex-col gap-4 border-b-2 border-brand pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-2xl font-bold tracking-tight">{companyName}</p>
            <p className="text-muted">{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-lg font-semibold">Contrato de licenciamento e serviços</p>
            <p className="tabular-nums">
              {contract.number} · versão {contract.version}
            </p>
            <p className="text-muted">Emitido em {formatDate(detail.sentAt ?? contract.createdAt)}</p>
            <p className="text-muted">Situação: {CONTRACT_STATUS_LABELS[contract.status]}</p>
          </div>
        </header>

        <section className="grid gap-4 border-b border-border py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contratante</h2>
            <p className="font-semibold">{billingData.legalName ?? client.legalName}</p>
            {client.tradeName !== (billingData.legalName ?? client.legalName) ? <p>{client.tradeName}</p> : null}
            <p>CNPJ/CPF: {formatDocument(billingData.document)}</p>
            <p>{address || "Endereço não informado"}</p>
            {billingData.email ? <p>{billingData.email}</p> : null}
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contratada</h2>
            <p className="font-semibold">{companyName}</p>
            <p>{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
          </div>
        </section>

        <section className="py-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Objeto: produtos e serviços contratados</h2>
          {contract.items.length === 0 ? (
            <p className="text-muted">Nenhum item cadastrado.</p>
          ) : (
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-2">Produto</th>
                  <th className="py-2 pr-2 text-right">Qtd.</th>
                  <th className="py-2 pr-2 text-right">Adesão</th>
                  <th className="py-2 pr-2 text-right">Mensalidade</th>
                  <th className="py-2 pr-2 text-right">Hardware</th>
                  <th className="py-2 text-right">Desconto</th>
                </tr>
              </thead>
              <tbody>
                {contract.items.map((i) => {
                  const net = netItem(i);
                  return (
                    <tr key={i.productId} className="border-b border-border">
                      <td className="py-2 pr-2">{i.productName}</td>
                      <td className="py-2 pr-2 text-right">{i.quantity}</td>
                      <td className="py-2 pr-2 text-right">{formatCurrency(net.setupTotal)}</td>
                      <td className="py-2 pr-2 text-right">{formatCurrency(net.monthlyTotal)}</td>
                      <td className="py-2 pr-2 text-right">{formatCurrency(net.hardwareTotal)}</td>
                      <td className="py-2 text-right">{i.discountPct > 0 ? `${i.discountPct}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <dl className="ml-auto mt-4 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
            <dt className="text-muted">Adesão / setup</dt>
            <dd className="text-right font-semibold">{formatCurrency(contract.setupTotal)}</dd>
            <dt className="text-muted">Mensalidade</dt>
            <dd className="text-right font-semibold">{formatCurrency(contract.monthlyTotal)}</dd>
            <dt className="text-muted">Hardware</dt>
            <dd className="text-right font-semibold">{formatCurrency(contract.hardwareTotal)}</dd>
            <dt className="border-t border-border-strong pt-1 font-semibold">Valor no 1º ano</dt>
            <dd className="border-t border-border-strong pt-1 text-right font-bold">{formatCurrency(firstYear)}</dd>
          </dl>
        </section>

        <section className="grid gap-4 border-t border-border py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Condições</h2>
            <p>Recorrência: {RECURRENCE_LABELS[contract.recurrence]}</p>
            <p>Prazo: {contract.termMonths} meses</p>
            <p>Vencimento: todo dia {contract.billingDay}</p>
            {contract.firstDueDate ? <p>Primeiro vencimento: {formatDate(contract.firstDueDate)}</p> : null}
            {contract.startDate ? (
              <p>
                Vigência: {formatDate(contract.startDate)} a {formatDate(contract.endDate)}
              </p>
            ) : null}
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Condição de pagamento</h2>
            <p className="whitespace-pre-line">{contract.paymentCondition || "—"}</p>
          </div>
        </section>

        <section className="border-t border-border pt-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Assinaturas</h2>
          <div className="grid gap-8 sm:grid-cols-2">
            {signers.map((s) => (
              <div key={s.email} className="pt-8">
                <div className="border-t border-border-strong pt-1 text-center">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-muted">
                    {s.role} · {s.email}
                  </p>
                  {s.signedAt ? (
                    <p className="text-muted">
                      Assinado em {formatDateTime(s.signedAt)}
                      {s.method === "manual" ? " · registro manual com evidência" : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <div className="pt-8">
              <div className="border-t border-border-strong pt-1 text-center">
                <p className="font-semibold">{companyName}</p>
                <p className="text-muted">Contratada</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-border pt-3 text-[11px] text-muted">
          <p>
            Código de integridade (SHA-256 do conteúdo): <span className="break-all font-mono">{generated ? contract.documentHash : currentHash}</span>
            {generated ? ` · documento ${contract.signatureEnvelopeId}` : " · prévia (documento ainda não gerado)"}
          </p>
        </footer>
      </article>
    </div>
  );
}
