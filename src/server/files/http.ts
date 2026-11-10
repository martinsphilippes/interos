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

/** Abertura direta pelo navegador (aba nova/link), não uma chamada da tela: o erro vira página legível. */
export function wantsHtml(request: Request): boolean {
  if (request.headers.get("sec-fetch-dest") === "document") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/** Página simples de erro (sem scripts) para quem abriu um arquivo por link: o que houve e o caminho de volta. */
export function htmlErrorPage(status: number, message: string, back: { href: string; label: string } = { href: "/", label: "Voltar ao INTEROS" }): Response {
  const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>INTEROS</title></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;line-height:1.5">
<p style="font-size:16px;max-width:560px">${escapeHtml(message)}</p>
<p><a href="${escapeHtml(back.href)}" style="color:#fb923c">${escapeHtml(back.label)}</a></p>
</body></html>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
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
