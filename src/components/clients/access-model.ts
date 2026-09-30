/**
 * Acesso na Ficha 360º e na base de clientes: seções (abas `?aba=`) visíveis e ações permitidas, calculadas no
 * SERVIDOR (can) e entregues por props. Módulo puro (servidor e cliente). Só esconde controles: as Server Actions
 * revalidam cada permissão e o escopo do registro.
 */
import type { ClientTab } from "./client-tabs";

/** Seções da ficha: as abas + o cartão de contatos da Visão geral. */
export type ClientSection = ClientTab | "contatos";

export type ClientSectionAccess = Record<ClientSection, boolean>;

export interface ClientCapabilities {
  create: boolean;
  edit: boolean;
  changeStatus: boolean;
  contactsEdit: boolean;
  contactsRemove: boolean;
  /** Registrar nota, ligação ou WhatsApp. */
  register: boolean;
  attachDocument: boolean;
  createOpportunity: boolean;
  /** Criar tarefa (Central de Tarefas). */
  createTask: boolean;
  /** Abrir a jornada no Workflow. */
  openWorkflow: boolean;
}

export const ALL_CLIENT_SECTIONS: ClientSectionAccess = {
  visao: true,
  contatos: true,
  produtos: true,
  financeiro: true,
  suporte: true,
  tarefas: true,
  timeline: true,
  documentos: true,
  comercial: true,
  implantacao: true,
  cs: true,
};

export const ALL_CLIENT_CAPABILITIES: ClientCapabilities = {
  create: true,
  edit: true,
  changeStatus: true,
  contactsEdit: true,
  contactsRemove: true,
  register: true,
  attachDocument: true,
  createOpportunity: true,
  createTask: true,
  openWorkflow: true,
};
