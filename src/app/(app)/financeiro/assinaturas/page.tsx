import type { Metadata } from "next";
import { FileText, PenLine } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
import { listSignatureQueue } from "@/server/finance/queries";
import { financeCapabilities } from "@/server/finance/access";
import { getIntegrationFlags } from "@/server/integrations/status";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { SignaturesList } from "@/components/finance/signatures-list";
import { FinanceAccessProvider } from "@/components/finance/finance-access";

export const metadata: Metadata = { title: "Assinaturas" };

/**
 * Contratos aguardando assinatura: quem falta assinar, há quanto tempo, lembretes e ações. Sem provedor de
 * assinatura conectado, o documento é gerado no INTEROS e cada assinatura é registrada com evidência.
 * Acesso (catálogo): tela financeiro.assinaturas; seções Aguardando / Prontos; escopo da tela; operações pelas chaves
 * financeiro.contratos.assinatura.* (financeCapabilities); mensalidade sob os valores do contrato.
 */
export default async function SignaturesPage() {
  const user = await requireScreen("financeiro.assinaturas");
  const caps = financeCapabilities(user);
  const show = { waiting: can(user, "financeiro.assinaturas.aguardando.ver"), toSend: can(user, "financeiro.assinaturas.prontos.ver") };
  const fetched = await listSignatureQueue({ scope: await resolveDataScope(user, "financeiro.assinaturas"), hideValues: !caps.contractValues });
  // Seção negada: a lista não é enviada ao cliente (nem entra nos indicadores).
  const queue = { waiting: show.waiting ? fetched.waiting : [], toSend: show.toSend ? fetched.toSend : [] };
  const integrations = getIntegrationFlags();
  const manual = integrations.assinatura !== "conectado";
  const pendingSigners = queue.waiting.reduce((s, r) => s + r.pendingCount, 0);
  const oldest = queue.waiting.reduce((m, r) => Math.max(m, r.daysWaiting), 0);
  const reminders = queue.waiting.reduce((s, r) => s + r.remindersSent, 0);

  return (
    <FinanceAccessProvider value={caps}>
      <PageContainer size="narrow">
        <PageHeader title="Assinaturas" description={manual ? "Documentos gerados aguardando assinatura e contratos prontos para gerar o documento. Assinatura digital não conectada: envio manual e registro com evidência." : "Envelopes enviados e contratos prontos para envio."} breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Assinaturas" }]} />

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Aguardando assinatura" value={formatNumber(queue.waiting.length)} icon={<PenLine />} tone={queue.waiting.length > 0 ? "info" : "neutral"} compact />
          <StatCard label="Signatários pendentes" value={formatNumber(pendingSigners)} tone={pendingSigners > 0 ? "warning" : "success"} compact />
          <StatCard label="Maior espera" value={`${oldest} dia(s)`} tone={oldest > 5 ? "danger" : oldest > 2 ? "warning" : "neutral"} compact />
          <StatCard label="Lembretes enviados" value={formatNumber(reminders)} hint="desde a geração do documento" compact />
        </div>

        {show.waiting ? (
          <section className="mb-8">
            <SectionTitle title="Aguardando assinatura" count={queue.waiting.length} description="Mais antigos primeiro." />
            {queue.waiting.length === 0 ? (
              <Card>
                <EmptyState size="sm" icon={<PenLine />} title="Nenhum contrato aguardando assinatura" description="Contratos com documento gerado aparecem aqui até todos assinarem." />
              </Card>
            ) : (
              <SignaturesList rows={queue.waiting} mode="waiting" integrations={integrations} />
            )}
          </section>
        ) : null}

        {show.toSend ? (
          <section>
            <SectionTitle title="Prontos para gerar o documento" count={queue.toSend.length} description="Contratos que ainda não tiveram o documento gerado para assinatura." />
            {queue.toSend.length === 0 ? (
              <Card>
                <EmptyState size="sm" icon={<FileText />} title="Nada pendente" description="Todos os contratos já têm o documento gerado para assinatura." />
              </Card>
            ) : (
              <SignaturesList rows={queue.toSend} mode="toSend" integrations={integrations} />
            )}
          </section>
        ) : null}
      </PageContainer>
    </FinanceAccessProvider>
  );
}
