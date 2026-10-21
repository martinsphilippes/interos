import { requireApiPermission } from "@/server/auth/session";
import { canSeeContractValues, contractAccessById } from "@/server/finance/access";
import { contractDocumentData, contractDocx, contractPdf } from "@/server/finance/contract-document";

/**
 * Documento do contrato para assinatura: ?formato=pdf (gerado pelo INTEROS) ou ?formato=docx (modelo Word preenchido).
 * Mesmo acesso da página do documento (seção + escopo do contrato) e exige ver os valores (o arquivo vai ao cliente).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("financeiro.contratos.documentos.ver");
  if (user instanceof Response) return user;
  const { id } = await params;
  const access = await contractAccessById(user, id);
  if (access === "missing") return Response.json({ ok: false, error: "Contrato não encontrado." }, { status: 404 });
  if (access === "denied") return Response.json({ ok: false, error: "Sem acesso a este contrato." }, { status: 403 });
  if (!canSeeContractValues(user)) return Response.json({ ok: false, error: "Baixar o documento exige ver os valores do contrato." }, { status: 403 });
  const data = await contractDocumentData(id);
  if (!data) return Response.json({ ok: false, error: "Contrato não encontrado." }, { status: 404 });
  const sp = new URL(request.url).searchParams;
  const format = sp.get("formato") === "docx" ? "docx" : "pdf";
  const file = format === "docx" ? await contractDocx(data) : await contractPdf(data);
  if (!file) return Response.json({ ok: false, error: "O modelo deste contrato não é um Word." }, { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
      "content-disposition": `${sp.get("download") === "1" || format === "docx" ? "attachment" : "inline"}; filename="${file.fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
