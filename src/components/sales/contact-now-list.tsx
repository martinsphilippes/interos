"use client";

import * as React from "react";
import { PhoneOutgoing } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import type { ContactNowItem } from "@/server/sales/queries";
import { ContactButtons } from "./contact-buttons";
import { NextActionPopover } from "./next-action-popover";
import { NextActionLabel, StageBadge, TemperatureDot } from "./opportunity-bits";
import { useSalesUrl } from "./use-sales-url";

/** "Contatar agora": oportunidades por urgência, com WhatsApp, Ligar e Agendar próxima ação inline. O clique abre a oportunidade no workspace. */
export function ContactNowList({ items, showOwner }: { items: ContactNowItem[]; showOwner?: boolean }) {
  const { navigate } = useSalesUrl();
  if (items.length === 0) {
    return <EmptyState size="sm" icon={<PhoneOutgoing />} title="Nada urgente agora" description="Todas as oportunidades têm próxima ação em dia." />;
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map(({ row, reasons }) => (
        <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center">
          <button type="button" onClick={() => navigate({ oportunidade: row.id, view: null })} className="min-w-0 flex-1 rounded-md text-left hover:bg-surface-hover lg:-my-1 lg:px-2 lg:py-1">
            <span className="flex items-center gap-2">
              <TemperatureDot temperature={row.temperature} withLabel={false} />
              <span className="truncate font-medium">{row.clientName}</span>
              <StageBadge stage={row.stage} />
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {row.contactName ? `${row.contactName} · ` : ""}
              {formatCurrency(row.monthlyTotal)}/mês{showOwner ? ` · ${row.ownerName}` : ""}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {reasons.map((r) => (
                <span key={r} className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-fg">
                  {r}
                </span>
              ))}
              {row.nextActionAt ? <NextActionLabel opp={row} /> : null}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <ContactButtons opportunityId={row.id} phone={row.contactPhone} whatsapp={row.contactWhatsapp} iconOnly />
            <NextActionPopover opportunityId={row.id} currentAction={row.nextAction} />
          </div>
        </li>
      ))}
    </ul>
  );
}
