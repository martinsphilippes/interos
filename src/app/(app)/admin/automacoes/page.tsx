import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, Plus, Timer, Zap } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { getAutomationsOverview } from "@/server/automations/queries";
import { dateKey, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button-variants";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { RulesList } from "@/components/automations/rules-list";
import { RunSweepsButton, SweepsPanel } from "@/components/automations/sweeps-panel";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";

export const metadata: Metadata = { title: "Automações" };

/** Regras TRIGGER → CONDIÇÃO → AÇÃO, varreduras agendadas e demonstração do assistente (blocos e botões por permissão). */
export default async function AdminAutomacoesPage() {
  const user = await requireScreen("admin.automacoes");
  const canCreate = can(user, "admin.automacoes.criar");
  const showSweeps = can(user, "admin.automacoes.varreduras.ver");
  const canRunSweeps = showSweeps && can(user, "admin.automacoes.executar-varredura");
  const showExecutive = can(user, "gestao.cockpit.sugestoes.ver");
  const showCommercial = can(user, "vendas.central.sugestoes.ver");
  const { rules, sweeps: allSweeps, stats } = await getAutomationsOverview();
  // Seção negada: os dados das varreduras não chegam ao cliente.
  const sweeps = showSweeps ? allSweeps : [];
  const sweepErrors = sweeps.filter((s) => s.lastStatus === "erro").length;
  const period = dateKey(new Date()).slice(0, 7);

  return (
    <PageContainer>
      <PageHeader
        title="Automações"
        description="Regras que reagem a eventos (gatilho → condições → ações) e varreduras agendadas que mantêm a operação em dia."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Automações" }]}
        actions={
          canRunSweeps || canCreate ? (
            <>
              {canRunSweeps ? <RunSweepsButton /> : null}
              {canCreate ? (
                <Link href="/admin/automacoes/nova" className={buttonVariants({ className: "min-h-[44px] md:min-h-0" })}>
                  <Plus /> Nova automação
                </Link>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Regras ativas" value={`${formatNumber(stats.active)}/${formatNumber(stats.total)}`} icon={<Zap />} tone={stats.active > 0 ? "info" : "neutral"} compact />
        <StatCard label="Execuções em 7 dias" value={formatNumber(stats.runs7d)} icon={<Activity />} tone="neutral" hint="Sucesso e erro (sem as ignoradas)" compact />
        <StatCard label="Erros em 7 dias" value={formatNumber(stats.errors7d)} icon={<AlertTriangle />} tone={stats.errors7d > 0 ? "danger" : "success"} compact />
        {showSweeps ? <StatCard label="Varreduras com erro" value={formatNumber(sweepErrors)} icon={<Timer />} tone={sweepErrors > 0 ? "danger" : "success"} hint={`${sweeps.length} varreduras nativas`} compact /> : null}
      </div>

      <section className="mb-8">
        <SectionTitle title="Regras" count={rules.length} description="Ative ou desative direto na lista; clique para editar, testar e ver o histórico." />
        <RulesList rules={rules} canToggle={can(user, "admin.automacoes.ativar")} canCreate={canCreate} />
      </section>

      {showSweeps ? (
      <section className="mb-8">
        <SectionTitle
          title="Varreduras agendadas"
          description="Rodam pelo cron diário (/api/cron/sweep), pelo botão acima e, de forma preguiçosa, quando as telas dos módulos são abertas. Cada uma respeita a própria frequência."
        />
        <SweepsPanel sweeps={sweeps} />
      </section>
      ) : null}

      {showExecutive || showCommercial ? (
      <section>
        <SectionTitle title="Assistente" description="Demonstração do ponto de extensão de IA: sugestões por regras determinísticas, complementadas pela IA quando ANTHROPIC_API_KEY está configurada." />
        <div className="grid gap-3 lg:grid-cols-2">
          {showExecutive ? <AgentSuggestions kind="executivo" subjectId={period} title="Sugestões para a diretoria" /> : null}
          {showCommercial ? <AgentSuggestions kind="comercial" subjectId={user.id} title="Sua carteira comercial" /> : null}
        </div>
      </section>
      ) : null}
    </PageContainer>
  );
}
