"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, ChevronRight, Clock, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/format";
import { setAutomationRuleActive } from "@/server/automations/actions";
import type { RuleListItem } from "@/server/automations/queries";

function ActiveSwitch({ rule }: { rule: RuleListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState(rule.active);
  const toggle = (next: boolean) => {
    setActive(next);
    startTransition(async () => {
      const result = await setAutomationRuleActive({ id: rule.id, active: next });
      if (!result.ok) {
        setActive(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? `Automação "${rule.name}" ativada` : `Automação "${rule.name}" desativada`);
      router.refresh();
    });
  };
  return <Switch checked={active} disabled={pending} onCheckedChange={toggle} aria-label={active ? "Desativar automação" : "Ativar automação"} />;
}

function Summary({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <span className="text-muted">{empty}</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.slice(0, 3).map((item, i) => (
        <li key={i} className="truncate" title={item}>
          {item}
        </li>
      ))}
      {items.length > 3 ? <li className="text-muted">+{items.length - 3}</li> : null}
    </ul>
  );
}

function RunInfo({ rule }: { rule: RuleListItem }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="tabular-nums">{formatNumber(rule.runCount)} execução(ões)</span>
      <span className="text-muted">{rule.lastRunAt ? <RelativeTime value={rule.lastRunAt} /> : "nunca executada"}</span>
      {rule.recentErrors > 0 ? (
        <Badge variant="danger" size="sm" title={rule.lastError}>
          <AlertTriangle /> {rule.recentErrors} erro(s) em 7 dias
        </Badge>
      ) : null}
    </div>
  );
}

/** Lista de regras: cards no celular, tabela a partir de md. Ativar/desativar direto na lista. */
export function RulesList({ rules }: { rules: RuleListItem[] }) {
  if (rules.length === 0) {
    return (
      <EmptyState
        icon={<Zap />}
        title="Nenhuma automação cadastrada"
        description="Crie uma regra com gatilho, condições e ações. O seed traz 5 regras de exemplo (npm run seed)."
        action={
          <Button asChild>
            <Link href="/admin/automacoes/nova">Nova automação</Link>
          </Button>
        }
      />
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-lg border border-border bg-surface p-3 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/admin/automacoes/${rule.id}`} className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center">
                <span className="truncate text-sm font-medium">{rule.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted">
                  {rule.triggerKind === "agendado" ? <Clock className="size-3" /> : <Zap className="size-3" />}
                  {rule.triggerLabel}
                </span>
              </Link>
              <div className="flex min-h-[44px] items-center">
                <ActiveSwitch rule={rule} />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="label-caps mb-0.5">Condições</p>
                <Summary items={rule.conditions} empty="Sempre" />
              </div>
              <div>
                <p className="label-caps mb-0.5">Ações</p>
                <Summary items={rule.actions} empty={rule.triggerKind === "agendado" ? "Varredura nativa" : "Nenhuma"} />
              </div>
            </div>
            <div className="mt-2 border-t border-border pt-2">
              <RunInfo rule={rule} />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden rounded-lg border border-border bg-surface shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Regra</TableHead>
              <TableHead>Gatilho</TableHead>
              <TableHead>Condições</TableHead>
              <TableHead>Ações</TableHead>
              <TableHead>Execuções</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="max-w-[240px] align-top">
                  <Link href={`/admin/automacoes/${rule.id}`} className="font-medium hover:underline">
                    {rule.name}
                  </Link>
                  {rule.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{rule.description}</p> : null}
                </TableCell>
                <TableCell className="max-w-[200px] align-top text-xs">
                  <Badge variant={rule.triggerKind === "agendado" ? "info" : "brand"} size="sm">
                    {rule.triggerKind === "agendado" ? "Agendado" : "Evento"}
                  </Badge>
                  <p className="mt-1 break-words text-muted">{rule.triggerLabel.replace(/^Evento /, "")}</p>
                </TableCell>
                <TableCell className="max-w-[220px] align-top text-xs">
                  <Summary items={rule.conditions} empty="Sempre" />
                </TableCell>
                <TableCell className="max-w-[240px] align-top text-xs">
                  <Summary items={rule.actions} empty={rule.triggerKind === "agendado" ? "Varredura nativa" : "Nenhuma"} />
                </TableCell>
                <TableCell className="align-top">
                  <RunInfo rule={rule} />
                </TableCell>
                <TableCell className="align-top">
                  <ActiveSwitch rule={rule} />
                </TableCell>
                <TableCell className="align-top">
                  <Link href={`/admin/automacoes/${rule.id}`} aria-label={`Editar ${rule.name}`} className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-hover">
                    <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
