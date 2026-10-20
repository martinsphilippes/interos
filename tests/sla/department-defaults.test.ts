/**
 * SLA padrão por departamento (regra `tarefa.<departamento>`): chaves, validação da regra e aplicação na criação de
 * tarefas (só tarefa aberta, sem SLA próprio, com regra ativa de tarefas; quem inicia SLA próprio pode recusar) e dono
 * do SLA acompanhando o responsável da tarefa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEPARTMENT_KEYS } from "@/domain/constants";
import { departmentOfTaskSlaKey, departmentTaskSlaKey } from "@/domain/sla-defaults";
import { slaRuleSchema } from "@/server/admin/schemas";

// ---------------------------------------------------------------------------
// Banco e eventos em memória
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>[]>(), seq: 0, events: [] as Record<string, unknown>[], DELETE: Symbol("delete") }));

vi.mock("@/server/db", () => {
  type Row = Record<string, unknown>;
  const rows = (name: string): Row[] => {
    if (!store.data.has(name)) store.data.set(name, []);
    return store.data.get(name)!;
  };
  const match = (row: Row, [field, op, value]: [string, string, unknown]) => (op === "==" ? row[field] === value : false);
  return {
    ORG_ID: "intercert",
    nowIso: () => "2026-10-20T13:00:00.000Z",
    list: async (name: string, options: { where?: [string, string, unknown][] } = {}) => rows(name).filter((r) => (options.where ?? []).every((w) => match(r, w))),
    getById: async (name: string, id: string) => rows(name).find((r) => r.id === id) ?? null,
    create: async (name: string, data: Row) => {
      const row = { ...data, id: `${name}_${++store.seq}`, createdAt: "2026-10-20T13:00:00.000Z", updatedAt: "2026-10-20T13:00:00.000Z" };
      rows(name).push(row);
      return row;
    },
    update: async (name: string, id: string, patch: Row) => {
      const row = rows(name).find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
    batchSet: async () => undefined,
    col: (name: string) => ({
      doc: (id: string) => ({
        update: async (patch: Row) => {
          const row = rows(name).find((r) => r.id === id);
          if (!row) return;
          for (const [k, v] of Object.entries(patch)) {
            if (v === store.DELETE) delete row[k];
            else row[k] = v;
          }
        },
      }),
    }),
  };
});
vi.mock("@/server/docdb", () => ({ FieldValue: { delete: () => store.DELETE } }));
vi.mock("@/server/events", () => ({ emitEvent: async (e: Record<string, unknown>) => void store.events.push(e) }));

const { assignTaskInternal, createTaskInternal, syncTaskSlaOwner } = await import("@/server/tasks/service");

const ACTOR = { id: "user_hercules", name: "Hércules" };
const rule = (department: string, extra: Record<string, unknown> = {}) => ({
  id: `sla_tarefa_${department}`,
  key: departmentTaskSlaKey(department as never),
  name: `Tarefas — ${department}`,
  appliesTo: "tarefa",
  department,
  resolutionHours: 8,
  businessHoursOnly: false,
  attentionPct: 50,
  riskPct: 80,
  active: true,
  ...extra,
});
const tasks = () => store.data.get("tasks") ?? [];
const instances = () => store.data.get("sla_instances") ?? [];

beforeEach(() => {
  store.data = new Map<string, Record<string, unknown>[]>([
    ["sla_rules", [rule("suporte"), rule("vendas", { active: false })]],
    [
      "users",
      [
        { id: "user_rafael", name: "Rafael", active: true },
        { id: "user_larissa", name: "Larissa", active: true },
      ],
    ],
  ]);
  store.events = [];
});

describe("chaves do SLA padrão", () => {
  it("cada departamento tem a sua chave e a chave volta ao departamento", () => {
    for (const d of DEPARTMENT_KEYS) expect(departmentOfTaskSlaKey(departmentTaskSlaKey(d))).toBe(d);
    expect(departmentOfTaskSlaKey("tarefa.padrao")).toBeNull();
    expect(departmentOfTaskSlaKey("suporte.alta")).toBeNull();
  });

  it("a regra tarefa.<departamento> exige «Tarefa» e o mesmo departamento", () => {
    const base = { name: "Tarefas — Suporte", resolutionHours: 8, businessHoursOnly: true, attentionPct: 50, riskPct: 80, active: true };
    expect(slaRuleSchema.safeParse({ ...base, key: "tarefa.suporte", appliesTo: "tarefa", department: "suporte" }).success).toBe(true);
    expect(slaRuleSchema.safeParse({ ...base, key: "tarefa.suporte", appliesTo: "chamado", department: "suporte" }).success).toBe(false);
    expect(slaRuleSchema.safeParse({ ...base, key: "tarefa.suporte", appliesTo: "tarefa", department: "vendas" }).success).toBe(false);
    expect(slaRuleSchema.safeParse({ ...base, key: "tarefa.padrao", appliesTo: "tarefa" }).success).toBe(true);
  });
});

describe("aplicação na criação de tarefas", () => {
  it("tarefa do departamento com regra ativa ganha o SLA padrão e prazo = vencimento do SLA", async () => {
    const task = await createTaskInternal({ title: "Retornar cliente", departmentId: "suporte", assigneeId: undefined }, ACTOR);
    expect(instances()).toHaveLength(1);
    const sla = instances()[0];
    expect(sla).toMatchObject({ ruleKey: "tarefa.suporte", entityType: "tarefa", entityId: task.id, department: "suporte" });
    expect(task.slaInstanceId).toBe(sla.id);
    expect(task.dueAt).toBe(sla.dueAt);
    expect(store.events.some((e) => e.type === "sla.started")).toBe(true);
  });

  it("data de entrega informada é mantida; o SLA corre em paralelo", async () => {
    const task = await createTaskInternal({ title: "Ligar", departmentId: "suporte", dueAt: "2026-10-30T12:00:00.000Z" }, ACTOR);
    expect(task.dueAt).toBe("2026-10-30T12:00:00.000Z");
    expect(task.slaInstanceId).toBeTruthy();
  });

  it("sem regra, com regra desativada, tarefa concluída ou SLA próprio: nada muda", async () => {
    await createTaskInternal({ title: "Sem regra", departmentId: "financeiro" }, ACTOR);
    await createTaskInternal({ title: "Regra desativada", departmentId: "vendas" }, ACTOR);
    await createTaskInternal({ title: "Já concluída", departmentId: "suporte", status: "concluida" }, ACTOR);
    await createTaskInternal({ title: "Passo com horas", departmentId: "suporte", departmentSla: false }, ACTOR);
    await createTaskInternal({ title: "SLA já ligado", departmentId: "suporte", slaInstanceId: "sla_existente" }, ACTOR);
    expect(instances()).toHaveLength(0);
    expect(tasks().every((t) => !t.slaInstanceId || t.slaInstanceId === "sla_existente")).toBe(true);
  });

  it("regra de outro tipo com a chave do departamento não vale para tarefas", async () => {
    store.data.set("sla_rules", [rule("suporte", { appliesTo: "chamado" })]);
    await createTaskInternal({ title: "Tarefa", departmentId: "suporte" }, ACTOR);
    expect(instances()).toHaveLength(0);
  });
});

describe("dono do SLA acompanha o responsável", () => {
  it("reatribuir a tarefa passa o SLA para o novo responsável", async () => {
    const task = await createTaskInternal({ title: "Chamado", departmentId: "suporte", assigneeId: "user_rafael" }, ACTOR);
    expect(instances()[0].ownerId).toBe("user_rafael");
    await assignTaskInternal(task, "user_larissa", ACTOR);
    expect(instances()[0].ownerId).toBe("user_larissa");
  });

  it("tirar o responsável deixa o SLA sem dono", async () => {
    const task = await createTaskInternal({ title: "Chamado", departmentId: "suporte", assigneeId: "user_rafael" }, ACTOR);
    await syncTaskSlaOwner(task, undefined);
    expect(instances()[0]).not.toHaveProperty("ownerId");
  });

  it("SLA de tarefa concluída fica com quem a encerrou", async () => {
    const task = await createTaskInternal({ title: "Chamado", departmentId: "suporte", assigneeId: "user_rafael" }, ACTOR);
    await assignTaskInternal({ ...task, status: "concluida" }, "user_larissa", ACTOR);
    expect(instances()[0].ownerId).toBe("user_rafael");
  });
});
