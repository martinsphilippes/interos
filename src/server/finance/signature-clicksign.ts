import "server-only";
/**
 * Provedor de assinatura Clicksign (implementa SignatureProvider). Com CLICKSIGN_API_TOKEN configurado, "Enviar para
 * assinatura" cria o envelope na Clicksign:
 * 1. documento: o Word do modelo preenchido (modelo Word) ou o PDF gerado pelo INTEROS, com o id do contrato nos
 *    metadados (é por eles que o aviso de assinatura volta para o contrato certo);
 * 2. cada signatário, com o papel (contratante, contratada, testemunha) e a autenticação escolhida no contrato ou na
 *    configuração (código por e-mail é o padrão);
 * 3. ativa e dispara o pedido de assinatura por e-mail (lembrete automático a cada 3 dias).
 * Sem o token, vale o provedor manual (documento no INTEROS + assinatura registrada com evidência).
 */
import { BusinessError } from "@/server/auth/error-classes";
import { getById, list } from "@/server/db";
import { activateEnvelope, addAuthentication, addDocument, addQualification, addSigner, cancelDocument, clicksignApi, clicksignConfigured, ClicksignError, createEnvelope, getDocument, notifyEnvelope, notifySigner } from "@/server/integrations/clicksign";
import { clicksignRole, clicksignSignerNameProblem } from "@/domain/contract-templates";
import { COLLECTIONS, type Client, type Contact, type Contract, type SignatureAuthMethod, type User } from "@/domain/types";
import { nationalNumber } from "@/domain/phone";
import { contractDocumentHash, manualSignatureProvider, type SignatureProvider } from "./signature";
import { contractDocumentData, contractDocx, contractPdf } from "./contract-document";
import { getSignatureSettings } from "./contract-templates";

/** Provedor em uso: Clicksign quando configurada; senão, o manual. */
export function activeSignatureProvider(): SignatureProvider {
  return clicksignConfigured() ? clicksignSignatureProvider : manualSignatureProvider;
}

const PHONE_AUTHS: SignatureAuthMethod[] = ["sms", "whatsapp"];

/** Celular de cada signatário (para código por SMS/WhatsApp): contatos do cliente e usuários do INTEROS. */
async function phonesFor(contract: Contract): Promise<Map<string, string>> {
  const [contacts, client, users] = await Promise.all([
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", contract.clientId]] }),
    getById<Client>(COLLECTIONS.clients, contract.clientId),
    list<User>(COLLECTIONS.users, { where: [["active", "==", true]] }),
  ]);
  const out = new Map<string, string>();
  const put = (email: string | undefined, ...numbers: (string | undefined)[]) => {
    const key = email?.trim().toLowerCase();
    const phone = numbers.map((n) => nationalNumber(n)).find((n) => n.length === 10 || n.length === 11);
    if (key && phone && !out.has(key)) out.set(key, phone);
  };
  for (const c of contacts) put(c.email, c.whatsapp, c.phone);
  for (const u of users) put(u.email, u.phone);
  if (client) put(client.email, client.whatsapp, client.phone);
  return out;
}

export const clicksignSignatureProvider: SignatureProvider = {
  name: "clicksign",

  async createEnvelope(contract, clientName, prepared) {
    // Confere antes de criar qualquer coisa na Clicksign (nome com sobrenome, celular quando a autenticação pede).
    for (const s of contract.signers) {
      const problem = clicksignSignerNameProblem(s.name);
      if (problem) throw new BusinessError(`Signatário «${s.name}»: ${problem}`);
    }
    const settings = await getSignatureSettings();
    const auth: SignatureAuthMethod = contract.signatureAuth ?? settings.defaultAuth;
    const phones = PHONE_AUTHS.includes(auth) ? await phonesFor(contract) : new Map<string, string>();
    if (PHONE_AUTHS.includes(auth)) {
      const missing = contract.signers.filter((s) => !phones.has(s.email.toLowerCase())).map((s) => s.name);
      if (missing.length) throw new BusinessError(`Código por ${auth === "sms" ? "SMS" : "WhatsApp"} precisa do celular de: ${missing.join(", ")}. Cadastre o celular no contato (ou use código por e-mail).`);
    }

    const data = prepared ?? (await contractDocumentData(contract.id, contract));
    if (!data) throw new BusinessError("Contrato não encontrado");
    const word = data.template?.kind === "word" ? await contractDocx(data) : null;
    const file = word ? { filename: word.fileName, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: word.buffer } : await contractPdf(data).then((p) => ({ filename: p.fileName, mimeType: "application/pdf", content: p.buffer }));

    let documentId = "";
    const signerIds: Record<string, string> = {};
    const envelopeId = await createEnvelope({
      name: `Contrato ${contract.number} v${contract.version} · ${clientName}`,
      defaultSubject: `Contrato ${contract.number} da ${data.companyName} para assinatura`,
      remindInterval: 3,
    });
    try {
      documentId = await addDocument(envelopeId, {
        filename: file.filename,
        mimeType: file.mimeType,
        content: file.content,
        // O envelope identifica o envio: avisos de um envio anterior (contrato reenviado) são ignorados.
        metadata: { interos_contract_id: contract.id, interos_number: contract.number, interos_version: String(contract.version), interos_envelope_id: envelopeId },
      });
      for (const s of contract.signers) {
        const email = s.email.trim().toLowerCase();
        const id = await addSigner(envelopeId, { name: s.name.trim(), email, phone: phones.get(email) });
        await addQualification(envelopeId, documentId, id, clicksignRole(s));
        await addAuthentication(envelopeId, documentId, id, auth);
        signerIds[email] = id;
      }
      await activateEnvelope(envelopeId);
    } catch (error) {
      // Não deixa rascunho perdido na Clicksign (só dá para apagar envelope em rascunho, antes de ativar).
      await clicksignApi(`/envelopes/${envelopeId}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
    // Ativado: o envio vale e fica gravado no contrato mesmo se o e-mail falhar agora (o lembrete reenvia o pedido).
    let notified = true;
    try {
      await notifyEnvelope(envelopeId);
    } catch (error) {
      notified = false;
      console.error("[clicksign] envelope ativado, mas o pedido de assinatura por e-mail falhou", error);
    }
    return { provider: "clicksign", envelopeId, documentId, signerIds, documentHash: contractDocumentHash(contract), sentAt: new Date().toISOString(), notified };
  },

  async sendReminder(contract, signerEmail) {
    const signer = contract.signers.find((s) => s.email.toLowerCase() === signerEmail.toLowerCase());
    if (!contract.signatureEnvelopeId || !signer?.providerSignerId) throw new BusinessError("Este envio não tem o signatário na Clicksign: gere o documento de novo para enviar pela Clicksign");
    await notifySigner(contract.signatureEnvelopeId, signer.providerSignerId);
    return { provider: "clicksign", envelopeId: contract.signatureEnvelopeId, email: signer.email, sentAt: new Date().toISOString(), message: `Lembrete de assinatura do contrato ${contract.number} v${contract.version} enviado pela Clicksign para ${signer.name} (${signer.email}).` };
  },

  async getStatus(contract) {
    return manualSignatureProvider.getStatus(contract);
  },
};

/** Resultado do cancelamento: "cancelado" (ou nada a cancelar), "finalizado" (já estava finalizado lá) ou "falhou". */
export type ClicksignCancelResult = "cancelado" | "finalizado" | "falhou";

/**
 * Cancela na Clicksign o documento de um envio que deixou de valer (contrato gerado de novo, nova versão, cancelado).
 * Melhor esforço. Recusado pela Clicksign (4xx), confere o documento: já cancelado → nada a fazer; FINALIZADO → o
 * chamador registra que ele foi concluído lá (todos assinaram ou finalizado manualmente), porque o aviso de finalização
 * desse envio passa a ser ignorado. Ainda em andamento ou sem resposta → "falhou" (alguém precisa cancelar lá).
 */
export async function cancelPreviousClicksignDocument(contract: Pick<Contract, "signatureProvider" | "signatureEnvelopeId" | "signatureDocumentId">): Promise<ClicksignCancelResult> {
  if (contract.signatureProvider !== "clicksign" || !contract.signatureEnvelopeId || !contract.signatureDocumentId || !clicksignConfigured()) return "cancelado";
  try {
    await cancelDocument(contract.signatureEnvelopeId, contract.signatureDocumentId);
    return "cancelado";
  } catch (error) {
    if (error instanceof ClicksignError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      const doc = await getDocument(contract.signatureEnvelopeId, contract.signatureDocumentId).catch(() => null);
      if (doc?.status === "closed") return "finalizado";
      if (doc && doc.status && doc.status !== "running") return "cancelado";
    }
    console.error("[assinatura] não cancelou o documento na Clicksign", error);
    return "falhou";
  }
}
