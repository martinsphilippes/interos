"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, CircleDashed, Clock } from "lucide-react";
import { saveRecordingPolicyAction } from "@/server/conversations/supervision-actions";
import type { ActivationGroup, StepStatus } from "@/server/conversations/activation";
import type { RecordingPolicy } from "@/domain/central-ops";
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@/domain/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

const STATUS: Record<StepStatus, { label: string; icon: React.ReactNode; className: string }> = {
  pronto: { label: "Pronto", icon: <CheckCircle2 className="size-5" aria-hidden />, className: "text-success-fg" },
  pendente: { label: "Pendente", icon: <Circle className="size-5" aria-hidden />, className: "text-warning-fg" },
  opcional: { label: "Opcional", icon: <CircleDashed className="size-5" aria-hidden />, className: "text-muted" },
  depois: { label: "Depende de outro passo", icon: <Clock className="size-5" aria-hidden />, className: "text-muted" },
};

/** Assistente de ativação: o que está pronto e o que falta, canal a canal, com onde resolver. */
export function ActivationView({ groups, policy, canEditPolicy }: { groups: ActivationGroup[]; policy: RecordingPolicy; canEditPolicy: boolean }) {
  const steps = groups.flatMap((g) => g.steps).filter((s) => s.status !== "opcional");
  const done = steps.filter((s) => s.status === "pronto").length;
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <p className="text-sm text-muted">Progresso</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {done} de {steps.length} passos prontos
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" aria-hidden>
          <div className="h-full rounded-full bg-success" style={{ width: `${steps.length ? Math.round((done / steps.length) * 100) : 0}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">Lido da configuração real a cada abertura (credenciais conferidas só pela existência; os valores nunca aparecem).</p>
      </div>

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`ag-${g.key}`} className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <h2 id={`ag-${g.key}`} className="border-b border-border px-4 py-3 text-sm font-semibold">
            {g.title}
          </h2>
          <ul>
            {g.steps.map((s) => (
              <li key={s.key} className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
                <span className={cn("mt-0.5", STATUS[s.status].className)} title={STATUS[s.status].label}>
                  {STATUS[s.status].icon}
                  <span className="sr-only">{STATUS[s.status].label}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-sm text-muted">{s.detail}</p>
                  {s.fix ? <p className="mt-1 text-xs text-warning-fg">Como resolver: {s.fix}</p> : null}
                </div>
                {s.href ? (
                  <Link href={s.href} className="shrink-0 self-center text-sm font-medium text-brand-fg hover:underline">
                    Abrir
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <RecordingPolicyForm policy={policy} canEdit={canEditPolicy} />
    </div>
  );
}

function RecordingPolicyForm({ policy, canEdit }: { policy: RecordingPolicy; canEdit: boolean }) {
  const router = useRouter();
  const [p, setP] = React.useState(policy);
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(p) !== JSON.stringify(policy);
  const ro = !canEdit;
  const save = () =>
    startTransition(async () => {
      const r = await saveRecordingPolicyAction(p);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Política de gravação salva");
      router.refresh();
    });
  const toggleRole = (role: RoleKey, on: boolean) => setP((x) => ({ ...x, listenRoles: on ? [...x.listenRoles, role] : x.listenRoles.filter((r) => r !== role) }));
  return (
    <section aria-labelledby="rec-t" className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="rec-t" className="text-sm font-semibold">
            Política de gravação de ligações
          </h2>
          <p className="text-sm text-muted">Vale quando a telefonia for ligada. Quem ouve ou baixa uma gravação fica registrado.</p>
        </div>
        <Switch checked={p.enabled} disabled={ro} onCheckedChange={(v) => setP((x) => ({ ...x, enabled: v }))} label="Gravar as ligações" />
      </div>
      <FormField label="Aviso tocado ao cliente no início da ligação" htmlFor="rec-notice" required>
        <Textarea id="rec-notice" rows={2} value={p.notice} disabled={ro} onChange={(e) => setP((x) => ({ ...x, notice: e.target.value }))} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Guardar por (dias)" htmlFor="rec-days" hint="Depois disso a gravação é apagada.">
          <Input id="rec-days" type="number" min={7} max={3650} value={p.retentionDays} disabled={ro} onChange={(e) => setP((x) => ({ ...x, retentionDays: Number(e.target.value) }))} />
        </FormField>
        <div className="flex items-end">
          <Switch checked={p.requireReason} disabled={ro} onCheckedChange={(v) => setP((x) => ({ ...x, requireReason: v }))} label="Exigir o motivo para ouvir ou baixar" className="w-full rounded-lg border border-border px-3 py-2" />
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-muted">Quem pode ouvir (além de quem atendeu a ligação)</legend>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {ROLE_KEYS.map((r) => (
            <label key={r} className="flex min-h-[40px] items-center gap-2 rounded-md border border-border px-2.5 text-sm">
              <Checkbox checked={p.listenRoles.includes(r)} disabled={ro} onCheckedChange={(v) => toggleRole(r, v === true)} />
              {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setP(policy)} disabled={!dirty || pending}>
            Descartar
          </Button>
          <Button onClick={save} loading={pending} disabled={!dirty}>
            Salvar política
          </Button>
        </div>
      ) : null}
    </section>
  );
}
