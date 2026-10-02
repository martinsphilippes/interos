import "server-only";
/**
 * Autorização dos títulos a receber AVULSOS (etapa CP/CR 3). Catálogo: tela financeiro.contas-a-receber, seção
 * "Títulos avulsos" (financeiro.contas-a-receber.avulsos.ver, aba ?aba=avulsos) e ações
 * financeiro.contas-a-receber.avulsos.{criar,editar,receber,desfazer-recebimento,cancelar} (+ editar-serie/cancelar-serie,
 * etapa CP/CR 5) — padrão = quem opera as cobranças hoje (gestores, papel ou departamento Financeiro).
 *
 * Escopo: o título avulso não tem dono (não há contrato nem vendedor). Como os títulos de fornecedor em Contas a Pagar,
 * ele só aparece com o escopo "empresa" da tela Contas a Receber (padrão de todos os papéis hoje); escopo menor = nenhum
 * título avulso. Registro fora do escopo: a página não abre o painel; a action lança PermissionError.
 * Quantias sob "Visualizar valores" (financeiro.valores.ver): sem a chave o servidor não envia valores ("Restrito") e as
 * ações de recebimento ficam ocultas (exigem digitar valor).
 */
import { cache } from "react";
import { can } from "@/server/auth/permissions";
import { BusinessError, PermissionError } from "@/server/auth/error-classes";
import { resolveDataScope } from "@/server/auth/scope";
import { canSeeFinanceValues } from "@/server/finance/access";
import { getById } from "@/server/db";
import { COLLECTIONS, type CurrentUser, type Receivable } from "@/domain/types";

export const RECEIVABLES_SECTION = "financeiro.contas-a-receber.avulsos.ver" as const;
export const RECEIVABLE_DENIED = "Este título a receber está fora do seu escopo de acesso";

/** Vê os títulos avulsos: seção da aba + escopo empresa em Contas a Receber. */
export const receivablesVisible = cache(async (user: CurrentUser): Promise<boolean> => {
  if (!can(user, RECEIVABLES_SECTION)) return false;
  const scope = await resolveDataScope(user, "financeiro.contas-a-receber");
  return scope.kind === "empresa" || scope.kind === "unidades";
});

/** Título existente e visível; fora do escopo = PermissionError; inexistente = BusinessError. */
export async function assertReceivableAccess(user: CurrentUser, receivableId: string): Promise<Receivable> {
  const r = await getById<Receivable>(COLLECTIONS.receivables, receivableId);
  if (!r) throw new BusinessError("Título a receber não encontrado");
  if (!(await receivablesVisible(user))) throw new PermissionError(RECEIVABLE_DENIED);
  return r;
}

/** Criar exige ver a aba no escopo empresa (o título criado precisa ficar visível a quem criou). */
export async function assertCanCreateReceivable(user: CurrentUser): Promise<void> {
  if (!(await receivablesVisible(user))) throw new PermissionError("Seu escopo em Contas a Receber não inclui os títulos avulsos");
}

export interface ReceivableCapabilities {
  create: boolean;
  edit: boolean;
  receive: boolean;
  undo: boolean;
  cancel: boolean;
  /** Edição e cancelamento em série (etapa CP/CR 5): exigem também editar/cancelar o título. */
  editSeries: boolean;
  cancelSeries: boolean;
  /** "Visualizar valores" (A13): sem ela, quantias "Restrito" e nada de recebimento pela tela. */
  values: boolean;
}

export function receivableCapabilities(user: CurrentUser): ReceivableCapabilities {
  const values = canSeeFinanceValues(user);
  const edit = can(user, "financeiro.contas-a-receber.avulsos.editar");
  const cancel = can(user, "financeiro.contas-a-receber.avulsos.cancelar");
  return {
    create: can(user, "financeiro.contas-a-receber.avulsos.criar") && values,
    edit,
    receive: can(user, "financeiro.contas-a-receber.avulsos.receber") && values,
    undo: can(user, "financeiro.contas-a-receber.avulsos.desfazer-recebimento"),
    cancel,
    editSeries: edit && can(user, "financeiro.contas-a-receber.avulsos.editar-serie"),
    cancelSeries: cancel && can(user, "financeiro.contas-a-receber.avulsos.cancelar-serie"),
    values,
  };
}
