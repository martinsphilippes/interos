"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Landmark, Pencil, Plus, ScrollText } from "lucide-react";
import type { FinancialAccountType } from "@/domain/types";
import { FINANCIAL_ACCOUNT_TYPES, FINANCIAL_ACCOUNT_TYPE_LABELS } from "@/domain/finance-registry";
import type { AccountRow } from "@/server/finance-registry/queries";
import { saveFinancialAccountAction, setFinancialAccountArchivedAction } from "@/server/finance-registry/actions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { ArchivedBadge } from "./shared";

export interface AccountsCan {
  values: boolean;
  /** Ver extrato (etapa CP/CR 2). */
  statement?: boolean;
  create: boolean;
  edit: boolean;
  archive: boolean;
}

const money = (n: number | null) => (n === null ? "Restrito" : formatCurrency(n));
const bankLine = (a: AccountRow) => [a.bankName, a.agency ? `ag. ${a.agency}` : null, a.accountNumber ? `conta ${a.accountNumber}` : null].filter(Boolean).join(" · ");

/** Contas financeiras: onde o dinheiro entra e sai. Saldo atual = saldo inicial + lançamentos de caixa (baixas com conta). */
export function AccountsPanel({ rows, can, selectedId }: { rows: AccountRow[]; can: AccountsCan; selectedId?: string }) {
  const [editing, setEditing] = React.useState<AccountRow | "new" | null>(null);
  const [archiving, setArchiving] = React.useState<AccountRow | null>(null);
  const { pending, run } = useFinanceAction();
  const active = rows.filter((r) => !r.archived).length;

  const reactivate = (r: AccountRow) => void run(() => setFinancialAccountArchivedAction({ id: r.id, archived: false }), `Conta ${r.name} reativada`);

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Contas financeiras</CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              {active} ativa(s){rows.length > active ? ` · ${rows.length - active} arquivada(s)` : ""} · saldo atual = saldo inicial + lançamentos de caixa (pagamentos e recebimentos registrados com a conta)
            </p>
          </div>
          {can.create ? (
            <Button className="h-11 md:h-9" onClick={() => setEditing("new")}>
              <Plus /> Nova conta
            </Button>
          ) : null}
        </CardHeader>
        {rows.length === 0 ? (
          <EmptyState icon={<Landmark />} title="Nenhuma conta financeira" description="Cadastre as contas onde o dinheiro entra e sai: conta corrente, caixa, cartão, investimento." />
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="accounts-list">
            {rows.map((r) => (
              <li key={r.id} data-account={r.name} className={cn("flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4", r.archived && "opacity-70", selectedId === r.id && "bg-brand-soft/40")}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="min-w-0 break-words">{r.name}</span>
                    <Badge variant="secondary" size="sm">
                      {FINANCIAL_ACCOUNT_TYPE_LABELS[r.type]}
                    </Badge>
                    {r.archived ? <ArchivedBadge reason={r.archiveReason} /> : null}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-muted">{[bankLine(r) || null, r.notes].filter(Boolean).join(" · ") || "Sem dados bancários"}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm md:w-[300px] md:shrink-0">
                  <dt className="text-xs text-muted">Saldo inicial</dt>
                  <dt className="text-xs text-muted">Saldo atual</dt>
                  <dd className="tabular-nums">{money(r.initialBalance)}</dd>
                  <dd className="font-semibold tabular-nums" data-testid="account-balance">
                    {money(r.balance)}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
                  {can.statement ? (
                    <Link href={`/financeiro/cadastros?aba=contas&conta=${r.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "h-10 md:h-8" })} aria-label={`Extrato de ${r.name}`} aria-current={selectedId === r.id ? "true" : undefined}>
                      <ScrollText /> Extrato
                    </Link>
                  ) : null}
                  {can.edit && can.values && !r.archived ? (
                    <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                      <Pencil /> Editar
                    </Button>
                  ) : null}
                  {can.archive ? (
                    r.archived ? (
                      <Button variant="outline" size="sm" className="h-10 md:h-8" disabled={pending} onClick={() => reactivate(r)} aria-label={`Reativar ${r.name}`}>
                        <ArchiveRestore /> Reativar
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => setArchiving(r)} aria-label={`Arquivar ${r.name}`}>
                        <Archive /> Arquivar
                      </Button>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing ? <AccountDialog account={editing === "new" ? null : editing} canSeeValues={can.values} onClose={() => setEditing(null)} /> : null}
      <ReasonDialog
        open={Boolean(archiving)}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archiving ? `Arquivar a conta ${archiving.name}?` : "Arquivar conta"}
        description="A conta sai das listas de escolha; nada é apagado e ela pode ser reativada."
        confirmLabel="Arquivar"
        destructive
        pending={pending}
        onConfirm={(reason) => (archiving ? run(() => setFinancialAccountArchivedAction({ id: archiving.id, archived: true, reason }), `Conta ${archiving.name} arquivada`, () => setArchiving(null)) : Promise.resolve(false))}
      />
    </>
  );
}

type Form = { name: string; type: FinancialAccountType; initialBalance: number | null; bankName: string; agency: string; accountNumber: string; notes: string };

function AccountDialog({ account, canSeeValues, onClose }: { account: AccountRow | null; canSeeValues: boolean; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [f, setF] = React.useState<Form>(() => ({
    name: account?.name ?? "",
    type: account?.type ?? "corrente",
    initialBalance: account?.initialBalance !== null && account?.initialBalance !== undefined ? account.initialBalance : 0,
    bankName: account?.bankName ?? "",
    agency: account?.agency ?? "",
    accountNumber: account?.accountNumber ?? "",
    notes: account?.notes ?? "",
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }));
  // Sem "Visualizar valores" o saldo não vem do servidor: editar a conta exige ver o valor que será gravado.
  const balanceHidden = Boolean(account) && !canSeeValues;
  // Máscara em centavos (etapa CP/CR 4): campo vazio = saldo zero.
  const balance = f.initialBalance ?? 0;
  const valid = f.name.trim().length >= 2 && Number.isFinite(balance);
  const submit = () =>
    void run(
      () => saveFinancialAccountAction({ id: account?.id, name: f.name, type: f.type, initialBalance: balance, bankName: f.bankName, agency: f.agency, accountNumber: f.accountNumber, notes: f.notes }),
      (d) => (d.created ? "Conta financeira cadastrada" : "Conta financeira atualizada"),
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{account ? `Editar ${account.name}` : "Nova conta financeira"}</DialogTitle>
          <DialogDescription>Onde o dinheiro entra e sai. Toda alteração fica registrada com o valor anterior e o novo.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome" htmlFor={`${id}-n`} required className="sm:col-span-2">
            <Input id={`${id}-n`} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Banco do Brasil — conta movimento" />
          </FormField>
          <FormField label="Tipo" htmlFor={`${id}-t`} required>
            <Select id={`${id}-t`} value={f.type} onChange={(e) => set("type", e.target.value as FinancialAccountType)} options={FINANCIAL_ACCOUNT_TYPES.map((t) => ({ value: t, label: FINANCIAL_ACCOUNT_TYPE_LABELS[t] }))} />
          </FormField>
          <FormField label="Saldo inicial (R$)" htmlFor={`${id}-s`} required hint={balanceHidden ? "Restrito: seu perfil não visualiza valores" : "Moeda: real (BRL). Digite só os números (os centavos entram sozinhos); \"-\" para saldo negativo"}>
            <MoneyInput id={`${id}-s`} value={balanceHidden ? null : f.initialBalance} placeholder={balanceHidden ? "" : undefined} disabled={balanceHidden} allowNegative onValueChange={(v) => set("initialBalance", v)} />
          </FormField>
          <FormField label="Banco" htmlFor={`${id}-b`} hint="Informativo">
            <Input id={`${id}-b`} value={f.bankName} onChange={(e) => set("bankName", e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Agência" htmlFor={`${id}-ag`}>
              <Input id={`${id}-ag`} value={f.agency} onChange={(e) => set("agency", e.target.value)} />
            </FormField>
            <FormField label="Conta" htmlFor={`${id}-ct`}>
              <Input id={`${id}-ct`} value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
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
          <Button onClick={submit} loading={pending} disabled={!valid || balanceHidden}>
            {account ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
