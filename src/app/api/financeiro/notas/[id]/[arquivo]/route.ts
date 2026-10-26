import { can, PermissionError, requireApiPermission } from "@/server/auth/session";
import { isUserFacingError } from "@/server/auth/errors";
import { assertBillingAccess } from "@/server/finance/access";
import { getInvoice, getInvoiceFile } from "@/server/finance/invoices";

/** PDF ou XML da nota fiscal (guardado no INTEROS). Mesmo escopo da cobrança da nota. `?download=1` baixa. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; arquivo: string }> }) {
  const user = await requireApiPermission("financeiro.faturamento.arquivos.baixar");
  if (user instanceof Response) return user;
  // O documento traz o valor da nota: mesma regra de ver valores das telas.
  if (!can(user, "financeiro.valores.ver")) return Response.json({ ok: false, error: "Baixar a nota exige ver os valores." }, { status: 403 });
  const { id, arquivo } = await params;
  if (arquivo !== "pdf" && arquivo !== "xml") return Response.json({ ok: false, error: "Arquivo inválido." }, { status: 404 });
  try {
    const invoice = await getInvoice(id);
    if (!invoice) return Response.json({ ok: false, error: "Nota não encontrada." }, { status: 404 });
    await assertBillingAccess(user, invoice.billingId, "financeiro.faturamento");
    const file = await getInvoiceFile(invoice, arquivo);
    if (!file)
      return Response.json(
        {
          ok: false,
          error: `Esta nota não tem ${arquivo.toUpperCase()} anexado.`,
        },
        { status: 404 },
      );
    const download = new URL(request.url).searchParams.get("download") === "1" || arquivo === "xml";
    return new Response(new Uint8Array(Buffer.from(file.contentBase64, "base64")), {
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (isUserFacingError(error)) return Response.json({ ok: false, error: error.message }, { status: error instanceof PermissionError ? 403 : 404 });
    throw error;
  }
}
