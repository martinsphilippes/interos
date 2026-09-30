import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, History, ListChecks } from "lucide-react";
import { ACCESS_DENIED_REDIRECT, getCurrentUser, requireScreen } from "@/server/auth/session";
import { canSeeInstance } from "@/server/workflow/access";
import { canSeeClientId } from "@/server/clients/access";
import { getInstanceView, getStepDetail, listAssignableUsers } from "@/server/workflow/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { GateDataPanel, WorkflowTimeline } from "@/components/workflow/instance-panels";
import { JourneyStepper } from "@/components/workflow/journey-stepper";
import { InstanceStepPanel } from "@/components/workflow/instance-step-panel";

type Params = Promise<{ instanceId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A30: permissão e escopo ANTES de ler a jornada; sem acesso, título genérico. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { instanceId } = await params;
  const user = await getCurrentUser();
  if (!user || !(await canSeeInstance(user, instanceId))) return { title: "Jornada" };
  const detail = await getInstanceView(instanceId);
  return { title: detail ? `Jornada — ${detail.client.tradeName}` : "Jornada não encontrada" };
}

const INSTANCE_STATUS: Record<string, { label: string; variant: "info" | "success" | "muted" }> = {
  ativo: { label: "Ativa", variant: "info" },
  concluido: { label: "Concluída", variant: "success" },
  cancelado: { label: "Cancelada", variant: "muted" },
};

/** Jornada completa do cliente: stepper, detalhe da etapa selecionada (?etapa=), dados de gate e linha do tempo. */
export default async function InstancePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireScreen("operacao.workflow");
  const [{ instanceId }, sp] = await Promise.all([params, searchParams]);
  // Jornada fora do escopo do usuário (nenhuma etapa dele/do departamento, quando o escopo recorta) = acesso negado.
  if (!(await canSeeInstance(user, instanceId))) redirect(ACCESS_DENIED_REDIRECT);
  const detail = await getInstanceView(instanceId);
  if (!detail) notFound();
  const canOpenClient = await canSeeClientId(user, detail.client.id);

  const requested = first(sp.etapa);
  const selectedId = requested && detail.steps.some((s) => s.step.id === requested) ? requested : (detail.instance.currentStepId ?? detail.steps[detail.steps.length - 1]?.step.id);
  const [stepDetail, users] = await Promise.all([selectedId ? getStepDetail(selectedId, user) : Promise.resolve(null), listAssignableUsers()]);
  const status = INSTANCE_STATUS[detail.instance.status] ?? INSTANCE_STATUS.ativo;
  const doneCount = detail.steps.filter((s) => s.state === "done").length;

  return (
    <PageContainer>
      <PageHeader
        title={detail.client.tradeName}
        description={`${detail.template ? `${detail.template.name} v${detail.template.version}` : "Jornada"} · iniciada em ${detail.startedAtLabel}${detail.completedAtLabel ? ` · concluída em ${detail.completedAtLabel}` : ""} · ${doneCount}/${Math.max(detail.stages.length, detail.steps.length)} etapas concluídas`}
        breadcrumbs={[{ label: "Workflow", href: "/workflow" }, { label: "Jornada" }]}
        badge={<Badge variant={status.variant}>{status.label}</Badge>}
        actions={
          canOpenClient ? (
            <Button asChild variant="outline">
              <Link href={`/clientes/${detail.client.id}`}>
                <Building2 /> Ficha do cliente
              </Link>
            </Button>
          ) : undefined
        }
      />

      <JourneyStepper detail={detail} selectedStepId={selectedId} className="mb-6" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="py-5">
            {stepDetail ? (
              <InstanceStepPanel detail={stepDetail} users={users} currentUserId={user.id} />
            ) : (
              <EmptyState size="sm" title="Nenhuma etapa instanciada" description="A jornada ainda não tem etapas." />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4 text-muted" /> Dados dos gates concluídos
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <GateDataPanel detail={detail} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4 text-muted" /> Linha do tempo do workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <WorkflowTimeline events={detail.timeline} />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
