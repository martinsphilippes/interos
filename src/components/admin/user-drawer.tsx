"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, Trash2, UserCheck, UserX } from "lucide-react";
import { ROLE_KEYS, ROLE_LABELS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import type { ActionResult, Department } from "@/domain/types";
import type { UserRow } from "@/server/admin/queries";
import type { UpdateUserInput } from "@/server/admin/schemas";
import { deleteUser, resetUserPassword, setUserActive, updateUser } from "@/server/admin/actions";
import { formatDateTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { FormError } from "./form-error";
import { KeyValueEditor, recordToRows, rowsToRecord, type KeyValueRow } from "./key-value-editor";
import { ActiveIndicator, RoleBadge } from "./users-table";
import { useAdminUrl } from "./use-admin-url";

export interface UserDrawerProps {
  user: UserRow | null;
  users: UserRow[];
  departments: Department[];
  canEdit: boolean;
  currentUserId: string;
}

/** Drawer de edição de usuário (?usuario=<id>). Em modo leitura (gestor/diretoria) só exibe os dados. */
export function UserDrawer({ user, users, departments, canEdit, currentUserId }: UserDrawerProps) {
  const { navigate } = useAdminUrl();
  const close = () => navigate({ usuario: null }, { replace: true });
  return (
    <Drawer open={Boolean(user)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="lg">
        {user ? <DrawerInner key={`${user.id}-${user.updatedAt}`} user={user} users={users} departments={departments} canEdit={canEdit} currentUserId={currentUserId} onClose={close} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

interface FormState {
  name: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  managerId: string;
  jobTitle: string;
  phone: string;
  active: boolean;
  goals: KeyValueRow[];
  baseSalary: string;
}

/** Chaves de meta já usadas por outros usuários (sugestões reais, não fixas). */
function goalSuggestions(users: UserRow[]): string[] {
  const keys = new Set<string>();
  for (const u of users) for (const k of Object.keys(u.monthlyGoals ?? {})) keys.add(k);
  return Array.from(keys).sort();
}

function DrawerInner({ user, users, departments, canEdit, currentUserId, onClose }: UserDrawerProps & { user: UserRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<"deactivate" | "reactivate" | "delete" | null>(null);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>({
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
    managerId: user.managerId ?? "",
    jobTitle: user.jobTitle ?? "",
    phone: user.phone ?? "",
    active: user.active !== false,
    goals: recordToRows(user.monthlyGoals),
    baseSalary: user.baseSalary === undefined || user.baseSalary === null ? "" : String(user.baseSalary),
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isSelf = user.id === currentUserId;
  const readOnly = !canEdit;
  const managers = users.filter((u) => u.id !== user.id && u.active !== false);
  const suggestions = React.useMemo(() => goalSuggestions(users), [users]);

  const run = (action: () => Promise<ActionResult<unknown>>, successMessage: string, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      after?.();
      router.refresh();
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const goals = rowsToRecord(form.goals, "meta");
    if (!goals.ok) {
      setError(goals.error);
      return;
    }
    const salary = form.baseSalary.trim() === "" ? undefined : Number(form.baseSalary.replace(",", "."));
    if (salary !== undefined && (!Number.isFinite(salary) || salary < 0)) {
      setError("Salário base inválido");
      return;
    }
    const input: UpdateUserInput = {
      id: user.id,
      name: form.name,
      role: form.role,
      departmentId: form.departmentId,
      managerId: form.managerId || undefined,
      jobTitle: form.jobTitle || undefined,
      phone: form.phone || undefined,
      active: form.active,
      monthlyGoals: goals.value,
      baseSalary: salary,
    };
    startTransition(async () => {
      const result = await updateUser(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Usuário salvo");
      router.refresh();
    });
  };

  return (
    <>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DrawerHeader>
          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.avatarUrl} size="lg" />
            <div className="min-w-0">
              <DrawerTitle className="truncate">{user.name}</DrawerTitle>
              <DrawerDescription className="truncate">{user.email}</DrawerDescription>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <RoleBadge role={user.role} />
                <ActiveIndicator active={user.active !== false} />
                {isSelf ? <span className="text-xs text-muted">Este é o seu usuário</span> : null}
              </div>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {readOnly ? <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">Modo leitura: apenas administradores editam usuários.</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome" htmlFor="ud-name" required className="sm:col-span-2">
              <Input id="ud-name" value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} disabled={readOnly} />
            </FormField>
            <FormField label="E-mail" htmlFor="ud-email" hint="O e-mail é o login e não pode ser alterado." className="sm:col-span-2">
              <Input id="ud-email" value={user.email} readOnly disabled />
            </FormField>
            <FormField label="Papel" htmlFor="ud-role" required hint={isSelf ? "Você não pode alterar o próprio papel." : undefined}>
              <Select id="ud-role" value={form.role} onChange={(e) => set("role", e.target.value as RoleKey)} disabled={readOnly || isSelf}>
                {ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Departamento" htmlFor="ud-department" required>
              <Select id="ud-department" value={form.departmentId} onChange={(e) => set("departmentId", e.target.value as DepartmentKey)} disabled={readOnly}>
                {departments.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Gestor" htmlFor="ud-manager">
              <Select id="ud-manager" value={form.managerId} onChange={(e) => set("managerId", e.target.value)} disabled={readOnly}>
                <option value="">Sem gestor</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Cargo" htmlFor="ud-job">
              <Input id="ud-job" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} maxLength={80} placeholder="Ex.: Analista de Suporte" disabled={readOnly} />
            </FormField>
            <FormField label="Telefone" htmlFor="ud-phone" hint="DDD + número, só dígitos.">
              <Input id="ud-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" placeholder="88999990000" disabled={readOnly} />
            </FormField>
            <FormField label="Salário base (R$)" htmlFor="ud-salary" hint="Base do bônus. Visível só para o colaborador, o gestor e o admin.">
              <Input id="ud-salary" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} inputMode="decimal" placeholder="Ex.: 3200" disabled={readOnly} />
            </FormField>
            <div className="flex items-end">
              <Switch
                label="Usuário ativo"
                description={isSelf ? "Você não pode desativar a si mesmo." : "Inativo não consegue entrar no INTEROS."}
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
                disabled={readOnly || isSelf}
                className="w-full rounded-lg border border-border px-3 py-2"
              />
            </div>
          </div>

          <FormField label="Metas mensais" hint="Pares chave/valor usados no Meu Desempenho (ex.: setup: 10000, csat: 8.5).">
            <KeyValueEditor rows={form.goals} onChange={(rows) => set("goals", rows)} keyLabel="Meta" valueLabel="Valor" keyPlaceholder="ex.: setup" suggestions={suggestions} addLabel="Adicionar meta" disabled={readOnly} emptyText="Nenhuma meta definida." />
          </FormField>

          <dl className="grid grid-cols-2 gap-2 rounded-md bg-surface-muted p-3 text-xs text-muted">
            <dt>Criado em</dt>
            <dd className="tabular-nums text-foreground">{formatDateTime(user.createdAt)}</dd>
            <dt>Atualizado em</dt>
            <dd className="tabular-nums text-foreground">{formatDateTime(user.updatedAt)}</dd>
            <dt>Liderados</dt>
            <dd className="tabular-nums text-foreground">{user.reportsCount}</dd>
          </dl>

          <FormError message={error} />

          {canEdit ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {user.active !== false ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("deactivate")} disabled={pending || isSelf}>
                  <UserX /> Desativar
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("reactivate")} disabled={pending}>
                  <UserCheck /> Reativar
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setPasswordOpen(true)} disabled={pending}>
                <KeyRound /> Redefinir senha
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger-fg" onClick={() => setConfirm("delete")} disabled={pending || isSelf}>
                <Trash2 /> Excluir
              </Button>
            </div>
          ) : null}
        </DrawerBody>

        {canEdit ? (
          <DrawerFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Fechar
            </Button>
            <Button type="submit" loading={pending}>
              Salvar alterações
            </Button>
          </DrawerFooter>
        ) : null}
      </form>

      <ConfirmDialog
        open={confirm === "deactivate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Desativar usuário?"
        description={`${user.name} perde o acesso ao INTEROS imediatamente. As tarefas e o histórico continuam registrados.`}
        confirmLabel="Desativar"
        destructive
        onConfirm={() => run(() => setUserActive({ id: user.id, active: false }), "Usuário desativado")}
      />
      <ConfirmDialog
        open={confirm === "reactivate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Reativar usuário?"
        description={`${user.name} volta a conseguir entrar no INTEROS com a senha atual.`}
        confirmLabel="Reativar"
        onConfirm={() => run(() => setUserActive({ id: user.id, active: true }), "Usuário reativado")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Excluir usuário?"
        description={`O login e o cadastro de ${user.name} serão removidos. A exclusão é bloqueada se houver tarefas abertas; prefira desativar quando quiser manter o histórico.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={() => run(() => deleteUser({ id: user.id }), "Usuário excluído", onClose)}
      />
      <ResetPasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} userId={user.id} userName={user.name} />
    </>
  );
}

function ResetPasswordDialog({ open, onOpenChange, userId, userName }: { open: boolean; onOpenChange: (open: boolean) => void; userId: string; userName: string }) {
  const [pending, startTransition] = React.useTransition();
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    setPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não conferem");
      return;
    }
    startTransition(async () => {
      const result = await resetUserPassword({ id: userId, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Senha redefinida");
      close();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && close()}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>Defina uma nova senha para {userName}. Comunique a senha por um canal seguro.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 py-3">
            <FormField label="Nova senha" htmlFor="rp-password" required hint="Mínimo de 8 caracteres.">
              <Input
                id="rp-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
                trailing={
                  <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-surface-hover" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
                    {show ? <EyeOff /> : <Eye />}
                  </button>
                }
              />
            </FormField>
            <FormField label="Confirmar senha" htmlFor="rp-confirm" required>
              <Input id="rp-confirm" type={show ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
            </FormField>
            <FormError message={error} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Redefinir senha
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
