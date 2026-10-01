import { AlertTriangle } from "lucide-react";
import type { SaleSnapshot } from "@/domain/types";
import { ContractSummaryCard, type ContractSummaryData } from "@/components/finance/contract-summary-card";

export interface SaleDataCardProps {
  sale: { snapshot: SaleSnapshot; summary: ContractSummaryData; sellerName?: string };
  /** Link para o documento do contrato (só para quem acessa o Financeiro). */
  showDocumentLink: boolean;
}

/**
 * "Dados da venda" no projeto de implantação (handoff Vendas → Implantação): o que foi contratado, vendedor,
 * contato responsável do cliente e observações comerciais e de implantação combinadas no fechamento.
 */
export function SaleDataCard({ sale, showDocumentLink }: SaleDataCardProps) {
  const notContracted = sale.snapshot.implementationRequired === false;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {notContracted ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning-soft px-4 py-3 text-sm text-warning-fg" role="note">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Implantação não contratada na venda: o projeto foi aberto para a jornada seguir até o CS. Valide com o gestor o que precisa ser feito antes do go-live.
        </p>
      ) : null}
      <ContractSummaryCard
        summary={sale.summary}
        title="Dados da venda"
        description={[sale.snapshot.saleNumber ? `Venda ${sale.snapshot.saleNumber}` : "Venda sem número (anterior ao VEN)", `contrato ${sale.summary.number}`, sale.sellerName ? `vendedor ${sale.sellerName}` : null].filter(Boolean).join(" · ")}
        showDocumentLink={showDocumentLink}
      />
    </div>
  );
}
