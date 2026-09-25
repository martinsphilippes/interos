/**
 * Links de envio manual (mailto:, wa.me com texto) usados enquanto e-mail/WhatsApp/assinatura não estão
 * conectados. Módulo puro: usado por Client Components.
 */

export const contractDocumentPath = (contractId: string) => `/financeiro/contratos/${contractId}/documento`;

function mailto(to: string[], subject: string, body: string): string {
  return `mailto:${to.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface ContractMailInput {
  number: string;
  version: number;
  clientName: string;
  documentHash?: string;
  documentUrl: string;
  signers: { name: string; email: string; status: string }[];
}

/** E-mail com o contrato para assinatura (o usuário anexa o PDF salvo do documento imprimível). */
export function contractEmailHref(c: ContractMailInput): string {
  const pending = c.signers.filter((s) => s.status !== "assinado");
  const to = (pending.length > 0 ? pending : c.signers).map((s) => s.email);
  const body = [
    `Olá!`,
    ``,
    `Segue o contrato ${c.number} (versão ${c.version}) da Intercert para ${c.clientName}, para assinatura.`,
    `O documento em PDF está anexo. Após assinar, responda este e-mail com o arquivo assinado.`,
    ``,
    c.documentHash ? `Código de integridade (SHA-256): ${c.documentHash}` : null,
    `Referência interna: ${c.documentUrl}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
  return mailto(to, `Contrato ${c.number} para assinatura — Intercert`, body);
}

/** Lembrete de assinatura para um signatário. */
export function reminderEmailHref(c: { number: string; version: number; documentHash?: string }, signer: { name: string; email: string }): string {
  const body = `Olá, ${signer.name.split(" ")[0]}!\n\nO contrato ${c.number} (versão ${c.version}) da Intercert aguarda a sua assinatura.${c.documentHash ? `\nCódigo de integridade: ${c.documentHash}` : ""}\n\nQualquer dúvida, estamos à disposição.`;
  return mailto([signer.email], `Lembrete: contrato ${c.number} aguardando sua assinatura`, body);
}

/** wa.me com o texto pronto (o `base` vem de whatsappHref). */
export function whatsappWithText(base: string, text: string): string {
  return `${base}?text=${encodeURIComponent(text)}`;
}
