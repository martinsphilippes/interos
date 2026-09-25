"use client";

import * as React from "react";
import { createTraining, markTrainingDone } from "@/server/implementation/actions";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useImplementationAction } from "./use-implementation-action";

export interface TrainingProjectOption {
  id: string;
  name: string;
  clientName: string;
  productIds: string[];
}

export interface TrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projeto fixo (aba do projeto) ou lista para escolher (tela de treinamentos). */
  project?: TrainingProjectOption;
  projects?: TrainingProjectOption[];
  products: { id: string; name: string }[];
  users: { id: string; name: string }[];
  defaultInstructorId: string;
}

const splitParticipants = (text: string) =>
  text
    .split(/[\n,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Agenda um treinamento ou registra um que já aconteceu (emite implementation.training.completed). */
export function TrainingDialog({ open, onOpenChange, project, projects = [], products, users, defaultInstructorId }: TrainingDialogProps) {
  const { pending, run } = useImplementationAction();
  const [projectId, setProjectId] = React.useState(project?.id ?? "");
  const [status, setStatus] = React.useState<"agendado" | "realizado">("agendado");
  const [subject, setSubject] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const [instructorId, setInstructorId] = React.useState(defaultInstructorId);
  const [scheduledAt, setScheduledAt] = React.useState(() => isoToDateTimeLocal(new Date(Date.now() + 86_400_000).toISOString()).slice(0, 11) + "09:00");
  const [participants, setParticipants] = React.useState("");
  const [materialUrl, setMaterialUrl] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const selected = project ?? projects.find((p) => p.id === projectId);
  const productOptions = products.filter((p) => selected?.productIds.includes(p.id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () =>
        createTraining({
          projectId: selected?.id ?? "",
          subject,
          productId,
          instructorId,
          scheduledAt: dateValueToIso(scheduledAt),
          participants: splitParticipants(participants),
          materialUrl,
          evidence,
          notes,
          status,
        }),
      status === "realizado" ? "Treinamento registrado como realizado" : "Treinamento agendado",
    );
    if (ok) {
      setSubject("");
      setParticipants("");
      setEvidence("");
      setNotes("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{status === "realizado" ? "Registrar treinamento realizado" : "Agendar treinamento"}</DialogTitle>
            <DialogDescription>{project ? `${project.clientName} · ${project.name}` : "Escolha o projeto de implantação."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Situação do treinamento"
              options={[
                { value: "agendado", label: "Agendar" },
                { value: "realizado", label: "Já realizado" },
              ]}
              value={status}
              onChange={setStatus}
              className="self-start"
            />
            {!project ? (
              <FormField label="Projeto" htmlFor="tr-project" required>
                <Select id="tr-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Selecione o projeto" required>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.clientName} — {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField label="Assunto" htmlFor="tr-subject" required>
              <Input id="tr-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Treinamento de PDV e caixa" required maxLength={200} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Produto" htmlFor="tr-product">
                <Select id="tr-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Geral</option>
                  {productOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Instrutor" htmlFor="tr-instructor" required>
                <Select id="tr-instructor" value={instructorId} onChange={(e) => setInstructorId(e.target.value)} required>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Data e hora" htmlFor="tr-date" required>
                <DateInput id="tr-date" mode="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
              </FormField>
            </div>
            <FormField label="Participantes" htmlFor="tr-participants" hint="Um por linha ou separados por vírgula">
              <Textarea id="tr-participants" value={participants} onChange={(e) => setParticipants(e.target.value)} className="min-h-[64px]" />
            </FormField>
            <FormField label="Material (link)" htmlFor="tr-material">
              <Input id="tr-material" type="url" value={materialUrl} onChange={(e) => setMaterialUrl(e.target.value)} placeholder="https://" />
            </FormField>
            {status === "realizado" ? (
              <FormField label="Evidência" htmlFor="tr-evidence" hint="Ex.: lista de presença, gravação, fotos">
                <Input id="tr-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} />
              </FormField>
            ) : null}
            <FormField label="Observações" htmlFor="tr-notes">
              <Textarea id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[64px]" maxLength={2000} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {status === "realizado" ? "Registrar" : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Conclui um treinamento agendado com evidência e observações. */
export function CompleteTrainingDialog({ open, onOpenChange, trainingId, subject }: { open: boolean; onOpenChange: (open: boolean) => void; trainingId: string; subject: string }) {
  const { pending, run } = useImplementationAction();
  const [evidence, setEvidence] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => markTrainingDone({ trainingId, evidence, notes }), "Treinamento concluído")) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Concluir treinamento</DialogTitle>
            <DialogDescription>{subject}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Evidência" htmlFor="ct-evidence" hint="Ex.: lista de presença assinada">
              <Input id="ct-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} />
            </FormField>
            <FormField label="Observações" htmlFor="ct-notes">
              <Textarea id="ct-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Concluir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
