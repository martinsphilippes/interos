"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, LayoutPanelLeft, User, Users } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { useSalesUrl } from "../use-sales-url";

export type CentralView = "workspace" | "painel";

/** "Workspace | Painel" da Central de Vendas (?view=painel); troca de visão limpa seleção e aba da fila. */
export function CentralViewToggle({ view }: { view: CentralView }) {
  const { navigate } = useSalesUrl();
  return (
    <SegmentedControl<CentralView>
      aria-label="Visão da Central"
      value={view}
      onChange={(v) => navigate({ view: v === "painel" ? "painel" : null, oportunidade: null, fila: null, tela: null, visita: null })}
      options={[
        { value: "workspace", label: "Workspace", icon: <LayoutPanelLeft /> },
        { value: "painel", label: "Painel", icon: <BarChart3 /> },
      ]}
    />
  );
}

/** Escopo da Central para gestores: minhas vendas ou equipe (preserva a visão atual). */
export function ScopeToggle({ scope, view }: { scope: "meu" | "equipe"; view: CentralView }) {
  const suffix = view === "painel" ? "view=painel" : "";
  const options = [
    { value: "meu", label: "Minhas vendas", icon: <User />, href: suffix ? `/vendas?${suffix}` : "/vendas" },
    { value: "equipe", label: "Equipe", icon: <Users />, href: `/vendas?escopo=equipe${suffix ? `&${suffix}` : ""}` },
  ];
  return (
    <div role="radiogroup" aria-label="Escopo da Central" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          role="radio"
          aria-checked={o.value === scope}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors md:h-8 [&_svg]:size-4",
            o.value === scope ? "bg-brand text-white shadow-brand" : "text-muted hover:bg-surface-hover hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </Link>
      ))}
    </div>
  );
}
