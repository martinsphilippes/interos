/**
 * Chaves do catálogo exigidas pelas actions de Vendas que despacham pelo argumento (puro: actions e testes).
 *
 * Catálogo (src/domain/permissions/vendas.ts):
 *  - `saveProposalAction?sem proposalId` → vendas.propostas.criar; `?com proposalId` → vendas.propostas.editar. Mesma
 *    regra do esquema: `proposalId` ausente ou vazio = proposta nova.
 *  - `transitionProposalAction?transition=enviar|visualizada|negociacao` → vendas.propostas.enviar;
 *    `?transition=aceitar|recusar` → vendas.propostas.aprovar. Transição desconhecida cai em "enviar" e é recusada
 *    pela validação logo depois.
 * A decisão usa o argumento BRUTO (antes do zod), para a permissão ser checada antes de qualquer leitura.
 */
import type { PermissionKey } from "@/domain/permissions";

function field(input: unknown, name: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[name] : undefined;
}

export function proposalSaveKey(input: unknown): Extract<PermissionKey, "vendas.propostas.criar" | "vendas.propostas.editar"> {
  const id = field(input, "proposalId");
  return typeof id === "string" && id !== "" ? "vendas.propostas.editar" : "vendas.propostas.criar";
}

export function proposalTransitionKey(input: unknown): Extract<PermissionKey, "vendas.propostas.enviar" | "vendas.propostas.aprovar"> {
  const transition = field(input, "transition");
  return transition === "aceitar" || transition === "recusar" ? "vendas.propostas.aprovar" : "vendas.propostas.enviar";
}
