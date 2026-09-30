import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, FileText, GitBranch, History } from "lucide-react";
import { ACCESS_DENIED_REDIRECT, getCurrentUser, requireScreen } from "@/server/auth/session";
import { getContract, redactContractDetail } from "@/server/finance/queries";
import { FINANCIAL_STATUS_LABELS, FINANCIAL_STATUS_VARIANT } from "@/server/finance/schemas";
import { contractAccessById, financeCapabilities } from "@/server/finance/access";
import { stripBoleto } from "@/server/finance/redact";
import { getIntegrationFlags } from "@/server/integrations/status";
import { formatDate, formatRelative } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { ScreenLink } from "@/components/auth/access-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SlaBadge } from "@/components/ui/sla-badge";
import { UserChip } from "@/components/ui/user-chip";
import { Timeline } from "@/components/timeline/timeline";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { BillingDataCard } from "@/components/finance/billing-data-card";
import { CancelContractCard } from "@/components/finance/cancel-contract-button";
import { ContractAmendmentsCard } from "@/components/finance/contract-amendments-card";
import { ContractBillingCard } from "@/components/finance/contract-billing-card";
import { ContractConditionsCard } from "@/components/finance/contract-conditions-card";
import { buildFlow, ContractFlow } from "@/components/finance/contract-flow";
import { ContractItemsCard } from "@/components/finance/contract-items-card";
import { ContractSummaryCard } from "@/components/finance/contract-summary-card";
import { DocumentsCard } from "@/components/finance/documents-card";
import { PendencyCard } from "@/components/finance/pendency-card";
import { ReleaseCard } from "@/components/finance/release-card";
import { SignatureCard } from "@/components/finance/signature-card";
import { FinanceAccessProvider } from "@/components/finance/finance-access";
import { money, RESTRICTED_HINT } from "@/components/finance/values";

type Params = Promise<{ id: string }>;

/** Título com número e cliente só para quem abre o contrato (tela + escopo, A30); os demais veem "Contrato". */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user || (await contractAccessById(user, id)) !== "ok") return { title: "Contrato" };
  const detail = await getContract(id);
  return { title: detail ? `Contrato ${detail.contract.number} — ${detail.client.tradeName}` : "Contrato" };
}

/**
 * Página do contrato: cabeçalho, fluxo visual, dados herdados da venda, itens, condições, signatários e
 * assinatura, cobrança, pendências, documentos, gate de liberação e histórico.
 * Acesso (catálogo): tela financeiro.contratos + escopo do contrato (fora do escopo → aviso de acesso negado);
 * seções Assinatura, Aditivos, Pendências, Documentos e Histórico (seção negada não é renderizada nem enviada);
 * valores sob financeiro.valores.ver ∧ financeiro.contratos.valores.ver (sem eles, "Restrito" e números zerados);
 * cada botão pela chave da ação (financeCapabilities; as actions revalidam).
 */
export default async function ContractPage({ params }: { params: Params }) {
  const user = await requireScreen("financeiro.contratos");
  const { id } = await params;
  // Escopo antes de carregar o detalhe: contrato de outro dono fora do escopo → aviso de acesso negado.
  const access = await contractAccessById(user, id);
  if (access === "missing") notFound();
  if (access === "denied") redirect(ACCESS_DENIED_REDIRECT);
  const raw = await getContract(id);
  if (!raw) notFound();
  const caps = financeCapabilities(user);
  const hidden = !caps.contractValues;
  const valued = hidden ? redactContractDetail(raw) : raw;
  const detail = caps.billings.boletoView ? valued : { ...valued, billings: valued.billings.map(stripBoleto) };

  const { contract, client, billings, gate, users, step, project } = detail;
  const sections = caps.contracts;
  const closed = contract.status === "liberado" || contract.status === "cancelado";
  const sent = Boolean(contract.signatureEnvelopeId);
  const signedByAll = sent && contract.signers.length > 0 && contract.signers.every((s) => s.status === "assinado");
  const hasBillings = billings.some((b) => b.status !== "cancelada");
  const paymentCheck = gate.checks.find((c) => c.key === "pagamento");
  const owner = contract.ownerId ? users[contract.ownerId] : undefined;

  return (
    <FinanceAccessProvider value={caps}>
      <PageContainer>
        <PageHeader
          title={`Contrato ${contract.number}`}
          badge={
            <>
              <Badge variant={CONTRACT_STATUS_VARIANT[contract.status]}>
                {CONTRACT_STATUS_LABELS[contract.status]}
              </Badge>
              {detail.expired ? (
                <Badge variant="danger" title={`Vigência terminou em ${formatDate(contract.endDate)} sem renovação`}>
                  Vencido
                </Badge>
              ) : null}
            </>
          }
          description={
            <>
              <ScreenLink href={`/clientes/${client.id}?aba=financeiro`} className="font-medium text-foreground hover:text-brand" fallback={<span className="font-medium text-foreground">{client.tradeName}</span>}>
                {client.tradeName}
              </ScreenLink>{" "}
              · versão {contract.version}
              {sections.historyView && sections.documentsView && (contract.previousVersions?.length ?? 0) > 0 ? (
                <>
                  {" "}
                  (<Link href={`/financeiro/contratos/${contract.id}/documento?versao=${contract.previousVersions![contract.previousVersions!.length - 1].version}`} className="hover:text-brand">
                    {contract.previousVersions!.length} anterior(es)
                  </Link>)
                </>
              ) : null}{" "}
              · criado {formatRelative(contract.createdAt)}
            </>
          }
          breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contratos", href: "/financeiro/contratos" }, { label: contract.number }]}
          actions={
            <>
              {sections.documentsView ? (
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link href={`/financeiro/contratos/${contract.id}/documento`}>
                    <FileText /> Ver contrato
                  </Link>
                </Button>
              ) : null}
              <ScreenLink href={`/clientes/${client.id}?aba=financeiro`} className={buttonVariants({ variant: "outline", className: "h-11 md:h-9" })}>
                <Building2 /> Ficha do cliente
              </ScreenLink>
              {step ? (
                <ScreenLink href={`/workflow?etapa=${step.id}`} className={buttonVariants({ variant: "outline", className: "h-11 md:h-9" })}>
                  <GitBranch /> Etapa Financeiro
                </ScreenLink>
              ) : null}
            </>
          }
        />

        {contract.status === "cancelado" ? (
          <p className="mb-4 rounded-lg border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-fg">
            Contrato cancelado{contract.cancelledAt ? ` em ${formatDate(contract.cancelledAt)}` : ""}
            {contract.cancelledBy && users[contract.cancelledBy] ? ` por ${users[contract.cancelledBy].name}` : ""}
            {contract.cancelReason ? ` · Motivo: ${contract.cancelReason}` : ""}
          </p>
        ) : null}

        {/* Resumo */}
        <Card className="mb-4">
          <CardContent className="grid grid-cols-2 gap-4 py-4 md:grid-cols-6">
            <div>
              <p className="label-caps">Mensal</p>
              <p className="text-lg font-semibold tabular-nums" title={hidden ? RESTRICTED_HINT : undefined}>{money(contract.monthlyTotal, hidden)}</p>
            </div>
            <div>
              <p className="label-caps">Adesão</p>
              <p className="text-lg font-semibold tabular-nums" title={hidden ? RESTRICTED_HINT : undefined}>{money(contract.setupTotal, hidden)}</p>
            </div>
            <div>
              <p className="label-caps">Hardware</p>
              <p className="text-lg font-semibold tabular-nums" title={hidden ? RESTRICTED_HINT : undefined}>{money(contract.hardwareTotal, hidden)}</p>
            </div>
            <div>
              <p className="label-caps">Situação financeira</p>
              <Badge variant={FINANCIAL_STATUS_VARIANT[contract.financialStatus]} size="sm" className="mt-1">
                {FINANCIAL_STATUS_LABELS[contract.financialStatus]}
              </Badge>
            </div>
            <div className="min-w-0">
              <p className="label-caps">Responsável</p>
              <div className="mt-1">{owner ? <UserChip name={owner.name} avatarUrl={owner.avatarUrl} size="sm" /> : <span className="text-sm text-muted">—</span>}</div>
            </div>
            <div>
              <p className="label-caps">SLA da etapa</p>
              <div className="mt-1">
                {step?.sla && !closed ? <SlaBadge state={step.sla.state} remainingMs={step.sla.remainingMs} /> : <span className="text-sm text-muted">{closed ? "Etapa encerrada" : "—"}</span>}
              </div>
            </div>
          </CardContent>
          <div className="border-t border-border px-5 py-4">
            <ContractFlow steps={buildFlow(contract, billings, paymentCheck ? paymentCheck.ok : hasBillings)} />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <ContractSummaryCard summary={detail.summary} />
            {/* Itens e condições (a condição de pagamento cita valores) pedem os valores para editar; dados de faturamento, só a chave. */}
            <ContractItemsCard contractId={contract.id} items={contract.items} products={detail.products} canEdit={sections.edit && !hidden && detail.editable} sent={sent} version={contract.version} amendable={signedByAll && !closed} />
            <ContractConditionsCard contract={contract} canEdit={sections.edit && !hidden && detail.editable} sent={sent} amendable={signedByAll && !closed} />
            {sections.amendmentsView && (signedByAll || detail.amendments.length > 0) ? <ContractAmendmentsCard contract={contract} amendments={detail.amendments} products={detail.products} closed={contract.status === "cancelado"} /> : null}
            {caps.billings.view ? (
              <ContractBillingCard
                contractId={contract.id}
                clientName={client.tradeName}
                billings={billings}
                requiredBillingId={detail.requiredBillingId}
                canGenerate={signedByAll && !hasBillings && contract.status !== "cancelado"}
                waitingSignature={!signedByAll}
                pendingRecurring={detail.pendingRecurring}
                hideValues={hidden}
              />
            ) : null}
            {sections.historyView ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="size-4 text-muted" /> Histórico
                  </CardTitle>
                  <CardDescription>Eventos do contrato, das cobranças e do Financeiro na linha do tempo do cliente.</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Timeline events={detail.history} pageSize={25} emptyTitle="Sem eventos ainda" />
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <ReleaseCard
              contractId={contract.id}
              number={contract.number}
              gate={gate}
              released={contract.releasedAt ? { at: contract.releasedAt, byName: contract.releasedBy ? users[contract.releasedBy]?.name : undefined } : undefined}
              project={project ? { id: project.id, name: project.name, dueDate: project.dueDate, ownerName: users[project.ownerId]?.name } : null}
              closed={closed}
            />
            {sections.signatureView ? (
              <SignatureCard contract={contract} sentAt={detail.sentAt} reminders={detail.reminders} editable={detail.editable} clientName={client.tradeName} integrations={getIntegrationFlags()} />
            ) : null}
            {sections.pendenciesView ? <PendencyCard contractId={contract.id} pendingReason={contract.pendingReason} isPending={contract.status === "pendencia"} closed={closed} /> : null}
            <BillingDataCard
              contractId={contract.id}
              clientId={client.id}
              clientName={client.tradeName}
              data={detail.billingData}
              canEdit={sections.edit && !closed}
              fromOpportunity={Boolean(raw.opportunity?.billingData)}
            />
            {sections.documentsView ? <DocumentsCard contractId={contract.id} documents={detail.documents} users={users} /> : null}
            {sections.cancel && !closed ? <CancelContractCard contractId={contract.id} number={contract.number} openBillings={billings.filter((b) => b.status === "aberta" || b.status === "vencida").length} /> : null}
            {contract.startDate ? (
              <p className="px-1 text-xs text-muted">
                Vigência {formatDate(contract.startDate)} a {formatDate(contract.endDate)}
              </p>
            ) : null}
          </div>
        </div>
      </PageContainer>
    </FinanceAccessProvider>
  );
}
