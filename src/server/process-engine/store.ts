import "server-only";
/**
 * Acesso às coleções dos processos (process_definitions, process_runs).
 */
import { col, getById, list, stripUndefined } from "@/server/db";
import { COLLECTIONS } from "@/domain/types";
import type { ProcessDefinition, ProcessRun } from "@/domain/workflow-graph";

export const DEFINITIONS = COLLECTIONS.processDefinitions;
export const RUNS = COLLECTIONS.processRuns;

export function getDefinition(id: string): Promise<ProcessDefinition | null> {
  return getById<ProcessDefinition>(DEFINITIONS, id);
}

export function listDefinitions(where: Parameters<typeof list>[1] = {}): Promise<ProcessDefinition[]> {
  return list<ProcessDefinition>(DEFINITIONS, where);
}

export function getRun(id: string): Promise<ProcessRun | null> {
  return getById<ProcessRun>(RUNS, id);
}

export function listRuns(where: Parameters<typeof list>[1] = {}): Promise<ProcessRun[]> {
  return list<ProcessRun>(RUNS, where);
}

/** Grava a execução inteira (sem merge): mapas como `pending` e `outcomes` precisam perder chaves removidas. */
export async function persistRun(run: ProcessRun): Promise<void> {
  const { id, ...data } = run;
  await col(RUNS)
    .doc(id)
    .set(stripUndefined({ ...data, updatedAt: new Date().toISOString() }));
}

/** Cria a execução apenas se o ID ainda não existe (idempotência por definição + entidade). */
export async function createRunIfAbsent(run: ProcessRun): Promise<boolean> {
  const { id, ...data } = run;
  try {
    await col(RUNS).doc(id).create(stripUndefined(data));
    return true;
  } catch (error) {
    // 6 = ALREADY_EXISTS (gRPC)
    if ((error as { code?: number }).code === 6 || /already exists/i.test(String((error as Error).message))) return false;
    throw error;
  }
}
