/**
 * Token do Portal do Cliente (D31): 32 bytes aleatórios (crypto.randomBytes) em base64url e o id do documento =
 * sha256(token) em hex. Só Node (sem dependências de requisição): usado pelo serviço, pelo seed e pelos testes.
 */
import { createHash, randomBytes } from "node:crypto";
import { isPortalTokenFormat } from "@/domain/portal";

/** Novo token (43 caracteres base64url, 256 bits de entropia). Só existe na memória de quem o gerou. */
export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Id do link para um token: sha256 em hex (64 caracteres). */
export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Id do link para um token recebido de fora, ou null quando o formato é inválido (nem consulta o banco). */
export function portalLinkIdFor(token: string | undefined | null): string | null {
  return isPortalTokenFormat(token) ? hashPortalToken(token) : null;
}
