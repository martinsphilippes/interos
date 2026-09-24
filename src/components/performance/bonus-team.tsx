"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CalendarCheck, CheckCircle2, ChevronRight, FileWarning, History, ShieldOff, Users } from "lucide-react";
import type { BonusBlockView } from "@/server/performance/bonus";
import type { BonusAuditEntry } from "@/server/performance/queries";
import { closeBonusPeriod, confirmBonusBlock, registerBonusBlock, revokeBonusBlock } from "@/server/performance/actions";
import { BLOCK_STATUS_LABELS, BLOCK_STATUS_TONES } from "@/server/performance/schemas";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AttainmentBar } from "@/components/kpis/attainment-bar";
import { statusFor } from "./bonus-status";

export interface TeamBonusRow {
  userId: string;
  userName: string;
  department: DepartmentKey;
  overall: number | null;
  tierLabel: string | null;
  payoutPct: number;
  total: number | null;
  blocked: boolean;
  pending: number;
  incomplete: boolean;
  hasSalary: boolean;
}

export interface BlockOption {
  userId: string;
  name: string;
  blockers: { key: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Registrar bloqueio
// ---------------------------------------------------------------------------

function BlockDialog({ open, onOpenChange, options, period, periodOptions, defaultUserId }: { open: boolean; onOpenChange: (v: boolean) => void; options: BlockOption[]; period: string; periodOptions: { value: string; label: string }[]; defaultUserId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ userId: defaultUserId ?? "", period, blockerKey: "", reason: "", evidence: "", notes: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [lastOpen, setLastOpen] = React.useState(open);

  // Reinicia o formulário a cada abertura (padrão "ajustar estado durante a renderização").
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({ userId: defaultUserId ?? "", period, blockerKey: "", reason: "", evidence: "", notes: "" });
      setError(null);
    }
  }

  const blockers = options.find((o) => o.userId === form.userId)?.blockers ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await registerBonusBlock({ ...form, evidence: form.evidence || undefined, notes: form.notes || undefined });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Bloqueio registrado para análise");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent size="md">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Registrar bloqueio de bônus</DialogTitle>
            <DialogDescription>O bloqueio entra como “aberto”. Só zera o bônus depois de confirmado por um gestor ou administrador.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <FormField label="Colaborador" required>
              <Select value={form.userId} required placeholder="Escolha o colaborador" onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value, blockerKey: "" }))} options={options.map((o) => ({ value: o.userId, label: o.name }))} />
            </FormField>
            <FormField label="Competência" required>
              <Select value={form.period} required onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} options={periodOptions} />
            </FormField>
            <FormField label="Bloqueador (linha vermelha da regra)" required hint={form.userId && blockers.length === 0 ? "A regra deste colaborador não tem bloqueadores." : undefined}>
              <Select value={form.blockerKey} required placeholder="Escolha o bloqueador" disabled={!form.userId} onChange={(e) => setForm((f) => ({ ...f, blockerKey: e.target.value }))} options={blockers.map((b) => ({ value: b.key, label: b.label }))} />
            </FormField>
            <FormField label="Motivo" required>
              <Textarea value={form.reason} required minLength={10} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="O que aconteceu, quando e com qual cliente" />
            </FormField>
            <FormField label="Evidência" hint="Link do documento, protocolo, número do chamado...">
              <Input value={form.evidence} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, evidence: e.target.value }))} placeholder="https://… ou protocolo" />
            </FormField>
            <FormField label="Observação">
              <Textarea value={form.notes} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="min-h-[64px]" />
            </FormField>
            {error ? (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="min-h-[44px] md:min-h-0">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} className="min-h-[44px] md:min-h-0">
              <FileWarning /> Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lista de bloqueios com decisão e auditoria
// ---------------------------------------------------------------------------

type Decision = { block: BonusBlockView; kind: "confirmar" | "revogar" } | null;

export function BonusBlocksList({ blocks, audit, manageableIds }: { blocks: BonusBlockView[]; audit: BonusAuditEntry[]; manageableIds: string[] }) {
  const router = useRouter();
  const [decision, setDecision] = React.useState<Decision>(null);
  const [note, setNote] = React.useState("");

  const onConfirm = async () => {
    if (!decision) return;
    const action = decision.kind === "confirmar" ? confirmBonusBlock : revokeBonusBlock;
    const result = await action({ id: decision.block.id, note: note || undefined });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(decision.kind === "confirmar" ? "Bloqueio confirmado: colaborador notificado" : "Bloqueio revogado");
    setNote("");
    router.refresh();
  };

  if (blocks.length === 0) return <EmptyState size="sm" icon={<ShieldOff />} title="Nenhum bloqueio registrado" description="Bloqueios (linhas vermelhas) registrados para a equipe aparecem aqui, com a trilha de auditoria." />;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {blocks.map((b) => {
          const trail = audit.filter((a) => a.blockId === b.id);
          const canDecide = manageableIds.includes(b.userId) && b.status !== "revogado";
          return (
            <li key={b.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {b.userName} · <span className="capitalize">{b.period}</span>
                  </p>
                  <p className="text-sm">{b.blockerLabel}</p>
                </div>
                <Badge variant={BLOCK_STATUS_TONES[b.status]} size="sm">
                  {BLOCK_STATUS_LABELS[b.status]}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{b.reason}</p>
              {b.evidence ? (
                <p className="mt-1 break-all text-xs">
                  Evidência:{" "}
                  {/^https?:\/\//.test(b.evidence) ? (
                    <a href={b.evidence} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      {b.evidence}
                    </a>
                  ) : (
                    b.evidence
                  )}
                </p>
              ) : null}
              {b.notes ? <p className="mt-1 whitespace-pre-line text-xs text-muted">{b.notes}</p> : null}
              {trail.length > 0 ? (
                <details className="mt-2 text-xs">
                  <summary className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 text-muted hover:text-foreground">
                    <History className="size-3.5" aria-hidden /> Auditoria ({trail.length})
                  </summary>
                  <ol className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
                    {trail.map((a) => (
                      <li key={a.id}>
                        <span className="font-medium">{a.title}</span> · {a.actorName} · {formatDateTime(a.occurredAt)}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {canDecide ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.status === "aberto" ? (
                    <Button size="sm" variant="destructive" className="min-h-[44px] md:min-h-0" onClick={() => setDecision({ block: b, kind: "confirmar" })}>
                      <Ban /> Confirmar bloqueio
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setDecision({ block: b, kind: "revogar" })}>
                    <CheckCircle2 /> Revogar
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(v) => {
          if (!v) {
            setDecision(null);
            setNote("");
          }
        }}
        title={decision?.kind === "confirmar" ? "Confirmar bloqueio?" : "Revogar bloqueio?"}
        description={
          decision?.kind === "confirmar"
            ? `O bônus de ${decision.block.userName} em ${decision.block.period} será zerado (inclusive extras) e o colaborador será notificado.`
            : decision
              ? `O bônus de ${decision.block.userName} em ${decision.block.period} volta a ser calculado normalmente.`
              : undefined
        }
        destructive={decision?.kind === "confirmar"}
        confirmLabel={decision?.kind === "confirmar" ? "Confirmar bloqueio" : "Revogar"}
        onConfirm={onConfirm}
      >
        <FormField label="Justificativa (fica na auditoria)">
          <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
        </FormField>
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Painel da equipe
// ---------------------------------------------------------------------------

export function BonusTeamPanel({
  rows,
  month,
  monthLabel,
  options,
  periodOptions,
  canClose,
}: {
  rows: TeamBonusRow[];
  month: string;
  monthLabel: string;
  options: BlockOption[];
  periodOptions: { value: string; label: string }[];
  canClose: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<{ open: boolean; userId?: string }>({ open: false });
  const [closing, setClosing] = React.useState(false);

  const onClose = async () => {
    const result = await closeBonusPeriod({ period: month });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Competência fechada: ${result.data.written} colaborador(es), total ${formatCurrency(result.data.total)}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Projeção de {monthLabel.toLowerCase()} para quem tem regra de bônus vigente.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setDialog({ open: true })} disabled={options.length === 0}>
            <FileWarning /> Registrar bloqueio
          </Button>
          {canClose ? (
            <Button className="min-h-[44px] md:min-h-0" onClick={() => setClosing(true)}>
              <CalendarCheck /> Fechar competência
            </Button>
          ) : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState size="sm" icon={<Users />} title="Nenhum colaborador com regra de bônus" description="Cadastre uma regra para o departamento em Performance › Bônus › Regras." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.userId} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_140px_120px_auto] md:items-center md:gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.userName}</p>
                <p className="text-xs text-muted">{DEPARTMENT_LABELS[r.department]}</p>
              </div>
              <div className="min-w-0">
                {r.overall === null ? <p className="text-xs text-muted">{r.incomplete ? "Sem dados suficientes" : "—"}</p> : <AttainmentBar attainment={r.overall} status={statusFor(r.overall)} size="sm" />}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span>{r.tierLabel ?? "—"}</span>
                <span className="text-xs text-muted">({r.payoutPct}%)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                <span className="text-sm font-semibold tabular-nums">{r.blocked ? formatCurrency(0) : r.total === null ? "—" : formatCurrency(r.total)}</span>
                {r.blocked ? (
                  <Badge variant="danger" size="sm">
                    Bloqueado
                  </Badge>
                ) : r.pending > 0 ? (
                  <Badge variant="warning" size="sm">
                    {r.pending} em análise
                  </Badge>
                ) : null}
                {!r.hasSalary ? (
                  <Badge variant="muted" size="sm">
                    sem salário
                  </Badge>
                ) : null}
              </div>
              <div className="flex gap-1 md:justify-end">
                <Button size="sm" variant="ghost" className="min-h-[44px] md:min-h-0" onClick={() => setDialog({ open: true, userId: r.userId })} aria-label={`Registrar bloqueio para ${r.userName}`}>
                  <Ban />
                </Button>
                <Button size="sm" variant="ghost" asChild className="min-h-[44px] md:min-h-0">
                  <Link href={`/performance/bonus?usuario=${r.userId}&periodo=${month}`} aria-label={`Detalhamento de ${r.userName}`}>
                    Detalhar <ChevronRight />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <BlockDialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} options={options} period={month} periodOptions={periodOptions} defaultUserId={dialog.userId} />
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Fechar ${monthLabel.toLowerCase()}?`}
        description={`Grava o resultado de bônus de cada colaborador (${rows.length} na sua visão) com a regra e a versão vigentes, avisa cada um do valor apurado e reavalia a medalha "Mês 100%". Pode ser refeito: o fechamento é regravado.`}
        confirmLabel="Fechar competência"
        onConfirm={onClose}
      />
    </div>
  );
}
