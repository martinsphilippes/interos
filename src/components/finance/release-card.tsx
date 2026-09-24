"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Rocket, ShieldAlert } from "lucide-react";
import { releaseContractAction } from "@/server/finance/actions";
import { PAYMENT_REQUIREMENT_LABELS, type ReleaseGate } from "@/server/finance/schemas";
import { formatDate, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "./use-finance-action";

export interface ReleaseCardProps {
  contractId: string;
  number: string;
  gate: ReleaseGate;
  released?: { at: string; byName?: string };
  project: { id: string; name: string; dueDate: string; ownerName?: string } | null;
  canOperate: boolean;
  isManager: boolean;
  closed: boolean;
}

/**
 * Gate financeiro: critérios configuráveis (setting "gate_financeiro") e o botão "Liberar para implantação",
 * habilitado só quando todos são cumpridos. Gestor/admin pode liberar com pendência informando o motivo.
 */
export function ReleaseCard({ contractId, number, gate, released, project, canOperate, isManager, closed }: ReleaseCardProps) {
  const id = React.useId();
  const [exceptionOpen, setExceptionOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { pending, run } = useFinanceAction();
  const canException = isManager && gate.settings.permiteExcecaoGestor && !gate.ok;

  const release = async (exceptionReason?: string) => {
    const ok = await run(() => releaseContractAction({ contractId, exceptionReason }), (d) => (d.exception ? "Liberado por exceção; projeto de implantação criado" : "Contrato liberado; projeto de implantação criado"));
    if (ok) setExceptionOpen(false);
  };

  return (
    <Card className={released ? "border-success/40" : gate.ok ? "border-brand/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-muted" /> Liberação para implantação
        </CardTitle>
        <CardDescription>
          {released
            ? `Liberado em ${formatDateTime(released.at)}${released.byName ? ` por ${released.byName}` : ""}.`
            : `Gate financeiro: ${gate.settings.exigeContratoAssinado ? "contrato assinado" : "assinatura dispensada"} · ${PAYMENT_REQUIREMENT_LABELS[gate.settings.exigePagamento].toLowerCase()}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {!released ? (
          <ul className="flex flex-col gap-2" aria-label="Critérios do gate financeiro">
            {gate.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Atendido" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-light" aria-label="Pendente" />}
                <span>
                  <span className={c.ok ? "text-foreground" : "text-muted"}>{c.label}</span>
                  {c.detail ? <span className="block text-xs text-muted">{c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {project ? (
          <div className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-fg">
            <p className="font-medium">{project.name}</p>
            <p className="text-xs">
              {project.ownerName ? `Responsável: ${project.ownerName} · ` : ""}prazo {formatDate(project.dueDate)} ·{" "}
              <Link href={`/implantacao/${project.id}`} className="underline">
                abrir projeto
              </Link>
            </p>
          </div>
        ) : null}

        {canOperate && !released && !closed ? (
          <>
            <Button onClick={() => release()} loading={pending && !exceptionOpen} disabled={!gate.ok || pending} className="h-11 md:h-10">
              <Rocket /> Liberar para implantação
            </Button>
            {!gate.ok ? <p className="text-xs text-muted">Disponível quando todos os critérios acima forem cumpridos.</p> : null}
            {canException ? (
              <Button variant="outline" onClick={() => setExceptionOpen(true)} disabled={pending} className="h-11 md:h-9">
                <ShieldAlert /> Liberar com pendência (exceção)
              </Button>
            ) : null}
          </>
        ) : null}
      </CardContent>

      <Dialog open={exceptionOpen} onOpenChange={(o) => !pending && setExceptionOpen(o)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Liberar com pendência</DialogTitle>
            <DialogDescription>
              Contrato {number}. A exceção fica registrada na etapa Financeiro da jornada, com seu nome e o motivo. Critérios pendentes:{" "}
              {gate.checks
                .filter((c) => !c.ok)
                .map((c) => c.label.toLowerCase())
                .join(", ")}
              .
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Motivo da exceção" htmlFor={`${id}-r`} required>
              <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente estratégico; pagamento confirmado por telefone pelo diretor" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExceptionOpen(false)} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button onClick={() => release(reason)} loading={pending} disabled={reason.trim().length < 5} className="h-11 md:h-9">
              Liberar por exceção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
