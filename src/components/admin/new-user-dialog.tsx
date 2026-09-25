"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Plus } from "lucide-react";
import { ROLE_KEYS, ROLE_LABELS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import type { Department } from "@/domain/types";
import type { UserRow } from "@/server/admin/queries";
import type { CreateUserInput } from "@/server/admin/schemas";
import { createUser } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { FormError } from "./form-error";
import { useAdminUrl } from "./use-admin-url";

export interface NewUserDialogProps {
  users: UserRow[];
  departments: Department[];
}

/** Botão "Novo usuário" + diálogo (?novo=1). Ao criar, abre o drawer do usuário recém-criado. */
export function NewUserDialog({ users, departments }: NewUserDialogProps) {
  const { searchParams, setLocal, navigate } = useAdminUrl();
  const open = searchParams.get("novo") === "1";
  return (
    <>
      <Button onClick={() => setLocal({ novo: "1" })}>
        <Plus /> Novo usuário
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setLocal({ novo: null })}>
        <DialogContent size="lg">
          {open ? <NewUserForm users={users} departments={departments} onClose={() => setLocal({ novo: null })} onCreated={(id) => navigate({ novo: null, usuario: id }, { replace: true })} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface FormState {
  name: string;
  email: string;
  password: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  managerId: string;
  jobTitle: string;
}

function NewUserForm({ users, departments, onClose, onCreated }: NewUserDialogProps & { onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [show, setShow] = React.useState(false);
  const [form, setForm] = React.useState<FormState>({
    name: "",
    email: "",
    password: "",
    role: "colaborador",
    departmentId: departments[0]?.key ?? "administrativo",
    managerId: "",
    jobTitle: "",
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const managers = users.filter((u) => u.active !== false);

  // Sugere como gestor o gestor do departamento escolhido (quem tem papel "gestor" nele).
  const suggestManager = (departmentId: DepartmentKey) => {
    const candidate = managers.find((u) => u.departmentId === departmentId && u.role === "gestor");
    return candidate?.id ?? "";
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: CreateUserInput = {
      name: form.name,
      email: form.email,
      password: form.password,
      role: form.role,
      departmentId: form.departmentId,
      managerId: form.managerId || undefined,
      jobTitle: form.jobTitle || undefined,
      monthlyGoals: {},
    };
    startTransition(async () => {
      const result = await createUser(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Usuário criado");
      onCreated(result.data.id);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>Novo usuário</DialogTitle>
        <DialogDescription>Cria o login no Firebase Auth e o cadastro no INTEROS. Metas mensais e telefone podem ser preenchidos depois, no drawer do usuário.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 py-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome completo" htmlFor="nu-name" required className="sm:col-span-2">
            <Input id="nu-name" autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} placeholder="Ex.: Maria Souza" />
          </FormField>
          <FormField label="E-mail" htmlFor="nu-email" required hint="Será o login do usuário.">
            <Input id="nu-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required autoComplete="off" placeholder="nome@intercert.com.br" />
          </FormField>
          <FormField label="Senha inicial" htmlFor="nu-password" required hint="Mínimo de 8 caracteres.">
            <Input
              id="nu-password"
              type={show ? "text" : "password"}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              trailing={
                <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-surface-hover" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
                  {show ? <EyeOff /> : <Eye />}
                </button>
              }
            />
          </FormField>
          <FormField label="Papel" htmlFor="nu-role" required>
            <Select id="nu-role" value={form.role} onChange={(e) => set("role", e.target.value as RoleKey)}>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Departamento" htmlFor="nu-department" required>
            <Select
              id="nu-department"
              value={form.departmentId}
              onChange={(e) => {
                const departmentId = e.target.value as DepartmentKey;
                setForm((f) => ({ ...f, departmentId, managerId: f.managerId || suggestManager(departmentId) }));
              }}
            >
              {departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Gestor" htmlFor="nu-manager">
            <Select id="nu-manager" value={form.managerId} onChange={(e) => set("managerId", e.target.value)}>
              <option value="">Sem gestor</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Cargo" htmlFor="nu-job">
            <Input id="nu-job" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} maxLength={80} placeholder="Ex.: Consultor de Vendas" />
          </FormField>
        </div>
        <FormError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Criar usuário
        </Button>
      </DialogFooter>
    </form>
  );
}
