import type { ReactNode } from "react";
import Link from "next/link";
import { ClipboardList, FileText } from "lucide-react";
import { SALE_PAYMENT_METHOD_LABELS, splitInstallments } from "@/domain/sale-closing";
import { FINANCIAL_STATUS_LABELS, RECURRENCE_LABELS } from "@/server/finance/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContractSummaryData, SummaryBillingState } from "./contract-summary";

export type { ContractSummaryData } from "./contract-summary";

const NOT_INFORMED = "Não informado";

const BILLING_STATE_LABELS: Record<SummaryBillingState, string> = { pago: "Cobranças em dia", em_aberto: "Cobranças em aberto", vencido: "Cobrança vencida", sem_cobranca: "Sem cobrança gerada" };

export interface ContractSummaryCardProps {
  summary: ContractSummaryData;
  /** "card" (página), "compact" (painel lateral: sem cabeçalho de card), "print" (documento imprimível). */
  variant?: "card" | "compact" | "print";
  title?: string;
  description?: string;
  /** Mostra o link "Ver documento" (padrão: sim, exceto na impressão). */
  showDocumentLink?: boolean;
  className?: string;
}

interface Row {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

function rowsOf(s: ContractSummaryData, print: boolean): Row[] {
  const installments = s.setupInstallments ?? 1;
  const parcels = s.setupTotal > 0 && installments > 1 ? splitInstallments(s.setupTotal, installments) : [];
  const signature = !s.signature.generated
    ? "Documento ainda não gerado"
    : s.signature.total > 0 && s.signature.signed === s.signature.total
      ? `Assinado${s.signature.signedAt ? ` em ${formatDate(s.signature.signedAt)}` : ""}`
      : `Aguardando assinatura (${s.signature.signed} de ${s.signature.total})`;
  const implementation = s.implementationRequired === undefined ? NOT_INFORMED : s.implementationRequired ? "Sim" : "Não contratada";
  const rows: Row[] = [
    { label: "Mensalidade", value: s.recurrence === "unico" ? "Sem recorrência" : `${formatCurrency(s.monthlyTotal)}/mês${s.recurrence === "anual" ? " (cobrança anual)" : ""}` },
    { label: "Adesão", value: s.setupTotal > 0 ? `${formatCurrency(s.setupTotal)}${parcels.length > 1 ? ` em ${parcels.length}x de ${formatCurrency(parcels[0])}` : " à vista"}` : formatCurrency(0) },
    { label: "Hardware", value: formatCurrency(s.hardwareTotal) },
    { label: "Vencimento", value: `Todo dia ${s.billingDay}${s.nextDueDate ? ` · próximo ${formatDate(s.nextDueDate)}` : ""}` },
    { label: "1º vencimento", value: s.firstDueDate ? formatDate(s.firstDueDate) : "Definido ao gerar as cobranças" },
    { label: "Forma de pagamento", value: s.paymentMethod ? SALE_PAYMENT_METHOD_LABELS[s.paymentMethod] : NOT_INFORMED },
    { label: "Prazo", value: `${s.termMonths} meses · ${RECURRENCE_LABELS[s.recurrence]}${s.startDate ? ` · vigência ${formatDate(s.startDate)} a ${formatDate(s.endDate)}` : ""}` },
    { label: "Implantação contratada", value: implementation },
    { label: "Condições", value: s.paymentCondition || NOT_INFORMED, wide: true },
  ];
  if (!print) {
    rows.push(
      { label: "Assinatura", value: signature },
      { label: "Financeiro", value: `${FINANCIAL_STATUS_LABELS[s.financialStatus]} · ${BILLING_STATE_LABELS[s.billingState]}${s.overdueCount > 1 ? ` (${s.overdueCount})` : ""}` },
    );
  }
  rows.push(
    { label: "Venda", value: s.saleNumber ?? NOT_INFORMED },
    { label: "Vendedor", value: s.sellerName ?? NOT_INFORMED },
    { label: "Contato do cliente", value: s.contactName ? [s.contactName, s.contactPhone, s.contactEmail].filter(Boolean).join(" · ") : NOT_INFORMED, wide: true },
  );
  if (s.commercialNotes) rows.push({ label: "Observações comerciais", value: s.commercialNotes, wide: true });
  if (s.implementationNotes) rows.push({ label: "Observações para implantação", value: s.implementationNotes, wide: true });
  if (s.cancelledAt) rows.push({ label: "Cancelamento", value: `${formatDate(s.cancelledAt)}${s.cancelReason ? ` · ${s.cancelReason}` : ""}`, wide: true });
  return rows;
}

function Items({ summary, compact }: { summary: ContractSummaryData; compact?: boolean }) {
  if (summary.items.length === 0) return <p className="text-sm text-muted">Nenhum item no contrato.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {summary.items.map((i, idx) => (
        <li key={`${i.productId}-${idx}`} className={cn("flex flex-wrap items-baseline justify-between gap-x-3 text-sm", compact && "flex-col items-start")}>
          <span className="min-w-0 break-words font-medium">
            {i.quantity > 1 ? `${i.quantity}× ` : ""}
            {i.productName}
            {i.discountPct > 0 ? <span className="text-xs font-normal text-muted"> · {i.discountPct}% desc.</span> : null}
          </span>
          <span className="tabular-nums text-xs text-muted">
            {[i.monthlyValue > 0 ? `${formatCurrency(i.monthlyValue)}/mês` : null, i.setupValue > 0 ? `adesão ${formatCurrency(i.setupValue)}` : null, i.hardwareValue > 0 ? `hardware ${formatCurrency(i.hardwareValue)}` : null].filter(Boolean).join(" · ") || "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Grid({ rows, columns }: { rows: Row[]; columns: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columns === 2 && "sm:grid-cols-2")}>
      {rows.map((r) => (
        <div key={r.label} className={cn("min-w-0", r.wide && columns === 2 && "sm:col-span-2")}>
          <dt className="text-xs text-muted">{r.label}</dt>
          <dd className={cn("break-words text-sm", r.value === NOT_INFORMED && "text-muted")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Resumo do contratado: produtos e quantidades (líquidos de desconto), mensalidade, adesão e parcelas, hardware,
 * vencimento, forma de pagamento, prazo, condições, implantação, assinatura, situação financeira, venda (VEN),
 * vendedor e contato. Reutilizado na página do contrato, no painel lateral, no documento e na implantação.
 */
export function ContractSummaryCard({ summary, variant = "card", title = "Resumo do contratado", description, showDocumentLink, className }: ContractSummaryCardProps) {
  const print = variant === "print";
  const rows = rowsOf(summary, print);
  const docLink = (showDocumentLink ?? !print) ? (
    <Link href={`/financeiro/contratos/${summary.id}/documento`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-fg hover:underline">
      <FileText className="size-4" /> Ver documento
    </Link>
  ) : null;

  if (print) {
    return (
      <section className={cn("border-t border-border py-5", className)} aria-label={title}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        <Items summary={summary} />
        <div className="mt-3">
          <Grid rows={rows} columns={2} />
        </div>
      </section>
    );
  }

  if (variant === "compact") {
    return (
      <section className={cn("flex flex-col gap-3", className)} aria-label={title}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4 text-muted" /> {title}
          </h3>
          {docLink}
        </div>
        <Items summary={summary} compact />
        <Grid rows={rows} columns={1} />
      </section>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4 text-muted" /> {title}
          </CardTitle>
          <CardDescription>{description ?? `Contrato ${summary.number} v${summary.version}${summary.saleNumber ? ` · venda ${summary.saleNumber}` : ""}`}</CardDescription>
        </div>
        <Badge variant={CONTRACT_STATUS_VARIANT[summary.status]} size="sm" className="shrink-0">
          {CONTRACT_STATUS_LABELS[summary.status]}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <Items summary={summary} />
        <Grid rows={rows} columns={2} />
        {docLink ? <div className="flex justify-end">{docLink}</div> : null}
      </CardContent>
    </Card>
  );
}
