import { Suspense } from "react";
import type { Client, CurrentUser } from "@/domain/types";
import { can } from "@/server/auth/session";
import { getErpCompanyView } from "@/server/erp/company-view";
import { Skeleton } from "@/components/ui/skeleton";
import { ErpWorkspace, type ErpSubView, type ErpWorkspaceCaps } from "./erp-workspace";
import type { ProvisionDefaults } from "./erp-provision-dialog";

/**
 * Aba Módulos ERP da ficha (seção operacao.clientes.erp.ver, conferida pela página). A leitura do ERP pode levar alguns
 * segundos: a aba carrega em streaming, sem segurar o resto da ficha.
 */
export function TabErp({ user, client, initialView }: { user: CurrentUser; client: Client; initialView?: string }) {
  return (
    <Suspense fallback={<ErpTabSkeleton />}>
      <ErpTabContent user={user} client={client} initialView={initialView} />
    </Suspense>
  );
}

const SUB_VIEWS = new Set<ErpSubView>(["modulos", "torre", "historico"]);

async function ErpTabContent({ user, client, initialView }: { user: CurrentUser; client: Client; initialView?: string }) {
  const caps: ErpWorkspaceCaps = {
    userId: user.id,
    change: can(user, "operacao.clientes.erp.alterar"),
    approve: can(user, "operacao.clientes.erp.aprovar"),
    provision: can(user, "operacao.clientes.erp.provisionar"),
    history: can(user, "operacao.clientes.erp-historico.ver"),
    tower: can(user, "operacao.clientes.erp-torre.ver"),
    importCatalog: can(user, "admin.integracoes.erp-catalogo"),
  };
  const view = await getErpCompanyView(client.id, { withHistory: caps.history });
  const a = client.address ?? {};
  const defaults: ProvisionDefaults = {
    razaoSocial: client.legalName ?? "",
    nomeFantasia: client.tradeName ?? "",
    cnpj: client.document ?? "",
    email: client.email ?? "",
    telefone: client.phone ?? "",
    endereco: { cep: a.zip ?? "", logradouro: a.street ?? "", numero: a.number ?? "", complemento: a.complement ?? "", bairro: a.district ?? "", municipio: a.city ?? "", uf: (a.state ?? "").slice(0, 2).toUpperCase() },
  };
  const sub = initialView && SUB_VIEWS.has(initialView as ErpSubView) ? (initialView as ErpSubView) : undefined;
  return <ErpWorkspace clientId={client.id} clientName={client.tradeName} view={view} caps={caps} defaults={defaults} initialView={sub} />;
}

function ErpTabSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando módulos do ERP">
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-9 w-80 rounded-lg" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-xl" />
      ))}
    </div>
  );
}
