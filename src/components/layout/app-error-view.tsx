"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NEW_VERSION_NOTICE_KEY, isNewVersionError } from "@/lib/version";

const RELOAD_KEY = "interos:recarregado-por-versao";
const RELOAD_WINDOW_MS = 30_000;
/** Tempo para ler o aviso antes da recarga; depois dela o VersionWatcher mostra o toast "repita a ação". */
const RELOAD_DELAY_MS = 2_500;

/** Pode recarregar? Uma vez por troca de versão; se o erro voltar logo depois, fica o botão para o usuário (sem laço). */
function canAutoReload(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    // Sem sessionStorage (modo privado): recarrega mesmo assim.
  }
  return Date.now() - last >= RELOAD_WINDOW_MS;
}

export function reloadForNewVersion() {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    sessionStorage.setItem(NEW_VERSION_NOTICE_KEY, "1");
  } catch {
    // idem
  }
  window.location.reload();
}

/**
 * Tela de erro do app: troca de versão recarrega; o resto mostra "Algo deu errado" com o código. Usada pelos dois
 * error.tsx; `inApp` liga o atalho "Ir para Meu Dia" (só faz sentido dentro do shell, não no portal, CSAT ou login).
 */
export function AppErrorView({ error, reset, retry, inApp = true }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void; inApp?: boolean }) {
  const newVersion = isNewVersionError(error);
  const [autoReload, setAutoReload] = useState<boolean | null>(null);

  useEffect(() => {
    if (!newVersion) {
      console.error("[app] erro não tratado", error);
      return;
    }
    // Depois do tempo de leitura: recarrega, ou (dentro da trava) troca o texto para "recarregue à mão".
    const timer = window.setTimeout(() => {
      if (canAutoReload()) reloadForNewVersion();
      else setAutoReload(false);
    }, RELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [error, newVersion]);

  if (newVersion) {
    return (
      <PageContainer size="narrow">
        <Card>
          <CardContent>
            <EmptyState
              icon={<RefreshCw className="text-info" />}
              title="Nova versão publicada"
              description={`O INTEROS foi atualizado enquanto esta tela estava aberta e o que você acabou de enviar não foi salvo. ${autoReload === false ? "Recarregue a página e repita a ação." : "A página vai recarregar em instantes; depois, repita a ação."}`}
              action={<Button onClick={reloadForNewVersion}>Recarregar agora</Button>}
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
                {inApp ? "Não foi possível carregar esta página. Tente novamente; se persistir, avise o administrador." : "Não foi possível carregar esta página. Tente novamente em instantes."}
                {error.digest ? <span className="mt-2 block font-mono text-xs text-muted-light">Código: {error.digest}</span> : null}
              </>
            }
            action={
              <>
                {/* retry (Next 16.3) refaz a busca no servidor; reset só re-renderiza e repetiria o mesmo erro. */}
                <Button onClick={retry ?? reset}>Tentar novamente</Button>
                {inApp ? (
                  <Button asChild variant="outline">
                    <Link href="/meu-dia">Ir para Meu Dia</Link>
                  </Button>
                ) : null}
              </>
            }
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
