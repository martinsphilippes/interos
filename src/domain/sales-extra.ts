/**
 * Constantes e tipos auxiliares do módulo de Vendas.
 * Os campos persistidos (`Visit.kind`, `Communication.status`/`provider` "manual") estão em `types.ts`.
 */
import type { Communication, Visit } from "./types";

export const VISIT_KINDS = ["comercial", "tecnica"] as const satisfies readonly NonNullable<Visit["kind"]>[];
export type VisitKind = (typeof VISIT_KINDS)[number];
export const VISIT_KIND_LABELS: Record<VisitKind, string> = { comercial: "Comercial", tecnica: "Técnica" };

/**
 * Comunicação como lida do Firestore. Registros antigos de Vendas podem trazer `registration: "manual"`
 * (equivalente a `status: "manual"`).
 */
export type CommunicationRecord = Communication & { registration?: "manual" };
