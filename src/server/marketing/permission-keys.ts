/**
 * Chaves do catálogo exigidas pelas actions de Marketing que despacham pelo argumento (puro: actions e testes).
 *
 * `saveCampaign` cria (sem `id`) ou edita (com `id`) — catálogo: guards `saveCampaign?sem id` →
 * `marketing.campanhas.criar` e `saveCampaign?com id` → `marketing.campanhas.editar`. A decisão usa o argumento BRUTO
 * (antes do zod), com a mesma regra do esquema: `id` vazio ou só com espaços = campanha nova.
 */
import type { PermissionKey } from "@/domain/permissions";

export function campaignSaveKey(input: unknown): Extract<PermissionKey, "marketing.campanhas.criar" | "marketing.campanhas.editar"> {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim() !== "" ? "marketing.campanhas.editar" : "marketing.campanhas.criar";
}
