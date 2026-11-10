import { z } from "zod";
import { requireApiPermission } from "@/server/auth/session";
import { assertClientInScope, documentErrorResponse, startClientDocumentUpload } from "@/server/clients/documents";
import { SHA256_TAG } from "@/domain/stored-files";

const startSchema = z.object({
  name: z.string().trim().min(1).max(300),
  size: z.number().int().positive(),
  sha256: z.string().regex(SHA256_TAG),
});

/**
 * Abre o envio de um documento do cliente (aba Documentos do Cliente 360º). O conteúdo sobe depois, em partes de 2 MB,
 * pela rota ./[arquivo] (limite de ~4,5 MB por requisição na Vercel). Corpo JSON: { name, size, sha256:
 * "sha256:<hex>" }. Resposta: { id, chunkSize, chunkCount }. Chave operacao.clientes.documentos.anexar + cliente no
 * escopo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("operacao.clientes.documentos.anexar");
  if (user instanceof Response) return user;
  const { id } = await params;
  try {
    await assertClientInScope(user, id);
    const body = startSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ ok: false, error: "Dados do arquivo inválidos." }, { status: 400 });
    const file = await startClientDocumentUpload(id, body.data, { id: user.id, name: user.name, departmentId: user.departmentId });
    return Response.json({ ok: true, data: { id: file.id, chunkSize: file.chunkSize, chunkCount: file.chunkCount } });
  } catch (error) {
    return documentErrorResponse(error, "Não foi possível começar o envio do documento.");
  }
}
