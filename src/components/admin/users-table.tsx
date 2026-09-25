"use client";

import * as React from "react";
import { ChevronRight, Users, X } from "lucide-react";
import { DEPARTMENT_LABELS, ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@/domain/constants";
import type { Department } from "@/domain/types";
import type { UserRow } from "@/server/admin/queries";
import { formatDate, formatPhone } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizeText } from "./admin-model";
import { useAdminUrl } from "./use-admin-url";

export interface UsersTableProps {
  users: UserRow[];
  departments: Department[];
  currentUserId: string;
}

const ROLE_TONE: Partial<Record<RoleKey, "brand" | "info" | "default">> = { admin: "brand", diretoria: "default", gestor: "info" };

export function RoleBadge({ role }: { role: RoleKey }) {
  return (
    <Badge variant={ROLE_TONE[role] ?? "outline"} size="sm">
      {ROLE_LABELS[role]}
    </Badge>
  );
}

export function ActiveIndicator({ active }: { active: boolean }) {
  return <StatusDot tone={active ? "success" : "muted"} label={active ? "Ativo" : "Inativo"} className="text-xs" />;
}

/**
 * Lista de usuários com busca e filtros (papel, departamento, situação). Os filtros vivem na URL
 * (History API, sem ir ao servidor); clicar em uma linha abre o drawer via ?usuario=<id>.
 */
export function UsersTable({ users, departments, currentUserId }: UsersTableProps) {
  const { searchParams, setLocal, navigate } = useAdminUrl();
  const q = searchParams.get("q") ?? "";
  const role = searchParams.get("papel") ?? "";
  const department = searchParams.get("departamento") ?? "";
  const active = searchParams.get("ativo") ?? "";

  const items = React.useMemo(() => {
    const term = normalizeText(q);
    return users.filter((u) => {
      if (role && u.role !== role) return false;
      if (department && u.departmentId !== department) return false;
      if (active === "1" && u.active === false) return false;
      if (active === "0" && u.active !== false) return false;
      if (term) {
        const haystack = normalizeText([u.name, u.email, u.jobTitle, u.departmentName, u.managerName].filter(Boolean).join(" "));
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [users, q, role, department, active]);

  const filtered = Boolean(q || role || department || active);
  const open = (id: string) => navigate({ usuario: id });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput value={q} onChange={(value) => setLocal({ q: value || null })} debounceMs={200} placeholder="Buscar por nome, e-mail ou cargo…" className="md:max-w-sm" aria-label="Buscar usuários" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" aria-label="Papel" value={role} onChange={(e) => setLocal({ papel: e.target.value || null })} className="w-auto min-w-[150px]">
            <option value="">Todos os papéis</option>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Departamento" value={department} onChange={(e) => setLocal({ departamento: e.target.value || null })} className="w-auto min-w-[170px]">
            <option value="">Todos os departamentos</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Situação" value={active} onChange={(e) => setLocal({ ativo: e.target.value || null })} className="w-auto min-w-[120px]">
            <option value="">Ativos e inativos</option>
            <option value="1">Só ativos</option>
            <option value="0">Só inativos</option>
          </Select>
          {filtered ? (
            <Button variant="link" size="sm" className="h-auto text-xs" onClick={() => setLocal({ q: null, papel: null, departamento: null, ativo: null })}>
              <X /> Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted tabular-nums" aria-live="polite">
        {items.length} usuário{items.length === 1 ? "" : "s"}
        {filtered ? " encontrados" : ""}
      </p>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<Users />} title={filtered ? "Nenhum usuário com esses filtros" : "Nenhum usuário cadastrado"} description={filtered ? "Ajuste a busca ou limpe os filtros." : "Crie o primeiro usuário para começar."} />
        </Card>
      ) : (
        <>
          {/* Desktop */}
          <Card className="hidden overflow-hidden md:block">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Gestor</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => (
                  <TableRow key={u.id} clickable onClick={() => open(u.id)} className={u.active === false ? "opacity-70" : undefined}>
                    <TableCell className="max-w-[300px]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(u.id);
                        }}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {u.name}
                            {u.id === currentUserId ? <span className="ml-1 text-xs text-muted">(você)</span> : null}
                          </span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={u.role} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{u.departmentName}</TableCell>
                    <TableCell className="whitespace-nowrap">{u.managerName ?? <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{u.jobTitle ?? <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell>
                      <ActiveIndicator active={u.active !== false} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted">{formatDate(u.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile */}
          <ul className="flex flex-col gap-2 md:hidden">
            {items.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => open(u.id)} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-card transition-colors active:bg-surface-hover">
                  <Avatar name={u.name} src={u.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{u.name}</p>
                      <RoleBadge role={u.role} />
                    </div>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{DEPARTMENT_LABELS[u.departmentId] ?? u.departmentName}</span>
                      {u.jobTitle ? <span>{u.jobTitle}</span> : null}
                      {u.phone ? <span className="tabular-nums">{formatPhone(u.phone)}</span> : null}
                      <ActiveIndicator active={u.active !== false} />
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
