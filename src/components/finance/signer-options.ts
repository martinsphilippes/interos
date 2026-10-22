/**
 * Opções de quem pode assinar um contrato (regras puras, sem banco): contatos do cliente, equipe da Intercert e
 * "cadastrar novo contato". Quem já é signatário sai da lista; contato sem e-mail aparece, mas desabilitado (a
 * assinatura eletrônica é por e-mail). Nome sem sobrenome é marcado quando a Clicksign está ligada.
 */
import { clicksignSignerNameProblem } from "@/domain/contract-templates";

export interface SignerContactOption {
  id: string;
  name: string;
  email?: string;
  /** Cargo no cliente (ex.: Sócio-administrador). */
  role?: string;
  isPrimary?: boolean;
}

export interface SignerUserOption {
  id: string;
  name: string;
  email: string;
}

export interface SignerOptions {
  contacts: SignerContactOption[];
  users: SignerUserOption[];
}

export type SignerChoiceKind = "contact" | "user";

export interface SignerChoice {
  /** Valor do select: "contact:<id>" ou "user:<id>". */
  value: string;
  kind: SignerChoiceKind;
  name: string;
  email: string;
  /** Rótulo da opção no select. */
  label: string;
  /** Papel sugerido no contrato (editável). */
  suggestedRole: string;
  /** Motivo de não poder ser escolhido (sem e-mail), se houver. */
  disabledReason?: string;
  /** Problema no nome para a Clicksign (nome sem sobrenome, números), se houver. */
  nameProblem?: string;
}

export const NEW_CONTACT_VALUE = "novo";

/** Papel padrão de quem assina pelo cliente e de quem assina pela equipe (testemunha). */
export const DEFAULT_CLIENT_SIGNER_ROLE = "Contratante";
export const DEFAULT_TEAM_SIGNER_ROLE = "Testemunha";

export function signerChoices(options: SignerOptions, existing: { email: string }[], clicksign: boolean): { contacts: SignerChoice[]; users: SignerChoice[] } {
  const taken = new Set(existing.map((s) => s.email.trim().toLowerCase()));
  const problem = (name: string) => (clicksign ? (clicksignSignerNameProblem(name) ?? undefined) : undefined);
  const contacts = options.contacts
    .filter((c) => !c.email || !taken.has(c.email.trim().toLowerCase()))
    .map<SignerChoice>((c) => {
      const email = c.email?.trim().toLowerCase() ?? "";
      return {
        value: `contact:${c.id}`,
        kind: "contact",
        name: c.name.trim(),
        email,
        label: `${c.name.trim()}${c.role ? ` · ${c.role}` : ""}${email ? ` · ${email}` : " · sem e-mail"}`,
        suggestedRole: DEFAULT_CLIENT_SIGNER_ROLE,
        disabledReason: email ? undefined : "Contato sem e-mail: cadastre o e-mail na ficha do cliente",
        nameProblem: problem(c.name),
      };
    })
    .sort((a, b) => Number(Boolean(a.disabledReason)) - Number(Boolean(b.disabledReason)) || a.name.localeCompare(b.name, "pt-BR"));
  const users = options.users
    .filter((u) => !taken.has(u.email.trim().toLowerCase()))
    .map<SignerChoice>((u) => ({
      value: `user:${u.id}`,
      kind: "user",
      name: u.name.trim(),
      email: u.email.trim().toLowerCase(),
      label: `${u.name.trim()} · ${u.email.trim().toLowerCase()}`,
      suggestedRole: DEFAULT_TEAM_SIGNER_ROLE,
      nameProblem: problem(u.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { contacts, users };
}
