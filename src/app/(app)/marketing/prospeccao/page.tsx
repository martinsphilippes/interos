import type { Metadata } from "next";
import { Crosshair, PhoneCall, Target, Users } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMarketingOptions, listProspectLists } from "@/server/marketing/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NewProspectListDialog, ProspectListsView } from "@/components/marketing/prospect-lists-view";

export const metadata: Metadata = { title: "Prospecção Ativa" };

/** Prospecção ativa: listas de contatos com totais reais (calculados dos prospects). */
export default async function ProspeccaoPage() {
  await requireUser();
  const [lists, options] = await Promise.all([listProspectLists(), getMarketingOptions()]);
  const active = lists.filter((l) => l.status === "ativa");
  const sum = (key: "contacts" | "attempts" | "responses" | "opportunities" | "converted") => lists.reduce((s, l) => s + l.computed[key], 0);
  const contacts = sum("contacts");

  return (
    <PageContainer>
      <PageHeader
        title="Prospecção Ativa"
        description="Listas de contatos para abordagem ativa: tentativas, respostas e conversão por responsável."
        breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Prospecção Ativa" }]}
        actions={<NewProspectListDialog options={options} />}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Listas ativas" value={formatNumber(active.length)} icon={<Crosshair />} tone="info" hint={`${lists.length} no total`} compact />
        <StatCard label="Contatos" value={formatNumber(contacts)} icon={<Users />} tone="neutral" hint={`${formatNumber(lists.reduce((s, l) => s + l.computed.pending, 0))} ainda sem resposta`} compact />
        <StatCard label="Tentativas" value={formatNumber(sum("attempts"))} icon={<PhoneCall />} tone="neutral" hint={`${formatNumber(sum("responses"))} respostas`} compact />
        <StatCard label="Oportunidades geradas" value={formatNumber(sum("opportunities"))} icon={<Target />} tone="success" hint={`Conversão ${formatPercent(contacts ? sum("converted") / contacts : null)}`} compact />
      </div>
      <ProspectListsView lists={lists} options={options} />
    </PageContainer>
  );
}
