import { requireApiPermission } from "@/server/auth/session";
import { getById } from "@/server/db";
import { getTemplateFile } from "@/server/finance/contract-templates";
import { COLLECTIONS, type ContractTemplate } from "@/domain/types";

/** Arquivo Word original de um modelo (?versao=N; padrão a atual). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("financeiro.assinaturas.modelos.ver");
  if (user instanceof Response) return user;
  const { id } = await params;
  const template = await getById<ContractTemplate>(COLLECTIONS.contractTemplates, id);
  if (!template || template.kind !== "word") return Response.json({ ok: false, error: "Modelo não encontrado." }, { status: 404 });
  const version = Number(new URL(request.url).searchParams.get("versao")) || template.version;
  const file = await getTemplateFile(template.id, version);
  if (!file) return Response.json({ ok: false, error: "Arquivo não encontrado." }, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(file.contentBase64, "base64")), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // Nome com acento: versão ASCII + a original codificada (cabeçalho só aceita ASCII com segurança).
      "content-disposition": `attachment; filename="${file.fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "") || "modelo.docx"}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
    },
  });
}
