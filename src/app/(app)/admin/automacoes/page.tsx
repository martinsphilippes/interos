import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, Plus, Timer, Zap } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getAutomationsOverview } from "@/server/automations/queries";
import { dateKey, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { RulesList } from "@/components/automations/rules-list";
import { RunSweepsButton, SweepsPanel } from "@/components/automations/sweeps-panel";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";

export const metadata: Metadata = { title: "Automações" };

/** Admin: regras TRIGGER → CONDIÇÃO → AÇÃO, varreduras agendadas e demonstração do assistente. */
export default async function AdminAutomacoesPage() {
  const user = await requireRole("admin");
  const { rules, sweeps, stats } = await getAutomationsOverview();
  const sweepErrors = sweeps.filter((s) => s.lastStatus === "erro").length;
  const period = dateKey(new Date()).slice(0, 7);

  return (
    <PageContainer>
      <PageHeader
        title="Automações"
        description="Regras que reagem a eventos (gatilho → condições → ações) e varreduras agendadas que mantêm a operação em dia."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Automações" }]}
        actions={
          <>
            <RunSweepsButton />
            <Button asChild className="min-h-[44px] md:min-h-0">
              <Link href="/admin/automacoes/nova">
                <Plus /> Nova automação
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Regras ativas" value={`${formatNumber(stats.active)}/${formatNumber(stats.total)}`} icon={<Zap />} tone={stats.active > 0 ? "info" : "neutral"} compact />
        <StatCard label="Execuções em 7 dias" value={formatNumber(stats.runs7d)} icon={<Activity />} tone="neutral" hint="Sucesso e erro (sem as ignoradas)" compact />
        <StatCard label="Erros em 7 dias" value={formatNumber(stats.errors7d)} icon={<AlertTriangle />} tone={stats.errors7d > 0 ? "danger" : "success"} compact />
        <StatCard label="Varreduras com erro" value={formatNumber(sweepErrors)} icon={<Timer />} tone={sweepErrors > 0 ? "danger" : "success"} hint={`${sweeps.length} varreduras nativas`} compact />
      </div>

      <section className="mb-8">
        <SectionTitle title="Regras" count={rules.length} description="Ative ou desative direto na lista; clique para editar, testar e ver o histórico." />
        <RulesList rules={rules} />
      </section>

      <section className="mb-8">
        <SectionTitle
          title="Varreduras agendadas"
          description="Rodam pelo cron diário (/api/cron/sweep), pelo botão acima e, de forma preguiçosa, quando as telas dos módulos são abertas. Cada uma respeita a própria frequência."
        />
        <SweepsPanel sweeps={sweeps} />
      </section>

      <section>
        <SectionTitle title="Assistente" description="Demonstração do ponto de extensão de IA: sugestões por regras determinísticas, complementadas pela IA quando ANTHROPIC_API_KEY está configurada." />
        <div className="grid gap-3 lg:grid-cols-2">
          <AgentSuggestions kind="executivo" subjectId={period} title="Sugestões para a diretoria" />
          <AgentSuggestions kind="comercial" subjectId={user.id} title="Sua carteira comercial" />
        </div>
      </section>
    </PageContainer>
  );
}
