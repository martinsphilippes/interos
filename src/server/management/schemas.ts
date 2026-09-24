/**
 * Validação (zod), focos de drill-down e rótulos do módulo de Gestão. Módulo puro (sem Firestore):
 * usado pelas Server Actions, pelas queries e pelos Client Components.
 */
import { z } from "zod";

/** Focos da cadeia de drill-down: card do topo → colaboradores → itens do colaborador. */
export const FOCUS_KEYS = ["atrasadas", "sla", "etapas", "clientes", "metas"] as const;
export type FocusKey = (typeof FOCUS_KEYS)[number];

export const FOCUS_LABELS: Record<FocusKey, { title: string; memberColumn: string; empty: string }> = {
  atrasadas: { title: "Tarefas atrasadas", memberColumn: "Atrasadas", empty: "Nenhuma tarefa atrasada na equipe." },
  sla: { title: "SLAs em risco ou violados", memberColumn: "SLAs em risco", empty: "Nenhum SLA em risco ou violado na equipe." },
  etapas: { title: "Etapas de workflow paradas", memberColumn: "Etapas paradas", empty: "Nenhuma etapa parada ou aguardando aprovação." },
  clientes: { title: "Clientes críticos", memberColumn: "Clientes críticos", empty: "Nenhum cliente crítico na carteira da equipe." },
  metas: { title: "Metas em risco", memberColumn: "Metas críticas", empty: "Nenhum indicador em situação crítica." },
};

export function parseFocus(value: string | string[] | undefined): FocusKey | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (FOCUS_KEYS as readonly string[]).includes(v) ? (v as FocusKey) : undefined;
}

/** Etapa aberta sem movimentação há este número de dias é considerada parada. */
export const STALLED_STEP_DAYS = 3;
/** Carga (abertas ÷ média da equipe) acima deste valor fica vermelha. */
export const OVERLOAD_RATIO = 1.1;

export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Dados inválidos";
}

export const redistributeTasksSchema = z.object({
  fromUserId: z.string().trim().min(1, "Colaborador de origem inválido"),
  toUserId: z.string().trim().min(1, "Escolha o novo responsável"),
  taskIds: z.array(z.string().trim().min(1)).min(1, "Selecione ao menos uma tarefa").max(100, "Selecione no máximo 100 tarefas por vez"),
});
export type RedistributeTasksInput = z.input<typeof redistributeTasksSchema>;
