import "server-only";
/**
 * Utilitários HTTP dos arquivos guardados em partes (rotas de envio e download).
 */

/** Lê o corpo binário até `limit` bytes; acima disso para de ler e devolve null (413 no chamador). */
export async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/**
 * Cabeçalhos de um arquivo servido: tipo definido pelo INTEROS (nunca adivinhado pelo navegador), nome em UTF-8
 * (RFC 5987), sem cache em lugar nenhum. `download` força baixar em vez de abrir.
 */
export function storedFileHeaders(file: { name: string; mimeType: string; size: number }, download: boolean): HeadersInit {
  return {
    "content-type": file.mimeType,
    "content-length": String(file.size),
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
}
