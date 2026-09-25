"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Package, Pencil, Plus, X } from "lucide-react";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import type { ActionResult } from "@/domain/types";
import type { ProductRow, TemplateOption } from "@/server/admin/queries";
import { moveProduct, setProductActive } from "@/server/admin/actions";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { BILLING_TYPE_LABELS, normalizeText } from "./admin-model";
import { ProductDrawer, type ProductDrawerState } from "./product-drawer";
import { useAdminUrl } from "./use-admin-url";

export interface ProductsWorkspaceProps {
  products: ProductRow[];
  templates: TemplateOption[];
}

function pct(value: number): string {
  return `${String(value).replace(".", ",")}%`;
}

/** Catálogo de produtos: filtros na URL, tabela/cards, reordenação, ativar/desativar e drawer de edição. */
export function ProductsWorkspace({ products, templates }: ProductsWorkspaceProps) {
  const router = useRouter();
  const { searchParams, setLocal } = useAdminUrl();
  const [pending, startTransition] = React.useTransition();
  const [drawer, setDrawer] = React.useState<ProductDrawerState>(null);
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("categoria") ?? "";
  const active = searchParams.get("ativo") ?? "";

  const items = React.useMemo(() => {
    const term = normalizeText(q);
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (active === "1" && !p.active) return false;
      if (active === "0" && p.active) return false;
      if (term && !normalizeText(`${p.name} ${p.description ?? ""} ${PRODUCT_CATEGORY_LABELS[p.category]}`).includes(term)) return false;
      return true;
    });
  }, [products, q, category, active]);
  const filtered = Boolean(q || category || active);
  // Reordenar só faz sentido sobre a lista completa (a posição é global).
  const canReorder = !filtered;

  const run = (action: () => Promise<ActionResult<unknown>>, successMessage?: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (successMessage) toast.success(successMessage);
      router.refresh();
    });

  const move = (id: string, direction: "up" | "down") => run(() => moveProduct({ id, direction }));
  const toggle = (id: string, next: boolean) => run(() => setProductActive({ id, active: next }), next ? "Produto ativado" : "Produto desativado");

  const selected = drawer?.mode === "edit" ? (products.find((p) => p.id === drawer.id) ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <SearchInput value={q} onChange={(value) => setLocal({ q: value || null })} debounceMs={200} placeholder="Buscar produto…" className="md:max-w-xs" aria-label="Buscar produtos" />
          <div className="flex flex-wrap items-center gap-2">
            <Select size="sm" aria-label="Categoria" value={category} onChange={(e) => setLocal({ categoria: e.target.value || null })} className="w-auto min-w-[160px]">
              <option value="">Todas as categorias</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PRODUCT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <Select size="sm" aria-label="Situação" value={active} onChange={(e) => setLocal({ ativo: e.target.value || null })} className="w-auto min-w-[130px]">
              <option value="">Ativos e inativos</option>
              <option value="1">Só ativos</option>
              <option value="0">Só inativos</option>
            </Select>
            {filtered ? (
              <Button variant="link" size="sm" className="h-auto text-xs" onClick={() => setLocal({ q: null, categoria: null, ativo: null })}>
                <X /> Limpar filtros
              </Button>
            ) : null}
          </div>
        </div>
        <Button onClick={() => setDrawer({ mode: "new" })}>
          <Plus /> Novo produto
        </Button>
      </div>
      <p className="text-xs text-muted tabular-nums" aria-live="polite">
        {items.length} produto{items.length === 1 ? "" : "s"}
        {filtered ? " encontrados · limpe os filtros para reordenar" : ""}
      </p>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title={filtered ? "Nenhum produto com esses filtros" : "Catálogo vazio"}
            description={filtered ? "Ajuste a busca ou limpe os filtros." : "Cadastre o primeiro produto para que vendas e propostas possam usá-lo."}
            action={
              !filtered ? (
                <Button onClick={() => setDrawer({ mode: "new" })}>
                  <Plus /> Novo produto
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop */}
          <Card className="hidden overflow-hidden md:block">
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[72px]">Ordem</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Setup</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Hardware</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead>Comissão (setup / rec. / hw)</TableHead>
                  <TableHead>Implantação</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p, index) => (
                  <TableRow key={p.id} className={cn(!p.active && "opacity-70")}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-right tabular-nums text-muted">{p.order}</span>
                        {canReorder ? (
                          <span className="flex flex-col">
                            <Button variant="ghost" size="icon" className="size-6" aria-label={`Subir ${p.name}`} disabled={pending || index === 0} onClick={() => move(p.id, "up")}>
                              <ArrowUp className="size-3.5!" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-6" aria-label={`Descer ${p.name}`} disabled={pending || index === items.length - 1} onClick={() => move(p.id, "down")}>
                              <ArrowDown className="size-3.5!" />
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <button type="button" onClick={() => setDrawer({ mode: "edit", id: p.id })} className="block w-full min-w-0 max-w-[280px] text-left">
                        <span className="block truncate font-medium text-foreground">{p.name}</span>
                        {p.description ? <span className="block truncate text-xs text-muted">{p.description}</span> : null}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        {PRODUCT_CATEGORY_LABELS[p.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.setupPrice)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.monthlyPrice)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.hardwarePrice)}</TableCell>
                    <TableCell className="whitespace-nowrap">{BILLING_TYPE_LABELS[p.billingType]}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted">
                      {pct(p.commission.setupPct)} / {pct(p.commission.recurringPct)} <span className="text-muted-light">(parc. {p.commission.recurringReleaseInstallment})</span> / {pct(p.commission.hardwarePct)}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {p.templateName ? (
                        <span className="block truncate">
                          {p.templateName}
                          {p.implementationDays !== undefined ? <span className="text-muted"> · {p.implementationDays} d</span> : null}
                        </span>
                      ) : p.implementationDays !== undefined ? (
                        <span className="text-muted">{p.implementationDays} dias (sem template)</span>
                      ) : (
                        <span className="text-muted-light">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch size="sm" checked={p.active} onCheckedChange={(next) => toggle(p.id, next)} disabled={pending} aria-label={p.active ? `Desativar ${p.name}` : `Ativar ${p.name}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setDrawer({ mode: "edit", id: p.id })}>
                        <Pencil /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile */}
          <ul className="flex flex-col gap-2 md:hidden">
            {items.map((p, index) => (
              <li key={p.id} className={cn("rounded-lg border border-border bg-surface p-3 shadow-card", !p.active && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-muted">#{p.order}</span>
                      <p className="min-w-0 flex-1 truncate font-medium">{p.name}</p>
                      <Badge variant="outline" size="sm">
                        {PRODUCT_CATEGORY_LABELS[p.category]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      Setup {formatCurrency(p.setupPrice)} · Mensal {formatCurrency(p.monthlyPrice)} · HW {formatCurrency(p.hardwarePrice)}
                    </p>
                    <p className="text-xs text-muted">
                      {BILLING_TYPE_LABELS[p.billingType]} · comissão {pct(p.commission.setupPct)} / {pct(p.commission.recurringPct)} / {pct(p.commission.hardwarePct)}
                      {p.templateName ? ` · ${p.templateName}` : ""}
                    </p>
                  </div>
                  <Switch size="sm" checked={p.active} onCheckedChange={(next) => toggle(p.id, next)} disabled={pending} aria-label={p.active ? `Desativar ${p.name}` : `Ativar ${p.name}`} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {canReorder ? (
                      <>
                        <Button variant="outline" size="icon" className="size-9" aria-label={`Subir ${p.name}`} disabled={pending || index === 0} onClick={() => move(p.id, "up")}>
                          <ArrowUp />
                        </Button>
                        <Button variant="outline" size="icon" className="size-9" aria-label={`Descer ${p.name}`} disabled={pending || index === items.length - 1} onClick={() => move(p.id, "down")}>
                          <ArrowDown />
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <Button variant="outline" size="sm" className="h-9" onClick={() => setDrawer({ mode: "edit", id: p.id })}>
                    <Pencil /> Editar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ProductDrawer state={drawer} product={selected} templates={templates} onClose={() => setDrawer(null)} />
    </div>
  );
}
