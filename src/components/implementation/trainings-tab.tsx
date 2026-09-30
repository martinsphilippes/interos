"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrainingDialog, type TrainingProjectOption } from "./training-dialog";
import { TrainingsList, type TrainingItem, type TrainingPermissions } from "./trainings-list";

export interface TrainingsTabProps {
  items: TrainingItem[];
  /** Projeto fixo (aba do projeto) ou lista de projetos ativos (tela de treinamentos). */
  project?: TrainingProjectOption;
  projects?: TrainingProjectOption[];
  products: { id: string; name: string }[];
  users: { id: string; name: string }[];
  defaultInstructorId: string;
  /** Ações permitidas (calculadas no servidor pelo catálogo; as actions revalidam). */
  permissions: TrainingPermissions;
  showProject?: boolean;
  /** Botão "novo" desabilitado (projeto concluído/cancelado). */
  allowNew?: boolean;
}

/** Treinamentos com o botão de agendar/registrar (aba do projeto e tela /implantacao/treinamentos). */
export function TrainingsTab({ items, project, projects, products, users, defaultInstructorId, permissions, showProject, allowNew = true }: TrainingsTabProps) {
  const [open, setOpen] = React.useState(false);
  const done = items.filter((t) => t.status === "realizado").length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {done} realizado(s) · {items.filter((t) => t.status === "agendado").length} agendado(s). O go-live exige pelo menos um treinamento realizado.
        </p>
        {permissions.schedule && allowNew ? (
          <Button className="h-11 md:h-9" onClick={() => setOpen(true)}>
            <Plus /> Agendar ou registrar
          </Button>
        ) : null}
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <TrainingsList items={items} permissions={permissions} showProject={showProject} />
      </div>
      {open ? <TrainingDialog open onOpenChange={setOpen} project={project} projects={projects} products={products} users={users} defaultInstructorId={defaultInstructorId} /> : null}
    </div>
  );
}
