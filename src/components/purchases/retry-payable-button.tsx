"use client";

import { RefreshCw } from "lucide-react";
import { retryReceiptPayableAction } from "@/server/purchases/actions";
import { Button } from "@/components/ui/button";
import { useFinanceAction } from "@/components/finance/use-finance-action";

/** Refaz o título a pagar de um recebimento que falhou (depois de corrigir fornecedor ou categoria). */
export function RetryPayableButton({ receiptId }: { receiptId: string }) {
  const { pending, run } = useFinanceAction();
  return (
    <Button size="sm" variant="outline" className="mt-1 h-10 md:h-8" loading={pending} onClick={() => void run(() => retryReceiptPayableAction({ receiptId }), (d) => `Título ${d.payableCode} criado`)}>
      <RefreshCw /> Criar título
    </Button>
  );
}
