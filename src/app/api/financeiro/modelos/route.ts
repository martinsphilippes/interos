import { revalidatePath } from "next/cache";
import { requireApiPermission } from "@/server/auth/session";
import { isUserFacingError } from "@/server/auth/errors";
import { uploadWordTemplate } from "@/server/finance/contract-templates";
import { DOCX_MAX_BYTES } from "@/server/finance/docx";

/**
 * Envio do modelo Word (.docx) usado na Clicksign: cria um modelo ou troca o arquivo de um existente (nova versão).
 * Rota em vez de Server Action porque o arquivo passa do limite de 1 MB das actions. Campos (multipart): arquivo,
 * templateId (opcional), nome (opcional).
 */
export async function POST(request: Request) {
  const user = await requireApiPermission("financeiro.assinaturas.modelos.editar");
  if (user instanceof Response) return user;
  try {
    const form = await request.formData();
    const file = form.get("arquivo");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "Escolha o arquivo Word (.docx)." }, { status: 400 });
    if (file.size > DOCX_MAX_BYTES) return Response.json({ ok: false, error: "Arquivo maior que 4 MB." }, { status: 413 });
    const templateId = String(form.get("templateId") ?? "").trim() || undefined;
    const name = String(form.get("nome") ?? "").trim().slice(0, 120) || undefined;
    const { template, variables } = await uploadWordTemplate({ templateId, name, fileName: file.name, content: Buffer.from(await file.arrayBuffer()) }, { id: user.id, name: user.name });
    revalidatePath("/financeiro/assinaturas");
    return Response.json({ ok: true, data: { id: template.id, version: template.version, variables } });
  } catch (error) {
    if (isUserFacingError(error)) return Response.json({ ok: false, error: error.message }, { status: 400 });
    console.error("[assinatura] envio do modelo Word", error);
    return Response.json({ ok: false, error: "Não foi possível ler o arquivo Word." }, { status: 400 });
  }
}
