import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiPermission } from "@/server/auth/session";
import { assertClientInScope, completeClientDocumentUpload, documentErrorResponse, documentViewer, getActiveClientDocumentFile, putClientDocumentChunk, toClientDocumentRow } from "@/server/clients/documents";
import { streamFile } from "@/server/files/store";
import { htmlErrorPage, readBodyLimited, storedFileHeaders, wantsHtml } from "@/server/files/http";
import { CLIENT_DOCUMENT_CATEGORY_MAX, CLIENT_DOCUMENT_TITLE_MAX, isInlineClientDocumentType } from "@/domain/client-documents";
import { STORED_FILE_CHUNK_BYTES } from "@/domain/stored-files";

/** Concluir confere o SHA-256 de até 50 MB (partes lidas do banco uma a uma); abrir manda o arquivo em stream. */
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; arquivo: string }> };

function partIndex(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get("parte");
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Arquivo de um documento do cliente (cliente no escopo + aba Documentos liberada). Abre no navegador quando é PDF,
 * imagem ou texto; os demais (e `?download=1`) baixam. A resposta vai em stream: passa do limite de ~4,5 MB da Vercel
 * (conferido em produção). Aberto direto pelo navegador, erro vira página legível em vez de JSON.
 */
export async function GET(request: Request, { params }: Params) {
  const url = new URL(request.url);
  const page = wantsHtml(request);
  const user = await requireApiPermission("operacao.clientes.documentos.ver");
  if (user instanceof Response) {
    if (!page) return user;
    return user.status === 401
      ? htmlErrorPage(401, "Sua sessão expirou. Entre no INTEROS e abra o documento de novo.", { href: "/login", label: "Entrar no INTEROS" })
      : htmlErrorPage(403, "Seu perfil não pode abrir documentos de clientes.");
  }
  const { id, arquivo } = await params;
  const back = { href: `/clientes/${encodeURIComponent(id)}?aba=documentos`, label: "Voltar aos documentos do cliente" };
  try {
    await assertClientInScope(user, id);
    const file = await getActiveClientDocumentFile(id, arquivo);
    if (!file) {
      return page ? htmlErrorPage(404, "Documento não encontrado: ele pode ter sido removido.", back) : Response.json({ ok: false, error: "Documento não encontrado." }, { status: 404 });
    }
    const download = url.searchParams.get("download") === "1" || !isInlineClientDocumentType(file.mimeType);
    return new Response(streamFile(file), { headers: storedFileHeaders(file, download) });
  } catch (error) {
    const response = documentErrorResponse(error, "Não foi possível abrir o documento.");
    if (!page) return response;
    const message = ((await response.clone().json()) as { error?: string }).error ?? "Não foi possível abrir o documento.";
    return htmlErrorPage(response.status, message, back);
  }
}

/** Uma parte do arquivo (`?parte=N`, corpo binário de até 2 MB). Só quem abriu o envio. */
export async function PUT(request: Request, { params }: Params) {
  const user = await requireApiPermission("operacao.clientes.documentos.anexar");
  if (user instanceof Response) return user;
  const { id, arquivo } = await params;
  try {
    await assertClientInScope(user, id);
    const index = partIndex(request);
    if (index === null) return Response.json({ ok: false, error: "Parte inválida." }, { status: 400 });
    const bytes = await readBodyLimited(request, STORED_FILE_CHUNK_BYTES);
    if (!bytes) return Response.json({ ok: false, error: "Parte maior que o permitido." }, { status: 413 });
    await putClientDocumentChunk(id, arquivo, index, bytes, { id: user.id, name: user.name });
    return Response.json({ ok: true, data: { index } });
  } catch (error) {
    return documentErrorResponse(error, "Não foi possível enviar esta parte do documento.");
  }
}

const completeSchema = z.object({
  title: z.string().max(CLIENT_DOCUMENT_TITLE_MAX * 2).optional(),
  category: z.string().max(CLIENT_DOCUMENT_CATEGORY_MAX * 2).optional(),
});

/**
 * Conclui o envio: o servidor confere tamanho e SHA-256, cria o documento (nome, categoria e versão) e registra no
 * histórico do cliente. Corpo JSON opcional: { title, category }. Devolve o documento como a aba mostra.
 */
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiPermission("operacao.clientes.documentos.anexar");
  if (user instanceof Response) return user;
  const { id, arquivo } = await params;
  try {
    await assertClientInScope(user, id);
    const body = completeSchema.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!body.success) return Response.json({ ok: false, error: "Nome ou categoria inválidos." }, { status: 400 });
    const doc = await completeClientDocumentUpload(id, arquivo, body.data, { id: user.id, name: user.name, departmentId: user.departmentId });
    revalidatePath(`/clientes/${id}`);
    return Response.json({ ok: true, data: toClientDocumentRow(doc, documentViewer(user)) });
  } catch (error) {
    return documentErrorResponse(error, "Não foi possível concluir o envio do documento.");
  }
}
