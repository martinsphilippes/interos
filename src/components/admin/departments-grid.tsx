"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckSquare, Info, Pencil, Users } from "lucide-react";
import { DEPARTMENT_KEYS } from "@/domain/constants";
import type { User } from "@/domain/types";
import type { DepartmentRow } from "@/server/admin/queries";
import type { UpdateDepartmentInput } from "@/server/admin/schemas";
import { updateDepartment } from "@/server/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { FormError } from "./form-error";
import { parseNumber } from "./admin-model";

export interface DepartmentsGridProps {
  departments: DepartmentRow[];
  users: Pick<User, "id" | "name" | "active" | "departmentId">[];
  canEdit: boolean;
}

/** Cards dos departamentos (chave fixa) com contagens reais e drawer de edição. */
export function DepartmentsGrid({ departments, users, canEdit }: DepartmentsGridProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = departments.find((d) => d.id === selectedId) ?? null;

  return (
    <>
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-fg">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          O conjunto de departamentos é fixo nesta fase ({DEPARTMENT_KEYS.length} chaves definidas no sistema: {DEPARTMENT_KEYS.join(", ")}). Não é possível criar nem excluir departamentos; edite nome, gestor,
          cor, descrição e ordem.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {departments.map((d) => (
          <li key={d.id}>
            <Card className="flex h-full flex-col overflow-hidden">
              <div className="h-1.5 w-full" style={{ backgroundColor: d.color ?? "#94a3b8" }} aria-hidden />
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold leading-tight">{d.name}</h3>
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {d.key} · ordem {d.order}
                    </p>
                  </div>
                  <span className="size-6 shrink-0 rounded-full border border-border" style={{ backgroundColor: d.color ?? "#94a3b8" }} title={d.color ?? "Sem cor"} aria-label={`Cor ${d.color ?? "não definida"}`} />
                </div>
                {d.description ? <p className="line-clamp-2 text-sm text-muted">{d.description}</p> : <p className="text-sm text-muted-light">Sem descrição.</p>}
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-surface-muted px-2.5 py-2">
                    <dt className="flex items-center gap-1 text-muted">
                      <Users className="size-3.5" aria-hidden /> Usuários ativos
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{d.activeUsers}</dd>
                  </div>
                  <Link href={`/tarefas?view=equipe&dep=${d.key}`} className="rounded-md bg-surface-muted px-2.5 py-2 transition-colors hover:bg-surface-hover">
                    <dt className="flex items-center gap-1 text-muted">
                      <CheckSquare className="size-3.5" aria-hidden /> Tarefas abertas
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{d.openTasks}</dd>
                  </Link>
                </dl>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <div className="min-w-0 text-xs">
                    <span className="text-muted">Gestor: </span>
                    {d.managerName ? (
                      <Link href={`/admin/usuarios?usuario=${d.managerId}`} className="font-medium text-foreground hover:underline">
                        {d.managerName}
                      </Link>
                    ) : (
                      <Badge variant="warning" size="sm">
                        sem gestor
                      </Badge>
                    )}
                  </div>
                  {canEdit ? (
                    <Button variant="outline" size="sm" onClick={() => setSelectedId(d.id)}>
                      <Pencil /> Editar
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Drawer open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DrawerContent size="md">{selected ? <DepartmentForm key={`${selected.id}-${selected.updatedAt}`} department={selected} users={users} onClose={() => setSelectedId(null)} /> : null}</DrawerContent>
      </Drawer>
    </>
  );
}

function DepartmentForm({ department, users, onClose }: { department: DepartmentRow; users: DepartmentsGridProps["users"]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    name: department.name,
    managerId: department.managerId ?? "",
    color: department.color ?? "#94A3B8",
    description: department.description ?? "",
    order: String(department.order),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  // Gestores candidatos: usuários ativos, os do próprio departamento primeiro.
  const candidates = users
    .filter((u) => u.active !== false)
    .sort((a, b) => (a.departmentId === department.key ? 0 : 1) - (b.departmentId === department.key ? 0 : 1) || a.name.localeCompare(b.name, "pt-BR"));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const order = parseNumber(form.order);
    if (Number.isNaN(order)) {
      setError("Informe a ordem (número inteiro)");
      return;
    }
    const input: UpdateDepartmentInput = {
      id: department.id,
      name: form.name,
      managerId: form.managerId || undefined,
      color: form.color || undefined,
      description: form.description || undefined,
      order,
    };
    startTransition(async () => {
      const result = await updateDepartment(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Departamento salvo");
      onClose();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader>
        <DrawerTitle>Editar departamento</DrawerTitle>
        <DrawerDescription>
          Chave <span className="font-mono">{department.key}</span> (fixa)
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <FormField label="Nome" htmlFor="dp-name" required>
          <Input id="dp-name" value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={60} />
        </FormField>
        <FormField label="Gestor" htmlFor="dp-manager" hint="Recebe notificações e aprovações do departamento.">
          <Select id="dp-manager" value={form.managerId} onChange={(e) => set("managerId", e.target.value)}>
            <option value="">Sem gestor</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.departmentId === department.key ? "" : " (outro departamento)"}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Cor" htmlFor="dp-color" hint="Formato #RRGGBB.">
            <div className="flex items-center gap-2">
              <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(form.color) ? form.color : "#94A3B8"} onChange={(e) => set("color", e.target.value.toUpperCase())} className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5" aria-label="Escolher cor" />
              <Input id="dp-color" value={form.color} onChange={(e) => set("color", e.target.value)} placeholder="#F26A21" maxLength={7} className="font-mono uppercase" />
            </div>
          </FormField>
          <FormField label="Ordem" htmlFor="dp-order" required hint="Posição nas listas e no workflow.">
            <Input id="dp-order" type="number" inputMode="numeric" min={1} max={99} step={1} value={form.order} onChange={(e) => set("order", e.target.value)} required />
          </FormField>
        </div>
        <FormField label="Descrição" htmlFor="dp-description">
          <Textarea id="dp-description" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={200} placeholder="O que este departamento entrega." />
        </FormField>
        <FormError message={error} />
      </DrawerBody>
      <DrawerFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Salvar
        </Button>
      </DrawerFooter>
    </form>
  );
}
