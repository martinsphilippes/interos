import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getProposalDetail } from "@/server/sales/queries";
import { HEADQUARTERS, formatAddressLine } from "@/server/sales/maps";
import { formatCurrency, formatDate, formatDocument, formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { netItem, PROPOSAL_STATUS_LABELS } from "@/components/sales/model";
import { PrintButton } from "@/components/sales/print-button";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Proposta comercial" };

/** Somente a área da proposta vai para a impressão (o shell do app fica oculto). */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden !important; }
  #proposta-impressao, #proposta-impressao * { visibility: visible !important; }
  #proposta-impressao { position: absolute; inset: 0 auto auto 0; width: 100%; margin: 0; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .no-print { display: none !important; }
  /* Na tela a proposta segue o tema escuro; no papel, fundo branco e tinta escura. */
  #proposta-impressao {
    background: #ffffff !important;
    --color-surface: #ffffff;
    --color-foreground: #0f172a;
    --color-muted: #475569;
    --color-muted-light: #64748b;
    --color-border: #e2e8f0;
    --color-border-strong: #94a3b8;
    color: #0f172a !important;
  }
}
`;

/** Proposta imprimível (window.print / salvar como PDF). */
export default async function ProposalPrintPage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const { id } = await params;
  const detail = await getProposalDetail(user, id);
  if (!detail) notFound();
  const { proposal, client, contact, owner, organization } = detail;
  const firstYear = proposal.setupTotal + proposal.monthlyTotal * 12 + proposal.hardwareTotal;

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-4 md:px-6 md:py-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" asChild>
          <Link href={`/vendas/propostas?proposta=${proposal.id}`}>
            <ArrowLeft /> Voltar
          </Link>
        </Button>
        <PrintButton />
      </div>

      <article id="proposta-impressao" className="rounded-xl border border-border bg-surface p-6 text-[13px] leading-relaxed text-foreground shadow-card md:p-10">
        <header className="flex flex-col gap-4 border-b-2 border-brand pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">{organization?.name ?? "Intercert"}</p>
            <p className="text-muted">{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
            {owner ? <p className="text-muted">Consultor: {owner.name}</p> : null}
          </div>
          <div className="sm:text-right">
            <p className="text-lg font-semibold">Proposta comercial</p>
            <p className="tabular-nums">
              {proposal.number} · versão {proposal.version}
            </p>
            <p className="text-muted">Emitida em {formatDate(proposal.sentAt ?? proposal.createdAt)}</p>
            <p className="text-muted">Status: {PROPOSAL_STATUS_LABELS[proposal.effectiveStatus]}</p>
          </div>
        </header>

        <section className="grid gap-4 border-b border-border py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Cliente</h2>
            <p className="font-semibold">{client.legalName}</p>
            {client.tradeName !== client.legalName ? <p>{client.tradeName}</p> : null}
            {client.document ? <p>CNPJ/CPF: {formatDocument(client.document)}</p> : null}
            <p>{formatAddressLine(client.address) || "—"}</p>
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contato</h2>
            <p className="font-semibold">{contact?.name ?? "—"}</p>
            {contact?.role ? <p>{contact.role}</p> : null}
            {contact?.email || client.email ? <p>{contact?.email ?? client.email}</p> : null}
            {contact?.phone || client.phone ? <p>{formatPhone(contact?.phone ?? client.phone)}</p> : null}
          </div>
        </section>

        <section className="py-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Itens</h2>
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
              {proposal.items.map((i) => {
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
          <dl className="ml-auto mt-4 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
            <dt className="text-muted">Adesão / setup</dt>
            <dd className="text-right font-semibold">{formatCurrency(proposal.setupTotal)}</dd>
            <dt className="text-muted">Mensalidade</dt>
            <dd className="text-right font-semibold">{formatCurrency(proposal.monthlyTotal)}</dd>
            <dt className="text-muted">Hardware</dt>
            <dd className="text-right font-semibold">{formatCurrency(proposal.hardwareTotal)}</dd>
            {proposal.discountTotal > 0 ? (
              <>
                <dt className="text-muted">Descontos concedidos</dt>
                <dd className="text-right">{formatCurrency(proposal.discountTotal)}</dd>
              </>
            ) : null}
            <dt className="border-t border-border-strong pt-1 font-semibold">Investimento no 1º ano</dt>
            <dd className="border-t border-border-strong pt-1 text-right font-bold">{formatCurrency(firstYear)}</dd>
          </dl>
        </section>

        <section className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Condições comerciais</h2>
            <p className="whitespace-pre-line">{proposal.conditions || "—"}</p>
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Validade</h2>
            <p>Proposta válida até {formatDate(proposal.validUntil)}.</p>
            {proposal.notes ? (
              <>
                <h2 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Observações</h2>
                <p className="whitespace-pre-line">{proposal.notes}</p>
              </>
            ) : null}
          </div>
        </section>

        <footer className="mt-10 grid gap-8 sm:grid-cols-2">
          <div className="border-t border-border-strong pt-1 text-center text-muted">{organization?.name ?? "Intercert"}</div>
          <div className="border-t border-border-strong pt-1 text-center text-muted">{client.legalName}</div>
        </footer>
      </article>
    </div>
  );
}
