import { revalidatePath } from "next/cache";
import { can, PermissionError, requireApiPermission } from "@/server/auth/session";
import { isUserFacingError } from "@/server/auth/errors";
import { assertBillingAccess } from "@/server/finance/access";
import { INVOICE_PDF_MAX_BYTES, INVOICE_XML_MAX_BYTES, registerInvoice } from "@/server/finance/invoices";

/**
 * Registrar a nota fiscal emitida para uma cobrança (número, série, emissão, chave/código, valor, PDF e XML).
 * Rota em vez de Server Action porque os arquivos passam do limite de 1 MB das actions. Campos (multipart):
 * billingId, tipo (nfse|nfe), numero, serie, emissao (AAAA-MM-DD), chave, codigo, valor, observacao, pdf, xml.
 * O valor da nota exige ver os valores (financeiro.valores.ver), como registrar boleto e dar baixa.
 */
export async function POST(request: Request) {
  const user = await requireApiPermission("financeiro.faturamento.registrar");
  if (user instanceof Response) return user;
  if (!can(user, "financeiro.valores.ver")) return Response.json({ ok: false, error: "Registrar a nota exige ver os valores." }, { status: 403 });
  try {
    const form = await request.formData();
    const text = (name: string, max = 120) =>
      String(form.get(name) ?? "")
        .trim()
        .slice(0, max);
    const billingId = text("billingId", 80);
    if (!billingId) return Response.json({ ok: false, error: "Cobrança não informada." }, { status: 400 });
    const billing = await assertBillingAccess(user, billingId, "financeiro.faturamento");
    const kind = text("tipo", 10);
    if (kind !== "nfse" && kind !== "nfe") return Response.json({ ok: false, error: "Escolha o tipo da nota (NFS-e ou NF-e)." }, { status: 400 });
    const file = async (name: string, max: number) => {
      const f = form.get(name);
      if (!(f instanceof File) || f.size === 0) return undefined;
      if (f.size > max) throw new RangeError(name);
      return {
        fileName: f.name,
        content: Buffer.from(await f.arrayBuffer()),
        mimeType: f.type,
      };
    };
    let pdf, xml;
    try {
      pdf = await file("pdf", INVOICE_PDF_MAX_BYTES);
      xml = await file("xml", INVOICE_XML_MAX_BYTES);
    } catch (e) {
      if (e instanceof RangeError)
        return Response.json(
          {
            ok: false,
            error: e.message === "pdf" ? "PDF maior que 3 MB." : "XML maior que 1 MB.",
          },
          { status: 413 },
        );
      throw e;
    }
    // "1.234,56" (vírgula decimal) ou "1234.56" (ponto decimal): ponto só é milhar quando há vírgula.
    const raw = text("valor", 20).replace(/[R$\s]/g, "");
    const amount = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
    const invoice = await registerInvoice(
      {
        billingId,
        kind,
        number: text("numero", 20),
        series: text("serie", 10) || undefined,
        issuedAt: text("emissao", 10),
        accessKey: text("chave", 80) || undefined,
        verificationCode: text("codigo", 60) || undefined,
        amount,
        notes: text("observacao", 500) || undefined,
        pdf,
        xml,
      },
      { id: user.id, name: user.name },
    );
    revalidatePath("/financeiro", "layout");
    revalidatePath(`/financeiro/contratos/${billing.contractId}`);
    revalidatePath(`/clientes/${billing.clientId}`);
    return Response.json({
      ok: true,
      data: { id: invoice.id, number: invoice.number },
    });
  } catch (error) {
    if (isUserFacingError(error)) return Response.json({ ok: false, error: error.message }, { status: error instanceof PermissionError ? 403 : 400 });
    console.error("[faturamento] registro da nota", error);
    return Response.json({ ok: false, error: "Não foi possível registrar a nota." }, { status: 500 });
  }
}
