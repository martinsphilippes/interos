"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveManagerAlertsAction, savePauseReasonsAction } from "@/server/conversations/supervision-actions";
import type { ManagerAlertsConfig, PauseReason } from "@/domain/central-ops";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";

function SaveBar({ dirty, pending, onSave, onReset }: { dirty: boolean; pending: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
      {dirty ? <span className="text-sm text-muted">Alterações não salvas</span> : null}
      <Button variant="ghost" onClick={onReset} disabled={!dirty || pending}>
        Descartar
      </Button>
      <Button onClick={onSave} loading={pending} disabled={!dirty}>
        Salvar
      </Button>
    </div>
  );
}

/** Motivos de pausa: o operador escolhe na barra superior; acima do limite, o gerente é avisado (se o alerta estiver ligado). */
export function PauseReasonsAdmin({ reasons, canEdit }: { reasons: PauseReason[]; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState(reasons.map((r) => ({ ...r, maxMinutes: r.maxMinutes ? String(r.maxMinutes) : "" })));
  const [pending, startTransition] = React.useTransition();
  const initial = JSON.stringify(reasons.map((r) => ({ ...r, maxMinutes: r.maxMinutes ? String(r.maxMinutes) : "" })));
  const dirty = JSON.stringify(rows) !== initial;
  const set = (i: number, v: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...v } : r)));
  const save = () =>
    startTransition(async () => {
      const r = await savePauseReasonsAction({ reasons: rows.map((x) => ({ key: x.key || undefined, label: x.label, maxMinutes: x.maxMinutes ? Number(x.maxMinutes) : null, active: x.active })) });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Motivos de pausa salvos");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted">Em pausa, a pessoa não recebe conversas novas. O gerente vê o motivo e há quanto tempo na Central de Comando; passou do limite, é avisado (Alertas do gerente).</p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.key || `novo-${i}`} className="grid grid-cols-[minmax(0,1fr)_150px_auto_40px] items-end gap-2 rounded-lg border border-border bg-surface p-3">
            <FormField label="Motivo" htmlFor={`pz-${i}`}>
              <Input id={`pz-${i}`} value={r.label} disabled={!canEdit} onChange={(e) => set(i, { label: e.target.value })} />
            </FormField>
            <FormField label="Limite (min)" htmlFor={`pz-max-${i}`}>
              <Input id={`pz-max-${i}`} type="number" min={1} max={480} value={r.maxMinutes} placeholder="sem limite" disabled={!canEdit} onChange={(e) => set(i, { maxMinutes: e.target.value })} />
            </FormField>
            <Switch size="sm" checked={r.active} disabled={!canEdit} onCheckedChange={(v) => set(i, { active: v })} label="Ativo" className="pb-2" />
            <Button size="icon" variant="ghost" aria-label={`Remover ${r.label}`} disabled={!canEdit || rows.length <= 1 || Boolean(r.key)} title={r.key ? "Motivo em uso: desative em vez de remover" : undefined} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        {canEdit && rows.length < 20 ? (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setRows((rs) => [...rs, { key: "", label: "", maxMinutes: "", active: true }])}>
            <Plus /> Motivo
          </Button>
        ) : null}
      </div>
      {canEdit ? <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => setRows(JSON.parse(initial))} /> : null}
    </div>
  );
}

/** Alertas do gerente: vão como notificação para o gestor do operador ou do departamento da fila (sem gestor, admins). */
export function ManagerAlertsAdmin({ config, canEdit, schedulerOk }: { config: ManagerAlertsConfig; canEdit: boolean; schedulerOk: boolean }) {
  const router = useRouter();
  const [c, setC] = React.useState(config);
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(c) !== JSON.stringify(config);
  const patch = <K extends keyof ManagerAlertsConfig>(k: K, v: ManagerAlertsConfig[K] extends object ? Partial<ManagerAlertsConfig[K]> : ManagerAlertsConfig[K]) =>
    setC((prev) => ({ ...prev, [k]: typeof prev[k] === "object" ? { ...(prev[k] as object), ...(v as object) } : v }));
  const save = () =>
    startTransition(async () => {
      const r = await saveManagerAlertsAction(c);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Alertas salvos");
      router.refresh();
    });
  const ro = !canEdit;
  const card = (title: string, description: string, active: boolean, onActive: (v: boolean) => void, children?: React.ReactNode) => (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted">{description}</p>
        </div>
        <Switch checked={active} onCheckedChange={onActive} disabled={ro} aria-label={`${title}: ${active ? "ligado" : "desligado"}`} />
      </div>
      {children}
    </section>
  );
  return (
    <div className="flex flex-col gap-4">
      {!schedulerOk ? (
        <p role="note" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          Os alertas são conferidos pelo agendador a cada 5 minutos, e ele ainda não rodou. Veja Ativação dos canais.
        </p>
      ) : null}
      <p className="max-w-3xl text-sm text-muted">Tudo nasce desligado. Os alertas chegam como notificação para o gestor do operador ou do departamento da fila (sem gestor, para os administradores).</p>
      {card(
        "Fila cheia",
        "Mais conversas esperando que o limite.",
        c.queue.active,
        (v) => patch("queue", { active: v }),
        <FormField label="Avisar acima de (conversas)" htmlFor="al-q" className="max-w-[220px]">
          <Input id="al-q" type="number" min={1} max={200} value={c.queue.maxWaiting} disabled={ro} onChange={(e) => patch("queue", { maxWaiting: Number(e.target.value) })} />
        </FormField>,
      )}
      {card("SLA perto de estourar", "Conversa com o prazo em risco: avisa quem atende e o gestor.", c.sla.active, (v) => patch("sla", { active: v }))}
      {card(
        "Cliente sem resposta",
        "Operador com cliente esperando resposta há muito tempo.",
        c.idle.active,
        (v) => patch("idle", { active: v }),
        <FormField label="Depois de (min)" htmlFor="al-i" className="max-w-[220px]">
          <Input id="al-i" type="number" min={1} max={240} value={c.idle.minutes} disabled={ro} onChange={(e) => patch("idle", { minutes: Number(e.target.value) })} />
        </FormField>,
      )}
      {card("Pausa longa", "Operador em pausa além do limite do motivo (aba Motivos de pausa).", c.pause.active, (v) => patch("pause", { active: v }))}
      <FormField label="Repetir o mesmo alerta no máximo a cada (min)" htmlFor="al-r" className="max-w-[320px]">
        <Input id="al-r" type="number" min={5} max={1440} value={c.repeatMinutes} disabled={ro} onChange={(e) => setC((p) => ({ ...p, repeatMinutes: Number(e.target.value) }))} />
      </FormField>
      {canEdit ? <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => setC(config)} /> : null}
    </div>
  );
}
