import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { listDepartmentsForAdmin } from "@/server/admin/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { DepartmentsGrid } from "@/components/admin/departments-grid";

export const metadata: Metadata = { title: "Departamentos" };

/** Quem tem admin.departamentos.editar edita; os demais que veem a tela (gestor/diretoria, no padrão) só leem. */
export default async function DepartamentosPage() {
  const user = await requireScreen("admin.departamentos");
  const { departments, users } = await listDepartmentsForAdmin();
  const canEdit = can(user, "admin.departamentos.editar");
  // Só o necessário chega ao Client Component (nada de e-mail/telefone).
  const userOptions = users.map((u) => ({ id: u.id, name: u.name, active: u.active, departmentId: u.departmentId }));

  return (
    <PageContainer>
      <PageHeader
        title="Departamentos"
        description="As áreas da Intercert, seus gestores e a carga atual de cada uma."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Departamentos" }]}
        badge={!canEdit ? <Badge variant="muted">Somente leitura</Badge> : null}
      />
      <DepartmentsGrid departments={departments} users={userOptions} canEdit={canEdit} />
    </PageContainer>
  );
}
