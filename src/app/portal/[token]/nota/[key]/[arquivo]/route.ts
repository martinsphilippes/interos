import { portalInvoiceFile } from "@/server/portal/service";
import { PORTAL_INVALID_MESSAGE } from "@/domain/portal";

/**
 * Portal do Cliente: PDF ou XML da nota fiscal de uma cobrança (chave posicional b1, b2… da página). Público, protegido
 * pelo token do portal (mesma regra da página); só nota emitida da própria cobrança do cliente. Qualquer caso inválido
 * tem a mesma resposta genérica.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; key: string; arquivo: string }> }) {
  const { token, key, arquivo } = await params;
  const notFound = () => new Response(PORTAL_INVALID_MESSAGE, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (arquivo !== "pdf" && arquivo !== "xml") return notFound();
  let file = null;
  try {
    file = await portalInvoiceFile(token, key, arquivo);
  } catch (error) {
    console.error("[portal] falha ao entregar a nota", error);
  }
  if (!file) return notFound();
  return new Response(new Uint8Array(Buffer.from(file.contentBase64, "base64")), {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `${arquivo === "xml" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}
