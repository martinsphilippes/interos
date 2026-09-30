import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { can, getCurrentUser, requireScreen } from "@/server/auth/session";
import { getEditorOptions, getRuleDetail, triggerLabel } from "@/server/automations/queries";
import { groupedEventTypes } from "@/server/automations/schemas";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { RuleEditor } from "@/components/automations/rule-editor";
import { RunsHistory } from "@/components/automations/runs-history";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  if (id === "nova") return { title: "Nova automação" };
  // A30: sem acesso à tela, nada é lido (título genérico).
  const user = await getCurrentUser();
  if (!user || !can(user, "admin.automacoes.ver")) return { title: "Automação" };
  const detail = await getRuleDetail(id);
  return { title: detail ? detail.rule.name : "Automação não encontrada" };
}

/** Criar (/admin/automacoes/nova) ou editar uma regra, testar e ver o histórico de execuções. */
export default async function AutomationRulePage({ params }: { params: Params }) {
  const user = await requireScreen("admin.automacoes");
  const { id } = await params;
  const isNew = id === "nova";
  if (isNew && !can(user, "admin.automacoes.criar")) redirect("/admin/automacoes");
  const showHistory = can(user, "admin.automacoes.historico.ver");
  const [detail, options] = await Promise.all([isNew ? Promise.resolve(null) : getRuleDetail(id), getEditorOptions()]);
  if (!isNew && !detail) notFound();
  const eventGroups = groupedEventTypes();

  return (
    <PageContainer size="narrow">
      <PageHeader
        title={detail ? detail.rule.name : "Nova automação"}
        description={detail ? triggerLabel(detail.rule) : "Defina o gatilho, as condições e as ações. Teste antes de ativar."}
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Automações", href: "/admin/automacoes" }, { label: detail ? detail.rule.name : "Nova" }]}
        badge={detail ? <Badge variant={detail.rule.active ? "success" : "muted"}>{detail.rule.active ? "Ativa" : "Inativa"}</Badge> : null}
      />
      <RuleEditor key={detail?.rule.updatedAt ?? "nova"} rule={detail?.rule ?? null} options={options} eventGroups={eventGroups} />
      {detail && showHistory ? (
        <section className="mt-8">
          <SectionTitle
            title="Histórico de execuções"
            count={detail.stats.total}
            description={`${formatNumber(detail.stats.success)} sucesso · ${formatNumber(detail.stats.errors)} erro · ${formatNumber(detail.stats.ignored)} ignorada(s)`}
          />
          <RunsHistory runs={detail.runs} total={detail.stats.total} />
        </section>
      ) : null}
    </PageContainer>
  );
}
