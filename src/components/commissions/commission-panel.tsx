"use client";

import * as React from "react";
import { Ban, Calculator, FilePlus2, History, Lock, LockOpen, Route, Undo2 } from "lucide-react";
import type { CommissionDetail } from "@/server/commissions/queries";
import type { CommissionCapabilities } from "@/server/commissions/access";
import { blockCommissionAction, regenerateCommissionPayableAction, reverseCommissionAction, unblockCommissionAction } from "@/server/commissions/actions";
import { COMMISSION_PENDING_STATUSES, COMMISSION_REVENUE_LABELS } from "@/domain/commissions";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { CalcMemory, CommissionStatusBadge, HistoryList, ReasonDialog, TraceChain } from "./commission-ui";

type Dialog = null | "reverse" | "block" | "unblock";

/**
 * Painel da comissão selecionada: resumo, memória de cálculo, origem rastreável, histórico e ações do Financeiro. Cada
 * botão aparece só com a permissão própria (calculada no servidor); as actions revalidam permissão e escopo.
 */
export function CommissionPanel({ c, can }: { c: CommissionDetail; can: CommissionCapabilities }) {
  const { pending, run } = useFinanceAction();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const pendingStatus = (COMMISSION_PENDING_STATUSES as readonly string[]).includes(c.status);
  const reversible = c.status === "paga" || c.status === "titulo_gerado" || c.status === "liberada" || pendingStatus || c.status === "bloqueada";
  const showRegenerate = can.regenerate && c.canRegeneratePayable;
  const showBlock = can.block && (pendingStatus || (c.status === "liberada" && !c.payableId));
  const showUnblock = can.unblock && c.status === "bloqueada";
  const showReverse = can.reverse && reversible;
  const reverseLabel = c.status === "paga" || c.status === "titulo_gerado" || c.status === "liberada" ? "Estornar comissão" : "Cancelar comissão";

  const close = (ok: boolean) => {
    if (ok) setDialog(null);
    return ok;
  };

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span data-testid="commission-code">{c.code}</span>
            <CommissionStatusBadge status={c.status} size="md" />
          </CardTitle>
          <p className="text-sm text-muted">
            {COMMISSION_REVENUE_LABELS[c.revenueType]} · {c.slotLabel} · {c.productName}
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-3 text-2xl font-semibold tabular-nums" data-testid="commission-amount">
            {formatCurrency(c.amount)}
          </p>
          <DataList
            labelWidth="8rem"
            items={[
              { label: "Vendedor", value: c.userName },
              { label: "Cliente", value: c.clientName, href: `/clientes/${c.clientId}?aba=financeiro` },
              { label: "Base", value: formatCurrency(c.baseAmount) },
              { label: "Competência", value: formatCompetence(c.competence) },
              { label: c.status === "em_carencia" ? "Elegível em" : "Elegível desde", value: c.eligibleAt ? formatDate(c.eligibleAt) : undefined },
              ...((c.status === "prevista" || c.status === "aguardando_recebimento") && c.expectedAt ? [{ label: "Previsão", value: `${formatDate(c.expectedAt)}${c.expectedLabel ? ` · ${c.expectedLabel}` : ""}` }] : []),
              ...(c.cancelReason ? [{ label: "Motivo do cancelamento", value: c.cancelReason }] : []),
              ...(c.blockedReason ? [{ label: "Motivo do bloqueio", value: c.blockedReason }] : []),
              ...(c.reverseReason ? [{ label: "Motivo do estorno", value: c.reverseReason }] : []),
            ]}
          />
          {showRegenerate || showBlock || showUnblock || showReverse ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {showRegenerate ? (
                <Button variant="secondary" className="h-11 md:h-9" loading={pending} onClick={() => run(() => regenerateCommissionPayableAction({ commissionId: c.id }), (d) => `Título ${d.code ?? ""} gerado`)}>
                  <FilePlus2 /> Gerar título
                </Button>
              ) : null}
              {showBlock ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("block")}>
                  <Lock /> Bloquear
                </Button>
              ) : null}
              {showUnblock ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("unblock")}>
                  <LockOpen /> Desbloquear
                </Button>
              ) : null}
              {showReverse ? (
                <Button variant="outline" className="h-11 text-danger-fg md:h-9" onClick={() => setDialog("reverse")}>
                  {pendingStatus || c.status === "bloqueada" ? <Ban /> : <Undo2 />} {reverseLabel}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="size-4 text-muted" /> Memória de cálculo
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0" data-testid="calc-memory">
          {c.legacy ? <p className="mb-2 text-xs text-muted">Comissão calculada pelo motor anterior: a memória detalhada não foi gravada.</p> : null}
          <CalcMemory steps={c.steps} formula={c.formula} ruleText={c.ruleText} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="size-4 text-muted" /> Origem
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0" data-testid="commission-trace">
          <TraceChain links={c.trace} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-muted" /> Histórico
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <HistoryList items={c.history} />
        </CardContent>
      </Card>

      <ReasonDialog
        open={dialog === "reverse"}
        onOpenChange={(o) => setDialog(o ? "reverse" : null)}
        title={`${reverseLabel} ${c.code}?`}
        description={
          c.status === "paga"
            ? `A comissão já foi paga: ela fica "Estornada" e é lançado um título negativo de ${formatCurrency(-c.amount)} em Contas a Pagar (valor a recuperar), vinculado ao título pago. Nada é apagado.`
            : c.status === "titulo_gerado"
              ? "O título em aberto é cancelado e a comissão fica \"Estornada\"."
              : c.status === "liberada"
                ? "A comissão elegível (sem título) fica \"Estornada\"."
                : "A comissão ainda não foi adquirida: ela fica \"Cancelada\" e o motor não a recria."
        }
        confirmLabel={reverseLabel}
        destructive
        pending={pending}
        onConfirm={(reason) => run(() => reverseCommissionAction({ commissionId: c.id, reason }), (d) => (d.status === "cancelada" ? "Comissão cancelada" : "Comissão estornada")).then(close)}
      />
      <ReasonDialog
        open={dialog === "block"}
        onOpenChange={(o) => setDialog(o ? "block" : null)}
        title={`Bloquear ${c.code}?`}
        description="A comissão fica retida: não evolui, não gera título e não entra nos totais até ser desbloqueada."
        confirmLabel="Bloquear"
        pending={pending}
        onConfirm={(reason) => run(() => blockCommissionAction({ commissionId: c.id, reason }), "Comissão bloqueada").then(close)}
      />
      <ReasonDialog
        open={dialog === "unblock"}
        onOpenChange={(o) => setDialog(o ? "unblock" : null)}
        title={`Desbloquear ${c.code}?`}
        description="A comissão volta ao fluxo normal e é reavaliada na hora (pode ficar elegível e gerar título)."
        confirmLabel="Desbloquear"
        pending={pending}
        onConfirm={(reason) => run(() => unblockCommissionAction({ commissionId: c.id, reason }), "Comissão desbloqueada").then(close)}
      />
    </>
  );
}
