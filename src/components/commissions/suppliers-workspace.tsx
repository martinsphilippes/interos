"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Truck } from "lucide-react";
import type { Supplier } from "@/domain/types";
import { saveSupplierAction, setSupplierActiveAction } from "@/server/commissions/actions";
import { formatDocument } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SidePanelShell } from "@/components/ui/side-panel-shell";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";

export interface SupplierRow extends Supplier {
  /** Títulos em aberto e total pago ao fornecedor (dados reais de Contas a Pagar). */
  openCount: number;
  openAmount: number;
  paidAmount: number;
}

type Form = { name: string; document: string; email: string; phone: string; pixKey: string; banco: string; agencia: string; conta: string; category: string; notes: string; active: boolean };
const empty: Form = { name: "", document: "", email: "", phone: "", pixKey: "", banco: "", agencia: "", conta: "", category: "", notes: "", active: true };
const toForm = (s: Supplier): Form => ({ name: s.name, document: s.document ?? "", email: s.email ?? "", phone: s.phone ?? "", pixKey: s.pixKey ?? "", banco: s.bank?.banco ?? "", agencia: s.bank?.agencia ?? "", conta: s.bank?.conta ?? "", category: s.category ?? "", notes: s.notes ?? "", active: s.active !== false });
const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Permissões da seção Fornecedores (calculadas no servidor; a interface só esconde — as actions revalidam). */
export interface SupplierCan {
  create: boolean;
  edit: boolean;
  toggle: boolean;
}

/** Fornecedores (D28): lista com títulos em aberto/pagos, painel (?fornecedor=<id>) e formulário. Não é cadastro de clientes. */
export function SuppliersWorkspace({ rows, selectedId, can }: { rows: SupplierRow[]; selectedId?: string; can: SupplierCan }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editing, setEditing] = React.useState<Supplier | "new" | null>(null);
  const { pending, run } = useFinanceAction();
  const selected = rows.find((r) => r.id === selectedId);
  const select = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("fornecedor", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <>
      <div className="mb-4 flex justify-end">{can.create ? <Button className="h-11 md:h-9" onClick={() => setEditing("new")}><Plus /> Novo fornecedor</Button> : null}</div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Fornecedores</CardTitle>
            <span className="text-sm text-muted">{rows.length} cadastrado(s)</span>
          </CardHeader>
          {rows.length === 0 ? (
            <EmptyState icon={<Truck />} title="Nenhum fornecedor" description="Cadastre credores recorrentes (aluguel, software, serviços) para lançar títulos com dados bancários e PIX à mão." />
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className={cn(r.id === selectedId && "bg-brand-soft/60")}>
                    <button type="button" onClick={() => select(r.id)} className="flex min-h-[44px] w-full flex-col gap-1 px-4 py-3 text-left active:bg-surface-hover" data-supplier={r.name}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        <Badge variant={r.active !== false ? "success" : "muted"} size="sm">
                          {r.active !== false ? "Ativo" : "Inativo"}
                        </Badge>
                      </span>
                      <span className="text-xs text-muted">
                        {r.category ?? "Sem categoria"} · {r.openCount} em aberto ({money(r.openAmount)}) · pago {money(r.paidAmount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Contato</TableHead>
                      <TableHead className="text-right">Em aberto</TableHead>
                      <TableHead className="text-right">Pago</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} clickable selected={r.id === selectedId} className="cursor-pointer" onClick={() => select(r.id)} data-supplier={r.name}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.document ? <span className="block text-xs font-normal text-muted">{formatDocument(r.document)}</span> : null}
                        </TableCell>
                        <TableCell className="text-sm">{r.category ?? <span className="text-muted">—</span>}</TableCell>
                        <TableCell className="text-sm text-muted">{[r.email, r.phone].filter(Boolean).join(" · ") || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(r.openAmount)} <span className="text-xs text-muted">({r.openCount})</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{money(r.paidAmount)}</TableCell>
                        <TableCell>
                          <Badge variant={r.active !== false ? "success" : "muted"} size="sm">
                            {r.active !== false ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>
        {selected ? (
          <SidePanelShell explicit={Boolean(selectedId)} param="fornecedor" ariaLabel="Fornecedor selecionado" title={selected.name}>
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {selected.name}
                  <Badge variant={selected.active !== false ? "success" : "muted"} size="sm">
                    {selected.active !== false ? "Ativo" : "Inativo"}
                  </Badge>
                </CardTitle>
                {can.edit ? (
                  <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setEditing(selected)}>
                    <Pencil /> Editar
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-4 pt-0" data-testid="supplier-panel">
                <DataList
                  labelWidth="8rem"
                  items={[
                    { label: "CPF/CNPJ", value: selected.document ? formatDocument(selected.document) : "—" },
                    { label: "E-mail", value: selected.email ?? "—" },
                    { label: "Telefone", value: selected.phone ?? "—" },
                    { label: "Chave PIX", value: selected.pixKey ?? "—" },
                    { label: "Banco", value: selected.bank?.banco ? `${selected.bank.banco}${selected.bank.agencia ? ` · ag. ${selected.bank.agencia}` : ""}${selected.bank.conta ? ` · conta ${selected.bank.conta}` : ""}` : "—" },
                    { label: "Categoria", value: selected.category ?? "—" },
                    { label: "Títulos em aberto", value: `${selected.openCount} · ${money(selected.openAmount)}`, href: `/financeiro/contas-a-pagar?credor=${encodeURIComponent(selected.name)}` },
                    { label: "Total pago", value: money(selected.paidAmount) },
                    ...(selected.notes ? [{ label: "Observações", value: selected.notes }] : []),
                  ]}
                />
                {can.toggle ? (
                  <Switch label={selected.active !== false ? "Fornecedor ativo" : "Fornecedor inativo"} description="Inativo não aparece ao lançar títulos novos; os existentes continuam." checked={selected.active !== false} disabled={pending} onCheckedChange={(v) => void run(() => setSupplierActiveAction({ id: selected.id, active: v }), v ? "Fornecedor reativado" : "Fornecedor inativado")} className="w-full rounded-lg border border-border px-3 py-2" />
                ) : null}
              </CardContent>
            </Card>
          </SidePanelShell>
        ) : null}
      </div>
      {editing ? <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); select(id); }} /> : null}
    </>
  );
}

function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: (id: string) => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [f, setF] = React.useState<Form>(() => (supplier ? toForm(supplier) : empty));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const submit = async () => {
    await run(
      () => saveSupplierAction({ id: supplier?.id, name: f.name, document: f.document, email: f.email, phone: f.phone, pixKey: f.pixKey, bank: { banco: f.banco, agencia: f.agencia, conta: f.conta }, category: f.category, notes: f.notes, active: f.active }),
      (d) => (d.created ? "Fornecedor cadastrado" : "Fornecedor atualizado"),
      (d) => onSaved(d.id),
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{supplier ? `Editar ${supplier.name}` : "Novo fornecedor"}</DialogTitle>
          <DialogDescription>Credor de Contas a Pagar (não é cliente). Toda alteração fica registrada com o valor anterior e o novo.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome" htmlFor={`${id}-n`} required className="sm:col-span-2">
            <Input id={`${id}-n`} value={f.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField label="CPF/CNPJ" htmlFor={`${id}-d`}>
            <Input id={`${id}-d`} inputMode="numeric" value={f.document} onChange={(e) => set("document", e.target.value)} />
          </FormField>
          <FormField label="Categoria" htmlFor={`${id}-c`} hint="Ex.: software, aluguel, serviços">
            <Input id={`${id}-c`} value={f.category} onChange={(e) => set("category", e.target.value)} />
          </FormField>
          <FormField label="E-mail" htmlFor={`${id}-e`}>
            <Input id={`${id}-e`} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </FormField>
          <FormField label="Telefone" htmlFor={`${id}-p`}>
            <Input id={`${id}-p`} inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </FormField>
          <FormField label="Chave PIX" htmlFor={`${id}-pix`} className="sm:col-span-2">
            <Input id={`${id}-pix`} value={f.pixKey} onChange={(e) => set("pixKey", e.target.value)} />
          </FormField>
          <FormField label="Banco" htmlFor={`${id}-b`}>
            <Input id={`${id}-b`} value={f.banco} onChange={(e) => set("banco", e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Agência" htmlFor={`${id}-ag`}>
              <Input id={`${id}-ag`} value={f.agencia} onChange={(e) => set("agencia", e.target.value)} />
            </FormField>
            <FormField label="Conta" htmlFor={`${id}-ct`}>
              <Input id={`${id}-ct`} value={f.conta} onChange={(e) => set("conta", e.target.value)} />
            </FormField>
          </div>
          <FormField label="Observações" htmlFor={`${id}-o`} className="sm:col-span-2">
            <Textarea id={`${id}-o`} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={f.name.trim().length < 2}>
            {supplier ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
