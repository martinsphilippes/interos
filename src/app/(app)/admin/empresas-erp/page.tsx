import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Building2, CircleDashed, ShieldQuestion } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { getErpCompaniesOverview } from "@/server/erp/companies-overview";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { StatCard } from "@/components/ui/stat-card";
import { ErpCompaniesList } from "@/components/erp/erp-companies-list";

export const metadata: Metadata = { title: "Empresas ERP" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Administração › Empresas ERP: todas as empresas vinculadas ao ERP Intercert no ambiente configurado, numa lista só,
 * com a situação de cada uma (licença registrada, alteração em andamento, última leitura e avisos do ERP) e os
 * clientes ativos ainda sem empresa no ERP. Só lê o INTEROS; as ações ficam na aba Módulos ERP do cliente.
 * `?situacao=` abre já filtrado (ex.: `atencao`, `aguardando_aprovacao`, `sem_vinculo`).
 */
export default async function ErpCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("admin.empresas-erp");
  const sp = await searchParams;
  const overview = await getErpCompaniesOverview();
  const canOpenClient = can(user, "operacao.clientes.erp.ver");
  const rows = overview.rows;
  const count = (pred: (s: (typeof rows)[number]["situation"]) => boolean) => rows.filter((r) => pred(r.situation)).length;
  const initialFilter = typeof sp.situacao === "string" ? sp.situacao : undefined;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Empresas ERP"
        description="Todas as empresas vinculadas ao ERP Intercert: licença, alterações em andamento e avisos do ERP. As ações ficam na aba Módulos ERP de cada cliente."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Empresas ERP" }]}
        badge={overview.environmentLabel ? <Badge variant={overview.environment === "producao" ? "brand" : "info"}>{overview.environmentLabel}</Badge> : null}
      />

      {!overview.configured ? (
        <EmptyState
          icon={<Building2 />}
          title="A integração com o ERP não está configurada neste ambiente"
          description={
            <>
              Configure o endereço e o ambiente do ERP (veja <Link href="/admin/integracoes" className="text-brand-fg hover:underline">Administração › Integrações</Link>) para ver as empresas aqui.
            </>
          }
        />
      ) : (
        <>
          <KpiStrip columns={4} mobileColumns={2}>
            <StatCard label="Vinculadas" value={formatNumber(rows.length)} icon={<Building2 />} tone="info" compact />
            <StatCard
              label="Precisam de atenção"
              value={formatNumber(count((s) => s === "falha" || s === "erro_leitura" || s === "aviso_erp" || s === "aguardando_aprovacao"))}
              icon={<AlertTriangle />}
              tone="warning"
              hint="Falha ao sincronizar, ERP sem resposta, aviso do ERP ou aprovação pendente"
              compact
            />
            <StatCard label="Aguardando aprovação" value={formatNumber(count((s) => s === "aguardando_aprovacao"))} icon={<ShieldQuestion />} tone="neutral" compact />
            <StatCard label="Clientes sem empresa no ERP" value={formatNumber(overview.unlinked.length)} icon={<CircleDashed />} tone="neutral" hint="Ativos ou em implantação" compact />
          </KpiStrip>
          {overview.lastEventAt ? <p className="mb-3 text-xs text-muted">Último evento recebido do ERP: {formatDateTime(overview.lastEventAt)}.</p> : null}
          <ErpCompaniesList rows={rows} unlinked={overview.unlinked} canOpenClient={canOpenClient} initialFilter={initialFilter} />
        </>
      )}
    </PageContainer>
  );
}
