import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PenLine, Send } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listSignatureQueue } from "@/server/finance/queries";
import { canOperateFinance } from "@/server/finance/schemas";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { SignaturesList } from "@/components/finance/signatures-list";

export const metadata: Metadata = { title: "Assinaturas" };

/** Contratos aguardando assinatura digital: quem falta assinar, há quanto tempo, lembretes e ações. */
export default async function SignaturesPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const queue = await listSignatureQueue();
  const canOperate = canOperateFinance(user);
  const pendingSigners = queue.waiting.reduce((s, r) => s + r.pendingCount, 0);
  const oldest = queue.waiting.reduce((m, r) => Math.max(m, r.daysWaiting), 0);
  const reminders = queue.waiting.reduce((s, r) => s + r.remindersSent, 0);

  return (
    <PageContainer size="narrow">
      <PageHeader title="Assinaturas" description="Envelopes enviados e contratos prontos para envio." breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Assinaturas" }]} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Aguardando assinatura" value={formatNumber(queue.waiting.length)} icon={<PenLine />} tone={queue.waiting.length > 0 ? "info" : "neutral"} compact />
        <StatCard label="Signatários pendentes" value={formatNumber(pendingSigners)} tone={pendingSigners > 0 ? "warning" : "success"} compact />
        <StatCard label="Maior espera" value={`${oldest} dia(s)`} tone={oldest > 5 ? "danger" : oldest > 2 ? "warning" : "neutral"} compact />
        <StatCard label="Lembretes enviados" value={formatNumber(reminders)} hint="desde o último envio" compact />
      </div>

      <section className="mb-8">
        <SectionTitle title="Aguardando assinatura" count={queue.waiting.length} description="Mais antigos primeiro." />
        {queue.waiting.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<PenLine />} title="Nenhum contrato aguardando assinatura" description="Contratos enviados para assinatura aparecem aqui até todos assinarem." />
          </Card>
        ) : (
          <SignaturesList rows={queue.waiting} mode="waiting" canOperate={canOperate} />
        )}
      </section>

      <section>
        <SectionTitle title="Prontos para envio" count={queue.toSend.length} description="Contratos gerados que ainda não foram enviados para assinatura." />
        {queue.toSend.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<Send />} title="Nada para enviar" description="Todos os contratos gerados já foram enviados." />
          </Card>
        ) : (
          <SignaturesList rows={queue.toSend} mode="toSend" canOperate={canOperate} />
        )}
      </section>
    </PageContainer>
  );
}
