"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import type { WonWithoutContract } from "@/server/finance/queries";
import { createContractFromOpportunityAction } from "@/server/finance/actions";
import { formatCurrency, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * Vendas ganhas que ainda não têm contrato (ex.: handler de vendas indisponível no momento do ganho).
 * "Gerar contrato" cria o contrato inicial a partir da oportunidade e abre a página dele.
 */
export function WonWithoutContractList({ items, canOperate }: { items: WonWithoutContract[]; canOperate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const create = (opportunityId: string) => {
    setBusy(opportunityId);
    startTransition(async () => {
      const result = await createContractFromOpportunityAction({ opportunityId });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Contrato gerado");
      router.push(`/financeiro/contratos/${result.data.contractId}`);
    });
  };

  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((o) => (
        <li key={o.opportunityId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href={`/clientes/${o.clientId}?aba=comercial`} className="font-medium hover:text-brand">
              {o.clientName}
            </Link>
            <p className="text-xs text-muted">
              {o.title} · {formatCurrency(o.monthlyTotal)}/mês{o.setupTotal > 0 ? ` · adesão ${formatCurrency(o.setupTotal)}` : ""}
              {o.wonAt ? ` · ganha ${formatRelative(o.wonAt)}` : ""}
            </p>
          </div>
          {canOperate ? (
            <Button size="sm" onClick={() => create(o.opportunityId)} loading={busy === o.opportunityId} disabled={busy !== null} className="h-11 sm:h-8">
              <FilePlus2 /> Gerar contrato
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
