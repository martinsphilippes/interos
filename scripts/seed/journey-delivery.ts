/**
 * Entrega e retenção: projetos de implantação (tarefas por fase a partir dos templates),
 * treinamentos, contas de CS, health scores, planos de sucesso, renovações e churn.
 */
import {
  COLLECTIONS,
  IMPLEMENTATION_PHASES,
  type ChurnRecord,
  type CsAccount,
  type HealthScore,
  type ImplementationPhase,
  type ImplementationProject,
  type ImplementationTask,
  type Renewal,
  type SuccessPlan,
  type Training,
} from "../../src/domain/types";
import type { HealthLevel } from "../../src/domain/constants";
import { NOW, addDays, businessTime, daysAgo, daysFromNow, id, pastOnly, rng, type SeedDoc } from "./lib";
import { clientById, type SeedContext, type SeededClient } from "./context";

// ---------------------------------------------------------------------------
// Projetos de implantação
// ---------------------------------------------------------------------------

interface ProjectPlan {
  client: number;
  status: ImplementationProject["status"];
  phase: ImplementationPhase;
}
const PROJECT_PLAN: ProjectPlan[] = [
  { client: 27, status: "em_implantacao", phase: "configuracao" },
  { client: 28, status: "em_implantacao", phase: "migracao" },
  { client: 29, status: "aguardando_cliente", phase: "configuracao" },
  { client: 30, status: "bloqueada", phase: "validacao_escopo" },
  { client: 31, status: "pronta_para_go_live", phase: "go_live" },
  { client: 32, status: "em_implantacao", phase: "kickoff" },
  { client: 25, status: "concluida", phase: "go_live" },
  { client: 26, status: "concluida", phase: "go_live" },
];

function phaseIndex(p: ImplementationPhase): number {
  return IMPLEMENTATION_PHASES.indexOf(p);
}

function seedProjects(ctx: SeedContext): void {
  const { store, users } = ctx;
  const projects: ImplementationProject[] = [];
  let taskSeq = 0;

  PROJECT_PLAN.forEach((plan, i) => {
    const client = clientById(ctx, id("client", plan.client));
    const projectId = id("proj", i + 1);
    const j = client.journey;
    const startDate = j.implementationStartAt!;
    const templates = client.products.map((p) => ctx.products[p.productId]?.implementationTemplateId).filter((t): t is string => Boolean(t)).map((t) => ctx.templates[t]);
    const uniqueTemplates = Array.from(new Map(templates.map((t) => [t.id, t])).values());
    const totalDays = Math.max(...uniqueTemplates.map((t) => t.totalDays), 3);
    const dueDate = addDays(startDate, Math.round(totalDays * 1.4) + 2);
    const done = plan.status === "concluida";
    const ownerId = client.doc.ownerImplementationId ?? users.marcos.id;
    const currentIdx = phaseIndex(plan.phase);

    // Tarefas por fase a partir dos templates dos produtos do cliente.
    const tasks: ImplementationTask[] = [];
    let dayCursor = 0;
    const phasesInProject = IMPLEMENTATION_PHASES.filter((ph) => uniqueTemplates.some((t) => t.phases.some((p) => p.key === ph)));
    for (const ph of phasesInProject) {
      const phIdx = phaseIndex(ph);
      const seen = new Set<string>();
      for (const tpl of uniqueTemplates) {
        const phaseSpec = tpl.phases.find((p) => p.key === ph);
        if (!phaseSpec) continue;
        for (const t of phaseSpec.tasks) {
          if (seen.has(t.title)) continue;
          seen.add(t.title);
          taskSeq += 1;
          let status: ImplementationTask["status"];
          if (done || phIdx < currentIdx) status = "concluida";
          else if (phIdx === currentIdx) status = plan.status === "pronta_para_go_live" ? (t.title.includes("aceite") ? "aberta" : "concluida") : rng.pick(["concluida", "em_andamento", "aberta"]);
          else status = "aberta";
          if (plan.status === "bloqueada" && phIdx === currentIdx) status = "aguardando";
          const dueAt = addDays(startDate, dayCursor + t.dueInDays);
          const completedAt = status === "concluida" ? businessTime(addDays(startDate, dayCursor + Math.max(t.dueInDays - 1, 0))) : undefined;
          tasks.push(
            store.add(COLLECTIONS.implementationTasks, id("itask", taskSeq, 4), {
              projectId,
              clientId: client.doc.id,
              phase: ph,
              title: `${t.title} (${tpl.name.replace("Implantação ", "").replace("Entrega ", "")})`,
              description: t.description,
              assigneeId: rng.chance(0.5) ? ownerId : rng.pick([users.marcos.id, users.bruno.id]),
              dueAt,
              status,
              required: t.required,
              evidence: status === "concluida" && rng.chance(0.3) ? "Print anexado ao projeto." : undefined,
              completedAt: completedAt && completedAt < NOW.toISOString() ? completedAt : status === "concluida" ? daysAgo(1, 15) : undefined,
              createdAt: startDate,
            } satisfies SeedDoc<ImplementationTask>),
          );
        }
      }
      dayCursor += Math.max(...uniqueTemplates.map((t) => t.phases.find((p) => p.key === ph)?.tasks.reduce((m, x) => Math.max(m, x.dueInDays), 0) ?? 0));
    }
    const doneCount = tasks.filter((t) => t.status === "concluida").length;
    const progress = done ? 100 : Math.round((doneCount / Math.max(tasks.length, 1)) * 100);

    // Checklist do projeto: uma linha por fase.
    const checklist = phasesInProject.map((ph, k) => {
      const phDone = done || phaseIndex(ph) < currentIdx;
      return { id: `chk_${k + 1}`, label: `Fase ${ph.replace("_", " ")} concluída`, done: phDone, required: true, doneAt: phDone ? businessTime(addDays(startDate, k + 1)) : undefined, doneBy: phDone ? ownerId : undefined };
    });

    const goLiveAt = done ? j.goLiveAt : undefined;
    const waitingClient = plan.status === "aguardando_cliente" ? { reason: "Cliente ainda não enviou o certificado digital A1 para configuração fiscal.", since: daysAgo(3, 10), responsibleId: ownerId, evidence: "WhatsApp enviado em " + daysAgo(3).slice(0, 10) } : undefined;

    const project = store.add(COLLECTIONS.implementationProjects, projectId, {
      clientId: client.doc.id,
      contractId: id("ctr", plan.client),
      workflowInstanceId: undefined, // preenchido em journey-workflow
      name: `Implantação — ${client.doc.tradeName}`,
      productIds: client.products.map((p) => p.productId),
      scope: `Produtos: ${client.products.map((p) => p.productName).join(", ")}.`,
      ownerId,
      teamIds: Array.from(new Set([ownerId, users.marcos.id, users.bruno.id])),
      status: plan.status,
      currentPhase: plan.phase,
      startDate,
      dueDate,
      completedAt: goLiveAt,
      goLiveAt,
      progress,
      waitingClient,
      externalDelayDays: plan.status === "aguardando_cliente" ? 3 : plan.status === "bloqueada" ? 2 : 0,
      internalDelayDays: plan.status === "bloqueada" ? 1 : 0,
      checklist,
      acceptance: done ? { acceptedAt: goLiveAt!, acceptedBy: client.contacts[0].name, notes: "Aceite registrado no go-live." } : undefined,
      createdAt: j.releasedAt ?? startDate,
      updatedAt: goLiveAt ?? daysAgo(rng.int(0, 2), 16),
    } satisfies SeedDoc<ImplementationProject>);
    projects.push(project);
    if (plan.status === "pronta_para_go_live") client.journey.trainingAt = businessTime(daysAgo(1));
  });
  ctx.projects = projects;
}

function seedTrainings(ctx: SeedContext): void {
  const { store, users } = ctx;
  const plan: { client: number; project: number; status: Training["status"]; when: string; subject: string; instructor: string }[] = [
    { client: 25, project: 7, status: "realizado", when: clientById(ctx, "client_025").journey.trainingAt!, subject: "Treinamento de PDV, estoque e fiscal", instructor: users.bruno.id },
    { client: 26, project: 8, status: "realizado", when: clientById(ctx, "client_026").journey.trainingAt!, subject: "Treinamento de PDV e financeiro", instructor: users.marcos.id },
    { client: 31, project: 5, status: "realizado", when: clientById(ctx, "client_031").journey.trainingAt!, subject: "Treinamento completo do ERP", instructor: users.bruno.id },
    { client: 29, project: 3, status: "agendado", when: daysFromNow(3, 14), subject: "Treinamento de PDV (após configuração fiscal)", instructor: users.marcos.id },
    { client: 27, project: 1, status: "agendado", when: daysFromNow(1, 9), subject: "Treinamento de cadastros e estoque", instructor: users.bruno.id },
  ];
  plan.forEach((t, i) => {
    const client = clientById(ctx, id("client", t.client));
    store.add(COLLECTIONS.trainings, id("training", i + 1), {
      clientId: client.doc.id,
      projectId: id("proj", t.project),
      productId: client.products[0]?.productId,
      subject: t.subject,
      instructorId: t.instructor,
      scheduledAt: t.when,
      completedAt: t.status === "realizado" ? t.when : undefined,
      participants: client.contacts.map((c) => c.name),
      materialUrl: "https://mock.intercert.com.br/materiais/roteiro-pdv.pdf",
      evidence: t.status === "realizado" ? "Lista de presença assinada." : undefined,
      notes: t.status === "realizado" ? "Equipe participativa; dúvidas sobre cancelamento de item." : undefined,
      status: t.status,
      createdAt: pastOnly(addDays(t.when, -3)),
    } satisfies SeedDoc<Training>);
  });
}

// ---------------------------------------------------------------------------
// CS: contas, saúde, planos, renovações e churn
// ---------------------------------------------------------------------------

const HEALTH_WEIGHTS = [
  { key: "uso", label: "Uso do sistema", weight: 25 },
  { key: "satisfacao", label: "Satisfação (CSAT)", weight: 20 },
  { key: "sla", label: "SLA cumprido nos chamados", weight: 15 },
  { key: "suporte", label: "Volume de chamados", weight: 15 },
  { key: "reincidencia", label: "Reincidência de chamados", weight: 10 },
  { key: "financeiro", label: "Situação financeira", weight: 15 },
];
const NOTES: Record<string, Record<HealthLevel, string>> = {
  uso: { saudavel: "Acessos diários em todos os módulos.", atencao: "Uso concentrado no PDV; estoque pouco usado.", risco: "Sem acessos relevantes nas últimas semanas." },
  satisfacao: { saudavel: "CSAT médio acima de 9.", atencao: "CSAT médio entre 7 e 8.", risco: "Última avaliação abaixo de 6." },
  sla: { saudavel: "Todos os chamados dentro do SLA.", atencao: "Um chamado fora do SLA no período.", risco: "Chamados críticos fora do SLA." },
  suporte: { saudavel: "Poucos chamados no período.", atencao: "Volume acima da média da carteira.", risco: "Muitos chamados recentes." },
  reincidencia: { saudavel: "Sem reincidência.", atencao: "Um chamado reaberto.", risco: "Chamados reincidentes sobre o mesmo problema." },
  financeiro: { saudavel: "Pagamentos em dia.", atencao: "Atraso pontual de mensalidade.", risco: "Mensalidade vencida em aberto." },
};

function levelFor(score: number): HealthLevel {
  return score >= 75 ? "saudavel" : score >= 50 ? "atencao" : "risco";
}

function seedCs(ctx: SeedContext): void {
  const { store, users } = ctx;
  const actives = ctx.clients.filter((c) => c.doc.status === "ativo");
  const overdueBillingClients = new Set(store.all<{ clientId: string; status: string }>(COLLECTIONS.billing).filter((b) => b.status === "vencida").map((b) => b.clientId));

  actives.forEach((client, i) => {
    const target = client.doc.healthScore ?? 80;
    const plannedLevel = client.doc.healthLevel ?? "saudavel";
    // Fatores em torno do alvo; o último fator fecha a conta para o score bater com o planejado.
    const factors = HEALTH_WEIGHTS.map((f) => {
      let value = Math.max(0, Math.min(100, target + rng.int(-8, 8)));
      if (f.key === "financeiro") value = overdueBillingClients.has(client.doc.id) ? rng.int(20, 45) : Math.max(value, 70);
      return { ...f, value, contribution: 0, note: "" };
    });
    const partial = factors.slice(0, -1).reduce((s, f) => s + (f.weight * f.value) / 100, 0);
    const last = factors[factors.length - 1];
    last.value = Math.max(0, Math.min(100, Math.round(((target - partial) * 100) / last.weight)));
    for (const f of factors) {
      f.contribution = Number(((f.weight * f.value) / 100).toFixed(1));
      f.note = NOTES[f.key][levelFor(f.value)];
    }
    let score = Math.round(factors.reduce((s, f) => s + f.contribution, 0));
    // Se a correção financeira tirou o cliente da faixa planejada, o fator de uso compensa.
    if (levelFor(score) !== plannedLevel) {
      const uso = factors[0];
      uso.value = Math.max(0, Math.min(100, uso.value + Math.round(((target - score) * 100) / uso.weight)));
      uso.contribution = Number(((uso.weight * uso.value) / 100).toFixed(1));
      uso.note = NOTES.uso[levelFor(uso.value)];
      score = Math.round(factors.reduce((s, f) => s + f.contribution, 0));
    }
    const level = levelFor(score);
    client.doc.healthScore = score;
    client.doc.healthLevel = level;
    if (level === "risco" && !client.doc.tags.includes("risco-churn")) client.doc.tags.push("risco-churn");

    store.add(COLLECTIONS.healthScores, id("hs", i + 1), {
      clientId: client.doc.id,
      score,
      level,
      factors,
      computedAt: daysAgo(0, 6),
      createdAt: daysAgo(0, 6),
    } satisfies SeedDoc<HealthScore>);

    const adoptionPct = level === "saudavel" ? rng.int(70, 98) : level === "atencao" ? rng.int(45, 70) : rng.int(15, 44);
    const riskReasons = level === "saudavel" ? [] : level === "atencao" ? rng.pickN(["Baixo uso do módulo de estoque", "Chamados acima da média", "Atraso pontual de pagamento", "Sem checkpoint há mais de 30 dias"], 2) : rng.pickN(["Uso do sistema em queda", "Mensalidade vencida", "Reclamação de lentidão no PDV", "Decisor mencionou concorrente"], 3);
    const contract = ctx.contracts.find((c) => c.clientId === client.doc.id);
    store.add(COLLECTIONS.csAccounts, id("cs", i + 1), {
      clientId: client.doc.id,
      ownerId: client.doc.ownerCsId ?? users.felipe.id,
      activatedAt: client.journey.activatedAt,
      adoptionPct,
      satisfaction: level === "saudavel" ? rng.float(8.5, 10, 1) : level === "atencao" ? rng.float(6.5, 8.4, 1) : rng.float(3, 6.4, 1),
      lastInteractionAt: client.doc.lastInteractionAt,
      nextInteractionAt: client.doc.nextInteractionAt,
      riskLevel: level,
      riskReasons,
      renewalDate: contract?.endDate,
      notes: level === "risco" ? "Priorizar contato do gestor de CS esta semana." : undefined,
      createdAt: client.journey.activatedAt,
      updatedAt: daysAgo(0, 6),
    } satisfies SeedDoc<CsAccount>);
  });

  // Planos de sucesso para os clientes em risco (um criado por automação).
  const riskClients = actives.filter((c) => c.doc.healthLevel === "risco").slice(0, 3);
  const fallback = actives.filter((c) => c.doc.healthLevel === "atencao");
  const planClients = [...riskClients, ...fallback].slice(0, 3);
  planClients.forEach((client, i) => {
    const ownerId = client.doc.ownerCsId ?? users.felipe.id;
    store.add(COLLECTIONS.successPlans, id("splan", i + 1), {
      clientId: client.doc.id,
      ownerId,
      objective: i === 0 ? "Recuperar adoção do sistema e resolver lentidão do PDV" : i === 1 ? "Reduzir chamados recorrentes e retomar uso do estoque" : "Regularizar financeiro e reengajar o decisor",
      actions: [
        { id: "act_1", description: "Reunião de diagnóstico com o proprietário", responsibleId: ownerId, dueAt: daysAgo(2, 10), done: true, doneAt: daysAgo(2, 11) },
        { id: "act_2", description: "Reforço de treinamento no módulo com baixa adoção", responsibleId: users.bruno.id, dueAt: daysFromNow(3, 14), done: false },
        { id: "act_3", description: "Checkpoint de acompanhamento em 15 dias", responsibleId: ownerId, dueAt: daysFromNow(15, 10), done: false },
      ],
      checkpointAt: daysFromNow(15, 10),
      status: "ativo",
      origin: i === 0 ? "automacao" : "manual",
      createdAt: daysAgo(3, 9),
    } satisfies SeedDoc<SuccessPlan>);
  });

  // Renovações: 2 dentro da janela de 60 dias, 3 mais adiante.
  const renewalPlan: { client: SeededClient; inDays: number; status: Renewal["status"] }[] = [
    { client: actives[4], inDays: 20, status: "em_negociacao" },
    { client: actives[10], inDays: 45, status: "aguardando" },
    { client: actives[7], inDays: 75, status: "aguardando" },
    { client: actives[15], inDays: 120, status: "aguardando" },
    { client: actives[19], inDays: 160, status: "aguardando" },
  ];
  renewalPlan.forEach((r, i) => {
    const contract = ctx.contracts.find((c) => c.clientId === r.client.doc.id)!;
    const dueDate = daysFromNow(r.inDays, 12);
    contract.endDate = dueDate;
    const cs = store.all<CsAccount>(COLLECTIONS.csAccounts).find((a) => a.clientId === r.client.doc.id);
    if (cs) cs.renewalDate = dueDate;
    store.add(COLLECTIONS.renewals, id("renewal", i + 1), {
      clientId: r.client.doc.id,
      contractId: contract.id,
      ownerId: r.client.doc.ownerCsId ?? users.felipe.id,
      dueDate,
      windowOpensAt: addDays(dueDate, -60),
      risk: r.client.doc.healthLevel ?? "saudavel",
      status: r.status,
      notes: r.status === "em_negociacao" ? "Cliente pediu desconto na mensalidade para renovar por mais 12 meses." : undefined,
      createdAt: pastOnly(addDays(dueDate, -75)),
    } satisfies SeedDoc<Renewal>);
  });

  // Churn dos cancelados.
  ctx.clients
    .filter((c) => c.doc.status === "cancelado")
    .forEach((client, i) => {
      store.add(COLLECTIONS.churnRecords, id("churn", i + 1), {
        clientId: client.doc.id,
        productIds: client.products.map((p) => p.productId),
        lostMrr: client.products.reduce((s, p) => s + p.monthlyValue, 0),
        reason: i === 0 ? "Fechou a loja física; migrou para venda apenas online." : "Migrou para sistema do concorrente por preço.",
        reasonCategory: i === 0 ? "fechamento" : "concorrente",
        responsibleId: client.doc.ownerCsId ?? users.felipe.id,
        date: client.journey.cancelledAt!,
        context: "Registrado após ligação de retenção sem sucesso.",
        origin: "cs",
        createdAt: client.journey.cancelledAt!,
      } satisfies SeedDoc<ChurnRecord>);
    });
}

export async function seedDelivery(ctx: SeedContext): Promise<void> {
  seedProjects(ctx);
  seedTrainings(ctx);
  seedCs(ctx);
}
