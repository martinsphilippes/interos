import { Package, TrendingUp } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { PRODUCT_CATEGORY_LABELS } from "@/domain/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLIENT_PRODUCT_STATUS_LABELS, CLIENT_PRODUCT_STATUS_VARIANT } from "./labels";
import { UpsellDialog } from "./upsell-dialog";

/** Aba Produtos: contratados (com MRR calculado) e disponíveis no catálogo para gerar oportunidade. */
export function TabProdutos({ data }: { data: Client360 }) {
  const { client, products, availableProducts, ownedCategories, contracts } = data;
  const activeMrr = products.filter((p) => p.status === "ativo").reduce((s, p) => s + p.monthlyValue, 0);
  const pendingMrr = products.filter((p) => p.status === "em_implantacao").reduce((s, p) => s + p.monthlyValue, 0);
  const contractNumber = (id?: string) => (id ? contracts.find((c) => c.id === id)?.number : undefined);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle
          title="Produtos contratados"
          count={products.length}
          description={products.length > 0 ? `MRR ativo ${formatCurrency(activeMrr)}${pendingMrr > 0 ? ` · ${formatCurrency(pendingMrr)}/mês entrando com a implantação` : ""}` : undefined}
        />
        <Card className="overflow-hidden">
          {products.length === 0 ? (
            <EmptyState size="sm" icon={<Package />} title="Nenhum produto contratado" description="Os produtos entram aqui quando a venda é ganha e o contrato é gerado." />
          ) : (
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Hardware</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Início</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.productName}</TableCell>
                    <TableCell className="text-muted">{p.plan ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.setupValue)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.monthlyValue)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(p.hardwareValue)}</TableCell>
                    <TableCell>
                      <Badge variant={CLIENT_PRODUCT_STATUS_VARIANT[p.status]} size="sm">
                        {CLIENT_PRODUCT_STATUS_LABELS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{contractNumber(p.contractId) ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDate(p.startedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>MRR total (produtos ativos)</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(activeMrr)}</TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle title="Produtos disponíveis" count={availableProducts.length} description="Itens do catálogo que o cliente ainda não tem. Cada um vira uma oportunidade com um clique." />
        {availableProducts.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<Package />} title="Cliente com o portfólio completo" description="Todos os produtos ativos do catálogo já estão contratados." />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {availableProducts.map((p) => (
              <li key={p.id}>
                <Card className="flex h-full flex-col">
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium leading-tight">{p.name}</p>
                        <p className="mt-0.5 text-xs text-muted">{PRODUCT_CATEGORY_LABELS[p.category]}</p>
                      </div>
                      <Badge variant="muted" size="sm">
                        {p.billingType === "recorrente" ? "Recorrente" : p.billingType === "unico" ? "Único" : "Adesão + mensal"}
                      </Badge>
                    </div>
                    {p.description ? <p className="line-clamp-2 text-sm text-muted">{p.description}</p> : null}
                    <dl className="mt-auto grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-muted">Adesão</dt>
                        <dd className="font-medium tabular-nums">{formatCurrency(p.setupPrice)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Mensal</dt>
                        <dd className="font-medium tabular-nums">{formatCurrency(p.monthlyPrice)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Hardware</dt>
                        <dd className="font-medium tabular-nums">{formatCurrency(p.hardwarePrice)}</dd>
                      </div>
                    </dl>
                    <UpsellDialog
                      clientId={client.id}
                      clientName={client.tradeName}
                      products={availableProducts}
                      ownedCategories={ownedCategories}
                      defaultProductId={p.id}
                      trigger={
                        <Button variant="outline" size="sm" className="w-full">
                          <TrendingUp /> Gerar oportunidade
                        </Button>
                      }
                    />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
