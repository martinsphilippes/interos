/**
 * Contexto compartilhado entre os módulos do seed. Cada módulo preenche a parte que gera e
 * os seguintes leem daqui (nunca do Firestore) o que precisam.
 */
import type {
  Client,
  ClientProduct,
  Contact,
  Contract,
  ImplementationProject,
  ImplementationTemplate,
  Lead,
  Opportunity,
  Product,
  SupportTicket,
  Task,
  User,
  WorkflowStep,
  WorkflowTemplate,
} from "../../src/domain/types";
import type { JourneyStage } from "../../src/domain/constants";
import type { City, Segment, Store } from "./lib";

export type UserKey =
  | "hercules" | "philippe" | "mateus" | "luciano" | "igor" | "vinicius" | "karem" | "anapaula"
  | "lando" | "marcos" | "bruno" | "felipe" | "camila" | "rafael" | "larissa";

/** Marcos da jornada de um cliente (ISO). Só existem os que já aconteceram. */
export interface Journey {
  leadAt: string;
  qualifiedAt?: string;
  opportunityAt?: string;
  proposalAt?: string;
  wonAt?: string;
  contractAt?: string;
  signedAt?: string;
  paidAt?: string;
  releasedAt?: string;
  implementationStartAt?: string;
  trainingAt?: string;
  goLiveAt?: string;
  activatedAt?: string;
  cancelledAt?: string;
}

export interface SeededClient {
  doc: Client;
  city: City;
  segment: Segment;
  journey: Journey;
  contacts: Contact[];
  products: ClientProduct[];
  /** Etapa atual da jornada (igual a doc.currentStage). */
  stage: JourneyStage;
}

export interface SeedContext {
  store: Store;
  users: Record<UserKey, User>;
  products: Record<string, Product>;
  templates: Record<string, ImplementationTemplate>;
  workflowTemplate: WorkflowTemplate;
  clients: SeededClient[];
  leads: Lead[];
  opportunities: Opportunity[];
  contracts: Contract[];
  projects: ImplementationProject[];
  tickets: SupportTicket[];
  steps: WorkflowStep[];
  tasks: Task[];
  holidays: Set<string>;
}

export function userRef(u: User): { id: string; name: string } {
  return { id: u.id, name: u.name };
}

export function clientById(ctx: SeedContext, clientId: string): SeededClient {
  const c = ctx.clients.find((x) => x.doc.id === clientId);
  if (!c) throw new Error(`Cliente não encontrado no contexto: ${clientId}`);
  return c;
}
