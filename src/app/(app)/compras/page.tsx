import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Hourglass, PackageCheck, Settings2, ShoppingCart, Truck } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { getPurchaseSettings, listPurchasableItems, listPurchaseNeeds, listPurchaseOrders, listPurchaseReceipts } from "@/server/purchases/service";
import { listSuppliers } from "@/server/commissions/suppliers";
import { getPayablesSettings } from "@/server/commissions/payables";
import { lineRemaining } from "@/domain/purchases";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NeedsList } from "@/components/purchases/needs-list";
import { OrderList } from "@/components/purchases/order-list";
import { ReceiptList } from "@/components/purchases/receipt-list";
import { PurchaseSettingsForm } from "@/components/purchases/settings-form";
import type { PurchaseCan, PurchaseTab } from "@/components/purchases/model";

export const metadata: Metadata = { title: "Compras" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: { key: PurchaseTab; label: string; icon: React.ReactNode }[] = [
  { key: "necessidades", label: "Necessidades", icon: <ClipboardList /> },
  { key: "pedidos", label: "Pedidos", icon: <ShoppingCart /> },
  { key: "recebimentos", label: "Recebimentos", icon: <PackageCheck /> },
  { key: "configuracao", label: "Configuração", icon: <Settings2 /> },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Operação › Compras: necessidades (falta dos contratos + mínimo − já pedido), pedidos (enviar, aprovar/devolver,
 * receber, cancelar), recebimentos (entrada no estoque + título a pagar) e configuração (aba = seção
 * operacao.compras.configuracao.ver). Cada botão pela sua chave; as actions revalidam.
 */
export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("operacao.compras");
  const sp = await searchParams;
  const caps: PurchaseCan = {
    edit: can(user, "operacao.compras.pedidos.editar"),
    approve: can(user, "operacao.compras.aprovar"),
    receive: can(user, "operacao.compras.receber"),
    configEdit: can(user, "operacao.compras.configuracao.editar"),
  };
  const configView = can(user, "operacao.compras.configuracao.ver");
  const visible = TABS.filter((t) => t.key !== "configuracao" || configView);
  const focusOrder = one(sp.pedido);
  const requested = (one(sp.aba) ?? (focusOrder ? "pedidos" : undefined)) as PurchaseTab | undefined;
  const tab: PurchaseTab = visible.some((t) => t.key === requested) ? requested! : "necessidades";

  const [settings, needs, orders, items, suppliers, receipts, payables] = await Promise.all([
    getPurchaseSettings(),
    listPurchaseNeeds(),
    listPurchaseOrders(),
    tab === "necessidades" || tab === "pedidos" ? listPurchasableItems() : Promise.resolve([]),
    tab === "necessidades" || tab === "pedidos" ? listSuppliers({ activeOnly: true }) : Promise.resolve([]),
    tab === "recebimentos" ? listPurchaseReceipts() : Promise.resolve([]),
    tab === "configuracao" ? getPayablesSettings() : Promise.resolve(null),
  ]);
  const toBuy = needs.filter((n) => n.suggested > 0);
  const waitingApproval = orders.filter((o) => o.status === "aguardando_aprovacao");
  const inTransit = orders.filter((o) => o.status === "aprovado" || o.status === "parcial");
  const inTransitValue = inTransit.reduce((s, o) => s + o.lines.reduce((x, l) => x + lineRemaining(l) * l.unitCost, 0), 0);
  const supplierOptions = suppliers.map((s) => ({ id: s.id, name: s.name }));

  return (
    <PageContainer size="full" className="max-w-[1480px]">
      <PageHeader
        title="Compras"
        description={`O que comprar (falta dos contratos e estoque mínimo), pedidos, aprovação e recebimento · ${settings.approvalEnabled ? `aprovação acima de ${formatCurrency(settings.approvalThreshold)}` : "sem aprovação"}`}
        breadcrumbs={[{ label: "Operação" }, { label: "Compras" }]}
      />

      <KpiStrip columns={4} mobileColumns={2}>
        <StatCard label="Itens a comprar" value={toBuy.length} icon={<ClipboardList />} tone={toBuy.length ? "warning" : "success"} valueTone={toBuy.length > 0} href="/compras?aba=necessidades" compact />
        <StatCard
          label="Aguardando aprovação"
          value={waitingApproval.length}
          icon={<Hourglass />}
          tone={waitingApproval.length ? "warning" : "neutral"}
          hint={waitingApproval.length ? formatCurrency(waitingApproval.reduce((s, o) => s + o.total, 0)) : undefined}
          href="/compras?aba=pedidos"
          compact
        />
        <StatCard label="A receber" value={inTransit.length} icon={<Truck />} tone="info" hint={inTransit.length ? formatCurrency(Math.round(inTransitValue * 100) / 100) : undefined} href="/compras?aba=pedidos" compact />
        <StatCard label="Rascunhos" value={orders.filter((o) => o.status === "rascunho").length} icon={<ShoppingCart />} tone="neutral" href="/compras?aba=pedidos" compact />
      </KpiStrip>

      <nav aria-label="Compras" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
        {visible.map((x) => {
          const active = x.key === tab;
          return (
            <Link
              key={x.key}
              href={`/compras?aba=${x.key}`}
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

      {tab === "necessidades" ? <NeedsList rows={needs} items={items} suppliers={supplierOptions} can={caps} paymentDays={settings.paymentDays} /> : null}
      {tab === "pedidos" ? <OrderList orders={orders} items={items} suppliers={supplierOptions} can={caps} focusId={focusOrder} /> : null}
      {tab === "recebimentos" ? <ReceiptList rows={receipts} canRetry={caps.receive} /> : null}
      {tab === "configuracao" && payables ? <PurchaseSettingsForm settings={settings} categories={payables.categoriasComRotulo} canEdit={caps.configEdit} /> : null}
    </PageContainer>
  );
}
