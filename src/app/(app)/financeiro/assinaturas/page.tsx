import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText, PenLine } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listSignatureQueue } from "@/server/finance/queries";
import { canOperateFinance } from "@/server/finance/schemas";
import { getIntegrationFlags } from "@/server/integrations/status";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { SignaturesList } from "@/components/finance/signatures-list";

export const metadata: Metadata = { title: "Assinaturas" };

/**
 * Contratos aguardando assinatura: quem falta assinar, há quanto tempo, lembretes e ações. Sem provedor de
 * assinatura conectado, o documento é gerado no INTEROS e cada assinatura é registrada com evidência.
 */
export default async function SignaturesPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const queue = await listSignatureQueue();
  const canOperate = canOperateFinance(user);
  const integrations = getIntegrationFlags();
  const manual = integrations.assinatura !== "conectado";
  const pendingSigners = queue.waiting.reduce((s, r) => s + r.pendingCount, 0);
  const oldest = queue.waiting.reduce((m, r) => Math.max(m, r.daysWaiting), 0);
  const reminders = queue.waiting.reduce((s, r) => s + r.remindersSent, 0);

  return (
    <PageContainer size="narrow">
      <PageHeader title="Assinaturas" description={manual ? "Documentos gerados aguardando assinatura e contratos prontos para gerar o documento. Assinatura digital não conectada: envio manual e registro com evidência." : "Envelopes enviados e contratos prontos para envio."} breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Assinaturas" }]} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Aguardando assinatura" value={formatNumber(queue.waiting.length)} icon={<PenLine />} tone={queue.waiting.length > 0 ? "info" : "neutral"} compact />
        <StatCard label="Signatários pendentes" value={formatNumber(pendingSigners)} tone={pendingSigners > 0 ? "warning" : "success"} compact />
        <StatCard label="Maior espera" value={`${oldest} dia(s)`} tone={oldest > 5 ? "danger" : oldest > 2 ? "warning" : "neutral"} compact />
        <StatCard label="Lembretes enviados" value={formatNumber(reminders)} hint="desde a geração do documento" compact />
      </div>

      <section className="mb-8">
        <SectionTitle title="Aguardando assinatura" count={queue.waiting.length} description="Mais antigos primeiro." />
        {queue.waiting.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<PenLine />} title="Nenhum contrato aguardando assinatura" description="Contratos com documento gerado aparecem aqui até todos assinarem." />
          </Card>
        ) : (
          <SignaturesList rows={queue.waiting} mode="waiting" canOperate={canOperate} integrations={integrations} />
        )}
      </section>

      <section>
        <SectionTitle title="Prontos para gerar o documento" count={queue.toSend.length} description="Contratos que ainda não tiveram o documento gerado para assinatura." />
        {queue.toSend.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<FileText />} title="Nada pendente" description="Todos os contratos já têm o documento gerado para assinatura." />
          </Card>
        ) : (
          <SignaturesList rows={queue.toSend} mode="toSend" canOperate={canOperate} integrations={integrations} />
        )}
      </section>
    </PageContainer>
  );
}
