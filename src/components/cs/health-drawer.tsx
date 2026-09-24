"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { HealthDetail } from "@/server/cs/queries";
import { formatCurrency, formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { cn } from "@/lib/utils";
import { LevelBadge } from "./cs-bits";
import { FactorBars, FactorRadar, ScoreHistoryChart } from "./health-charts";
import { RecalculateClientButton } from "./health-actions";
import { CheckpointDialog } from "./checkpoint-dialog";
import { useCsUrl } from "./use-cs";

/** Drill-down do health score (?cliente=<id>): fatores, explicação textual e histórico. */
export function HealthDrawer({ detail, limiares }: { detail: HealthDetail | null; limiares: { saudavel: number; atencao: number } }) {
  const { navigate } = useCsUrl();
  const latest = detail?.latest ?? null;
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && navigate({ cliente: null })}>
      <DrawerContent size="lg">
        {detail ? (
          <>
            <DrawerHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DrawerTitle className="truncate">{detail.tradeName}</DrawerTitle>
                  <DrawerDescription>
                    {formatCurrency(detail.mrr)}/mês{latest ? ` · calculado ${formatRelative(latest.computedAt)}` : ""}
                  </DrawerDescription>
                </div>
                {latest ? (
                  <div className="shrink-0 text-right">
                    <p className={cn("text-3xl font-semibold leading-none tabular-nums", latest.level === "risco" ? "text-danger-fg" : latest.level === "atencao" ? "text-warning-fg" : "text-success-fg")}>{latest.score}</p>
                    <div className="mt-1">
                      <LevelBadge level={latest.level} />
                    </div>
                  </div>
                ) : null}
              </div>
            </DrawerHeader>
            <DrawerBody className="flex flex-col gap-6">
              {!latest ? (
                <EmptyState size="sm" title="Sem cálculo de saúde" description="Recalcule para gerar o primeiro score deste cliente." />
              ) : (
                <>
                  <section aria-labelledby="why">
                    <h3 id="why" className="mb-2 text-sm font-semibold">
                      {latest.level === "risco" ? "Por que este cliente está em risco" : latest.level === "atencao" ? "Por que este cliente pede atenção" : "Leitura do score"}
                    </h3>
                    <ul className="flex flex-col gap-1.5 rounded-md bg-surface-muted p-3 text-sm">
                      {detail.explanation.map((line, i) => (
                        <li key={i} className={cn(i === 0 && "font-medium")}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="grid gap-4 lg:grid-cols-2">
                    <FactorRadar factors={latest.factors} level={latest.level} />
                    <FactorBars factors={latest.factors} />
                  </section>
                  <section>
                    <SectionTitle title="Histórico do score" description={`Últimos ${detail.history.length} cálculo(s) · linhas: saudável (${limiares.saudavel}) e atenção (${limiares.atencao})`} as="h3" />
                    <ScoreHistoryChart history={detail.history} limiares={limiares} />
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      {[...detail.history].reverse().slice(0, 5).map((h) => (
                        <li key={h.computedAt} className="tabular-nums">
                          {formatDateTime(h.computedAt)} · {h.score}
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </DrawerBody>
            <DrawerFooter>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/clientes/${detail.clientId}?aba=cs`}>
                  Ficha do cliente <ExternalLink />
                </Link>
              </Button>
              <CheckpointDialog clientId={detail.clientId} clientName={detail.tradeName} adoptionPct={detail.account?.adoptionPct} satisfaction={detail.account?.satisfaction} />
              <RecalculateClientButton clientId={detail.clientId} variant="primary" />
            </DrawerFooter>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
