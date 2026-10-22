"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isNewVersionError } from "@/lib/version";

const RELOAD_KEY = "interos:recarregado-por-versao";
const RELOAD_WINDOW_MS = 30_000;

/** Recarrega uma vez por troca de versão; se o erro voltar logo depois, deixa o botão para o usuário (sem laço). */
function reloadOnce(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    // Sem sessionStorage (modo privado): recarrega mesmo assim.
  }
  if (Date.now() - last < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // idem
  }
  window.location.reload();
  return true;
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const newVersion = isNewVersionError(error);

  useEffect(() => {
    if (newVersion) {
      reloadOnce();
      return;
    }
    console.error("[app] erro não tratado", error);
  }, [error, newVersion]);

  if (newVersion) {
    return (
      <PageContainer size="narrow">
        <Card>
          <CardContent>
            <EmptyState
              icon={<RefreshCw className="text-info" />}
              title="Nova versão publicada"
              description="O INTEROS foi atualizado enquanto esta tela estava aberta e o que você acabou de enviar não foi salvo. A página vai recarregar; depois, repita a ação."
              action={<Button onClick={() => window.location.reload()}>Recarregar agora</Button>}
            />
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

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
