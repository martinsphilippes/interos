"use client";

import { AppErrorView } from "@/components/layout/app-error-view";

/**
 * Erros acima de (app)/error.tsx: o próprio shell (seletor de presença, softphone, notificações) chama Server Actions e,
 * na troca de versão, cairia na tela crua do Next. Mesma tela: recarrega na troca de versão, "Algo deu errado" no resto.
 * Também cobre as páginas públicas (portal, CSAT, login): por isso sem o atalho "Ir para Meu Dia".
 */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  return <AppErrorView {...props} inApp={false} />;
}
