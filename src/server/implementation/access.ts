/**
 * Autorização da Implantação (catálogo src/domain/permissions/implantacao.ts). Só no servidor: páginas, queries e
 * Server Actions. Os Client Components recebem o resultado por props (capacidades e seções) e só escondem controles;
 * as actions revalidam sempre (requirePermission + escopo do registro).
 *
 * Escopo (A7/A23/A29): dono de um projeto = responsável (`ownerId`) OU membro da equipe (`teamIds`); de um
 * treinamento = instrutor OU donos do projeto. Padrão "empresa" para todos (comportamento anterior); a restrição
 * configurada pelo CEO/CTO vale nas listas, no detalhe e nas actions sobre um registro.
 */
import "server-only";
import type { EffectivePermissions, PermissionKey } from "@/domain/permissions";
import { COLLECTIONS, type CurrentUser, type ImplementationTask, type Training } from "@/domain/types";
import { getById } from "@/server/db";
import { can, type PermissionHolder } from "@/server/auth/permissions";
import { PermissionError } from "@/server/auth/error-classes";
import { canSeeRecord, resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import type { ImplementationCapabilities } from "@/components/implementation/access-model";
import type { ProjectRecord } from "./schemas";

/** Telas da Implantação com escopo de dados (kanban, treinamentos e go-live seguem o escopo de Projetos). */
export type ImplementationScreen = "implantacao.projetos" | "implantacao.kanban" | "implantacao.treinamentos" | "implantacao.go-live";

/**
 * Quem opera a implantação (Suporte e CS apenas consultam): equipe de implantação e gestores — COM o módulo.
 * Fachada de `implantacao.projetos.atribuir` (as operações de implantação têm a mesma regra padrão). Semântica
 * ampliada em relação ao predicado antigo, que não incluía o módulo: papéis sem o módulo lotados no departamento
 * implantação (vendas, marketing, financeiro, colaborador) passam a false. Mantida por compatibilidade: páginas e
 * actions usam as chaves do catálogo (implementationCapabilities / requirePermission).
 */
export function canOperateImplementation(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string; permissions?: EffectivePermissions }): boolean {
  return can(user as PermissionHolder, "implantacao.projetos.atribuir");
}

// ---------------------------------------------------------------------------
// Capacidades (botões e controles) e seções (abas) — calculadas no servidor
// ---------------------------------------------------------------------------

/** Chave do catálogo de cada capacidade da interface. */
export const IMPLEMENTATION_CAPABILITY_KEYS = {
  assignTeam: "implantacao.projetos.atribuir",
  addTask: "implantacao.projetos.plano.criar",
  completeTask: "implantacao.projetos.plano.concluir",
  reopenTask: "implantacao.projetos.plano.reabrir",
  assignTask: "implantacao.projetos.plano.atribuir",
  addChecklistItem: "implantacao.projetos.checklist.criar",
  toggleChecklist: "implantacao.projetos.checklist.concluir",
  registerPending: "implantacao.projetos.pendencias.criar",
  resolvePending: "implantacao.projetos.pendencias.concluir",
  attachDocument: "implantacao.projetos.documentos.anexar",
  movePhase: "implantacao.kanban.editar",
  scheduleTraining: "implantacao.treinamentos.criar",
  completeTraining: "implantacao.treinamentos.concluir",
  cancelTraining: "implantacao.treinamentos.cancelar",
  createTemplate: "implantacao.checklists.criar",
  editTemplate: "implantacao.checklists.editar",
  toggleTemplate: "implantacao.checklists.ativar",
  validateGoLive: "implantacao.go-live.validar",
  registerAcceptance: "implantacao.go-live.registrar-aceite",
  approveGoLive: "implantacao.go-live.aprovar",
  configureGoLive: "implantacao.go-live.configurar",
} as const satisfies Record<keyof ImplementationCapabilities, PermissionKey>;

/** O que o usuário pode fazer na Implantação (padrão = requireOperator de antes; configurar = gestores). */
export function implementationCapabilities(user: PermissionHolder): ImplementationCapabilities {
  const out = {} as ImplementationCapabilities;
  for (const [cap, key] of Object.entries(IMPLEMENTATION_CAPABILITY_KEYS) as [keyof ImplementationCapabilities, PermissionKey][]) out[cap] = can(user, key);
  return out;
}

/** Seções (abas e blocos) da tela de projetos. */
export const PROJECT_SECTION_KEYS = {
  indicators: "implantacao.projetos.indicadores.ver",
  saleData: "implantacao.projetos.dados-da-venda.ver",
  plan: "implantacao.projetos.plano.ver",
  checklist: "implantacao.projetos.checklist.ver",
  trainings: "implantacao.projetos.treinamentos.ver",
  pending: "implantacao.projetos.pendencias.ver",
  documents: "implantacao.projetos.documentos.ver",
  history: "implantacao.projetos.historico.ver",
  goLive: "implantacao.projetos.go-live.ver",
  suggestions: "implantacao.projetos.sugestoes.ver",
} as const satisfies Record<string, PermissionKey>;

export type ProjectSections = Record<keyof typeof PROJECT_SECTION_KEYS, boolean>;

/** Seções da tela de projetos visíveis ao usuário (padrão: todas para quem entra na tela). */
export function projectSections(user: PermissionHolder): ProjectSections {
  const out = {} as ProjectSections;
  for (const [section, key] of Object.entries(PROJECT_SECTION_KEYS) as [keyof ProjectSections, PermissionKey][]) out[section] = can(user, key);
  return out;
}

// ---------------------------------------------------------------------------
// Escopo por registro
// ---------------------------------------------------------------------------

/** Donos de um projeto: responsável e equipe. */
export function projectOwners(project: Pick<ProjectRecord, "ownerId" | "teamIds">): string[] {
  return [project.ownerId, ...(project.teamIds ?? [])];
}

/** Donos de um treinamento: instrutor e donos do projeto (quando houver). */
export function trainingOwners(training: Pick<Training, "instructorId">, project?: Pick<ProjectRecord, "ownerId" | "teamIds"> | null): string[] {
  return [training.instructorId, ...(project ? projectOwners(project) : [])];
}

const unrestricted = (scope: Pick<DataScope, "userIds" | "departmentKeys">) => !scope.userIds && !scope.departmentKeys;

/** O usuário vê este projeto na tela? (detalhe por id: tela + escopo) */
export async function canSeeProject(user: CurrentUser, project: Pick<ProjectRecord, "ownerId" | "teamIds">, screen: ImplementationScreen = "implantacao.projetos"): Promise<boolean> {
  return canSeeRecord(user, screen, projectOwners(project));
}

/**
 * Action sobre um projeto: fora do escopo da tela → PermissionError. Com escopo "empresa" (padrão) não lê nada;
 * projeto inexistente segue para o serviço (que responde "não encontrado").
 */
export async function assertProjectAccess(user: CurrentUser, projectId: string, screen: ImplementationScreen = "implantacao.projetos"): Promise<void> {
  const scope = await resolveDataScope(user, screen);
  if (unrestricted(scope)) return;
  const project = await getById<ProjectRecord>(COLLECTIONS.implementationProjects, projectId);
  if (project && !scopeAllows(scope, projectOwners(project))) throw new PermissionError();
}

/** Action sobre uma tarefa do plano: vale o escopo do projeto dela. */
export async function assertTaskAccess(user: CurrentUser, taskId: string): Promise<void> {
  const scope = await resolveDataScope(user, "implantacao.projetos");
  if (unrestricted(scope)) return;
  const task = await getById<ImplementationTask>(COLLECTIONS.implementationTasks, taskId);
  if (task) await assertProjectAccess(user, task.projectId, "implantacao.projetos");
}

/** Action sobre um treinamento: instrutor ou donos do projeto dentro do escopo de Treinamentos. */
export async function assertTrainingAccess(user: CurrentUser, trainingId: string): Promise<void> {
  const scope = await resolveDataScope(user, "implantacao.treinamentos");
  if (unrestricted(scope)) return;
  const training = await getById<Training>(COLLECTIONS.trainings, trainingId);
  if (!training) return;
  const project = training.projectId ? await getById<ProjectRecord>(COLLECTIONS.implementationProjects, training.projectId) : null;
  if (!scopeAllows(scope, trainingOwners(training, project))) throw new PermissionError();
}
