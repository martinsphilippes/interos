"use client";

import * as React from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import type { ProposalItem } from "@/domain/types";
import type { ProductOption } from "@/server/finance/queries";
import { updateContractItemsAction } from "@/server/finance/actions";
import { formatCurrency } from "@/lib/format";
import { netItem, proposalTotals } from "@/components/sales/model";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFinanceAction } from "./use-finance-action";

export interface ContractItemsCardProps {
  contractId: string;
  items: ProposalItem[];
  products: ProductOption[];
  /** Pode editar (não assinado por todos, não liberado) e o usuário opera o Financeiro. */
  canEdit: boolean;
  /** Já enviado para assinatura: editar gera nova versão. */
  sent: boolean;
  version: number;
}

/** "1.234,56" (pt-BR) ou "1234.56". */
const num = (v: string) => {
  const text = v.trim();
  const n = text.includes(",") ? Number(text.replace(/\./g, "").replace(",", ".")) : Number(text);
  return Number.isFinite(n) ? n : 0;
};

/** Linha em edição: campos numéricos como texto (permite digitar "12,5" sem perder a vírgula). */
type EditRow = { productId: string; productName: string; quantity: string; setupValue: string; monthlyValue: string; hardwareValue: string; discountPct: string };
const NUMERIC = ["quantity", "setupValue", "monthlyValue", "hardwareValue", "discountPct"] as const;
const toEdit = (i: ProposalItem): EditRow => ({ productId: i.productId, productName: i.productName, quantity: String(i.quantity), setupValue: String(i.setupValue).replace(".", ","), monthlyValue: String(i.monthlyValue).replace(".", ","), hardwareValue: String(i.hardwareValue).replace(".", ","), discountPct: String(i.discountPct).replace(".", ",") });
const fromEdit = (r: EditRow): ProposalItem => ({
  productId: r.productId,
  productName: r.productName,
  quantity: Math.max(1, Math.round(num(r.quantity))),
  setupValue: num(r.setupValue),
  monthlyValue: num(r.monthlyValue),
  hardwareValue: num(r.hardwareValue),
  discountPct: Math.min(100, Math.max(0, num(r.discountPct))),
});

const FIELD_LABEL: Record<(typeof NUMERIC)[number], string> = { quantity: "Quantidade", setupValue: "Adesão", monthlyValue: "Mensalidade", hardwareValue: "Hardware", discountPct: "Desconto (%)" };

/** Itens do contrato (produtos, quantidades, valores). Editável enquanto não assinado. */
export function ContractItemsCard({ contractId, items, products, canEdit, sent, version }: ContractItemsCardProps) {
  const [editing, setEditing] = React.useState(false);
  const [rows, setRows] = React.useState<EditRow[]>(() => items.map(toEdit));
  const [pick, setPick] = React.useState("");
  const { pending, run } = useFinanceAction();
  const view = editing ? rows.map(fromEdit) : items;
  const totals = proposalTotals(view);

  const start = () => {
    setRows(items.map(toEdit));
    setEditing(true);
  };
  const patch = (index: number, change: Partial<EditRow>) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...change } : r)));
  const add = () => {
    const product = products.find((p) => p.id === pick);
    if (!product) return;
    setRows((current) => [...current, toEdit({ productId: product.id, productName: product.name, quantity: 1, setupValue: product.setupPrice, monthlyValue: product.monthlyPrice, hardwareValue: product.hardwarePrice, discountPct: 0 })]);
    setPick("");
  };
  const save = async () => {
    const ok = await run(() => updateContractItemsAction({ contractId, items: rows.map(fromEdit) }), (d) => (d.versioned ? `Itens salvos: contrato v${version + 1} criado (reenvie para assinatura)` : "Itens do contrato salvos"));
    if (ok) setEditing(false);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Itens</CardTitle>
          <CardDescription>Valores por linha (já multiplicados pela quantidade). Desconto aplicado sobre adesão, mensalidade e hardware.</CardDescription>
        </div>
        {canEdit && !editing ? (
          <Button variant="outline" size="sm" onClick={start} className="h-10 md:h-8">
            <Pencil /> Editar
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 pt-0">
        {editing && sent ? (
          <p className="mx-5 mb-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-fg">
            O contrato já foi enviado para assinatura. Salvar cria a versão {version + 1}, descarta as assinaturas e exige novo envio.
          </p>
        ) : null}
        {view.length === 0 ? (
          <EmptyState size="sm" icon={<Package />} title="Nenhum item" description="Adicione os produtos vendidos." />
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="w-20 text-right">Qtd.</TableHead>
                <TableHead className="text-right">Adesão</TableHead>
                <TableHead className="text-right">Mensal</TableHead>
                <TableHead className="text-right">Hardware</TableHead>
                <TableHead className="w-20 text-right">Desc. %</TableHead>
                {editing ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.map((item, i) => {
                const net = netItem(item);
                return (
                  <TableRow key={`${item.productId}-${i}`}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    {editing ? (
                      <>
                        <TableCell>
                          <Input aria-label="Quantidade" inputMode="numeric" className="h-10 text-right md:h-9" value={rows[i].quantity} onChange={(e) => patch(i, { quantity: e.target.value })} />
                        </TableCell>
                        {NUMERIC.slice(1).map((field) => (
                          <TableCell key={field}>
                            <Input aria-label={FIELD_LABEL[field]} inputMode="decimal" className="h-10 text-right md:h-9" value={rows[i][field]} onChange={(e) => patch(i, { [field]: e.target.value })} />
                          </TableCell>
                        ))}
                        <TableCell>
                          <Button variant="ghost" size="icon" className="size-10 text-danger md:size-9" aria-label={`Remover ${item.productName}`} onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}>
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(net.setupTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(net.monthlyTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(net.hardwareTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted">{item.discountPct ? `${item.discountPct}%` : "—"}</TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total{editing ? " (com desconto)" : ""}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{formatCurrency(totals.setupTotal)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(totals.monthlyTotal)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(totals.hardwareTotal)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted">{totals.discountTotal > 0 ? `-${formatCurrency(totals.discountTotal)}` : "—"}</TableCell>
                {editing ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        )}
        {editing ? (
          <div className="mt-4 flex flex-col gap-3 px-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 gap-2">
              <Select aria-label="Produto a adicionar" value={pick} onChange={(e) => setPick(e.target.value)} className="md:max-w-xs [&_select]:h-10 md:[&_select]:h-9">
                <option value="">Adicionar produto…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button variant="outline" onClick={add} disabled={!pick} className="h-10 md:h-9">
                <Plus /> Adicionar
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={pending} className="h-11 flex-1 md:h-9 md:flex-none">
                Cancelar
              </Button>
              <Button onClick={save} loading={pending} disabled={rows.length === 0} className="h-11 flex-1 md:h-9 md:flex-none">
                Salvar itens
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
