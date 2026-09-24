/**
 * Tipos aditivos do módulo de Vendas que ainda não estão em `types.ts`.
 *
 * INTEGRAÇÃO (integrador): mover para src/domain/types.ts como campos aditivos:
 * - `Visit.kind?: VisitKind` (visita comercial ou técnica);
 * - `Communication.status`/`provider` aceitarem "manual" (e provider "resend"), como já gravado pelo registro de
 *   integrações (src/server/integrations/communications.ts).
 * Enquanto isso as leituras de Vendas usam os tipos estendidos abaixo.
 */
import type { Communication, Visit } from "./types";

export const VISIT_KINDS = ["comercial", "tecnica"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const VISIT_KIND_LABELS: Record<VisitKind, string> = { comercial: "Comercial", tecnica: "Técnica" };

/** Visita com o tipo (campo aditivo; visitas antigas não têm `kind` e contam como comerciais). */
export type VisitRecord = Visit & { kind?: VisitKind };

/**
 * Comunicação como lida do Firestore: além dos valores de `types.ts`, o registro de integrações grava
 * status/provider "manual" (contato feito fora do sistema) e provider "resend" (e-mail transacional).
 * Registros antigos de Vendas podem trazer `registration: "manual"`.
 */
export type CommunicationRecord = Omit<Communication, "status" | "provider"> & {
  status: Communication["status"] | "manual";
  provider: Communication["provider"] | "manual" | "resend";
  registration?: "manual";
};
