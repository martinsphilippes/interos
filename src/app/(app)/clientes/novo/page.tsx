import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { getClientFormOptions } from "@/server/clients/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ClientForm } from "@/components/clients/client-form";

export const metadata: Metadata = { title: "Novo cliente" };

export default async function NovoClientePage() {
  const user = await requireUser();
  const options = await getClientFormOptions();
  // Vendedor cadastrando já entra como responsável comercial.
  const ownerSalesId = user.departmentId === "vendas" && options.sellers.some((s) => s.id === user.id) ? user.id : "";

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Novo cliente"
        description="Cadastre a empresa para iniciar a jornada dela. O sistema avisa se já existir cliente com o mesmo CNPJ, telefone ou e-mail."
        breadcrumbs={[{ label: "Operação" }, { label: "Clientes 360º", href: "/clientes" }, { label: "Novo cliente" }]}
      />
      <ClientForm mode="create" options={options} initial={{ ownerSalesId }} />
    </PageContainer>
  );
}
