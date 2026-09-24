import Link from "next/link";
import { BadgeCheck, CalendarCheck, CircleAlert, Plus } from "lucide-react";
import type { ClientCs } from "@/server/cs/queries";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivateButton } from "./activate-button";
import { CheckpointDialog } from "./checkpoint-dialog";
import { RecalculateClientButton } from "./health-actions";

export interface ClientCsPanelProps {
  clientId: string;
  clientName: string;
  data: ClientCs;
}

/**
 * Painel de ações de CS para a ficha 360º (aba CS): gate de ativação, checkpoint, recálculo da saúde,
 * explicação do score e últimos checkpoints. Os dados vêm de `getClientCs(clientId)`.
 */
export function ClientCsPanel({ clientId, clientName, data }: ClientCsPanelProps) {
  const { activation, account } = data;
  return (
    <Card>
      <CardHeader className="gap-3 pb-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Customer Success</CardTitle>
          <CardDescription>
            {activation.activatedAt ? `Cliente ativado em ${formatDateTime(activation.activatedAt)}` : "Ativação pendente"}
            {activation.stageOpen ? " · jornada na etapa de CS" : ""}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckpointDialog clientId={clientId} clientName={clientName} adoptionPct={account?.adoptionPct} satisfaction={account?.satisfaction} />
          <RecalculateClientButton clientId={clientId} />
          {!activation.activePlan ? (
            <Button asChild size="sm" variant="outline" className="min-h-[44px] md:min-h-0">
              <Link href={`/cs/planos?novo=1&cliente=${clientId}`}>
                <Plus /> Plano de sucesso
              </Link>
            </Button>
          ) : null}
          {activation.stageOpen ? <ActivateButton clientId={clientId} clientName={clientName} missing={activation.missing} /> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-0 lg:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="label-caps mb-2">Gate de ativação</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex items-start gap-2">
              {(activation.adoptionPct ?? 0) >= activation.settings.adocaoMinimaPct ? <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              Adoção {activation.adoptionPct ?? 0}% (mínimo {activation.settings.adocaoMinimaPct}%)
            </li>
            <li className="flex items-start gap-2">
              {activation.ownerId ? <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              Responsável de CS {activation.ownerId ? `definido${data.users[activation.ownerId] ? ` (${data.users[activation.ownerId].name})` : ""}` : "não definido"}
            </li>
            <li className="flex items-start gap-2">
              {activation.activePlan || !activation.settings.exigePlano ? <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              {activation.activePlan ? (
                <Link href={`/cs/planos?plano=${activation.activePlan.id}`} className="hover:underline">
                  Plano ativo: {activation.activePlan.objective}
                </Link>
              ) : activation.settings.exigePlano ? (
                "Plano de sucesso ativo (obrigatório)"
              ) : (
                "Plano de sucesso opcional"
              )}
            </li>
          </ul>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="label-caps mb-2">Leitura do score</p>
          {data.explanation.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.explanation.map((line, i) => (
                <li key={i} className={i === 0 ? "font-medium" : "text-muted"}>
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Sem cálculo de saúde ainda.</p>
          )}
          <Link href={`/cs/saude?cliente=${clientId}`} className="mt-2 inline-block text-sm text-secondary hover:underline">
            Ver fatores e histórico
          </Link>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="label-caps mb-2">Últimos checkpoints</p>
          {data.checkpoints.length === 0 ? (
            <p className="text-sm text-muted">Nenhum checkpoint registrado.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.checkpoints.slice(0, 3).map((c) => (
                <li key={c.id} className="text-sm">
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <CalendarCheck className="size-3.5" /> {formatDateTime(c.occurredAt)} · {c.actorName}
                  </p>
                  {c.description ? <p className="line-clamp-2">{c.description.split("\n")[0]}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
