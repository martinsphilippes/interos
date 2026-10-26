import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ClipboardList, History, Package, PackageSearch, ScanBarcode, Settings2, Undo2, Wallet } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { getStockSettings } from "@/server/stock/service";
import { MOVEMENTS_LIMIT, getStockOverview, listLinkableProducts, listStockMovements, listStockReservations, listStockSerials } from "@/server/stock/queries";
import { STOCK_MOVEMENT_LABELS, STOCK_MOVEMENT_TYPES, STOCK_SERIAL_STATUS_LABELS, STOCK_SERIAL_STATUSES, type StockMovementType, type StockSerialStatus } from "@/domain/stock";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { StockItemList } from "@/components/stock/item-list";
import { StockReservationList } from "@/components/stock/reservation-list";
import { StockMovementList, StockSerialList } from "@/components/stock/history-lists";
import { StockSettingsForm } from "@/components/stock/settings-form";
import type { StockCan, StockTab } from "@/components/stock/model";

export const metadata: Metadata = { title: "Estoque" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: { key: StockTab; label: string; icon: React.ReactNode }[] = [
  { key: "itens", label: "Itens", icon: <Package /> },
  { key: "reservas", label: "Reservas", icon: <ClipboardList /> },
  { key: "movimentacoes", label: "Movimentações", icon: <History /> },
  { key: "series", label: "Números de série", icon: <ScanBarcode /> },
  { key: "configuracao", label: "Configuração", icon: <Settings2 /> },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Operação › Estoque: equipamentos (saldo em mãos, reservado, disponível), reservas por contrato (automáticas na
 * assinatura), movimentações (a trilha de auditoria), números de série e a configuração (aba = seção
 * operacao.estoque.configuracao.ver). Custos sob operacao.estoque.custos.ver; cada botão pela sua chave (as actions
 * revalidam).
 */
export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("operacao.estoque");
  const sp = await searchParams;
  const caps: StockCan = {
    costs: can(user, "operacao.estoque.custos.ver"),
    editItems: can(user, "operacao.estoque.itens.editar"),
    entry: can(user, "operacao.estoque.entrada.registrar"),
    exit: can(user, "operacao.estoque.saida.registrar"),
    reservations: can(user, "operacao.estoque.reservas.gerenciar"),
    adjust: can(user, "operacao.estoque.ajustar"),
    configEdit: can(user, "operacao.estoque.configuracao.editar"),
  };
  const configView = can(user, "operacao.estoque.configuracao.ver");
  const visible = TABS.filter((t) => t.key !== "configuracao" || configView);
  const requested = one(sp.aba) as StockTab | undefined;
  const tab: StockTab = visible.some((t) => t.key === requested) ? requested! : "itens";
  const itemFilter = one(sp.item);
  const typeFilter = STOCK_MOVEMENT_TYPES.includes(one(sp.tipo) as StockMovementType) ? (one(sp.tipo) as StockMovementType) : undefined;
  const statusFilter = STOCK_SERIAL_STATUSES.includes(one(sp.situacao) as StockSerialStatus) ? (one(sp.situacao) as StockSerialStatus) : undefined;
  const q = one(sp.q)?.slice(0, 80);

  const [overview, settings, products, reservations, movements, serials] = await Promise.all([
    getStockOverview({ showCost: caps.costs }),
    getStockSettings(),
    tab === "itens" && caps.editItems ? listLinkableProducts() : Promise.resolve([]),
    tab === "reservas" ? listStockReservations() : Promise.resolve([]),
    tab === "movimentacoes" ? listStockMovements({ itemId: itemFilter, type: typeFilter, showCost: caps.costs }) : Promise.resolve([]),
    tab === "series" ? listStockSerials({ itemId: itemFilter, status: statusFilter, q }) : Promise.resolve([]),
  ]);
  const t = overview.totals;
  const itemOptions = overview.items.filter((i) => i.active || i.id === itemFilter);
  const serialItems = itemOptions.filter((i) => i.serialControlled);

  return (
    <PageContainer size="full" className="max-w-[1480px]">
      <PageHeader
        title="Estoque"
        description={`Equipamentos: o que há, o que está reservado para contratos, o que falta e onde cada unidade está · responsável: ${DEPARTMENT_LABELS[settings.responsibleDepartment]}`}
        breadcrumbs={[{ label: "Operação" }, { label: "Estoque" }]}
      />

      {!settings.reserveOnSign ? (
        <p role="status" className="mb-4 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted">
          A reserva automática na assinatura do contrato está desligada: reserve pelo número do contrato na aba Reservas.
        </p>
      ) : null}

      <KpiStrip columns={4} mobileColumns={2}>
        <StatCard label="Itens ativos" value={t.activeItems} icon={<Package />} tone="info" hint={`${t.units} unidade(s) em estoque · ${t.reserved} reservada(s)`} href="/estoque?aba=itens" compact />
        <StatCard
          label="Abaixo do mínimo"
          value={t.belowMinimum}
          icon={<AlertTriangle />}
          tone={t.belowMinimum > 0 ? "warning" : "success"}
          valueTone={t.belowMinimum > 0}
          href="/estoque?aba=itens"
          compact
        />
        <StatCard
          label="Reservas aguardando"
          value={t.waitingReservations}
          icon={<PackageSearch />}
          tone={t.waitingReservations > 0 ? "warning" : "neutral"}
          hint={t.missing > 0 ? `${t.missing} unidade(s) a comprar/repor` : undefined}
          href="/estoque?aba=reservas"
          compact
        />
        {t.value !== null ? (
          <StatCard label="Valor em estoque" value={formatCurrency(t.value)} icon={<Wallet />} tone="neutral" hint="pelo custo médio" compact />
        ) : (
          <StatCard label="Devoluções pendentes" value={t.pendingReturns} icon={<Undo2 />} tone={t.pendingReturns > 0 ? "danger" : "neutral"} href="/estoque?aba=reservas" compact />
        )}
      </KpiStrip>
      {t.value !== null && t.pendingReturns > 0 ? (
        <p role="status" className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {t.pendingReturns} reserva(s) de contrato cancelado com equipamento ainda no cliente.{" "}
          <Link href="/estoque?aba=reservas" className="font-medium underline">
            Ver devoluções pendentes
          </Link>
        </p>
      ) : null}

      <nav aria-label="Estoque" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
        {visible.map((x) => {
          const active = x.key === tab;
          return (
            <Link
              key={x.key}
              href={`/estoque?aba=${x.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors md:min-h-[40px] [&_svg]:size-4",
                active ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {x.icon}
              {x.label}
            </Link>
          );
        })}
      </nav>

      {tab === "itens" ? <StockItemList rows={overview.items} products={products} can={caps} focusId={itemFilter} /> : null}
      {tab === "reservas" ? <StockReservationList rows={reservations} can={caps} /> : null}

      {tab === "movimentacoes" || tab === "series" ? (
        <form method="get" action="/estoque">
          <input type="hidden" name="aba" value={tab} />
          <FilterBar
            actions={
              <>
                <Button type="submit" variant="outline" className="h-11 md:h-9">
                  Filtrar
                </Button>
                {itemFilter || typeFilter || statusFilter || q ? (
                  <Button asChild variant="ghost" className="h-11 md:h-9">
                    <Link href={`/estoque?aba=${tab}`}>Limpar</Link>
                  </Button>
                ) : null}
              </>
            }
          >
            <FilterField label="Item" htmlFor="f-item">
              <Select id="f-item" name="item" defaultValue={itemFilter ?? ""} className="h-11 md:h-9">
                <option value="">Todos</option>
                {(tab === "series" ? serialItems : itemOptions).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            {tab === "movimentacoes" ? (
              <FilterField label="Tipo" htmlFor="f-tipo">
                <Select id="f-tipo" name="tipo" defaultValue={typeFilter ?? ""} className="h-11 md:h-9">
                  <option value="">Todos</option>
                  {STOCK_MOVEMENT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {STOCK_MOVEMENT_LABELS[x]}
                    </option>
                  ))}
                </Select>
              </FilterField>
            ) : (
              <>
                <FilterField label="Situação" htmlFor="f-sit">
                  <Select id="f-sit" name="situacao" defaultValue={statusFilter ?? ""} className="h-11 md:h-9">
                    <option value="">Todas</option>
                    {STOCK_SERIAL_STATUSES.map((x) => (
                      <option key={x} value={x}>
                        {STOCK_SERIAL_STATUS_LABELS[x]}
                      </option>
                    ))}
                  </Select>
                </FilterField>
                <FilterField label="Série, cliente ou contrato" htmlFor="f-q">
                  <Input id="f-q" name="q" defaultValue={q ?? ""} className="h-11 md:h-9" maxLength={80} />
                </FilterField>
              </>
            )}
          </FilterBar>
        </form>
      ) : null}
      {tab === "movimentacoes" ? <StockMovementList rows={movements} limit={MOVEMENTS_LIMIT} /> : null}
      {tab === "series" ? <StockSerialList rows={serials} /> : null}
      {tab === "configuracao" ? <StockSettingsForm settings={settings} canEdit={caps.configEdit} /> : null}
    </PageContainer>
  );
}
