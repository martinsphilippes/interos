import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, FileText, GitBranch, History } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getContract } from "@/server/finance/queries";
import { canOperateFinance, FINANCIAL_STATUS_LABELS, FINANCIAL_STATUS_VARIANT } from "@/server/finance/schemas";
import { getIntegrationFlags } from "@/server/integrations/status";
import { formatCurrency, formatDate, formatRelative } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SlaBadge } from "@/components/ui/sla-badge";
import { UserChip } from "@/components/ui/user-chip";
import { Timeline } from "@/components/timeline/timeline";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { BillingDataCard } from "@/components/finance/billing-data-card";
import { ContractBillingCard } from "@/components/finance/contract-billing-card";
import { ContractConditionsCard } from "@/components/finance/contract-conditions-card";
import { buildFlow, ContractFlow } from "@/components/finance/contract-flow";
import { ContractItemsCard } from "@/components/finance/contract-items-card";
import { DocumentsCard } from "@/components/finance/documents-card";
import { PendencyCard } from "@/components/finance/pendency-card";
import { ReleaseCard } from "@/components/finance/release-card";
import { SignatureCard } from "@/components/finance/signature-card";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getContract(id);
  return { title: detail ? `Contrato ${detail.contract.number} — ${detail.client.tradeName}` : "Contrato" };
}

/**
 * Página do contrato: cabeçalho, fluxo visual, dados herdados da venda, itens, condições, signatários e
 * assinatura, cobrança, pendências, documentos, gate de liberação e histórico.
 */
export default async function ContractPage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const { id } = await params;
  const detail = await getContract(id);
  if (!detail) notFound();

  const { contract, client, billings, gate, users, step, project } = detail;
  const canOperate = canOperateFinance(user);
  const closed = contract.status === "liberado" || contract.status === "cancelado";
  const sent = Boolean(contract.signatureEnvelopeId);
  const signedByAll = sent && contract.signers.length > 0 && contract.signers.every((s) => s.status === "assinado");
  const hasBillings = billings.some((b) => b.status !== "cancelada");
  const paymentCheck = gate.checks.find((c) => c.key === "pagamento");
  const owner = contract.ownerId ? users[contract.ownerId] : undefined;

  return (
    <PageContainer>
      <PageHeader
        title={`Contrato ${contract.number}`}
        badge={
          <Badge variant={CONTRACT_STATUS_VARIANT[contract.status]}>
            {CONTRACT_STATUS_LABELS[contract.status]}
          </Badge>
        }
        description={
          <>
            <Link href={`/clientes/${client.id}?aba=financeiro`} className="font-medium text-foreground hover:text-brand">
              {client.tradeName}
            </Link>{" "}
            · versão {contract.version} · criado {formatRelative(contract.createdAt)}
          </>
        }
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contratos", href: "/financeiro/contratos" }, { label: contract.number }]}
        actions={
          <>
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`/financeiro/contratos/${contract.id}/documento`}>
                <FileText /> Ver contrato
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`/clientes/${client.id}?aba=financeiro`}>
                <Building2 /> Ficha do cliente
              </Link>
            </Button>
            {step ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`/workflow?etapa=${step.id}`}>
                  <GitBranch /> Etapa Financeiro
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Resumo */}
      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-4 py-4 md:grid-cols-6">
          <div>
            <p className="label-caps">Mensal</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(contract.monthlyTotal)}</p>
          </div>
          <div>
            <p className="label-caps">Adesão</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(contract.setupTotal)}</p>
          </div>
          <div>
            <p className="label-caps">Hardware</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(contract.hardwareTotal)}</p>
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
          <ContractItemsCard contractId={contract.id} items={contract.items} products={detail.products} canEdit={canOperate && detail.editable} sent={sent} version={contract.version} />
          <ContractConditionsCard contract={contract} canEdit={canOperate && detail.editable} sent={sent} />
          <ContractBillingCard
            contractId={contract.id}
            clientName={client.tradeName}
            billings={billings}
            requiredBillingId={detail.requiredBillingId}
            canOperate={canOperate}
            canGenerate={signedByAll && !hasBillings && contract.status !== "cancelado"}
            waitingSignature={!signedByAll}
          />
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
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ReleaseCard
            contractId={contract.id}
            number={contract.number}
            gate={gate}
            released={contract.releasedAt ? { at: contract.releasedAt, byName: contract.releasedBy ? users[contract.releasedBy]?.name : undefined } : undefined}
            project={project ? { id: project.id, name: project.name, dueDate: project.dueDate, ownerName: users[project.ownerId]?.name } : null}
            canOperate={canOperate}
            isManager={user.isManager}
            closed={closed}
          />
          <SignatureCard
            contract={contract}
            sentAt={detail.sentAt}
            reminders={detail.reminders}
            canOperate={canOperate}
            editable={detail.editable}
            clientName={client.tradeName}
            integrations={getIntegrationFlags()}
          />
          <PendencyCard contractId={contract.id} pendingReason={contract.pendingReason} isPending={contract.status === "pendencia"} closed={closed} canOperate={canOperate} />
          <BillingDataCard
            contractId={contract.id}
            clientId={client.id}
            clientName={client.tradeName}
            data={detail.billingData}
            canEdit={canOperate && !closed}
            fromOpportunity={Boolean(detail.opportunity?.billingData)}
          />
          <DocumentsCard contractId={contract.id} documents={detail.documents} users={users} canOperate={canOperate} />
          {contract.startDate ? (
            <p className="px-1 text-xs text-muted">
              Vigência {formatDate(contract.startDate)} a {formatDate(contract.endDate)}
            </p>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}
