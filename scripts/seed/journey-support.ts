/**
 * Suporte: chamados (40), interações e respostas de CSAT. Os SLAs dos chamados são criados em
 * journey-workflow (junto com os demais SLAs).
 */
import { COLLECTIONS, type CsatResponse, type SupportTicket, type TicketInteraction } from "../../src/domain/types";
import { addBusinessHours } from "../../src/server/sla";
import { NOW, addDays, addHours, businessTime, daysAgo, hoursAgo, id, minIso, pad, pastOnly, rng, type SeedDoc } from "./lib";
import type { SeedContext, SeededClient } from "./context";
import { PRODUCT_IDS } from "./catalog";

export const TICKET_RULE_HOURS: Record<SupportTicket["priority"], { response: number; resolution: number; businessOnly: boolean }> = {
  critico: { response: 0.25, resolution: 4, businessOnly: false },
  alto: { response: 2, resolution: 10, businessOnly: true },
  medio: { response: 8, resolution: 20, businessOnly: true },
  baixo: { response: 24, resolution: 30, businessOnly: true },
};

interface SubjectSpec {
  productId: string;
  subject: string;
  description: string;
  category: string;
  solution: string;
  rootCause: string;
  priority: SupportTicket["priority"];
}
const SUBJECTS: SubjectSpec[] = [
  { productId: PRODUCT_IDS.erpIntersys, subject: "PDV trava ao finalizar venda", description: "Ao clicar em finalizar, o PDV congela e precisa ser reaberto. Acontece várias vezes por dia.", category: "PDV", solution: "Atualizada a versão do PDV e limpo o cache local; monitorado por 2 dias sem recorrência.", rootCause: "bug_software", priority: "critico" },
  { productId: PRODUCT_IDS.erpIntersys, subject: "NFC-e rejeitada pela SEFAZ (rejeição 539)", description: "Todas as notas estão sendo rejeitadas desde hoje cedo.", category: "Fiscal", solution: "Corrigida duplicidade de numeração e reenviadas as notas em contingência.", rootCause: "configuracao", priority: "alto" },
  { productId: PRODUCT_IDS.erpIntersys, subject: "Dúvida sobre relatório de estoque mínimo", description: "Cliente quer saber como listar produtos abaixo do estoque mínimo.", category: "Dúvida", solution: "Orientado a usar Relatórios > Estoque > Abaixo do mínimo e enviado artigo da base.", rootCause: "duvida_uso", priority: "baixo" },
  { productId: PRODUCT_IDS.erpIntersys, subject: "Erro ao fechar o caixa: diferença de valores", description: "Fechamento apresenta diferença de R$ 230,00 entre apurado e informado.", category: "PDV", solution: "Identificada sangria não registrada; lançamento corrigido junto com o operador.", rootCause: "erro_operacional", priority: "medio" },
  { productId: PRODUCT_IDS.erpIntersys, subject: "Sistema lento para abrir cadastros", description: "Demora mais de 30 segundos para abrir a tela de produtos.", category: "Desempenho", solution: "Reindexado o banco de dados e ajustado o antivírus do servidor local.", rootCause: "infraestrutura", priority: "medio" },
  { productId: PRODUCT_IDS.erpIntersys, subject: "Como cadastrar promoção por quantidade", description: "Cliente quer configurar 'leve 3 pague 2'.", category: "Dúvida", solution: "Configurada promoção de exemplo em conjunto com o cliente e enviado passo a passo.", rootCause: "treinamento", priority: "baixo" },
  { productId: PRODUCT_IDS.erpGdoor, subject: "Não consegue emitir boleto pelo Gdoor", description: "Ao gerar boleto aparece 'convênio inválido'.", category: "Financeiro", solution: "Reconfigurado o convênio bancário com os dados corretos da carteira.", rootCause: "configuracao", priority: "medio" },
  { productId: PRODUCT_IDS.tef, subject: "TEF não conecta com a adquirente", description: "Mensagem 'sem comunicação' em todas as transações no cartão.", category: "TEF", solution: "Reiniciado o cliente TEF e liberada a porta no firewall do roteador novo.", rootCause: "infraestrutura", priority: "critico" },
  { productId: PRODUCT_IDS.tef, subject: "Transação TEF pendente sem confirmação", description: "Venda aprovada na maquininha mas não confirmada no PDV.", category: "TEF", solution: "Executada a confirmação manual da transação pendente e orientado o operador.", rootCause: "erro_operacional", priority: "alto" },
  { productId: PRODUCT_IDS.omnichannel, subject: "WhatsApp desconectou da plataforma", description: "Conversas pararam de chegar na plataforma desde ontem à noite.", category: "Omnichannel", solution: "Refeita a conexão do número no Gerenciador de Negócios da Meta.", rootCause: "terceiros", priority: "alto" },
  { productId: PRODUCT_IDS.ponto, subject: "Colaborador não consegue registrar ponto no app", description: "App diz 'fora da área permitida' mesmo dentro da loja.", category: "Ponto", solution: "Ampliado o raio de geolocalização da filial para 150 m.", rootCause: "configuracao", priority: "medio" },
  { productId: PRODUCT_IDS.internotas, subject: "Certificado digital expirado", description: "Não emite NF-e: 'certificado expirado'.", category: "Fiscal", solution: "Instalado o novo certificado A1 enviado pelo contador.", rootCause: "terceiros", priority: "alto" },
  { productId: PRODUCT_IDS.maquininha, subject: "Maquininha não liga", description: "Aparelho não liga mesmo carregado.", category: "Hardware", solution: "Aparelho substituído por garantia; nova unidade ativada.", rootCause: "hardware", priority: "medio" },
  { productId: PRODUCT_IDS.pabx, subject: "Ramal sem áudio nas chamadas", description: "Ramal 203 atende mas não tem áudio.", category: "Telefonia", solution: "Ajustado o codec do ramal e liberado o RTP no roteador.", rootCause: "configuracao", priority: "medio" },
  { productId: PRODUCT_IDS.telefonia, subject: "Número principal dando 'inexistente'", description: "Clientes reclamam que o número dá inexistente.", category: "Telefonia", solution: "Portabilidade concluída pela operadora; roteamento normalizado.", rootCause: "terceiros", priority: "alto" },
  { productId: PRODUCT_IDS.erpIntersys, subject: "Impressora não imprime cupom", description: "Cupom não sai depois da troca de bobina.", category: "PDV", solution: "Reinstalado o driver da impressora térmica e testada a impressão.", rootCause: "infraestrutura", priority: "baixo" },
];

/** Leva um instante para dentro do expediente local (8h-18h) sem passar da referência mínima. */
function snapToBusiness(isoDate: string, notBefore: string): string {
  const d = new Date(isoDate);
  const localHour = ((d.getUTCHours() - 3) + 24) % 24;
  if (localHour >= 8 && localHour < 18) return isoDate;
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (localHour < 8) day.setUTCDate(day.getUTCDate() - 1);
  const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17 + 3, rng.int(0, 45))).toISOString();
  return candidate > notBefore ? candidate : addHours(notBefore, 0.25);
}

const CSAT_POOL = [10, 10, 10, 9, 9, 9, 9, 8, 8, 8, 7, 10, 9, 6, 9, 10, 8, 9, 5, 10];

function pickSubject(client: SeededClient, forced?: SupportTicket["priority"]): SubjectSpec {
  const owned = new Set(client.products.map((p) => p.productId));
  const matching = SUBJECTS.filter((s) => owned.has(s.productId) && (!forced || s.priority === forced));
  const pool = matching.length ? matching : forced ? SUBJECTS.filter((s) => s.priority === forced) : SUBJECTS;
  return rng.pick(pool);
}

export async function seedSupport(ctx: SeedContext): Promise<void> {
  const { store, users } = ctx;
  const statusPlan: SupportTicket["status"][] = [
    ...Array<SupportTicket["status"]>(5).fill("aberto"),
    ...Array<SupportTicket["status"]>(7).fill("em_atendimento"),
    ...Array<SupportTicket["status"]>(4).fill("aguardando_cliente"),
    ...Array<SupportTicket["status"]>(20).fill("resolvido"),
    ...Array<SupportTicket["status"]>(3).fill("fechado"),
    "reaberto",
  ];
  const priorityPlan = rng.shuffle<SupportTicket["priority"]>([...Array<SupportTicket["priority"]>(4).fill("critico"), ...Array<SupportTicket["priority"]>(10).fill("alto"), ...Array<SupportTicket["priority"]>(16).fill("medio"), ...Array<SupportTicket["priority"]>(10).fill("baixo")]);
  const eligible = ctx.clients.filter((c) => c.doc.status === "ativo");
  const riskClients = eligible.filter((c) => c.doc.healthLevel !== "saudavel");

  // Monta as especificações, depois numera em ordem cronológica de abertura.
  const specs = statusPlan.map((status, i) => {
    const priority = priorityPlan[i];
    const isOpen = status === "aberto" || status === "em_atendimento" || status === "aguardando_cliente" || status === "reaberto";
    // Clientes em atenção/risco concentram mais chamados.
    const client = rng.chance(0.4) ? rng.pick(riskClients) : rng.pick(eligible);
    let openedAt: string;
    if (isOpen) openedAt = priority === "critico" || priority === "alto" ? hoursAgo(rng.int(1, 30)) : businessTime(daysAgo(rng.int(0, 4)));
    else openedAt = businessTime(daysAgo(rng.int(5, 45)));
    // Chamado só depois da ativação do cliente; encerrados precisam de folga para terem sido resolvidos.
    const minOpen = addDays(client.journey.activatedAt!, 1);
    if (openedAt < minOpen) openedAt = isOpen ? businessTime(daysAgo(rng.int(0, 2))) : minOpen < daysAgo(4) ? businessTime(addDays(minOpen, rng.int(0, 2))) : businessTime(daysAgo(2));
    return { status, priority, client, openedAt, subject: pickSubject(client, priority === "critico" ? "critico" : undefined) };
  });
  specs.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));

  const tickets: SupportTicket[] = [];
  let interactionSeq = 0;
  let csatSeq = 0;
  const year = NOW.getUTCFullYear();

  specs.forEach((spec, i) => {
    const n = i + 1;
    const ticketId = id("ticket", n);
    const { status, priority, client, openedAt } = spec;
    const rule = TICKET_RULE_HOURS[priority];
    const start = new Date(openedAt);
    const responseDue = rule.businessOnly ? addBusinessHours(start, rule.response, ctx.holidays) : new Date(start.getTime() + rule.response * 3_600_000);
    const resolutionDue = rule.businessOnly ? addBusinessHours(start, rule.resolution, ctx.holidays) : new Date(start.getTime() + rule.resolution * 3_600_000);
    const isClosed = status === "resolvido" || status === "fechado";
    const lateResponse = rng.chance(0.15);
    const lateResolution = rng.chance(0.15);
    const responseSpan = responseDue.getTime() - start.getTime();
    let firstResponseAt = status === "aberto" ? undefined : new Date(start.getTime() + responseSpan * (lateResponse ? rng.float(1.1, 1.8) : rng.float(0.1, 0.9))).toISOString();
    if (firstResponseAt && rule.businessOnly) firstResponseAt = snapToBusiness(firstResponseAt, openedAt);
    const resolutionSpan = resolutionDue.getTime() - start.getTime();
    let resolvedAt = isClosed ? new Date(start.getTime() + resolutionSpan * (lateResolution ? rng.float(1.05, 1.6) : rng.float(0.2, 0.95))).toISOString() : undefined;
    if (resolvedAt && rule.businessOnly) resolvedAt = snapToBusiness(resolvedAt, firstResponseAt ?? openedAt);
    if (resolvedAt && resolvedAt > NOW.toISOString()) resolvedAt = hoursAgo(rng.int(1, 3));
    if (firstResponseAt && resolvedAt && firstResponseAt > resolvedAt) firstResponseAt = addHours(resolvedAt, -0.5);
    const queue = priority === "critico" || priority === "alto" || status === "reaberto" ? "n2" : "n1";
    const assigneeId = status === "aberto" && rng.chance(0.4) ? undefined : queue === "n2" ? (rng.chance(0.8) ? users.larissa.id : users.lando.id) : users.rafael.id;
    const evaluated = isClosed && rng.chance(0.7);
    const csatScore = evaluated ? rng.pick(CSAT_POOL) : undefined;
    const resolvedBefore = tickets.filter((t) => t.status === "resolvido" && t.resolvedAt && t.resolvedAt < openedAt);
    const reopenedFrom = status === "reaberto" ? resolvedBefore.find((t) => t.clientId === client.doc.id) ?? resolvedBefore[resolvedBefore.length - 1] : undefined;

    const ticket = store.add(COLLECTIONS.supportTickets, ticketId, {
      number: `CH-${year}-${pad(n, 4)}`,
      clientId: client.doc.id,
      contactId: client.contacts[0].id,
      productId: spec.subject.productId,
      subject: spec.subject.subject,
      description: spec.subject.description,
      channel: rng.pick(["whatsapp", "whatsapp", "telefone", "email", "portal"]),
      priority,
      category: spec.subject.category,
      assigneeId,
      queue,
      status,
      openedAt,
      firstResponseAt: firstResponseAt && firstResponseAt < NOW.toISOString() ? firstResponseAt : status === "aberto" ? undefined : hoursAgo(0.5),
      resolvedAt,
      closedAt: status === "fechado" ? minIso(addHours(resolvedAt!, 48), hoursAgo(1)) : undefined,
      solution: isClosed ? spec.subject.solution : undefined,
      rootCause: isClosed ? spec.subject.rootCause : undefined,
      slaInstanceId: undefined, // preenchido em journey-workflow
      reopenedFromId: reopenedFrom?.id,
      reopenCount: reopenedFrom ? 1 : 0,
      csatScore,
      originatedOpportunityId: n === 7 ? "opp_010" : undefined,
      trainingRelated: n === 5 || n === 12,
      createdAt: openedAt,
      updatedAt: resolvedAt ?? firstResponseAt ?? openedAt,
    } satisfies SeedDoc<SupportTicket>);
    if (reopenedFrom) {
      reopenedFrom.reopenCount = 1;
      ticket.clientId = reopenedFrom.clientId;
      ticket.contactId = reopenedFrom.contactId ?? ticket.contactId;
      ticket.subject = `[Reaberto] ${reopenedFrom.subject}`;
      ticket.description = "Problema voltou a acontecer dois dias depois da solução.";
    }
    tickets.push(ticket);

    // Interações: abertura pelo cliente, atendimento, solução.
    const author = ticket.assigneeId ?? users.rafael.id;
    const interactions: { kind: TicketInteraction["kind"]; body: string; authorId?: string; at: string; durationSeconds?: number }[] = [
      { kind: ticket.channel === "whatsapp" ? "whatsapp" : ticket.channel === "telefone" ? "ligacao" : "mensagem", body: ticket.description, at: openedAt, durationSeconds: ticket.channel === "telefone" ? rng.int(120, 600) : undefined },
    ];
    if (ticket.firstResponseAt) interactions.push({ kind: "mensagem", body: "Olá! Recebemos seu chamado e já estamos verificando.", authorId: author, at: ticket.firstResponseAt });
    if (status !== "aberto" && rng.chance(0.7)) interactions.push({ kind: "nota_interna", body: rng.pick(["Acesso remoto realizado; coletando logs.", "Aguardando retorno do nível 2.", "Reproduzido o erro no ambiente do cliente."]), authorId: author, at: addHours(ticket.firstResponseAt ?? openedAt, 0.5) });
    if (status === "aguardando_cliente") interactions.push({ kind: "status", body: "Status alterado para aguardando cliente: precisamos do acesso ao servidor.", authorId: author, at: addHours(ticket.firstResponseAt ?? openedAt, 1) });
    if (resolvedAt) interactions.push({ kind: "mensagem", body: ticket.solution!, authorId: author, at: resolvedAt });
    if (status === "fechado") interactions.push({ kind: "status", body: "Chamado fechado após confirmação do cliente.", authorId: author, at: ticket.closedAt! });
    for (const it of interactions) {
      interactionSeq += 1;
      store.add(COLLECTIONS.ticketInteractions, id("tint", interactionSeq, 4), {
        ticketId,
        clientId: ticket.clientId,
        authorId: it.authorId,
        kind: it.kind,
        body: it.body,
        durationSeconds: it.durationSeconds,
        // Sem VoIP/WhatsApp conectados: contatos da equipe são registros manuais (sem gravação).
        manual: it.authorId && (it.kind === "ligacao" || it.kind === "mensagem" || it.kind === "whatsapp" || it.kind === "email") ? true : undefined,
        createdAt: pastOnly(it.at),
      } satisfies SeedDoc<TicketInteraction>);
    }

    if (csatScore !== undefined) {
      csatSeq += 1;
      store.add(COLLECTIONS.csatResponses, id("csat", csatSeq), {
        ticketId,
        clientId: ticket.clientId,
        attendantId: ticket.assigneeId,
        productId: ticket.productId,
        score: csatScore,
        comment: csatScore >= 9 ? rng.pick(["Atendimento rápido e resolveu!", "Excelente, obrigado.", undefined]) : csatScore <= 6 ? "Demorou para resolver e o problema voltou." : undefined,
        respondedAt: minIso(addHours(resolvedAt!, rng.int(1, 30)), hoursAgo(1)),
        createdAt: minIso(addHours(resolvedAt!, rng.int(1, 30)), hoursAgo(1)),
      } satisfies SeedDoc<CsatResponse>);
    }
  });

  ctx.tickets = tickets;
}
