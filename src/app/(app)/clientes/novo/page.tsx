import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ACCESS_DENIED_REDIRECT, can, requireScreen } from "@/server/auth/session";
import { getClientFormOptions } from "@/server/clients/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ClientForm } from "@/components/clients/client-form";
import { NEW_OPPORTUNITY_CLIENT_PARAM } from "@/components/sales/model";

type SearchParams = Promise<{ voltar?: string | string[]; nome?: string | string[] }>;

/** Telas que abrem o cadastro e recebem o cliente de volta (Nova oportunidade). Qualquer outro destino é ignorado. */
const RETURN_PATHS = ["/vendas", "/vendas/pipeline", "/vendas/oportunidades"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata: Metadata = { title: "Novo cliente" };

export default async function NovoClientePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("operacao.clientes");
  // Cadastro exige também a ação de criar (catálogo: /clientes/novo passa a exigir operacao.clientes.criar).
  if (!can(user, "operacao.clientes.criar")) redirect(ACCESS_DENIED_REDIRECT);
  const options = await getClientFormOptions();
  // Vendedor cadastrando já entra como responsável comercial.
  const ownerSalesId = user.departmentId === "vendas" && options.sellers.some((s) => s.id === user.id) ? user.id : "";
  const params = await searchParams;
  // Lista fechada de destinos: evita redirecionamento aberto por ?voltar=.
  const voltar = first(params.voltar);
  const returnPath = voltar && RETURN_PATHS.includes(voltar) ? voltar : undefined;
  const tradeName = first(params.nome)?.trim().slice(0, 120) ?? "";

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Novo cliente"
        description={
          returnPath
            ? "Cadastre a empresa e você volta para a nova oportunidade com o cliente já escolhido. O sistema avisa se já existir cliente com o mesmo CNPJ, telefone ou e-mail."
            : "Cadastre a empresa para iniciar a jornada dela. O sistema avisa se já existir cliente com o mesmo CNPJ, telefone ou e-mail."
        }
        breadcrumbs={[{ label: "Operação" }, { label: "Clientes 360º", href: "/clientes" }, { label: "Novo cliente" }]}
      />
      <ClientForm
        mode="create"
        options={options}
        initial={{ ownerSalesId, ...(tradeName ? { tradeName } : {}) }}
        returnTo={returnPath ? { href: returnPath, param: NEW_OPPORTUNITY_CLIENT_PARAM } : undefined}
      />
    </PageContainer>
  );
}
