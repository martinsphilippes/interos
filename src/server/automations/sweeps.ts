import "server-only";
/**
 * Varreduras nativas do motor de automações: funções nomeadas e registradas em `SWEEPS`, chamadas
 * pelo scheduler (runSweeps) conforme a frequência de cada uma. Reaproveitam os serviços dos módulos
 * sempre que existem (vendas, CS, suporte) e gravam também os campos de controle que esses módulos já
 * usam em `settings/sweeps` (followupLastRunAt, csHealthLastRunAt, csRenewalsLastRunAt,
 * supportSlaLastRunAt), para que as telas não repitam a mesma varredura logo em seguida.
 *
 * Os serviços são importados dinamicamente: evitam ciclo de módulos com o registro de handlers.
 */
import { create, getManyByIds, list, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { computeSlaState } from "@/server/sla";
import { createTaskInternal, nextOccurrenceDueAt } from "@/server/tasks/service";
import { dateKey, formatDate, formatDateTime } from "@/lib/format";
import {
  COLLECTIONS,
  type Client,
  type CsAccount,
  type ImplementationProject,
  type Lead,
  type Notification,
  type Opportunity,
  type Settings,
  type SlaInstance,
  type Task,
  type WorkflowStep,
} from "@/domain/types";
import { AUTOMATION_ACTOR, cachedUsers, managerOf } from "./actions-registry";
import type { SweepKey } from "./schemas";

export interface SweepOutcome {
  summary: string;
  data: Record<string, unknown>;
}

type SweepFn = (now: Date) => Promise<SweepOutcome>;

const DAY_MS = 86_400_000;
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

// ---------------------------------------------------------------------------
// settings/sweeps
// ---------------------------------------------------------------------------

export async function readSweepsSetting(): Promise<Settings | null> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "sweeps"]] });
  return docs[0] ?? null;
}

/** Mescla campos em settings/sweeps.value (merge profundo do Firestore). */
export async function mergeSweepsSetting(patch: Record<string, unknown>): Promise<void> {
  const doc = await readSweepsSetting();
  if (doc) await update<Settings>(COLLECTIONS.settings, doc.id, { value: patch });
  else await create<Settings>(COLLECTIONS.settings, { key: "sweeps", value: patch, description: "Última execução das varreduras automáticas." }, "setting_sweeps");
}

// ---------------------------------------------------------------------------
// sla_alerts: todas as instâncias em andamento, de qualquer tipo
// ---------------------------------------------------------------------------

interface SlaTarget {
  open: boolean;
  label: string;
  href: string;
  entity: { type: string; id: string };
  ownerId?: string;
  clientId?: string;
}

async function slaAlerts(now: Date): Promise<SweepOutcome> {
  // Chamados: o serviço do Suporte continua sendo a fonte (mesmas marcas alertedRisk/alertedBreach).
  const support = await import("@/server/support/service");
  const tickets = await support.checkSlaAlerts(now);
  await mergeSweepsSetting({ supportSlaLastRunAt: tickets.ranAt, supportSlaLastResult: tickets });

  const running = (await list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["status", "==", "em_andamento"]] })).filter((s) => s.entityType !== "chamado" && !s.supersededBy);
  const idsOf = (type: SlaInstance["entityType"]) => running.filter((s) => s.entityType === type).map((s) => s.entityId);
  const [tasks, steps, projects, opps, accounts] = await Promise.all([
    getManyByIds<Task>(COLLECTIONS.tasks, idsOf("tarefa")),
    getManyByIds<WorkflowStep>(COLLECTIONS.workflowSteps, idsOf("workflow_step")),
    getManyByIds<ImplementationProject>(COLLECTIONS.implementationProjects, idsOf("projeto")),
    getManyByIds<Opportunity>(COLLECTIONS.opportunities, idsOf("oportunidade")),
    getManyByIds<CsAccount>(COLLECTIONS.csAccounts, idsOf("cs")),
  ]);
  const clientIds = [...running.map((s) => s.clientId ?? ""), ...Array.from(projects.values()).map((p) => p.clientId), ...Array.from(opps.values()).map((o) => o.clientId)];
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, clientIds);
  const clientName = (id: string | undefined) => (id ? (clients.get(id)?.tradeName ?? "cliente") : "");

  const target = (sla: SlaInstance): SlaTarget | null => {
    switch (sla.entityType) {
      case "tarefa": {
        const t = tasks.get(sla.entityId);
        return t ? { open: OPEN_TASK.has(t.status) && t.slaInstanceId === sla.id, label: `tarefa "${t.title}"`, href: `/tarefas?tarefa=${t.id}`, entity: { type: "task", id: t.id }, ownerId: sla.ownerId ?? t.assigneeId, clientId: t.clientId } : null;
      }
      case "workflow_step": {
        const s = steps.get(sla.entityId);
        const open = Boolean(s && s.status !== "concluida" && s.status !== "pulada" && (!s.slaInstanceId || s.slaInstanceId === sla.id));
        return s ? { open, label: `etapa ${s.stageName} — ${s.clientName}`, href: `/workflow?etapa=${s.id}`, entity: { type: "workflow_step", id: s.id }, ownerId: sla.ownerId ?? s.assigneeId, clientId: s.clientId } : null;
      }
      case "projeto": {
        const p = projects.get(sla.entityId);
        return p ? { open: p.status !== "concluida" && p.status !== "cancelada", label: `implantação ${p.name} — ${clientName(p.clientId)}`, href: `/implantacao/${p.id}`, entity: { type: "project", id: p.id }, ownerId: sla.ownerId ?? p.ownerId, clientId: p.clientId } : null;
      }
      case "oportunidade": {
        const o = opps.get(sla.entityId);
        return o ? { open: o.stage !== "ganho" && o.stage !== "perdido", label: `oportunidade ${o.title}`, href: `/vendas/oportunidades?oportunidade=${o.id}`, entity: { type: "opportunity", id: o.id }, ownerId: sla.ownerId ?? o.ownerId, clientId: o.clientId } : null;
      }
      case "cs": {
        const a = accounts.get(sla.entityId);
        const clientId = a?.clientId ?? sla.clientId;
        return clientId ? { open: true, label: `conta de CS — ${clientName(clientId)}`, href: `/clientes/${clientId}?aba=cs`, entity: { type: "cs_account", id: a?.id ?? sla.entityId }, ownerId: sla.ownerId ?? a?.ownerId, clientId } : null;
      }
      default:
        return null;
    }
  };

  let atRisk = 0;
  let breached = 0;
  for (const sla of running) {
    const t = target(sla);
    if (!t || !t.open) continue;
    const view = computeSlaState(sla, now);
    const payload = { ownerId: t.ownerId ?? null, href: t.href, entityType: sla.entityType, entityId: sla.entityId, slaInstanceId: sla.id, dueAt: sla.dueAt, consumedPct: Math.round(view.consumedPct) };
    if (view.state === "violado" && !sla.alertedBreach) {
      await update<SlaInstance>(COLLECTIONS.slaInstances, sla.id, { alertedBreach: true, alertedRisk: true, breachedAt: sla.breachedAt ?? sla.dueAt });
      await emitEvent({
        type: "sla.breached",
        actor: AUTOMATION_ACTOR,
        clientId: t.clientId,
        entity: t.entity,
        title: `SLA violado: ${t.label}`,
        description: `${sla.ruleName} · prazo ${formatDateTime(sla.dueAt)}`,
        department: sla.department,
        payload,
      });
      breached += 1;
    } else if (view.state === "em_risco" && !sla.alertedRisk) {
      await update<SlaInstance>(COLLECTIONS.slaInstances, sla.id, { alertedRisk: true });
      await emitEvent({
        type: "sla.at_risk",
        actor: AUTOMATION_ACTOR,
        clientId: t.clientId,
        entity: t.entity,
        title: `SLA em risco: ${t.label}`,
        description: `${sla.ruleName} · ${Math.round(view.consumedPct)}% do prazo consumido · vence ${formatDateTime(sla.dueAt)}`,
        department: sla.department,
        payload,
        timeline: false,
      });
      atRisk += 1;
    }
  }
  return {
    summary: `Chamados: ${tickets.atRisk} em risco, ${tickets.breached} violado(s) · Demais: ${atRisk} em risco, ${breached} violado(s) em ${running.length} SLA(s) ativo(s)`,
    data: { ticketsScanned: tickets.scanned, ticketsAtRisk: tickets.atRisk, ticketsBreached: tickets.breached, scanned: running.length, atRisk, breached },
  };
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------

async function followupVendas(): Promise<SweepOutcome> {
  const sales = await import("@/server/sales/service");
  const r = await sales.detectStalledOpportunities(AUTOMATION_ACTOR);
  return { summary: `${r.scanned} oportunidade(s) abertas · ${r.followupTasksCreated} follow-up(s) criado(s) · ${r.stalledFlagged} parada(s) sinalizada(s)`, data: { ...r } };
}

/** Já recebeu hoje uma notificação com este prefixo de título? */
async function notifiedToday(userIds: string[], titlePrefix: string, now: Date, entityId?: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const today = dateKey(now);
  const items = entityId
    ? await list<Notification>(COLLECTIONS.notifications, { where: [["entityId", "==", entityId]] })
    : await list<Notification>(COLLECTIONS.notifications, { where: [["userId", "in", userIds]] });
  return new Set(items.filter((n) => n.title.startsWith(titlePrefix) && dateKey(n.createdAt) === today).map((n) => n.userId));
}

async function oportunidadesParadas(now: Date): Promise<SweepOutcome> {
  const sales = await import("@/server/sales/service");
  const [settings, opps, users, managerId] = await Promise.all([sales.getOpportunitySettings(), list<Opportunity>(COLLECTIONS.opportunities), cachedUsers(), managerOf("vendas")]);
  const limit = new Date(now.getTime() - settings.diasSemMovimentoParaParada * DAY_MS).toISOString();
  const byOwner = new Map<string, { stalled: number; noNext: number }>();
  for (const o of opps) {
    if (sales.isClosed(o)) continue;
    const stalled = o.lastActivityAt < limit;
    const noNext = !o.nextActionAt;
    if (!stalled && !noNext) continue;
    const entry = byOwner.get(o.ownerId) ?? { stalled: 0, noNext: 0 };
    if (stalled) entry.stalled += 1;
    if (noNext) entry.noNext += 1;
    byOwner.set(o.ownerId, entry);
  }
  const prefix = "Resumo do pipeline";
  const owners = Array.from(byOwner.keys()).filter((id) => users.get(id)?.active !== false && users.has(id));
  const already = await notifiedToday([...owners, ...(managerId ? [managerId] : [])], prefix, now);
  let sent = 0;
  const describe = (e: { stalled: number; noNext: number }) => `${e.stalled} parada(s) há mais de ${settings.diasSemMovimentoParaParada} dias · ${e.noNext} sem próxima ação`;
  for (const ownerId of owners) {
    if (already.has(ownerId)) continue;
    await notify({ userIds: [ownerId], kind: "atencao", title: `${prefix}: oportunidades que precisam de atenção`, body: describe(byOwner.get(ownerId)!), href: "/vendas/oportunidades" });
    sent += 1;
  }
  if (managerId && owners.length > 0 && !already.has(managerId)) {
    const lines = owners.map((id) => `${users.get(id)?.name ?? id}: ${describe(byOwner.get(id)!)}`);
    await notify({ userIds: [managerId], kind: "informativa", title: `${prefix} da equipe`, body: lines.join("\n"), href: "/vendas/pipeline" });
    sent += 1;
  }
  const totals = Array.from(byOwner.values()).reduce((acc, e) => ({ stalled: acc.stalled + e.stalled, noNext: acc.noNext + e.noNext }), { stalled: 0, noNext: 0 });
  return { summary: `${totals.stalled} parada(s) · ${totals.noNext} sem próxima ação · ${sent} resumo(s) enviado(s)`, data: { ...totals, notified: sent, sellers: owners.length } };
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

async function leadsSemContato24h(now: Date): Promise<SweepOutcome> {
  const limit = new Date(now.getTime() - DAY_MS).toISOString();
  const [leads, leadTasks, users, managerId] = await Promise.all([
    list<Lead>(COLLECTIONS.leads, { where: [["status", "==", "novo"]] }),
    list<Task>(COLLECTIONS.tasks, { where: [["processType", "==", "lead"]] }),
    cachedUsers(),
    managerOf("marketing"),
  ]);
  const pending = leads.filter((l) => !l.lastContactAt && l.createdAt < limit && !l.duplicateOfId);
  const withTask = new Set(leadTasks.filter((t) => OPEN_TASK.has(t.status) && t.tags.includes("sem-contato-24h")).map((t) => t.processId));
  let created = 0;
  for (const lead of pending) {
    if (withTask.has(lead.id)) continue;
    const owner = lead.ownerId ? users.get(lead.ownerId) : undefined;
    const assigneeId = owner && owner.active !== false ? owner.id : managerId;
    const hours = Math.floor((now.getTime() - new Date(lead.createdAt).getTime()) / 3_600_000);
    await createTaskInternal(
      {
        title: `Primeiro contato pendente: ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
        description: `Lead captado em ${formatDateTime(lead.createdAt)} via ${lead.origin} (score ${lead.score}, ${lead.temperature}) está há ${hours}h sem contato registrado. Faça o primeiro contato e registre o resultado no lead.`,
        clientId: lead.clientId,
        assigneeId,
        departmentId: (assigneeId ? users.get(assigneeId)?.departmentId : undefined) ?? "marketing",
        priority: lead.temperature === "quente" ? "critica" : "alta",
        dueAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
        processType: "lead",
        processId: lead.id,
        origin: "automacao",
        tags: ["marketing", "sem-contato-24h"],
      },
      AUTOMATION_ACTOR,
    );
    created += 1;
  }
  return { summary: `${pending.length} lead(s) sem contato há mais de 24h · ${created} tarefa(s) criada(s)`, data: { pending: pending.length, tasksCreated: created } };
}

// ---------------------------------------------------------------------------
// Customer Success
// ---------------------------------------------------------------------------

async function renovacoes(): Promise<SweepOutcome> {
  const cs = await import("@/server/cs/service");
  const r = await cs.ensureRenewals(AUTOMATION_ACTOR);
  await mergeSweepsSetting({ csRenewalsLastRunAt: r.ranAt, csRenewalsLastResult: r });
  return { summary: `${r.created} renovação(ões) criada(s) · ${r.dueEmitted} aviso(s) de renovação próxima`, data: { ...r } };
}

async function saudeClientes(): Promise<SweepOutcome> {
  const cs = await import("@/server/cs/service");
  const r = await cs.recalculateAllHealth(AUTOMATION_ACTOR);
  await mergeSweepsSetting({ csHealthLastRunAt: r.ranAt, csHealthLastResult: r });
  return { summary: `${r.count} cliente(s) recalculado(s) · ${r.changed} mudança(s) de nível · ${r.risk} em risco`, data: { ...r } };
}

// ---------------------------------------------------------------------------
// Implantação
// ---------------------------------------------------------------------------

async function implantacoesAtrasadas(now: Date): Promise<SweepOutcome> {
  const nowIso = now.toISOString();
  const projects = (await list<ImplementationProject>(COLLECTIONS.implementationProjects)).filter((p) => p.status !== "concluida" && p.status !== "cancelada" && p.dueDate < nowIso);
  const [clients, users, managerId] = await Promise.all([getManyByIds<Client>(COLLECTIONS.clients, projects.map((p) => p.clientId)), cachedUsers(), managerOf("implantacao")]);
  const prefix = "Implantação atrasada";
  let notified = 0;
  for (const p of projects) {
    const targets = [p.ownerId, managerId].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i && users.get(id!)?.active !== false);
    const already = await notifiedToday(targets, prefix, now, p.id);
    const pending = targets.filter((id) => !already.has(id));
    if (pending.length === 0) continue;
    const days = Math.max(1, Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / DAY_MS));
    await notify({
      userIds: pending,
      kind: "atencao",
      title: `${prefix}: ${clients.get(p.clientId)?.tradeName ?? p.name}`,
      body: `${p.name} · prazo ${formatDate(p.dueDate)} (${days} dia(s) de atraso) · ${p.progress}% concluído${p.waitingClient ? " · aguardando cliente" : ""}${p.blocked ? " · bloqueado" : ""}`,
      href: `/implantacao/${p.id}`,
      entity: { type: "project", id: p.id },
    });
    notified += pending.length;
  }
  return { summary: `${projects.length} projeto(s) atrasado(s) · ${notified} aviso(s) enviado(s)`, data: { late: projects.length, notified } };
}

// ---------------------------------------------------------------------------
// Tarefas recorrentes
// ---------------------------------------------------------------------------

/**
 * Uma série recorrente é identificada por título + responsável + cliente + departamento + processo.
 * Se a ocorrência mais recente foi concluída e não há ocorrência aberta, cria a próxima (com prazo
 * avançado até o futuro), respeitando recurrence.until. Séries canceladas não são retomadas.
 */
async function tarefasRecorrentes(now: Date): Promise<SweepOutcome> {
  const tasks = (await list<Task>(COLLECTIONS.tasks)).filter((t) => t.recurrence);
  const series = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = [t.title, t.assigneeId ?? "", t.clientId ?? "", t.departmentId, t.processId ?? ""].join("|");
    series.set(key, [...(series.get(key) ?? []), t]);
  }
  const nowIso = now.toISOString();
  let created = 0;
  for (const items of series.values()) {
    if (items.some((t) => OPEN_TASK.has(t.status))) continue;
    const latest = [...items].sort((a, b) => ((a.dueAt ?? a.completedAt ?? a.createdAt) < (b.dueAt ?? b.completedAt ?? b.createdAt) ? 1 : -1))[0];
    if (latest.status !== "concluida" || !latest.recurrence) continue;
    let dueAt = nextOccurrenceDueAt(latest.dueAt ?? latest.completedAt ?? nowIso, latest.recurrence);
    for (let i = 0; dueAt < nowIso && i < 400; i++) dueAt = nextOccurrenceDueAt(dueAt, latest.recurrence);
    if (latest.recurrence.until && dueAt > latest.recurrence.until) continue;
    await createTaskInternal(
      {
        title: latest.title,
        description: latest.description,
        clientId: latest.clientId,
        assigneeId: latest.assigneeId,
        departmentId: latest.departmentId,
        priority: latest.priority,
        dueAt,
        checklist: latest.checklist.map((c) => c.label),
        tags: latest.tags,
        recurrence: latest.recurrence,
        processType: latest.processType,
        processId: latest.processId,
        origin: "automacao",
        creatorId: latest.creatorId,
      },
      AUTOMATION_ACTOR,
    );
    created += 1;
  }
  return { summary: `${series.size} série(s) recorrente(s) · ${created} próxima(s) ocorrência(s) criada(s)`, data: { series: series.size, created } };
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

interface KpiModules {
  storeSnapshots: (period: unknown) => Promise<unknown>;
  monthPeriod: (key: string) => unknown;
  currentMonthKey: (now?: Date) => string;
}

/** O motor de KPIs (src/server/kpis/engine.ts) é de outro módulo: ausente ou com erro, a varredura só informa. */
async function loadKpiModules(): Promise<KpiModules | null> {
  try {
    const [engine, period] = await Promise.all([import("@/server/kpis/engine"), import("@/server/kpis/period")]);
    const e = engine as Partial<KpiModules>;
    const p = period as Partial<KpiModules>;
    if (typeof e.storeSnapshots !== "function" || typeof p.monthPeriod !== "function" || typeof p.currentMonthKey !== "function") return null;
    return { storeSnapshots: e.storeSnapshots, monthPeriod: p.monthPeriod, currentMonthKey: p.currentMonthKey };
  } catch (error) {
    console.warn("[automacoes] motor de KPIs indisponível", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Fotografia do mês corrente e, nos 3 primeiros dias do mês, o fechamento do mês anterior (os indicadores
 * de fluxo recebem os eventos das últimas horas; os de estado sem valor no passado mantêm a última fotografia,
 * porque storeSnapshots não grava valores nulos).
 */
async function kpiSnapshots(now: Date): Promise<SweepOutcome> {
  const kpis = await loadKpiModules();
  if (!kpis) return { summary: "Motor de indicadores não instalado: nada a gravar", data: { available: false } };
  const key = kpis.currentMonthKey(now);
  const result = (await kpis.storeSnapshots(kpis.monthPeriod(key))) as { written?: number; skipped?: number } | undefined;
  let closing: { period: string; written?: number } | null = null;
  const day = Number(dateKey(now).slice(8, 10));
  if (day <= 3) {
    const [y, m] = key.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const r = (await kpis.storeSnapshots(kpis.monthPeriod(prev))) as { written?: number } | undefined;
    closing = { period: prev, written: r?.written };
  }
  const closingText = closing ? ` · fechamento de ${closing.period}: ${closing.written ?? 0} snapshot(s)` : "";
  return {
    summary: `Competência ${key}: ${result?.written ?? 0} snapshot(s) gravado(s), ${result?.skipped ?? 0} sem valor${closingText}`,
    data: { available: true, period: key, written: result?.written ?? null, skipped: result?.skipped ?? null, closing },
  };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// processos_esperas: etapas "espera por horas" do construtor de processos
// ---------------------------------------------------------------------------

async function processosEsperas(now: Date): Promise<SweepOutcome> {
  const { sweepProcessWaits } = await import("@/server/process-engine/engine");
  const result = await sweepProcessWaits(now);
  const summary = `${result.advanced} espera(s) liberada(s) em ${result.checked} execução(ões) em andamento${result.errors.length ? ` · ${result.errors.length} erro(s)` : ""}`;
  return { summary, data: { ...result } };
}

export const SWEEPS: Record<SweepKey, SweepFn> = {
  sla_alerts: slaAlerts,
  followup_vendas: followupVendas,
  oportunidades_paradas: oportunidadesParadas,
  leads_sem_contato_24h: leadsSemContato24h,
  renovacoes,
  saude_clientes: saudeClientes,
  implantacoes_atrasadas: implantacoesAtrasadas,
  tarefas_recorrentes: tarefasRecorrentes,
  kpi_snapshots: kpiSnapshots,
  processos_esperas: processosEsperas,
};

/** Campos antigos (dos módulos) que também contam como "última execução" da varredura. */
export const LEGACY_LAST_RUN_FIELDS: Partial<Record<SweepKey, string>> = {
  followup_vendas: "followupLastRunAt",
  saude_clientes: "csHealthLastRunAt",
  renovacoes: "csRenewalsLastRunAt",
};

