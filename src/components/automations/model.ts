/** Rótulos e tons compartilhados pelas telas de automações (sem React). */
import type { BadgeProps } from "@/components/ui/badge";

type Variant = NonNullable<BadgeProps["variant"]>;

export const RUN_STATUS_LABELS: Record<string, string> = { sucesso: "Sucesso", erro: "Erro", ignorada: "Ignorada", simulada: "Teste / não executada" };
export const RUN_STATUS_VARIANT: Record<string, Variant> = { sucesso: "success", erro: "danger", ignorada: "muted", simulada: "info" };

export const SWEEP_STATUS_LABELS: Record<string, string> = { executada: "Executada", pulada: "No prazo", erro: "Erro" };
export const SWEEP_STATUS_VARIANT: Record<string, Variant> = { executada: "success", pulada: "muted", erro: "danger" };

export const TRIGGER_KIND_LABELS: Record<string, string> = { evento: "Evento", agendado: "Agendado", manual: "Teste" };
