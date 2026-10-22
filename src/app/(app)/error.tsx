"use client";

import { AppErrorView } from "@/components/layout/app-error-view";

/** Erros das páginas dentro do shell (o shell continua visível). */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppErrorView {...props} />;
}
