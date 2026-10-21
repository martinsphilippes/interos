import "server-only";
/**
 * Filas da Central de Atendimento.
 *
 * Na primeira leitura sem nenhuma fila, cria as filas padrão (ids fixos, idempotente) com os usuários ativos de cada
 * departamento como operadores — as antigas filas N1/N2 do Suporte viram as duas primeiras. Depois disso, quem edita
 * é o gestor na tela Canais e filas; nada é recriado (filas são desativadas, nunca apagadas).
 */
import { createIfAbsent, getById, list, update } from "@/server/db";
import { COLLECTIONS, type ConversationChannel, type ServiceQueue, type User } from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import { BusinessError } from "@/server/auth/error-classes";
import { patchFields } from "./store";

interface DefaultQueue {
  id: string;
  name: string;
  department: DepartmentKey;
  strategy: ServiceQueue["strategy"];
  /** Operadores = usuários ativos destes departamentos. */
  memberDepartments: DepartmentKey[];
  isDefault?: boolean;
}

export const DEFAULT_QUEUES: readonly DefaultQueue[] = [
  { id: "fila_suporte_n1", name: "Suporte N1", department: "suporte", strategy: "menor_carga", memberDepartments: ["suporte"] },
  { id: "fila_suporte_n2", name: "Suporte N2", department: "suporte", strategy: "manual", memberDepartments: [] },
  { id: "fila_financeiro", name: "Financeiro e boletos", department: "financeiro", strategy: "rodizio", memberDepartments: ["financeiro"] },
  { id: "fila_comercial", name: "Comercial", department: "vendas", strategy: "responsavel_primeiro", memberDepartments: ["vendas"] },
  { id: "fila_geral", name: "Atendimento geral", department: "administrativo", strategy: "rodizio", memberDepartments: ["administrativo"], isDefault: true },
];

const CHANNELS: ConversationChannel[] = ["whatsapp", "email"];

async function createDefaultQueues(): Promise<void> {
  const users = (await list<User>(COLLECTIONS.users)).filter((u) => u.active !== false && u.role !== "admin");
  for (const [index, q] of DEFAULT_QUEUES.entries()) {
    const memberIds = users.filter((u) => q.memberDepartments.includes(u.departmentId)).map((u) => u.id);
    await createIfAbsent<ServiceQueue>(COLLECTIONS.serviceQueues, q.id, {
      name: q.name,
      department: q.department,
      channels: [...CHANNELS],
      memberIds,
      strategy: q.strategy,
      maxConcurrent: 4,
      isDefault: q.isDefault,
      overflowQueueId: q.isDefault || q.strategy === "manual" ? undefined : "fila_geral",
      overflowAfterMinutes: q.isDefault || q.strategy === "manual" ? undefined : 10,
      active: true,
      order: index + 1,
    });
  }
}

/** Todas as filas (ativas e inativas), na ordem de exibição. Cria as padrão na primeira vez. */
export async function listQueues(): Promise<ServiceQueue[]> {
  let queues = await list<ServiceQueue>(COLLECTIONS.serviceQueues);
  if (queues.length === 0) {
    await createDefaultQueues();
    queues = await list<ServiceQueue>(COLLECTIONS.serviceQueues);
  }
  return queues.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
}

export async function listActiveQueues(): Promise<ServiceQueue[]> {
  return (await listQueues()).filter((q) => q.active);
}

export async function getQueue(id: string): Promise<ServiceQueue | null> {
  return getById<ServiceQueue>(COLLECTIONS.serviceQueues, id);
}

/** Filas em que a pessoa é operadora. */
export function queuesOf(queues: readonly ServiceQueue[], userId: string): ServiceQueue[] {
  return queues.filter((q) => q.active && q.memberIds.includes(userId));
}

export interface ChooseQueueContext {
  channel: ConversationChannel;
  identity: "cliente" | "lead" | "desconhecido";
  /** Há chamado aberto do cliente. */
  hasOpenTicket: boolean;
}

/**
 * Fila de entrada da conversa (fase 1, sem menu de boas-vindas): chamado aberto → Suporte; lead → Comercial;
 * demais → fila padrão. Sempre uma fila ativa que atende o canal; sem nenhuma, undefined.
 */
export function chooseQueue(queues: readonly ServiceQueue[], ctx: ChooseQueueContext): ServiceQueue | undefined {
  const usable = queues.filter((q) => q.active && q.channels.includes(ctx.channel));
  const byDepartment = (d: DepartmentKey) => usable.find((q) => q.department === d && q.strategy !== "manual") ?? usable.find((q) => q.department === d);
  const fallback = usable.find((q) => q.isDefault) ?? usable[0];
  if (ctx.hasOpenTicket) return byDepartment("suporte") ?? fallback;
  if (ctx.identity === "lead") return byDepartment("vendas") ?? fallback;
  return fallback;
}

export interface SaveQueueInput {
  id?: string;
  name: string;
  department: DepartmentKey;
  channels: ConversationChannel[];
  memberIds: string[];
  strategy: ServiceQueue["strategy"];
  maxConcurrent: number;
  slaRuleKey?: string;
  overflowQueueId?: string;
  overflowAfterMinutes?: number;
  isDefault: boolean;
  active: boolean;
}

/** Cria ou edita uma fila. Regras: uma única fila padrão, sempre ativa; transbordo não aponta para si mesma. */
export async function saveQueue(input: SaveQueueInput): Promise<ServiceQueue> {
  const queues = await listQueues();
  const current = input.id ? queues.find((q) => q.id === input.id) : undefined;
  if (input.id && !current) throw new BusinessError("Fila não encontrada");
  if (input.overflowQueueId && input.overflowQueueId === input.id) throw new BusinessError("A fila não pode transbordar para ela mesma");
  if (input.overflowQueueId && !queues.some((q) => q.id === input.overflowQueueId && q.active)) throw new BusinessError("Fila de transbordo inválida ou inativa");
  if (current?.isDefault && !input.isDefault) throw new BusinessError("Escolha outra fila como padrão antes de tirar esta");
  if (input.isDefault && !input.active) throw new BusinessError("A fila padrão precisa ficar ativa");
  const users = await list<User>(COLLECTIONS.users);
  const valid = new Set(users.filter((u) => u.active !== false).map((u) => u.id));
  const memberIds = Array.from(new Set(input.memberIds.filter((id) => valid.has(id))));

  const data = {
    name: input.name.trim(),
    department: input.department,
    channels: input.channels,
    memberIds,
    strategy: input.strategy,
    maxConcurrent: input.maxConcurrent,
    slaRuleKey: input.slaRuleKey || undefined,
    overflowQueueId: input.overflowQueueId || undefined,
    overflowAfterMinutes: input.overflowQueueId ? input.overflowAfterMinutes : undefined,
    isDefault: input.isDefault || undefined,
    active: input.active,
  };
  let saved: ServiceQueue;
  if (current) {
    await patchFields<ServiceQueue>(COLLECTIONS.serviceQueues, current.id, data);
    saved = { ...current, ...data };
  } else {
    const id = `fila_${Date.now().toString(36)}`;
    const created = await createIfAbsent<ServiceQueue>(COLLECTIONS.serviceQueues, id, { ...data, order: queues.length + 1 });
    saved = created.doc;
  }
  // Uma única fila padrão.
  if (input.isDefault) {
    for (const q of queues) if (q.id !== saved.id && q.isDefault) await update<ServiceQueue>(COLLECTIONS.serviceQueues, q.id, { isDefault: false });
  }
  return saved;
}

/** Tira o usuário de todas as filas (usuário desativado). */
export async function removeFromAllQueues(userId: string): Promise<number> {
  const queues = await list<ServiceQueue>(COLLECTIONS.serviceQueues);
  let changed = 0;
  for (const q of queues) {
    if (!q.memberIds.includes(userId)) continue;
    await update<ServiceQueue>(COLLECTIONS.serviceQueues, q.id, { memberIds: q.memberIds.filter((id) => id !== userId) });
    changed += 1;
  }
  return changed;
}
