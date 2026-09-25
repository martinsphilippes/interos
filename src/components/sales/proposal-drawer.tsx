"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Copy, Eye, Handshake, Pencil, Printer, Send, Target, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Timeline } from "@/components/timeline/timeline";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { newProposalVersionAction, transitionProposalAction } from "@/server/sales/actions";
import type { ProposalDetail } from "@/server/sales/queries";
import type { ProposalTransition } from "@/server/sales/schemas";
import { isOpenStage, netItem, opportunityHref } from "./model";
import { ProposalStatusBadge, StageBadge } from "./opportunity-bits";
import { ProposalEditorDialog } from "./proposal-editor-dialog";
import { useSalesUrl } from "./use-sales-url";
import { WonDialog } from "./won-dialog";

/** Drawer da proposta (?proposta=<id>): itens, totais, transições de status, versões e impressão. */
export function ProposalDrawer({ detail }: { detail: ProposalDetail | null }) {
  const { navigate } = useSalesUrl();
  const close = () => navigate({ proposta: null }, { replace: true });
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="lg">{detail ? <Inner key={detail.proposal.id} detail={detail} /> : null}</DrawerContent>
    </Drawer>
  );
}

const TRANSITION_LABEL: Record<ProposalTransition, string> = {
  enviar: "Proposta enviada",
  visualizada: "Marcada como visualizada",
  negociacao: "Proposta em negociação",
  aceitar: "Proposta aceita",
  recusar: "Proposta recusada",
};

function Inner({ detail }: { detail: ProposalDetail }) {
  const router = useRouter();
  const { navigate } = useSalesUrl();
  const { proposal, client, opportunity } = detail;
  const status = proposal.effectiveStatus;
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"editar" | "recusar" | "ganho" | null>(null);
  const [reason, setReason] = React.useState("");
  const oppOpen = isOpenStage(opportunity.stage);

  const run = (transition: ProposalTransition, extra?: { reason?: string }) =>
    startTransition(async () => {
      const result = await transitionProposalAction({ proposalId: proposal.id, transition, ...extra });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(TRANSITION_LABEL[transition]);
      setDialog(null);
      if (transition === "aceitar") setDialog("ganho");
      router.refresh();
    });

  const newVersion = () =>
    startTransition(async () => {
      const result = await newProposalVersionAction({ proposalId: proposal.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Nova versão criada como rascunho");
      navigate({ proposta: result.data.id }, { replace: true });
    });

  const touch = "min-h-[44px] md:min-h-0";
  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ProposalStatusBadge status={status} size="md" />
          <span className="text-xs text-muted">Criada em {formatDateTime(proposal.createdAt)}</span>
        </div>
        <DrawerTitle className="mt-1 tabular-nums">
          Proposta {proposal.number} <span className="text-muted">v{proposal.version}</span>
        </DrawerTitle>
        <DrawerDescription asChild>
          <div className="flex flex-col gap-1.5">
            <Link href={`/clientes/${client.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary hover:underline">
              <Building2 className="size-4" /> {client.tradeName}
            </Link>
            <Link href={opportunityHref(opportunity.id)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground hover:underline">
              <Target className="size-4" /> {opportunity.title} <StageBadge stage={opportunity.stage} />
            </Link>
          </div>
        </DrawerDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "rascunho" ? (
            <>
              <Button size="sm" className={touch} onClick={() => run("enviar")} loading={pending} disabled={!oppOpen}>
                <Send /> Enviar
              </Button>
              <Button size="sm" variant="outline" className={touch} onClick={() => setDialog("editar")} disabled={!oppOpen}>
                <Pencil /> Editar
              </Button>
            </>
          ) : null}
          {status === "enviada" ? (
            <Button size="sm" variant="outline" className={touch} onClick={() => run("visualizada")} loading={pending}>
              <Eye /> Marcar como visualizada
            </Button>
          ) : null}
          {status === "enviada" || status === "visualizada" ? (
            <Button size="sm" variant="outline" className={touch} onClick={() => run("negociacao")} loading={pending}>
              <Handshake /> Em negociação
            </Button>
          ) : null}
          {status === "enviada" || status === "visualizada" || status === "negociacao" ? (
            <>
              <Button size="sm" className={`${touch} bg-success-strong hover:bg-success-hover`} onClick={() => run("aceitar")} loading={pending}>
                <CheckCircle2 /> Aceita
              </Button>
              <Button size="sm" variant="outline" className={touch} onClick={() => setDialog("recusar")}>
                <XCircle className="text-danger" /> Recusada
              </Button>
            </>
          ) : null}
          {status === "aceita" && oppOpen ? (
            <Button size="sm" className={`${touch} bg-success-strong hover:bg-success-hover`} onClick={() => setDialog("ganho")}>
              <Trophy /> Marcar oportunidade como ganha
            </Button>
          ) : null}
          {status !== "rascunho" && oppOpen ? (
            <Button size="sm" variant="outline" className={touch} onClick={newVersion} loading={pending}>
              <Copy /> Nova versão
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild className={touch}>
            <Link href={`/vendas/propostas/${proposal.id}`} target="_blank">
              <Printer /> Imprimir
            </Link>
          </Button>
        </div>
        {status === "vencida" ? <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">Validade encerrada em {formatDate(proposal.validUntil)}. Gere uma nova versão com nova validade.</p> : null}
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-6">
        <section>
          <h4 className="mb-2 text-sm font-semibold">Itens</h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Produto</th>
                  <th className="px-3 py-2 text-right font-semibold">Qtd.</th>
                  <th className="px-3 py-2 text-right font-semibold">Adesão</th>
                  <th className="px-3 py-2 text-right font-semibold">Mensal</th>
                  <th className="px-3 py-2 text-right font-semibold">Hardware</th>
                  <th className="px-3 py-2 text-right font-semibold">Desc.</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {proposal.items.map((i) => {
                  const net = netItem(i);
                  return (
                    <tr key={i.productId} className="border-t border-border">
                      <td className="px-3 py-2">{i.productName}</td>
                      <td className="px-3 py-2 text-right">{i.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(net.setupTotal)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(net.monthlyTotal)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(net.hardwareTotal)}</td>
                      <td className="px-3 py-2 text-right">{i.discountPct > 0 ? `${i.discountPct}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border bg-surface-muted font-semibold tabular-nums">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    Total{proposal.discountTotal > 0 ? ` (descontos ${formatCurrency(proposal.discountTotal)})` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCurrency(proposal.setupTotal)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(proposal.monthlyTotal)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(proposal.hardwareTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <h4 className="mb-1 text-sm font-semibold">Condições</h4>
            <p className="whitespace-pre-line text-muted">{proposal.conditions || "—"}</p>
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">Datas</h4>
            <p className="text-muted">Validade: {formatDate(proposal.validUntil)}</p>
            {proposal.sentAt ? <p className="text-muted">Enviada: {formatDateTime(proposal.sentAt)}</p> : null}
            {proposal.viewedAt ? <p className="text-muted">Visualizada: {formatDateTime(proposal.viewedAt)}</p> : null}
            {proposal.acceptedAt ? <p className="text-muted">Aceita: {formatDateTime(proposal.acceptedAt)}</p> : null}
            {proposal.rejectedAt ? <p className="text-muted">Recusada: {formatDateTime(proposal.rejectedAt)}</p> : null}
          </div>
          {proposal.notes ? (
            <div className="sm:col-span-2">
              <h4 className="mb-1 text-sm font-semibold">Observações</h4>
              <p className="whitespace-pre-line text-muted">{proposal.notes}</p>
            </div>
          ) : null}
        </section>

        {detail.versions.length > 1 ? (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Versões</h4>
            <ul className="flex flex-wrap gap-2">
              {detail.versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ proposta: v.id }, { replace: true })}
                    className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-sm ${v.id === proposal.id ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-hover"}`}
                  >
                    v{v.version} <ProposalStatusBadge status={v.effectiveStatus} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h4 className="mb-2 text-sm font-semibold">Histórico</h4>
          <Timeline events={detail.activities} showFilters={false} emptyTitle="Sem eventos" />
        </section>
      </DrawerBody>

      {dialog === "editar" ? <ProposalEditorDialog open onOpenChange={(v) => !v && setDialog(null)} opportunity={opportunity} proposal={proposal} products={detail.products} /> : null}
      <Dialog open={dialog === "recusar"} onOpenChange={(v) => !pending && !v && setDialog(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Proposta recusada</DialogTitle>
            <DialogDescription>Informe o motivo da recusa do cliente.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: achou a mensalidade alta; pediu retorno em 60 dias" aria-label="Motivo da recusa" />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => run("recusar", { reason })} loading={pending} disabled={reason.trim().length < 3}>
              Registrar recusa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog === "ganho" && oppOpen ? (
        <WonDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          opportunity={{
            ...opportunity,
            products: proposal.items.map((i) => {
              const net = netItem(i);
              return { productId: i.productId, productName: i.productName, quantity: i.quantity, setupValue: net.setupTotal, monthlyValue: net.monthlyTotal, hardwareValue: net.hardwareTotal };
            }),
          }}
          clientDefaults={{ legalName: client.legalName, document: client.document, email: client.email }}
          products={detail.products}
        />
      ) : null}
    </>
  );
}
