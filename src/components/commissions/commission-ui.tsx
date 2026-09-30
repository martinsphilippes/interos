"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CircleDot } from "lucide-react";
import type { CommissionCalcStep, CommissionStatus, PayableStatus } from "@/domain/types";
import { COMMISSION_STATUS_LABELS, COMMISSION_STATUS_VARIANT, PAYABLE_STATUS_LABELS, PAYABLE_STATUS_VARIANT } from "@/domain/commissions";
import type { HistoryItem, TraceLink } from "@/server/commissions/queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { TimelineList } from "@/components/ui/timeline-list";

export function CommissionStatusBadge({ status, size = "sm" }: { status: CommissionStatus; size?: "sm" | "md" }) {
  return (
    <Badge variant={COMMISSION_STATUS_VARIANT[status]} size={size}>
      {COMMISSION_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PayableStatusBadge({ status, overdue, size = "sm" }: { status: PayableStatus; overdue?: boolean; size?: "sm" | "md" }) {
  if (overdue) {
    return (
      <Badge variant="danger" size={size} title={`Vencido · ${PAYABLE_STATUS_LABELS[status]}`}>
        Vencido
      </Badge>
    );
  }
  return (
    <Badge variant={PAYABLE_STATUS_VARIANT[status]} size={size}>
      {PAYABLE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Memória de cálculo passo a passo (mesmo padrão do BonusBreakdown): transparência é requisito do negócio. */
export function CalcMemory({ steps, formula, ruleText }: { steps: CommissionCalcStep[]; formula?: string; ruleText?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">
              {i + 1}. {s.label}
            </p>
            <p className="break-words text-sm text-muted">
              {s.value}
              {s.date ? <span className="ml-1 text-xs text-muted-light">({formatDate(s.date)})</span> : null}
            </p>
          </li>
        ))}
      </ol>
      {formula || ruleText ? (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
          {formula ? (
            <p>
              <span className="font-medium text-foreground">Fórmula:</span> {formula}
            </p>
          ) : null}
          {ruleText ? (
            <p className="mt-0.5">
              <span className="font-medium text-foreground">Regra:</span> {ruleText}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Origem rastreável: venda → contrato → recebimento → regra → comissão → título. */
export function TraceChain({ links }: { links: TraceLink[] }) {
  if (links.length === 0) return <p className="text-sm text-muted">Sem origem registrada.</p>;
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Origem rastreável">
      {links.map((l, i) => (
        <li key={l.key} className="flex min-w-0 items-center gap-2 text-sm">
          <span className="flex size-5 shrink-0 items-center justify-center text-muted" aria-hidden>
            {i === 0 ? <CircleDot className="size-3.5" /> : <ArrowRight className="size-3.5" />}
          </span>
          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted">{l.label}</span>
          {l.href ? (
            <Link href={l.href} className="min-w-0 truncate font-medium text-brand-fg hover:underline" data-trace={l.key}>
              {l.value}
            </Link>
          ) : (
            <span className="min-w-0 truncate font-medium" data-trace={l.key}>
              {l.value}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function HistoryList({ items }: { items: HistoryItem[] }) {
  return (
    <TimelineList
      emptyText="Sem histórico registrado."
      items={items.map((h) => ({
        id: h.id,
        icon: <CircleDot className="size-3.5" />,
        tone: h.tone,
        title: h.title,
        subtitle: [h.subtitle, h.by ? `por ${h.by}` : null].filter(Boolean).join(" · ") || undefined,
        date: formatDateTime(h.at),
      }))}
    />
  );
}

/** Confirmação com motivo obrigatório (mín. 5 caracteres). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Motivo",
  placeholder,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const id = React.useId();
  const [reason, setReason] = React.useState("");
  const confirm = async () => {
    if (await onConfirm(reason.trim())) setReason("");
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          <FormField label={label} htmlFor={`${id}-reason`} required hint="Mínimo de 5 caracteres; fica registrado no histórico e na auditoria">
            <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Voltar
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={confirm} loading={pending} disabled={reason.trim().length < 5}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aviso de acesso negado (redirecionamento com ?erro=sem-permissao). */
export function AccessNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("mb-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg", className)}>
      {children}
    </div>
  );
}
