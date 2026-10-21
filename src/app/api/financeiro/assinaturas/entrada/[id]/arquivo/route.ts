import { requireApiPermission } from "@/server/auth/session";
import { getById } from "@/server/db";
import { getSignedFile } from "@/server/finance/signature-webhook";
import { COLLECTIONS, type SignatureInboxItem } from "@/domain/types";

/** PDF assinado de um documento da caixa de entrada (criado direto na Clicksign), quando a Clicksign o devolveu. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("financeiro.assinaturas.entrada.ver");
  if (user instanceof Response) return user;
  const { id } = await params;
  const item = await getById<SignatureInboxItem>(COLLECTIONS.signatureInbox, id);
  if (!item) return Response.json({ ok: false, error: "Documento não encontrado." }, { status: 404 });
  const file = item.signedFileId ? await getSignedFile(item.signedFileId) : null;
  if (!file) return Response.json({ ok: false, error: "A Clicksign não devolveu o PDF assinado deste documento. Baixe-o na Clicksign." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(Buffer.from(file.contentBase64, "base64")), {
    headers: {
      "content-type": file.mimeType || "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
    },
  });
}
