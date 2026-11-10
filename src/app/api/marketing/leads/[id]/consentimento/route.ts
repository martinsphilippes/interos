import { z } from "zod";
import { requireApiPermission } from "@/server/auth/session";
import { assertLeadInScope } from "@/server/marketing/access";
import { evidenceErrorResponse, startConsentEvidenceUpload } from "@/server/marketing/consent-evidence";
import { CONSENT_EVIDENCE_THUMB_MAX_CHARS } from "@/domain/consent-evidence";
import { SHA256_TAG } from "@/domain/stored-files";

const startSchema = z.object({
  name: z.string().trim().min(1).max(300),
  size: z.number().int().positive(),
  sha256: z.string().regex(SHA256_TAG),
  thumbnail: z.string().max(CONSENT_EVIDENCE_THUMB_MAX_CHARS).optional(),
});

/**
 * Abre o envio de um comprovante do consentimento LGPD do lead. O conteúdo sobe depois, em partes de 2 MB, pela rota
 * ./[arquivo] (limite de ~4,5 MB por requisição na Vercel). Corpo JSON: { name, size, sha256: "sha256:<hex>",
 * thumbnail? }. Resposta: { id, chunkSize, chunkCount }. Chave marketing.leads.consentimento.anexar + lead no escopo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("marketing.leads.consentimento.anexar");
  if (user instanceof Response) return user;
  const { id } = await params;
  try {
    await assertLeadInScope(user, id);
    const body = startSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ ok: false, error: "Dados do arquivo inválidos." }, { status: 400 });
    const file = await startConsentEvidenceUpload(id, body.data, { id: user.id, name: user.name });
    return Response.json({ ok: true, data: { id: file.id, chunkSize: file.chunkSize, chunkCount: file.chunkCount } });
  } catch (error) {
    return evidenceErrorResponse(error, "Não foi possível começar o envio do comprovante.");
  }
}
