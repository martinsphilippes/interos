import { requireApiPermission } from "@/server/auth/session";
import { getById } from "@/server/db";
import { canSeeContractValues, contractAccessById } from "@/server/finance/access";
import { contractSignedFileId, getSignedFile, storeContractSignedFile } from "@/server/finance/signature-webhook";
import { COLLECTIONS, type Contract, type SignedFile } from "@/domain/types";

/**
 * PDF assinado do contrato (devolvido pela Clicksign e guardado no INTEROS). Se ainda não foi guardado, busca na
 * Clicksign na hora e guarda. Mesmo acesso do documento do contrato (seção + escopo + ver os valores).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("financeiro.contratos.documentos.ver");
  if (user instanceof Response) return user;
  const { id } = await params;
  const access = await contractAccessById(user, id);
  if (access === "missing") return Response.json({ ok: false, error: "Contrato não encontrado." }, { status: 404 });
  if (access === "denied") return Response.json({ ok: false, error: "Sem acesso a este contrato." }, { status: 403 });
  if (!canSeeContractValues(user)) return Response.json({ ok: false, error: "Baixar o documento exige ver os valores do contrato." }, { status: 403 });
  const contract = await getById<Contract>(COLLECTIONS.contracts, id);
  if (!contract) return Response.json({ ok: false, error: "Contrato não encontrado." }, { status: 404 });
  let file = await getSignedFile(contractSignedFileId(contract));
  if (!file && contract.signatureProvider === "clicksign" && contract.signedAt) {
    if (await storeContractSignedFile(contract)) file = await getSignedFile(contractSignedFileId(contract));
  }
  if (!file) return Response.json({ ok: false, error: "O PDF assinado ainda não está disponível. Tente de novo em alguns minutos." }, { status: 404 });
  return signedFileResponse(file, new URL(request.url).searchParams.get("download") === "1");
}

function signedFileResponse(file: SignedFile, download: boolean): Response {
  return new Response(new Uint8Array(Buffer.from(file.contentBase64, "base64")), {
    headers: {
      "content-type": file.mimeType || "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
    },
  });
}
