/**
 * Validação das ações internas do Portal do Cliente (D31). Puro (zod): usado pelas Server Actions e pelos testes.
 */
import { z } from "zod";
import { PORTAL_DEFAULT_DAYS, PORTAL_LINK_ID_PATTERN, PORTAL_MAX_DAYS, PORTAL_MIN_DAYS, PORTAL_TOKEN_PATTERN } from "@/domain/portal";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createPortalLinkSchema = z.object({
  clientId: z.string().trim().min(1, "Cliente não informado"),
  contractId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  days: z
    .number("Validade inválida")
    .int("Use dias inteiros")
    .min(PORTAL_MIN_DAYS, `Validade mínima de ${PORTAL_MIN_DAYS} dia`)
    .max(PORTAL_MAX_DAYS, `Validade máxima de ${PORTAL_MAX_DAYS} dias`)
    .default(PORTAL_DEFAULT_DAYS),
  label: optionalText(80, "Rótulo muito longo (máx. 80)"),
});
export type CreatePortalLinkActionInput = z.input<typeof createPortalLinkSchema>;

const linkId = z.string().trim().regex(PORTAL_LINK_ID_PATTERN, "Link do portal inválido");

export const revokePortalLinkSchema = z.object({
  linkId,
  reason: optionalText(300, "Motivo muito longo (máx. 300)"),
});

export const sendPortalLinkSchema = z.object({
  linkId,
  token: z.string().trim().regex(PORTAL_TOKEN_PATTERN, "Link do portal inválido"),
  channel: z.enum(["whatsapp", "email"], { message: "Canal inválido" }),
  text: optionalText(2000, "Texto muito longo"),
});
