"use client";

import { Kanban, List } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { LeadView } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";

/** Alterna lista / kanban (?view=kanban). */
export function LeadsViewSwitch({ view }: { view: LeadView }) {
  const { navigate } = useMarketingUrl();
  return (
    <SegmentedControl<LeadView>
      aria-label="Visualização"
      value={view}
      onChange={(next) => navigate({ view: next === "kanban" ? "kanban" : null, lead: null }, { replace: true })}
      options={[
        { value: "lista", label: "Lista", icon: <List /> },
        { value: "kanban", label: "Kanban", icon: <Kanban /> },
      ]}
    />
  );
}
