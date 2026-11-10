import { revalidatePath } from "next/cache";
import { requireApiPermission } from "@/server/auth/session";
import { assertLeadInScope } from "@/server/marketing/access";
import { completeConsentEvidenceUpload, evidenceErrorResponse, evidenceViewer, getActiveConsentEvidence, putConsentEvidenceChunk, toEvidenceRow } from "@/server/marketing/consent-evidence";
import { readChunk, streamFile } from "@/server/files/store";
import { readBodyLimited, storedFileHeaders } from "@/server/files/http";
import { isInlineEvidenceType } from "@/domain/consent-evidence";
import { STORED_FILE_CHUNK_BYTES } from "@/domain/stored-files";

/** Concluir confere o SHA-256 de até 50 MB (partes lidas do banco uma a uma). */
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; arquivo: string }> };

function partIndex(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get("parte");
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Comprovante do consentimento LGPD (lead no escopo da tela de Leads). Sem parâmetros: o arquivo inteiro (abre no
 * navegador quando é imagem/PDF/áudio/vídeo/texto; `?download=1` baixa). `?parte=N`: só a parte N (2 MB) — o navegador
 * remonta os arquivos grandes parte a parte, abaixo do limite de resposta da Vercel, e confere o SHA-256.
 */
export async function GET(request: Request, { params }: Params) {
  const user = await requireApiPermission("marketing.leads.ver");
  if (user instanceof Response) return user;
  const { id, arquivo } = await params;
  try {
    await assertLeadInScope(user, id);
    const file = await getActiveConsentEvidence(id, arquivo);
    if (!file) return Response.json({ ok: false, error: "Comprovante não encontrado." }, { status: 404 });
    const url = new URL(request.url);
    if (url.searchParams.has("parte")) {
      const index = partIndex(request);
      if (index === null) return Response.json({ ok: false, error: "Parte inválida." }, { status: 400 });
      const bytes = await readChunk(file, index);
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength), "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      });
    }
    const download = url.searchParams.get("download") === "1" || !isInlineEvidenceType(file.mimeType);
    return new Response(streamFile(file), { headers: storedFileHeaders(file, download) });
  } catch (error) {
    return evidenceErrorResponse(error, "Não foi possível abrir o comprovante.");
  }
}

/** Uma parte do arquivo (`?parte=N`, corpo binário de até 2 MB). Só quem abriu o envio. */
export async function PUT(request: Request, { params }: Params) {
  const user = await requireApiPermission("marketing.leads.consentimento.anexar");
  if (user instanceof Response) return user;
  const { id, arquivo } = await params;
  try {
    await assertLeadInScope(user, id);
    const index = partIndex(request);
    if (index === null) return Response.json({ ok: false, error: "Parte inválida." }, { status: 400 });
    const bytes = await readBodyLimited(request, STORED_FILE_CHUNK_BYTES);
    if (!bytes) return Response.json({ ok: false, error: "Parte maior que o permitido." }, { status: 413 });
    await putConsentEvidenceChunk(id, arquivo, index, bytes, { id: user.id, name: user.name });
    return Response.json({ ok: true, data: { index } });
  } catch (error) {
    return evidenceErrorResponse(error, "Não foi possível enviar esta parte do comprovante.");
  }
}

/** Conclui o envio: o servidor confere tamanho e SHA-256 e registra no histórico do lead. Devolve o comprovante. */
export async function POST(_request: Request, { params }: Params) {
  const user = await requireApiPermission("marketing.leads.consentimento.anexar");
  if (user instanceof Response) return user;
  const { id, arquivo } = await params;
  try {
    await assertLeadInScope(user, id);
    const file = await completeConsentEvidenceUpload(id, arquivo, { id: user.id, name: user.name });
    revalidatePath("/marketing", "layout");
    return Response.json({ ok: true, data: toEvidenceRow(file, evidenceViewer(user)) });
  } catch (error) {
    return evidenceErrorResponse(error, "Não foi possível concluir o envio do comprovante.");
  }
}
