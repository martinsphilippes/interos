/**
 * Assinatura das escritas de licença (contrato v2 §3): `X-Interos-Signature: t=<unix>,v1=<hex>`, em que
 * hex = HMAC-SHA256(segredo, `${t}.${corpo}`) sobre o corpo EXATO enviado. O ERP recusa fora de ±5 minutos e
 * guarda o `X-Interos-Event-Id` por 7 dias (o mesmo evento com o mesmo corpo devolve a resposta anterior).
 *
 * A verificação no sentido contrário (eventos ERP → INTEROS, `X-ERP-Signature`) usa o mesmo formato.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Valor do cabeçalho de assinatura para `body` (string já serializada) no instante `nowMs`. */
export function signBody(secret: string, body: string, nowMs: number = Date.now()): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

export interface ParsedSignature {
  t: number;
  v1: string[];
}

export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) v1.push(value.toLowerCase());
  }
  return t === null || v1.length === 0 ? null : { t, v1 };
}

export type SignatureCheck = "ok" | "missing" | "malformed" | "expired" | "mismatch";

/** Confere uma assinatura recebida (tempo constante; aceita mais de um `v1` para rotação de segredo). */
export function verifySignature(secret: string, header: string | null | undefined, body: string, nowMs: number = Date.now()): SignatureCheck {
  if (!header) return "missing";
  const parsed = parseSignatureHeader(header);
  if (!parsed) return "malformed";
  if (Math.abs(Math.floor(nowMs / 1000) - parsed.t) > SIGNATURE_TOLERANCE_SECONDS) return "expired";
  const expected = Buffer.from(hmacHex(secret, `${parsed.t}.${body}`), "hex");
  for (const candidate of parsed.v1) {
    const got = Buffer.from(candidate, "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return "ok";
  }
  return "mismatch";
}
