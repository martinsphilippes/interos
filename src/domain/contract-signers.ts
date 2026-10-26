/**
 * Signatários do contrato ligados aos contatos do cliente (regras puras, sem banco).
 *
 * - O signatário do cliente guarda o `contactId` do contato de onde veio: editar o contato atualiza o signatário
 *   enquanto o contrato ainda não foi enviado (`syncSignersFromContact`).
 * - Contrato refeito da mesma venda reaproveita os signatários do contrato cancelado, com os dados atuais dos
 *   contatos (`reuseSigners`).
 * - Avisos antes do envio: nome de teste, alguém da equipe assinando pelo cliente (`signerWarnings`).
 */
import { isCompanySigner, isSignerEmail, isWitnessSigner, samePersonName } from "./contract-templates";
import type { ContractSignerEntry } from "./types";

export interface SignerContact {
  id: string;
  name: string;
  email?: string;
}

const norm = (email: string | undefined) => (email ?? "").trim().toLowerCase();

/** Contato que é este signatário: pelo vínculo gravado ou, em signatário antigo sem vínculo, pelo e-mail (só se único). */
export function signerContact<C extends SignerContact>(signer: Pick<ContractSignerEntry, "email" | "contactId">, contacts: C[]): C | undefined {
  if (signer.contactId) {
    const linked = contacts.find((c) => c.id === signer.contactId);
    if (linked) return linked;
  }
  const email = norm(signer.email);
  const byEmail = contacts.filter((c) => norm(c.email) === email);
  return byEmail.length === 1 ? byEmail[0] : undefined;
}

/**
 * Signatários de um contrato cancelado para o contrato novo da mesma venda: todos voltam a "pendente", sem
 * assinatura, evidência nem id do provedor; quem está ligado a um contato (`contactId`) vem com o nome e o e-mail
 * atuais do contato; sem vínculo, fica como foi acertado no contrato. Quem assina pela Intercert fica de fora (vem da
 * configuração atual). E-mails que a assinatura não aceita e repetidos também ficam de fora.
 */
export function reuseSigners(previous: ContractSignerEntry[], contacts: SignerContact[]): ContractSignerEntry[] {
  const out: ContractSignerEntry[] = [];
  for (const s of previous) {
    if (isCompanySigner(s)) continue;
    const contact = s.contactId ? contacts.find((c) => c.id === s.contactId) : undefined;
    const fromContact = contact && isSignerEmail(contact.email ?? "") ? contact : undefined;
    const email = fromContact ? norm(fromContact.email) : norm(s.email);
    if (!isSignerEmail(email) || out.some((o) => o.email === email)) continue;
    out.push({
      name: (fromContact?.name ?? s.name).trim(),
      email,
      role: s.role,
      status: "pendente",
      ...(s.party ? { party: s.party } : {}),
      ...(fromContact ? { contactId: fromContact.id } : {}),
    });
  }
  return out;
}

/**
 * Contato editado → signatários que são esse contato (pelo vínculo ou, sem vínculo, pelo e-mail E nome antigos — quem
 * foi corrigido à mão no contrato não é sobrescrito) passam a ter o nome e o e-mail novos. Não mexe em quem já assinou, em quem assina pela Intercert, nem quando o e-mail novo é
 * inválido para assinatura ou já é de outro signatário.
 */
export function syncSignersFromContact(
  signers: ContractSignerEntry[],
  contact: { id: string; name: string; email?: string },
  previous: { name?: string; email?: string },
): { signers: ContractSignerEntry[]; changed: { from: { name: string; email: string }; to: { name: string; email: string } }[] } {
  const email = norm(contact.email);
  const old = norm(previous.email);
  const changed: { from: { name: string; email: string }; to: { name: string; email: string } }[] = [];
  if (!isSignerEmail(email)) return { signers, changed };
  const next = signers.map((s) => {
    const isThis = s.contactId ? s.contactId === contact.id : Boolean(old) && norm(s.email) === old && samePersonName(s.name, previous.name ?? "");
    if (!isThis || s.status === "assinado" || s.party === "contratada") return s;
    const name = contact.name.trim();
    if (s.name === name && norm(s.email) === email && s.contactId === contact.id) return s;
    if (norm(s.email) !== email && signers.some((o) => o !== s && norm(o.email) === email)) return s;
    changed.push({ from: { name: s.name, email: s.email }, to: { name, email } });
    // E-mail trocado: o id do signatário no provedor era do e-mail antigo.
    const { providerSignerId, ...rest } = s;
    return { ...rest, name, email, contactId: contact.id, ...(norm(s.email) === email && providerSignerId ? { providerSignerId } : {}) };
  });
  return { signers: changed.length > 0 ? next : signers, changed };
}

/** Palavras que denunciam cadastro de teste/rascunho no nome de quem assina. */
const PLACEHOLDER_WORDS = /^(teste|testes|test|tst|xxx+|asdf+|qwerty|fulano|fulana|ciclano|beltrano|exemplo|dummy|aaa+|abc)$/i;

export function looksLikePlaceholderName(name: string): boolean {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/i)
    .some((w) => PLACEHOLDER_WORDS.test(w));
}

export interface SignerWarning {
  email: string;
  message: string;
}

/**
 * Avisos sobre quem assina (não bloqueiam o envio, pedem confirmação): nome com cara de teste e pessoa da equipe
 * Intercert assinando pelo cliente (não é testemunha nem representante da Intercert, nem contato do cliente).
 */
export function signerWarnings(
  signers: Pick<ContractSignerEntry, "name" | "email" | "role" | "party" | "status" | "contactId">[],
  teamEmails: string[],
  contactEmails: string[] = [],
): SignerWarning[] {
  const team = new Set(teamEmails.map(norm));
  // Quem também é contato do cliente assina por ele de fato (ex.: sócio que tem usuário no sistema).
  const contacts = new Set(contactEmails.map(norm));
  const out: SignerWarning[] = [];
  for (const s of signers) {
    if (s.status === "assinado") continue;
    if (looksLikePlaceholderName(s.name)) out.push({ email: s.email, message: `«${s.name}» parece um nome de teste: confira quem assina antes de enviar` });
    if (!isCompanySigner(s) && !isWitnessSigner(s) && !s.contactId && !contacts.has(norm(s.email)) && team.has(norm(s.email))) {
      out.push({ email: s.email, message: `${s.name} é da equipe Intercert, mas está assinando como ${s.role}: quem assina pelo cliente deve ser um contato do cliente (se assina pela Intercert, defina em Financeiro › Assinaturas › Configuração)` });
    }
  }
  return out;
}

/** Há quem assine pelo cliente (nem Intercert, nem testemunha)? */
export function hasClientSigner(signers: Pick<ContractSignerEntry, "party" | "role">[]): boolean {
  return signers.some((s) => !isCompanySigner(s) && !isWitnessSigner(s));
}
