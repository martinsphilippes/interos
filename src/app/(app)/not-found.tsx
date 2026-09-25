import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <PageContainer size="narrow">
      <Card>
        <CardContent>
          <EmptyState
            icon={<SearchX />}
            title="Página não encontrada"
            description="O endereço não existe ou foi movido. Verifique o link ou volte para o início."
            action={
              <Button asChild>
                <Link href="/meu-dia">Ir para Meu Dia</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
