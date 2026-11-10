/**
 * Documentos do cliente enviados ao INTEROS (aba Documentos do Cliente 360º): contrato social, cartão CNPJ, documentos
 * dos sócios, comprovantes, contratos, propostas… Vários arquivos de uma vez, cada um com nome, categoria e versão (o
 * mesmo nome vira v2, v3…). O registro por link (Drive, assinatura digital, ERP) continua valendo.
 *
 * O conteúdo fica no banco (src/server/files/store.ts, dono "client_document"); a ficha guarda um Document com o nome,
 * a categoria, a versão e o arquivo (`fileId`). Remover exige motivo, apaga o conteúdo e deixa o registro.
 *
 * Regras puras: valem no navegador (antes de enviar) e no servidor (que confere tudo de novo).
 */
import { canRemoveUpload, fileExtension, formatBytes } from "./stored-files";

/** Tamanho máximo de cada arquivo (documento escaneado em alta resolução cabe com folga). */
export const CLIENT_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Arquivos por cliente (ativos + envios em andamento): o espaço é da organização inteira. */
export const CLIENT_DOCUMENT_MAX_FILES = 100;

/** Arquivos escolhidos de uma vez. */
export const CLIENT_DOCUMENT_MAX_BATCH = 20;

/** Quem enviou pode remover o próprio documento nesta janela; depois, só quem tem a chave de remover. */
export const CLIENT_DOCUMENT_UNDO_MS = 60 * 60 * 1000;

/** Motivo da remoção: mínimo de caracteres. */
export const CLIENT_DOCUMENT_REASON_MIN = 5;

/** Nome do documento (o que aparece na lista e decide a versão). */
export const CLIENT_DOCUMENT_TITLE_MIN = 2;
export const CLIENT_DOCUMENT_TITLE_MAX = 160;

/** Categoria (texto livre no servidor; a tela oferece a lista abaixo). */
export const CLIENT_DOCUMENT_CATEGORY_MAX = 60;

/** Miniatura das imagens (data URL gerada no navegador, só para a lista). */
export const CLIENT_DOCUMENT_THUMB_MAX_CHARS = 60_000;

/** Categorias oferecidas na tela (as primeiras são os documentos de cadastro da empresa). */
export const CLIENT_DOCUMENT_CATEGORIES = [
  "Contrato social",
  "Cartão CNPJ",
  "Documento dos sócios",
  "Comprovante de endereço",
  "Alvará e licenças",
  "Certidão",
  "Procuração",
  "Contrato",
  "Proposta",
  "Documento fiscal",
  "Comprovante de pagamento",
  "Cadastro",
  "Treinamento",
  "Evidência",
  "Outro",
] as const;

/** Documentos de cadastro que a aba confere (o que falta aparece com atalho para enviar). */
export const CLIENT_ESSENTIAL_DOCUMENTS = ["Contrato social", "Cartão CNPJ"] as const;

/**
 * Extensão → tipo do arquivo. O tipo gravado e servido vem SEMPRE daqui (nunca do navegador): sem HTML, SVG ou
 * scripts, nada do que é servido roda como página.
 */
export const CLIENT_DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  p7s: "application/pkcs7-signature",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xml: "application/xml",
  zip: "application/zip",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
};

/** Para o `accept` do seletor de arquivos. */
export const CLIENT_DOCUMENT_ACCEPT = Object.keys(CLIENT_DOCUMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/** Tipos que o navegador mostra (Abrir); os demais só baixam. */
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"]);

export function isInlineClientDocumentType(mimeType: string): boolean {
  return INLINE_TYPES.has(mimeType);
}

/** Tipo aceito pelo nome do arquivo (null = extensão não aceita). */
export function clientDocumentMimeType(name: string): string | null {
  return CLIENT_DOCUMENT_TYPES[fileExtension(name)] ?? null;
}

/** Extensão para um arquivo sem extensão, a partir do tipo informado pelo navegador (ex.: print colado). */
export function clientDocumentExtensionFor(mimeType: string): string | null {
  if (mimeType === "image/jpeg") return "jpg";
  const found = Object.entries(CLIENT_DOCUMENT_TYPES).find(([, type]) => type === mimeType);
  return found ? found[0] : null;
}

/** O que impede enviar o arquivo (null = pode enviar). */
export function clientDocumentProblem(file: { name: string; size: number }): string | null {
  if (!clientDocumentMimeType(file.name)) {
    const ext = fileExtension(file.name);
    return `${ext ? `Arquivos .${ext}` : "Arquivos sem extensão"} não são aceitos. Use PDF, imagem, Word, Excel, XML, ZIP ou e-mail.`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "O arquivo está vazio.";
  if (file.size > CLIENT_DOCUMENT_MAX_BYTES) return `O arquivo tem ${formatBytes(file.size)}; o limite é ${formatBytes(CLIENT_DOCUMENT_MAX_BYTES)} por arquivo.`;
  return null;
}

/** Miniatura aceita: data URL de imagem (JPEG, PNG ou WebP) em base64, dentro do limite. */
export function isValidClientDocumentThumbnail(value: string): boolean {
  return value.length <= CLIENT_DOCUMENT_THUMB_MAX_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Sem acentos e em minúsculas (para reconhecer o nome do arquivo). */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Palavras do nome do arquivo → categoria sugerida (a primeira que bate vale). */
const CATEGORY_HINTS: readonly [RegExp, (typeof CLIENT_DOCUMENT_CATEGORIES)[number]][] = [
  [/contrato[\s_.-]*social|estatuto|requerimento[\s_.-]*de[\s_.-]*empresario|\bccmei\b|alteracao[\s_.-]*contratual/, "Contrato social"],
  [/cartao[\s_.-]*cnpj|comprovante[\s_.-]*(de[\s_.-]*)?inscricao|\bcnpj\b/, "Cartão CNPJ"],
  [/\b(rg|cnh|cpf)\b|identidade|habilitacao|documento[\s_.-]*(do|dos|de)[\s_.-]*socio/, "Documento dos sócios"],
  [/comprovante[\s_.-]*(de[\s_.-]*)?(endereco|residencia)|conta[\s_.-]*de[\s_.-]*(luz|agua|energia)/, "Comprovante de endereço"],
  [/alvara|licenca|vigilancia|bombeiro|\bavcb\b/, "Alvará e licenças"],
  [/certidao|\bcnd\b|negativa/, "Certidão"],
  [/procuracao/, "Procuração"],
  [/boleto|comprovante[\s_.-]*(de[\s_.-]*)?pagamento|\bpix\b|recibo/, "Comprovante de pagamento"],
  [/nota[\s_.-]*fiscal|\bnfs?-?e\b|\bdanfe\b|\bnf\b/, "Documento fiscal"],
  [/proposta|orcamento/, "Proposta"],
  [/contrato|aditivo|termo/, "Contrato"],
  [/ficha[\s_.-]*cadastral|cadastro/, "Cadastro"],
];

/** Categoria sugerida pelo nome do arquivo ("Outro" quando nada bate). */
export function suggestDocumentCategory(fileName: string): (typeof CLIENT_DOCUMENT_CATEGORIES)[number] {
  // "_", "-" e "." viram espaço: "rg_maria" e "cartao-cnpj" casam com as palavras inteiras.
  const name = plain(fileName.replace(/\.[a-z0-9]{1,8}$/i, "")).replace(/[_.-]+/g, " ");
  for (const [pattern, category] of CATEGORY_HINTS) if (pattern.test(name)) return category;
  return "Outro";
}

/**
 * Nome sugerido a partir do arquivo: sem extensão, "_" e "-" viram espaço, primeira letra maiúscula
 * ("contrato_social-2024.pdf" → "Contrato social 2024"). Quando o nome do arquivo é a própria categoria
 * ("cartao-cnpj.png" com a categoria "Cartão CNPJ"), vale o nome da categoria, com acentos e maiúsculas.
 */
export function suggestDocumentTitle(fileName: string, category?: string): string {
  const base = fileName
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/(?<=\S)-(?=\S)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (category && base && sameDocumentTitle(base, category)) return category;
  const title = base || "Documento";
  const capped = title.length > CLIENT_DOCUMENT_TITLE_MAX ? title.slice(0, CLIENT_DOCUMENT_TITLE_MAX).trimEnd() : title;
  return `${capped.charAt(0).toUpperCase()}${capped.slice(1)}`;
}

/** Mesmo nome (para a versão): sem diferença de maiúsculas, acentos e espaços extras. */
export function sameDocumentTitle(a: string, b: string): boolean {
  const norm = (s: string) => plain(s).replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * Pode remover o documento? Quem tem a chave de remover (`canRemoveAny`), sempre; quem enviou e ainda pode anexar
 * (`canRemoveOwn`), só na primeira hora depois de enviar — para corrigir um arquivo errado sem depender do gestor.
 */
export function canRemoveClientDocument(input: { canRemoveAny: boolean; canRemoveOwn: boolean; viewerId: string; uploadedById: string; completedAt?: string; now: Date }): boolean {
  return canRemoveUpload({ ...input, undoMs: CLIENT_DOCUMENT_UNDO_MS });
}

/** Documento que vale: removido não conta em listas, nos portões do workflow nem nos documentos do contrato. */
export function isActiveDocument(doc: { status?: string }): boolean {
  return doc.status !== "removido";
}

/** Endereço do arquivo do documento (abre no navegador quando dá; `download` força baixar). */
export function clientDocumentFileUrl(clientId: string, fileId: string, download = false): string {
  return `/api/clientes/${encodeURIComponent(clientId)}/documentos/${encodeURIComponent(fileId)}${download ? "?download=1" : ""}`;
}
