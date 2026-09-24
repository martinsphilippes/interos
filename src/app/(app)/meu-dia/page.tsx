import type { Metadata } from "next";
import { Sun } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Meu Dia" };

/** PLACEHOLDER: outro agente substitui esta página neste bloco. */
export default function MeuDiaPage() {
  return (
    <PageContainer>
      <PageHeader title="Meu Dia" description="Suas prioridades, prazos e alertas de hoje." />
      <Card>
        <CardContent>
          <EmptyState icon={<Sun />} title="Sendo construído neste bloco" description="O painel do dia aparece aqui em breve." />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
