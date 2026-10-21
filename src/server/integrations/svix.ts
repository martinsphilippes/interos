/**
 * Verificação de assinatura de webhooks no padrão Svix (usado pelo Resend): cabeçalhos svix-id, svix-timestamp e
 * svix-signature («v1,<base64>», podendo vir vários separados por espaço). O conteúdo assinado é
 * «<id>.<timestamp>.<corpo bruto>», com HMAC-SHA256 e a chave base64 que vem depois de «whsec_».
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_S = 5 * 60;

export function svixSignatureValid(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now?: number }): boolean {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  // Aviso velho ou do futuro: recusa (evita reenvio de um aviso capturado).
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${input.body}`, "utf8").digest();
  return signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .some((part) => {
      const received = Buffer.from(part.slice(3), "base64");
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
}
