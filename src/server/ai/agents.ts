import "server-only";
/**
 * Agentes do INTEROS. Cada agente tem uma versão DETERMINÍSTICA (regras sobre o contexto montado em
 * context.ts) que sempre funciona; `runWithLlm` é o ponto de extensão que, com ANTHROPIC_API_KEY,
 * pede à IA sugestões complementares a partir do mesmo contexto. As sugestões da IA nunca substituem
 * as das regras: são somadas (marcadas com source "ia").
 */
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { emitEvent } from "@/server/events";
import { OPPORTUNITY_STAGE_LABELS } from "@/components/sales/model";
import type { Opportunity } from "@/domain/types";
import {
  buildCommercialContext,
  buildCsContext,
  buildExecutiveContext,
  buildImplementationContext,
  buildSupportContext,
  type CommercialData,
  type CsData,
  type ExecutiveData,
  type ImplementationData,
  type SupportData,
} from "./context";
import { completeWithLlm, isLlmAvailable } from "./provider";
import { AGENT_LABELS, type AgentContext, type AgentKind, type AgentRun, type AgentSuggestion, type SuggestionPriority } from "./types";

const PRIORITY_RANK: Record<SuggestionPriority, number> = { alta: 0, media: 1, baixa: 2 };

function suggestion(id: string, title: string, priority: SuggestionPriority, extra: Partial<AgentSuggestion> = {}): AgentSuggestion {
  return { id, title, priority, source: "regras", ...extra };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const names = (items: { title?: string; name?: string; clientName?: string }[], max = 3) =>
  items
    .slice(0, max)
    .map((i) => i.clientName ?? i.title ?? i.name)
    .join(", ") + (items.length > max ? "…" : "");

// ---------------------------------------------------------------------------
// Regras determinísticas
// ---------------------------------------------------------------------------

export function commercialRules(d: CommercialData): AgentSuggestion[] {
  const out: AgentSuggestion[] = [];
  if (d.overdue.length > 0) {
    out.push(suggestion("followups-vencidos", `${plural(d.overdue.length, "follow-up vencido", "follow-ups vencidos")}: retomar o contato hoje`, "alta", { detail: names(d.overdue), href: `/vendas/oportunidades?oportunidade=${d.overdue[0].id}`, actionLabel: "Abrir a primeira" }));
  }
  if (d.noNextAction.length > 0) {
    out.push(suggestion("sem-proxima-acao", `${plural(d.noNextAction.length, "oportunidade sem próxima ação", "oportunidades sem próxima ação")}: agendar follow-up`, "alta", { detail: names(d.noNextAction), href: `/vendas/oportunidades?oportunidade=${d.noNextAction[0].id}`, actionLabel: "Agendar" }));
  }
  if (d.leadsUncontacted.length > 0) {
    const hot = d.leadsUncontacted.filter((l) => l.temperature === "quente").length;
    out.push(suggestion("leads-sem-contato", `${plural(d.leadsUncontacted.length, "lead aguardando", "leads aguardando")} o primeiro contato${hot ? ` (${hot} quente${hot > 1 ? "s" : ""})` : ""}`, hot ? "alta" : "media", { detail: names(d.leadsUncontacted), href: `/marketing/leads?lead=${d.leadsUncontacted[0].id}`, actionLabel: "Contatar" }));
  }
  if (d.stalled.length > 0) {
    const value = d.stalled.reduce((s, o) => s + o.monthlyTotal, 0);
    out.push(suggestion("paradas", `${plural(d.stalled.length, "oportunidade parada", "oportunidades paradas")} há mais de ${d.stalledDays} dias: reativar ou encerrar`, "media", { detail: `${formatCurrency(value)}/mês em risco · ${names(d.stalled)}`, href: `/vendas/oportunidades?oportunidade=${d.stalled[0].id}` }));
  }
  const hotLate = d.hot.filter((o) => o.stage === "negociacao" || o.stage === "fechamento");
  if (hotLate.length > 0) {
    out.push(suggestion("quentes-fechamento", `${plural(hotLate.length, "negócio quente", "negócios quentes")} em ${OPPORTUNITY_STAGE_LABELS[hotLate[0].stage as Opportunity["stage"]]?.toLowerCase() ?? "negociação"}: priorizar o fechamento`, "media", { detail: names(hotLate), href: `/vendas/oportunidades?oportunidade=${hotLate[0].id}` }));
  }
  if (d.overdueTasks.length > 0) {
    out.push(suggestion("tarefas-atrasadas", `${plural(d.overdueTasks.length, "tarefa atrasada", "tarefas atrasadas")} na sua fila`, "media", { detail: names(d.overdueTasks), href: `/tarefas?tarefa=${d.overdueTasks[0].id}` }));
  }
  if (d.open.length === 0 && d.leadsUncontacted.length === 0) {
    out.push(suggestion("pipeline-vazio", "Pipeline vazio: buscar novas oportunidades na prospecção ativa", "baixa", { href: "/marketing/prospeccao" }));
  }
  return out;
}

export function implementationRules(d: ImplementationData): AgentSuggestion[] {
  const out: AgentSuggestion[] = [];
  const base = `/implantacao/${d.projectId}`;
  if (d.status === "concluida" || d.status === "cancelada") {
    if (d.postGoLiveTickets > 0) out.push(suggestion("pos-golive", `${plural(d.postGoLiveTickets, "chamado", "chamados")} nos 30 dias após o go-live: revisar treinamento`, "media", { href: base }));
    return out;
  }
  if (d.overdue) out.push(suggestion("atrasado", `Projeto atrasado ${plural(d.daysLate, "dia", "dias")}: replanejar o prazo com o cliente e priorizar as pendências`, "alta", { detail: `Prazo era ${formatDate(d.dueDate)}`, href: base }));
  if (d.slaState === "em_risco" || d.slaState === "violado") out.push(suggestion("sla", d.slaState === "violado" ? "SLA da implantação violado: escalar ao gestor" : "SLA da implantação em risco", "alta", { href: base }));
  if (d.waitingClient) {
    const days = Math.floor((Date.now() - new Date(d.waitingClient.since).getTime()) / 86_400_000);
    out.push(suggestion("aguardando-cliente", `Aguardando o cliente há ${plural(days, "dia", "dias")}: cobrar o retorno`, days >= 3 ? "alta" : "media", { detail: d.waitingClient.reason, href: base }));
  }
  if (d.blocked) out.push(suggestion("bloqueado", "Projeto bloqueado: resolver o impedimento ou escalar", "alta", { detail: d.blocked.reason, href: base }));
  if (d.pendingInPhase.length > 0) out.push(suggestion("pendencias-fase", `${plural(d.pendingInPhase.length, "tarefa obrigatória", "tarefas obrigatórias")} para avançar de fase`, "media", { detail: d.pendingInPhase.slice(0, 3).join("; "), href: `${base}?aba=pendencias` }));
  if (d.trainingsDone === 0 && d.trainingsScheduled === 0 && (d.phase === "treinamento" || d.phase === "validacao" || d.phase === "go_live")) {
    out.push(suggestion("treinamento", "Nenhum treinamento agendado: agendar antes do go-live", "alta", { href: `${base}?aba=treinamentos` }));
  }
  if (d.gateMissing.length > 0 && (d.phase === "validacao" || d.phase === "go_live" || d.status === "pronta_para_go_live")) {
    out.push(suggestion("gate-golive", `Faltam ${plural(d.gateMissing.length, "item", "itens")} para o go-live`, "media", { detail: d.gateMissing.slice(0, 3).join("; "), href: `${base}?aba=go-live` }));
  }
  if (d.gateMissing.length === 0) out.push(suggestion("pronto-golive", "Gate de go-live completo: aprovar o go-live", "media", { href: `${base}?aba=go-live`, actionLabel: "Ir para o go-live" }));
  return out;
}

export function supportRules(d: SupportData): AgentSuggestion[] {
  const out: AgentSuggestion[] = [];
  const href = `/suporte/chamados?chamado=${d.ticketId}`;
  if (!d.open) {
    if (d.csatAverage !== undefined && d.csatAverage <= 6) out.push(suggestion("csat", `CSAT médio do cliente baixo (${d.csatAverage.toFixed(1)}): acionar o CS`, "media", { href: `/clientes/${d.clientId}?aba=cs` }));
    return out;
  }
  if (!d.firstResponseAt) out.push(suggestion("primeira-resposta", `Sem primeira resposta há ${d.hoursOpen}h: responder o cliente`, d.priority === "critico" || d.priority === "alto" ? "alta" : "media", { href }));
  if (d.slaState === "violado" || d.slaState === "em_risco") out.push(suggestion("sla", d.slaState === "violado" ? "SLA violado: escalar e informar o cliente" : "SLA em risco: priorizar este chamado", "alta", { href }));
  for (const a of d.articles.slice(0, 2)) out.push(suggestion(`artigo-${a.id}`, `Artigo sugerido: ${a.title}`, "media", { href: `/suporte/base-de-conhecimento/${a.id}`, actionLabel: "Abrir artigo" }));
  if (d.previousSimilar.length > 0) out.push(suggestion("reincidencia", `${plural(d.previousSimilar.length, "chamado parecido", "chamados parecidos")} do mesmo cliente: investigar a causa raiz`, "media", { detail: d.previousSimilar.slice(0, 3).map((p) => p.number).join(", "), href: `/suporte/chamados?chamado=${d.previousSimilar[0].id}` }));
  if (d.reopenRate >= 0.2 && d.previousCount >= 3) out.push(suggestion("reabertura", `Reincidência de ${(d.reopenRate * 100).toFixed(0)}% neste cliente: confirmar a solução antes de encerrar`, "media", { href }));
  if (d.status === "aguardando_cliente" && d.hoursOpen > 48) out.push(suggestion("aguardando", "Aguardando o cliente: enviar lembrete ou encerrar por falta de retorno", "baixa", { href }));
  return out;
}

const FACTOR_ACTIONS: Record<string, string> = {
  uso: "agendar treinamento de reforço e acompanhar o uso",
  satisfacao: "ligar para entender a insatisfação",
  sla: "revisar os chamados fora do SLA com o suporte",
  suporte: "analisar o volume de chamados e as causas",
  reincidencia: "tratar a causa raiz dos chamados reabertos",
  financeiro: "alinhar com o financeiro as cobranças em aberto",
  relacionamento: "agendar um checkpoint com o decisor",
};

export function csRules(d: CsData): AgentSuggestion[] {
  const out: AgentSuggestion[] = [];
  const clientHref = `/clientes/${d.clientId}?aba=cs`;
  if (d.level === "risco" && !d.activePlan) out.push(suggestion("plano", "Cliente em risco sem plano de sucesso: criar um plano", "alta", { href: `/cs/planos?novo=1&cliente=${d.clientId}`, actionLabel: "Criar plano" }));
  const weak = [...d.factors].filter((f) => f.value < 50).sort((a, b) => b.weight * (100 - b.value) - a.weight * (100 - a.value));
  for (const f of weak.slice(0, 3)) {
    out.push(suggestion(`fator-${f.key}`, `${f.label} em ${f.value}/100: ${FACTOR_ACTIONS[f.key] ?? "atuar neste fator"}`, f.value < 30 ? "alta" : "media", { detail: f.note, href: `/cs/saude?cliente=${d.clientId}` }));
  }
  if (d.adoptionPct !== undefined && d.adoptionPct < 40 && !weak.some((f) => f.key === "uso")) out.push(suggestion("adocao", `Adoção de ${d.adoptionPct}%: agendar treinamento de reforço`, "media", { href: clientHref }));
  if (d.daysSinceInteraction === undefined || d.daysSinceInteraction > 30) out.push(suggestion("checkpoint", d.daysSinceInteraction === undefined ? "Nenhuma interação registrada: agendar checkpoint" : `Sem interação há ${d.daysSinceInteraction} dias: agendar checkpoint`, "media", { href: clientHref }));
  if (d.renewal && d.renewal.daysLeft <= 90) out.push(suggestion("renovacao", `Renovação em ${plural(Math.max(0, d.renewal.daysLeft), "dia", "dias")} (${formatDate(d.renewal.dueDate)}): preparar a negociação`, d.renewal.daysLeft <= 30 ? "alta" : "media", { href: "/cs/renovacoes" }));
  if (d.openTickets >= 3) out.push(suggestion("chamados", `${d.openTickets} chamados abertos: alinhar com o suporte`, "media", { href: `/clientes/${d.clientId}?aba=suporte` }));
  if (d.level === "saudavel" && (d.adoptionPct ?? 0) >= 70 && out.length === 0) out.push(suggestion("upsell", "Cliente saudável e com boa adoção: avaliar oportunidade de upsell", "baixa", { href: `/cs/upsell` }));
  return out;
}

export function executiveRules(d: ExecutiveData): AgentSuggestion[] {
  const out: AgentSuggestion[] = [];
  if (d.riskClients.length > 0) {
    const mrr = d.riskClients.reduce((s, c) => s + c.mrr, 0);
    out.push(suggestion("risco", `${plural(d.riskClients.length, "cliente em risco", "clientes em risco")} (${formatCurrency(mrr)} de MRR): revisar os planos com o CS`, "alta", { detail: names(d.riskClients.map((c) => ({ name: c.tradeName }))), href: "/cs/riscos" }));
  }
  if (d.breachedSlas > 0) out.push(suggestion("slas", `${plural(d.breachedSlas, "SLA violado", "SLAs violados")} no período: cobrar os gestores das áreas`, "alta", { href: "/suporte/sla" }));
  for (const k of d.kpisCritical.slice(0, 3)) out.push(suggestion(`kpi-${k.kpiKey}`, `Indicador "${k.name}" em nível crítico (${k.value.toLocaleString("pt-BR")}${k.target !== undefined ? ` · meta ${k.target.toLocaleString("pt-BR")}` : ""})`, "alta", { href: "/gestao/cockpit" }));
  if (d.overdueTasks > 10) out.push(suggestion("tarefas", `${d.overdueTasks} tarefas atrasadas na operação: verificar gargalos por área`, "media", { href: "/tarefas?view=atrasadas" }));
  if (d.stalledOpportunities > 0) out.push(suggestion("pipeline", `${plural(d.stalledOpportunities, "oportunidade parada", "oportunidades paradas")} há mais de 7 dias no pipeline`, "media", { detail: `Pipeline aberto: ${formatCurrency(d.openPipelineMonthly)}/mês`, href: "/vendas/pipeline" }));
  for (const i of d.insights.slice(0, 2)) out.push(suggestion(`insight-${i.occurredAt}`, i.title, "media", { href: "/gestao/cockpit" }));
  return out;
}

// ---------------------------------------------------------------------------
// Extensão com IA
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "Você é um assistente operacional do INTEROS, o sistema de gestão da Intercert (revenda de ERP, TEF, telefonia e serviços). " +
  "Receberá o contexto de uma área (comercial, implantação, suporte, customer success ou diretoria) e as sugestões já geradas por regras. " +
  "Proponha de 1 a 3 ações adicionais, concretas e acionáveis hoje, que não repitam as existentes, baseadas apenas nos dados fornecidos. " +
  'Responda somente com JSON válido no formato {"suggestions":[{"title":"...","detail":"...","priority":"alta|media|baixa"}]}, em português do Brasil.';

/** Ponto de extensão: sugestões complementares pela IA. Devolve null sem chave ou em qualquer falha. */
export async function runWithLlm(kind: AgentKind, context: AgentContext, existing: AgentSuggestion[] = []): Promise<{ suggestions: AgentSuggestion[]; model: string } | null> {
  if (!isLlmAvailable()) return null;
  const prompt = [
    `Agente: ${AGENT_LABELS[kind]}.`,
    `Contexto: ${context.summary}`,
    `Fatos (JSON): ${JSON.stringify(context.facts).slice(0, 12_000)}`,
    `Sugestões já geradas: ${existing.map((s) => `- ${s.title}`).join("\n") || "nenhuma"}`,
  ].join("\n\n");
  const response = await completeWithLlm({ system: SYSTEM_PROMPT, prompt, maxTokens: 2000 });
  if (!response) return null;
  try {
    const json = response.text.slice(response.text.indexOf("{"), response.text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { suggestions?: { title?: unknown; detail?: unknown; priority?: unknown }[] };
    const items = (parsed.suggestions ?? [])
      .filter((s) => typeof s.title === "string" && s.title.trim())
      .slice(0, 3)
      .map((s, i) =>
        suggestion(`ia-${i}`, String(s.title).trim().slice(0, 200), s.priority === "alta" || s.priority === "baixa" ? s.priority : "media", {
          detail: typeof s.detail === "string" ? s.detail.slice(0, 400) : undefined,
          source: "ia",
        }),
      );
    return { suggestions: items, model: response.model };
  } catch {
    console.error("[ia] resposta da IA fora do formato JSON esperado");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Execução do agente
// ---------------------------------------------------------------------------

async function build(kind: AgentKind, subjectId: string) {
  switch (kind) {
    case "comercial": {
      const b = await buildCommercialContext(subjectId);
      return b && { ...b, rules: commercialRules(b.data) };
    }
    case "implantacao": {
      const b = await buildImplementationContext(subjectId);
      return b && { ...b, rules: implementationRules(b.data) };
    }
    case "suporte": {
      const b = await buildSupportContext(subjectId);
      return b && { ...b, rules: supportRules(b.data) };
    }
    case "cs": {
      const b = await buildCsContext(subjectId);
      return b && { ...b, rules: csRules(b.data) };
    }
    case "executivo": {
      const period = /^\d{4}-\d{2}$/.test(subjectId) ? subjectId : dateKey(new Date()).slice(0, 7);
      const b = await buildExecutiveContext(period);
      return { ...b, rules: executiveRules(b.data) };
    }
  }
}

/** Monta o contexto, aplica as regras e (se configurada) complementa com a IA. */
export async function runAgent(kind: AgentKind, subjectId: string, options: { useLlm?: boolean; actor?: { id: string; name: string } } = {}): Promise<AgentRun | null> {
  const built = await build(kind, subjectId);
  if (!built) return null;
  const suggestions = [...built.rules];
  let usedLlm = false;
  let model: string | undefined;
  if (options.useLlm !== false) {
    const llm = await runWithLlm(kind, built.context, suggestions);
    if (llm) {
      usedLlm = true;
      model = llm.model;
      suggestions.push(...llm.suggestions);
      if (options.actor) {
        await emitEvent({
          type: "ai.suggestion_generated",
          actor: options.actor,
          clientId: kind === "cs" ? subjectId : undefined,
          entity: { type: "ai_agent", id: `${kind}:${subjectId}` },
          title: `${AGENT_LABELS[kind]}: ${llm.suggestions.length} sugestão(ões) da IA para ${built.subject.label}`,
          payload: { kind, subjectId, model: llm.model, count: llm.suggestions.length },
          timeline: false,
        });
      }
    }
  }
  suggestions.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  return { kind, subject: built.subject, context: built.context, suggestions, generatedAt: new Date().toISOString(), usedLlm, model };
}
