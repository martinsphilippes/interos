import type { Metadata } from "next";
import { requireRole } from "@/server/auth/session";
import { listDepartmentsForAdmin } from "@/server/admin/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { DepartmentsGrid } from "@/components/admin/departments-grid";

export const metadata: Metadata = { title: "Departamentos" };

/** Admin edita; gestor e diretoria veem em modo leitura. */
export default async function DepartamentosPage() {
  const user = await requireRole("admin", "gestor", "diretoria");
  const { departments, users } = await listDepartmentsForAdmin();
  const canEdit = user.isAdmin;
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
