import Link from "next/link";
import type { Insight } from "@/server/insights/rules";
import { InsightList } from "@/components/insights/insight-list";
import { CollapsibleBlock } from "./collapsible-block";

/** Alertas de gestão no Meu Dia de gestores e diretoria (top 3 insights do escopo do usuário). */
export function InsightsBlock({ insights, director }: { insights: Insight[]; director: boolean }) {
  return (
    <CollapsibleBlock
      title="Alertas de gestão"
      count={insights.length}
      description={director ? "Gargalos da empresa detectados pelas regras" : "Gargalos dos departamentos que você lidera"}
      action={
        <Link href={director ? "/gestao/cockpit" : "/gestao"} className="font-medium text-brand hover:underline">
          {director ? "Cockpit" : "Dashboard"}
        </Link>
      }
    >
      <InsightList insights={insights} compact emptyText="Nenhum gargalo detectado nos seus indicadores neste mês." />
    </CollapsibleBlock>
  );
}
