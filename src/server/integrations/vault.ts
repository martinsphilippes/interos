import "server-only";
/**
 * Cofre dos tokens dos canais conectados pela tela (página da Meta, bot do Telegram): AES-256-GCM. A chave vem de
 * INTEGRATIONS_SECRET_KEY (recomendado: 32 bytes em base64) ou, sem ela, é derivada de SESSION_COOKIE_SECRET (trocar
 * esse segredo exige reconectar os canais). Em produção, sem nenhum dos dois, não grava nem lê.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(): Buffer {
  const dedicated = process.env.INTEGRATIONS_SECRET_KEY?.trim();
  if (dedicated) {
    const raw = Buffer.from(dedicated, "base64");
    if (raw.length >= 32) return raw.subarray(0, 32);
    return Buffer.from(hkdfSync("sha256", dedicated, "interos", "integrations-vault", 32));
  }
  const session = process.env.SESSION_COOKIE_SECRET?.trim();
  if (!session) {
    if (process.env.NODE_ENV === "production") throw new Error("Cofre de integrações sem chave (INTEGRATIONS_SECRET_KEY ou SESSION_COOKIE_SECRET)");
    return Buffer.from(hkdfSync("sha256", "dev-only-vault", "interos", "integrations-vault", 32));
  }
  return Buffer.from(hkdfSync("sha256", session, "interos", "integrations-vault", 32));
}

/** Texto cifrado: v1.<iv>.<tag>.<dados> (base64url). */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Abre o texto cifrado; null se foi adulterado ou a chave mudou. */
export function unseal(sealed: string | undefined | null): string | null {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
