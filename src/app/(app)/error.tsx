"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] erro não tratado", error);
  }, [error]);

  return (
    <PageContainer size="narrow">
      <Card>
        <CardContent>
          <EmptyState
            icon={<AlertTriangle className="text-danger" />}
            title="Algo deu errado"
            description={
              <>
                Não foi possível carregar esta página. Tente novamente; se persistir, avise o administrador.
                {error.digest ? <span className="mt-2 block font-mono text-xs text-muted-light">Código: {error.digest}</span> : null}
              </>
            }
            action={
              <>
                <Button onClick={reset}>Tentar novamente</Button>
                <Button asChild variant="outline">
                  <Link href="/meu-dia">Ir para Meu Dia</Link>
                </Button>
              </>
            }
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
