import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CalendarClock, FilePlus2, FileText, Send, Settings2 } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
import { getInvoiceQueue, listFiscalProducts, listInvoices } from "@/server/finance/invoices";
import { PageContainer } from "@/components/layout/page-container";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { InvoiceQueue, type InvoicingCan } from "@/components/finance/invoicing/invoice-queue";
import { InvoiceList } from "@/components/finance/invoicing/invoice-list";
import { FiscalSettingsForm, ProductFiscalTable } from "@/components/finance/invoicing/fiscal-settings";
import { cn } from "@/lib/utils";
import type { InvoicingTab } from "@/components/finance/invoicing/model";

export const metadata: Metadata = { title: "Faturamento" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: { key: InvoicingTab; label: string; icon: React.ReactNode }[] = [
  { key: "a-faturar", label: "A faturar", icon: <FilePlus2 /> },
  { key: "proximas", label: "Próximas", icon: <CalendarClock /> },
  { key: "notas", label: "Notas", icon: <FileText /> },
  { key: "dispensadas", label: "Dispensadas", icon: <Ban /> },
  { key: "configuracao", label: "Configuração fiscal", icon: <Settings2 /> },
];
type TabKey = InvoicingTab;

/**
 * Financeiro › Faturamento: notas fiscais das cobranças. Fila "A faturar" (cobranças que pedem nota pela configuração
 * e já chegaram ao momento), próximas, notas registradas (PDF/XML, envio, cancelamento), dispensadas e a configuração
 * fiscal (aba = seção financeiro.faturamento.configuracao.ver). Escopo pelos donos do contrato; valores sob
 * "Visualizar valores"; cada botão pela sua chave (as actions/rotas revalidam).
 */
export default async function InvoicingPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.faturamento");
  const sp = await searchParams;
  const values = can(user, "financeiro.valores.ver");
  const caps: InvoicingCan = {
    values,
    register: can(user, "financeiro.faturamento.registrar"),
    send: can(user, "financeiro.faturamento.enviar"),
    cancel: can(user, "financeiro.faturamento.cancelar"),
    waive: can(user, "financeiro.faturamento.dispensar"),
    issueData: can(user, "financeiro.faturamento.dados.consultar"),
    files: can(user, "financeiro.faturamento.arquivos.baixar"),
    configView: can(user, "financeiro.faturamento.configuracao.ver"),
    configEdit: can(user, "financeiro.faturamento.configuracao.editar"),
  };
  const visible = TABS.filter((t) => t.key !== "configuracao" || caps.configView);
  const requested = (Array.isArray(sp.aba) ? sp.aba[0] : sp.aba) as TabKey | undefined;
  const tab: TabKey = visible.some((t) => t.key === requested) ? requested! : "a-faturar";
  const scope = await resolveDataScope(user, "financeiro.faturamento");
  const [queue, invoices, products] = await Promise.all([
    getInvoiceQueue({ scope, hideValues: !values }),
    tab === "notas" ? listInvoices({ scope, hideValues: !values }) : Promise.resolve([]),
    tab === "configuracao" ? listFiscalProducts() : Promise.resolve([]),
  ]);
  const byState = (s: string) => queue.rows.filter((r) => r.state === s);

  return (
    <PageContainer size="full" className="max-w-[1480px]">
      <PageHeader
        title="Faturamento"
        description="Notas fiscais das cobranças: o que faturar, as notas emitidas e o envio ao cliente"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Faturamento" }]}
      />

      {!queue.settings.stored && caps.configView ? (
        <p role="status" className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-fg">
          A configuração fiscal ainda não foi salva: estão valendo os padrões (adesão, mensalidade e serviço com NFS-e; hardware com NF-e; entra na fila {queue.settings.leadDays} dias antes do
          vencimento).{" "}
          <Link href="/financeiro/faturamento?aba=configuracao" className="font-medium underline">
            Conferir a configuração
          </Link>
        </p>
      ) : null}
      {!queue.settings.enabled ? (
        <p role="status" className="mb-4 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted">
          O controle de notas fiscais está desligado na configuração fiscal: nenhuma cobrança pede nota.
        </p>
      ) : null}

      <KpiStrip columns={4} mobileColumns={2}>
        <StatCard
          label="A faturar"
          value={queue.counts.a_faturar}
          icon={<FilePlus2 />}
          tone={queue.counts.a_faturar > 0 ? "warning" : "success"}
          valueTone={queue.counts.a_faturar > 0}
          href="/financeiro/faturamento?aba=a-faturar"
          compact
        />
        <StatCard label="Próximas" value={queue.counts.aguardando} icon={<CalendarClock />} tone="info" href="/financeiro/faturamento?aba=proximas" compact />
        <StatCard
          label="Emitidas, não enviadas"
          value={queue.counts.emitida}
          icon={<Send />}
          tone={queue.counts.emitida > 0 ? "warning" : "neutral"}
          href="/financeiro/faturamento?aba=notas"
          compact
        />
        <StatCard label="Enviadas" value={queue.counts.enviada} icon={<FileText />} tone="success" href="/financeiro/faturamento?aba=notas" compact />
      </KpiStrip>

      <nav aria-label="Faturamento" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
        {visible.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/financeiro/faturamento?aba=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors md:min-h-[40px] [&_svg]:size-4",
                active ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </Link>
          );
        })}
      </nav>

      {tab === "a-faturar" ? <InvoiceQueue rows={byState("a_faturar")} can={caps} mode="a_faturar" /> : null}
      {tab === "proximas" ? <InvoiceQueue rows={byState("aguardando")} can={caps} mode="aguardando" /> : null}
      {tab === "dispensadas" ? <InvoiceQueue rows={byState("dispensada")} can={caps} mode="dispensada" /> : null}
      {tab === "notas" ? <InvoiceList rows={invoices} can={caps} /> : null}
      {tab === "configuracao" ? (
        <div className="grid gap-4">
          <FiscalSettingsForm settings={queue.settings} canEdit={caps.configEdit} />
          <ProductFiscalTable rows={products} canEdit={caps.configEdit} />
        </div>
      ) : null}
    </PageContainer>
  );
}
