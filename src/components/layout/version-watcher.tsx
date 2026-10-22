"use client";

import * as React from "react";
import { toast } from "@/components/ui/toast";
import { BUILD_ID, NEW_VERSION_NOTICE_KEY } from "@/lib/version";

const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Avisa uma vez quando o deploy no ar é outro: ao voltar para a aba e a cada 10 min enquanto ela está visível. Fora da
 * Vercel (BUILD_ID "local") não faz nada. Não recarrega sozinho: o usuário pode estar no meio de um formulário.
 * Depois de uma recarga por troca de versão (AppErrorView), explica o que aconteceu, já que a tela anterior sumiu.
 */
export function VersionWatcher() {
  React.useEffect(() => {
    try {
      if (sessionStorage.getItem(NEW_VERSION_NOTICE_KEY)) {
        sessionStorage.removeItem(NEW_VERSION_NOTICE_KEY);
        toast.info("Página recarregada: saiu uma nova versão do INTEROS", { id: "versao-recarregada", duration: 15_000, description: "O último envio não foi salvo. Repita a ação." });
      }
    } catch {
      // Sem sessionStorage: sem aviso.
    }
    if (BUILD_ID === "local") return;
    let warned = false;
    const check = async () => {
      if (warned || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/versao", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === BUILD_ID) return;
        warned = true;
        toast.info("Nova versão do INTEROS publicada", {
          id: "nova-versao",
          duration: Infinity,
          description: "Termine o que está salvando e recarregue a página para continuar sem erros.",
          action: { label: "Recarregar", onClick: () => window.location.reload() },
        });
      } catch {
        // Sem rede no momento: tenta na próxima verificação.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void check(), INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
