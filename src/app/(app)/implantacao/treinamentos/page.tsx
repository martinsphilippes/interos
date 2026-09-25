import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listTrainings } from "@/server/implementation/queries";
import { canOperateImplementation } from "@/server/implementation/schemas";
import { dateKey } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { TrainingsTab } from "@/components/implementation/trainings-tab";
import { CalendarClock, CheckCircle2, GraduationCap } from "lucide-react";

export const metadata: Metadata = { title: "Treinamentos" };

/** Agenda e registro de treinamentos de todos os projetos de implantação. */
export default async function TrainingsPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "implantacao")) redirect("/meu-dia?erro=sem-permissao");
  const { rows, projects, users, products } = await listTrainings();
  const canOperate = canOperateImplementation(user);
  const now = new Date().toISOString();
  const month = dateKey(now).slice(0, 7);
  const upcoming = rows.filter((r) => r.status === "agendado" && r.scheduledAt >= now);
  const late = rows.filter((r) => r.status === "agendado" && r.scheduledAt < now);
  const doneMonth = rows.filter((r) => r.status === "realizado" && dateKey(r.completedAt ?? r.scheduledAt).slice(0, 7) === month);
  // Agendados primeiro (mais próximos no topo), depois o histórico.
  const ordered = [...upcoming.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)), ...late, ...rows.filter((r) => r.status !== "agendado")];

  return (
    <PageContainer>
      <PageHeader
        title="Treinamentos"
        description="Treinamentos de implantação: agende, registre presença e evidência. O go-live exige pelo menos um realizado."
        breadcrumbs={[{ label: "Implantação", href: "/implantacao" }, { label: "Treinamentos" }]}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Próximos" value={upcoming.length} icon={<CalendarClock />} tone="info" compact />
        <StatCard label="Data passou sem registro" value={late.length} icon={<GraduationCap />} tone={late.length > 0 ? "warning" : "success"} hint="Conclua ou cancele" compact />
        <StatCard label="Realizados no mês" value={doneMonth.length} icon={<CheckCircle2 />} tone="success" compact />
      </div>
      <TrainingsTab
        items={ordered}
        projects={projects}
        products={products}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
        defaultInstructorId={user.id}
        canOperate={canOperate}
        showProject
        allowNew={projects.length > 0}
      />
    </PageContainer>
  );
}
