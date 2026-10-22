"use client";

import * as React from "react";
import { toast } from "@/components/ui/toast";
import { BUILD_ID } from "@/lib/version";

const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Avisa uma vez quando o deploy no ar é outro: ao voltar para a aba e a cada 10 min enquanto ela está visível. Fora da
 * Vercel (BUILD_ID "local") não faz nada. Não recarrega sozinho: o usuário pode estar no meio de um formulário.
 */
export function VersionWatcher() {
  React.useEffect(() => {
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
