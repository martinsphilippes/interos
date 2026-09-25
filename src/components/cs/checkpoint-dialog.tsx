"use client";

import * as React from "react";
import { CalendarCheck } from "lucide-react";
import { registerCheckpoint } from "@/server/cs/actions";
import { CHECKPOINT_TYPE_LABELS, CHECKPOINT_TYPES, type CheckpointType } from "@/server/cs/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCsAction } from "./use-cs";

export interface CheckpointDialogProps {
  clientId: string;
  clientName: string;
  /** Valores atuais da conta, para pré-preencher. */
  adoptionPct?: number;
  satisfaction?: number;
  /** Botão que abre o diálogo; padrão: "Registrar checkpoint". */
  trigger?: React.ReactElement<{ onClick?: () => void }>;
  size?: "sm" | "md";
  variant?: "primary" | "outline" | "ghost";
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Registro de checkpoint: atualiza a conta de CS (adoção, satisfação, riscos, próxima interação),
 * grava o evento na timeline, recalcula a saúde e, opcionalmente, cria tarefas dos próximos passos.
 */
export function CheckpointDialog({ clientId, clientName, adoptionPct, satisfaction, trigger, size = "sm", variant = "outline" }: CheckpointDialogProps) {
  const [open, setOpen] = React.useState(false);
  const { pending, run } = useCsAction();
  const [type, setType] = React.useState<CheckpointType>("ligacao");
  const [summary, setSummary] = React.useState("");
  const [sat, setSat] = React.useState(satisfaction !== undefined ? String(satisfaction) : "8");
  const [adoption, setAdoption] = React.useState(adoptionPct !== undefined ? String(adoptionPct) : "");
  const [risks, setRisks] = React.useState("");
  const [nextSteps, setNextSteps] = React.useState("");
  const [createTasks, setCreateTasks] = React.useState(true);
  const [nextInDays, setNextInDays] = React.useState("30");
  const id = React.useId();

  const reset = () => {
    setSummary("");
    setRisks("");
    setNextSteps("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () =>
        registerCheckpoint({
          clientId,
          type,
          summary,
          satisfaction: Number(sat.replace(",", ".")),
          adoptionPct: Number(adoption),
          risks: lines(risks),
          nextSteps: lines(nextSteps),
          createTasks,
          nextInDays: Number(nextInDays),
        }),
      (data) => `Checkpoint registrado${data.score !== undefined ? ` · saúde ${data.score}` : ""}${data.tasksCreated ? ` · ${data.tasksCreated} tarefa(s) criada(s)` : ""}`,
    );
    if (ok) {
      reset();
      setOpen(false);
    }
  };

  const openButton = trigger ? (
    React.cloneElement(trigger, { onClick: () => setOpen(true) })
  ) : (
    <Button size={size} variant={variant} onClick={() => setOpen(true)} className="min-h-[44px] max-w-full md:min-h-0" title="Registrar checkpoint">
      <CalendarCheck /> <span className="truncate">Registrar checkpoint</span>
    </Button>
  );

  return (
    <>
      {openButton}
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent size="lg">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>Registrar checkpoint</DialogTitle>
              <DialogDescription>{clientName}: o registro atualiza a conta de CS, a timeline e recalcula a saúde.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Tipo" htmlFor={`${id}-type`} required>
                  <Select id={`${id}-type`} value={type} onChange={(e) => setType(e.target.value as CheckpointType)} options={CHECKPOINT_TYPES.map((t) => ({ value: t, label: CHECKPOINT_TYPE_LABELS[t] }))} />
                </FormField>
                <FormField label="Próxima interação em (dias)" htmlFor={`${id}-next`} required>
                  <Input id={`${id}-next`} type="number" min={1} max={365} inputMode="numeric" value={nextInDays} onChange={(e) => setNextInDays(e.target.value)} required />
                </FormField>
              </div>
              <FormField label="Resumo" htmlFor={`${id}-summary`} required>
                <Textarea id={`${id}-summary`} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="O que foi conversado, percepção do cliente, uso do sistema…" required minLength={5} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Satisfação percebida (0 a 10)" htmlFor={`${id}-sat`} required>
                  <Input id={`${id}-sat`} type="number" min={0} max={10} step={0.5} inputMode="decimal" value={sat} onChange={(e) => setSat(e.target.value)} required />
                </FormField>
                <FormField label="Adoção atualizada (%)" htmlFor={`${id}-adoption`} required hint="Percentual dos módulos contratados em uso.">
                  <Input id={`${id}-adoption`} type="number" min={0} max={100} inputMode="numeric" value={adoption} onChange={(e) => setAdoption(e.target.value)} required />
                </FormField>
              </div>
              <FormField label="Riscos identificados" htmlFor={`${id}-risks`} hint="Um por linha. Substituem os riscos manuais anteriores da conta.">
                <Textarea id={`${id}-risks`} value={risks} onChange={(e) => setRisks(e.target.value)} className="min-h-[72px]" placeholder={"Decisor citou concorrente\nPouco uso do estoque"} />
              </FormField>
              <FormField label="Próximos passos" htmlFor={`${id}-steps`} hint="Um por linha.">
                <Textarea id={`${id}-steps`} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} className="min-h-[72px]" placeholder={"Enviar material de treinamento\nAgendar reforço com a equipe"} />
              </FormField>
              <Checkbox checked={createTasks} onCheckedChange={(v) => setCreateTasks(v === true)} label="Criar tarefas para os próximos passos" description="Atribuídas ao responsável de CS do cliente." />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
