import { Check, Eye, FileText, Receipt, Send, Wallet } from "lucide-react";
import type { FinanceFlow, Milestone } from "@/server/finance/workspace";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimelineList, type TimelineListItem } from "@/components/ui/timeline-list";
import type { Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

/** Fluxo financeiro dos contratos listados: recebido, em aberto e vencido com barras e % do total. */
export function FinanceFlowCard({ flow }: { flow: FinanceFlow }) {
  const lines: { key: string; label: string; value: number; bar: string }[] = [
    { key: "recebido", label: "Recebido", value: flow.received, bar: "bg-success" },
    { key: "aberto", label: "Em aberto", value: flow.open, bar: "bg-warning" },
    { key: "vencido", label: "Vencido", value: flow.overdue, bar: "bg-danger" },
  ];
  const pct = (v: number) => (flow.total > 0 ? v / flow.total : 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fluxo financeiro</CardTitle>
        <CardDescription>{flow.billings} cobrança(s) dos contratos listados</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {lines.map((l) => (
          <div key={l.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted">{l.label}</span>
              <span className="flex items-baseline gap-3 tabular-nums">
                <span className="font-semibold">{formatCurrency(l.value)}</span>
                <span className="w-14 text-right text-xs text-muted">{formatPercent(pct(l.value))}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-track">
              <div className={cn("h-full rounded-full", l.bar)} style={{ width: `${Math.round(pct(l.value) * 100)}%` }} />
            </div>
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
          <span className="font-medium">Total</span>
          <span className="font-semibold tabular-nums">{formatCurrency(flow.total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

const MILESTONE: Record<Milestone["key"], { icon: React.ReactNode; tone: Tone }> = {
  criado: { icon: <FileText />, tone: "info" },
  enviado: { icon: <Send />, tone: "info" },
  visualizado: { icon: <Eye />, tone: "secondary" },
  assinado: { icon: <Check />, tone: "success" },
  cobranca: { icon: <Receipt />, tone: "brand" },
  pagamento: { icon: <Wallet />, tone: "success" },
};

/** Linha do tempo do contrato (criado → documento → visualizado → assinado → cobrança → pagamento), com autor e data dos eventos. */
export function ContractMilestonesCard({ number, milestones }: { number?: string; milestones: Milestone[] }) {
  const items: TimelineListItem[] = milestones.map((m) => ({
    id: m.key,
    icon: MILESTONE[m.key].icon,
    tone: m.done ? MILESTONE[m.key].tone : "neutral",
    title: <span className={m.done ? undefined : "text-muted"}>{m.label}</span>,
    subtitle: m.done ? [m.by ? `Por ${m.by}` : null, m.detail].filter(Boolean).join(" · ") || (m.at ? undefined : "Sem data no histórico de eventos") : (m.pendingHint ?? "Pendente"),
    date: m.done && m.at ? formatDateTime(m.at) : m.done ? "—" : "Pendente",
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linha do tempo</CardTitle>
        <CardDescription>{number ? `Contrato ${number}` : "Selecione um contrato"}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <TimelineList items={items} emptyText="Selecione um contrato na tabela." />
      </CardContent>
    </Card>
  );
}
