import type { Metadata } from "next";
import { CalendarClock, ExternalLink, FileSignature, LinkIcon, MessageCircle, Receipt, ShieldCheck } from "lucide-react";
import { loadPortalForToken, type PortalPageData } from "@/server/portal/service";
import type { PortalBillingView, PortalContractView } from "@/server/portal/content";
import { PORTAL_INVALID_MESSAGE } from "@/domain/portal";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { ContractSummaryCard } from "@/components/finance/contract-summary-card";
import { ContractDocument } from "@/components/finance/contract-document";
import { CopyButton } from "@/components/portal/copy-button";

/** Sempre na hora (nada em cache: o link pode ser revogado a qualquer momento). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Portal do Cliente · Intercert" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  // O token está na URL: nada de Referer para links externos (wa.me, PDF do boleto).
  referrer: "no-referrer",
};

type Params = Promise<{ token: string }>;

const STATUS_LABEL: Record<PortalBillingView["status"], string> = { aberta: "Em aberto", vencida: "Vencida", paga: "Paga" };
const STATUS_VARIANT: Record<PortalBillingView["status"], "info" | "danger" | "success"> = { aberta: "info", vencida: "danger", paga: "success" };

function BrandMark() {
  return (
    <svg viewBox="0 0 64 64" className="size-7 shrink-0" aria-hidden>
      <path d="M32 9.5 51.5 20.75v22.5L32 54.5 12.5 43.25v-22.5Z" fill="none" stroke="#F26A21" strokeWidth="6" strokeLinejoin="round" />
      <path d="M32 23.5 39.5 27.8v8.4L32 40.5l-7.5-4.3v-8.4Z" fill="#FF8A4C" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3">
          <BrandMark />
          <p className="text-sm font-semibold tracking-wide text-foreground">
            INTERCERT <span className="font-normal text-muted">· Portal do Cliente</span>
          </p>
        </div>
      </header>
      <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-5 px-4 py-6">{children}</main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted">
        <p className="flex items-center justify-center gap-1">
          <ShieldCheck className="size-3.5" aria-hidden /> Acesso pessoal e somente leitura. Não compartilhe este link.
        </p>
      </footer>
    </div>
  );
}

function Invalid() {
  return (
    <section className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center shadow-card" data-testid="portal-invalid">
      <span className="text-muted [&_svg]:size-10">
        <LinkIcon />
      </span>
      <h1 className="text-lg font-semibold">{PORTAL_INVALID_MESSAGE}</h1>
      <p className="text-sm text-muted">Confira se o endereço foi copiado por completo ou peça um novo link ao Financeiro da Intercert.</p>
    </section>
  );
}

function secondCopyHref(base: string, clientName: string, b: PortalBillingView): string {
  const what = `${b.typeLabel}${b.installment ? ` ${b.installment}` : ""}`.toLowerCase();
  const text = `Olá! Sou da ${clientName} e gostaria da 2ª via da ${what} (vencimento ${formatDate(b.dueDate)}${b.contractNumber ? `, contrato ${b.contractNumber}` : ""}).`;
  return `${base}?text=${encodeURIComponent(text)}`;
}

function BillingCard({ billing: b, clientName, secondCopyWhatsapp }: { billing: PortalBillingView; clientName: string; secondCopyWhatsapp: string | null }) {
  const open = b.status !== "paga";
  const hasPayment = Boolean(b.linhaDigitavel || b.pdfUrl || b.paymentUrl || b.pixCopiaECola);
  return (
    <li className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-4", b.status === "vencida" ? "border-danger/40" : "border-border")} data-testid="portal-billing" data-billing={b.key} data-status={b.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {b.typeLabel}
            {b.installment ? ` · parcela ${b.installment}` : ""}
          </p>
          <p className="text-xs text-muted">
            competência <span className="capitalize">{formatCompetence(b.competence)}</span>
            {b.contractNumber ? ` · contrato ${b.contractNumber}` : ""}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[b.status]} size="sm">
          {STATUS_LABEL[b.status]}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Valor</dt>
        <dd className="text-right font-semibold tabular-nums">{formatCurrency(b.amount)}</dd>
        <dt className="text-muted">Vencimento</dt>
        <dd className={cn("text-right tabular-nums", b.status === "vencida" && "text-danger-fg")}>{formatDate(b.dueDate)}</dd>
        {b.status === "paga" ? (
          <>
            <dt className="text-muted">Pago em</dt>
            <dd className="text-right tabular-nums">
              {formatDate(b.paidAt)}
              {b.paidAmount !== undefined && b.paidAmount !== b.amount ? ` (${formatCurrency(b.paidAmount)})` : ""}
            </dd>
          </>
        ) : null}
      </dl>
      {open && b.linhaDigitavel ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
          <p className="text-xs font-medium text-muted">Linha digitável do boleto</p>
          <p className="break-all font-mono text-sm" data-testid="portal-linha-digitavel">
            {b.linhaDigitavel}
          </p>
          <CopyButton value={b.linhaDigitavel} label="Copiar linha digitável" testId="portal-copy-linha" className="h-11 w-full sm:w-auto md:h-9" />
        </div>
      ) : null}
      {open && b.pixCopiaECola ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
          <p className="text-xs font-medium text-muted">PIX copia e cola</p>
          <p className="line-clamp-3 break-all font-mono text-xs" data-testid="portal-pix">
            {b.pixCopiaECola}
          </p>
          <CopyButton value={b.pixCopiaECola} label="Copiar código PIX" testId="portal-copy-pix" className="h-11 w-full sm:w-auto md:h-9" />
        </div>
      ) : null}
      {open && (b.pdfUrl || b.paymentUrl) ? (
        <a href={b.pdfUrl ?? b.paymentUrl} target="_blank" rel="noreferrer noopener" className={buttonVariants({ variant: "outline", className: "h-11 w-full sm:w-auto md:h-9" })} data-testid="portal-boleto-link">
          <ExternalLink /> {b.pdfUrl ? "Abrir boleto (PDF)" : "Pagar online"}
        </a>
      ) : null}
      {open && !hasPayment ? (
        secondCopyWhatsapp ? (
          <a href={secondCopyHref(secondCopyWhatsapp, clientName, b)} target="_blank" rel="noreferrer noopener" className={buttonVariants({ variant: "outline", className: "h-11 w-full sm:w-auto md:h-9" })} data-testid="portal-segunda-via">
            <MessageCircle /> Solicitar 2ª via pelo WhatsApp
          </a>
        ) : (
          <p className="text-xs text-muted">Boleto ainda não disponível por aqui. Fale com o Financeiro da Intercert para receber a 2ª via.</p>
        )
      ) : null}
    </li>
  );
}

function ContractBlock({ contract: c, companyName }: { contract: PortalContractView; companyName: string }) {
  return (
    <article className="flex min-w-0 flex-col gap-3" data-testid="portal-contract" data-contract={c.key}>
      <ContractSummaryCard
        summary={c.summary}
        rows="client"
        showDocumentLink={false}
        title={`Contrato ${c.number}`}
        description={`Versão ${c.version}${c.startDate ? ` · vigência ${formatDate(c.startDate)} a ${formatDate(c.endDate)}` : ""}`}
      />
      {c.document ? (
        <details className="group rounded-xl border border-border bg-surface" data-testid="portal-contract-document">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium">
            <span className="flex items-center gap-2">
              <FileSignature className="size-4 text-muted" aria-hidden /> Ver contrato assinado
            </span>
            <span className="text-xs text-muted group-open:hidden">abrir</span>
            <span className="hidden text-xs text-muted group-open:inline">fechar</span>
          </summary>
          <div className="min-w-0 border-t border-border p-2 sm:p-4">
            <ContractDocument
              contract={c.document.contract}
              historical={false}
              client={c.document.client}
              billingData={c.document.billingData}
              sentAt={c.document.sentAt}
              amendments={c.document.amendments}
              summary={c.document.summary}
              companyName={companyName}
              hidden={false}
              amendmentLinks={false}
              audience="cliente"
              articleId={`contrato-${c.key}`}
            />
          </div>
        </details>
      ) : (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          <Badge variant={CONTRACT_STATUS_VARIANT[c.status]} size="sm" className="mr-2">
            {CONTRACT_STATUS_LABELS[c.status]}
          </Badge>
          O documento assinado aparece aqui assim que todas as assinaturas forem concluídas.
        </p>
      )}
    </article>
  );
}

function Portal({ data }: { data: PortalPageData }) {
  const { content } = data;
  const pending = content.billings.filter((b) => b.status !== "paga");
  const paid = content.billings.filter((b) => b.status === "paga");
  return (
    <>
      <section className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold" data-testid="portal-client">
          {content.clientName}
        </h1>
        <p className="flex items-center gap-1 text-xs text-muted">
          <CalendarClock className="size-3.5" aria-hidden /> Acesso válido até {formatDate(data.expiresAt)}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3" aria-label="Resumo das cobranças">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Em aberto</p>
          <p className="text-2xl font-semibold tabular-nums">{content.openCount}</p>
        </div>
        <div className={cn("rounded-xl border bg-surface p-4", content.overdueCount > 0 ? "border-danger/40" : "border-border")}>
          <p className="text-xs text-muted">Vencidas</p>
          <p className={cn("text-2xl font-semibold tabular-nums", content.overdueCount > 0 && "text-danger-fg")}>{content.overdueCount}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="portal-cobrancas">
        <h2 id="portal-cobrancas" className="flex items-center gap-2 text-base font-semibold">
          <Receipt className="size-4 text-muted" aria-hidden /> Cobranças
        </h2>
        {content.billings.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Nenhuma cobrança por enquanto.</p>
        ) : (
          <>
            {pending.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {pending.map((b) => (
                  <BillingCard key={b.key} billing={b} clientName={content.clientName} secondCopyWhatsapp={data.secondCopyWhatsapp} />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Nenhuma cobrança em aberto. Obrigado!</p>
            )}
            {paid.length > 0 ? (
              <>
                <h3 className="mt-2 text-sm font-semibold text-muted">Pagas recentemente</h3>
                <ul className="flex flex-col gap-3">
                  {paid.map((b) => (
                    <BillingCard key={b.key} billing={b} clientName={content.clientName} secondCopyWhatsapp={data.secondCopyWhatsapp} />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="portal-contratos">
        <h2 id="portal-contratos" className="flex items-center gap-2 text-base font-semibold">
          <FileSignature className="size-4 text-muted" aria-hidden /> Contratos
        </h2>
        {content.contracts.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Nenhum contrato vigente.</p>
        ) : (
          content.contracts.map((c) => <ContractBlock key={c.key} contract={c} companyName={data.companyName} />)
        )}
      </section>
    </>
  );
}

/**
 * Portal do Cliente (D31) — página PÚBLICA, sem login, fora de (app) (modelo /csat). O token da URL (32 bytes
 * base64url) identifica o link pelo hash; inexistente, revogado ou expirado → "Link inválido ou expirado" (mesma
 * resposta). Somente leitura: as únicas escritas são o acesso (lastAccessAt/accessCount) e o evento diário.
 * Isenção do catálogo em src/domain/permissions/exemptions.ts; no-store/noindex em next.config.ts e aqui.
 */
export default async function PortalPage({ params }: { params: Params }) {
  const { token } = await params;
  let data: PortalPageData | null = null;
  try {
    data = await loadPortalForToken(token);
  } catch (error) {
    // Falha técnica: mesma resposta genérica (nada do erro chega ao visitante).
    console.error("[portal] falha ao carregar o portal", error);
    data = null;
  }
  return <Shell>{data ? <Portal data={data} /> : <Invalid />}</Shell>;
}
