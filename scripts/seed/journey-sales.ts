/**
 * Aquisição e receita: leads, oportunidades, propostas, contratos, cobranças, visitas,
 * listas de prospecção e comunicações simuladas.
 */
import {
  COLLECTIONS,
  type Billing,
  type Communication,
  type Contract,
  type Lead,
  type Opportunity,
  type OpportunityProduct,
  type Proposal,
  type ProposalItem,
  type Prospect,
  type ProspectList,
  type Visit,
} from "../../src/domain/types";
import { CITIES, NOW, addDays, businessTime, cnpj, competence, dayInCompetence, daysAgo, daysFromNow, emailFor, hoursAgo, id, isPast, minIso, pad, pastOnly, personName, phone, pickCity, rng, type SeedDoc } from "./lib";
import { clientById, type SeedContext, type SeededClient } from "./context";
import { LEAD_SCORING, LEAD_SOURCE_KEYS, PRODUCT_IDS } from "./catalog";

const INTERESTS: Record<string, string> = {
  erp: "Sistema de gestão (ERP) com PDV e fiscal",
  tef: "TEF integrado ao caixa",
  omnichannel: "Atendimento por WhatsApp com vários atendentes",
  pabx: "Central telefônica (PABX virtual)",
  telefonia: "Telefonia VoIP",
  maquininha: "Maquininha de cartão",
  ponto: "Controle de ponto",
  notas: "Emissão de notas fiscais",
  certificado: "Certificado digital",
  consultoria: "Consultoria de gestão",
};
const INTEREST_PRODUCT: Record<string, string> = {
  erp: PRODUCT_IDS.erpIntersys,
  tef: PRODUCT_IDS.tef,
  omnichannel: PRODUCT_IDS.omnichannel,
  pabx: PRODUCT_IDS.pabx,
  telefonia: PRODUCT_IDS.telefonia,
  maquininha: PRODUCT_IDS.maquininha,
  ponto: PRODUCT_IDS.ponto,
  notas: PRODUCT_IDS.internotas,
  certificado: PRODUCT_IDS.certificado,
  consultoria: PRODUCT_IDS.consultoria,
};

function scoreFor(origin: string, interest: string, city: string): number {
  return (LEAD_SCORING.origem[origin] ?? 10) + (LEAD_SCORING.interesse[interest] ?? 10) + (LEAD_SCORING.cidade[city] ?? 5);
}
function temperatureFor(score: number): Lead["temperature"] {
  if (score >= LEAD_SCORING.limiares.quente) return "quente";
  if (score >= LEAD_SCORING.limiares.morno) return "morno";
  return "frio";
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

function seedLeads(ctx: SeedContext): void {
  const { store, users } = ctx;
  const leads: Lead[] = [];
  const statusPlan: Lead["status"][] = [
    "convertido", "convertido", "convertido",
    "em_contato", "em_contato", "em_contato", "em_contato", "em_contato", "em_contato", "em_contato", "em_contato",
    "qualificado", "qualificado", "qualificado", "qualificado", "qualificado", "qualificado",
    "desqualificado", "desqualificado", "desqualificado",
    "novo", "novo", "novo", "novo", "novo", "novo", "novo", "novo", "novo", "novo",
  ];
  // Leads 1-3 viraram os prospects 33-35; leads 4-7 são os clientes em status "lead" (38-41).
  const linkedClient: Record<number, number> = { 1: 33, 2: 34, 3: 35, 4: 38, 5: 39, 6: 40, 7: 41 };
  const duplicates: Record<number, number> = { 22: 9, 27: 14 };
  const DISQUALIFY = ["Sem orçamento no momento", "Já usa sistema concorrente com contrato vigente", "Contato inválido após 3 tentativas"];

  statusPlan.forEach((status, idx) => {
    const n = idx + 1;
    const linked = linkedClient[n] ? clientById(ctx, id("client", linkedClient[n])) : undefined;
    const city = linked?.city ?? pickCity();
    const origin = linked?.doc.origin ?? rng.pick(LEAD_SOURCE_KEYS);
    const interestKey = rng.pick(Object.keys(INTERESTS));
    const interest = INTERESTS[interestKey];
    let score = scoreFor(origin, interestKey, city.name);
    if (status === "desqualificado") score = Math.min(score, 35);
    // MQLs entram quentes: passaram do score mínimo e têm interesse confirmado.
    if (status === "qualificado" || status === "convertido") score = Math.max(score, 72);
    if (status === "novo" && n % 7 === 0) score = Math.max(score, 70);
    const temperature = temperatureFor(score);
    const createdAt = linked ? linked.journey.leadAt : status === "novo" ? hoursAgo(rng.int(1, 72)) : businessTime(daysAgo(rng.int(3, 30)));
    const isMarketingOwned = status === "novo" || status === "em_contato" || status === "desqualificado";
    const ownerId = isMarketingOwned ? (n % 2 === 0 ? users.luciano.id : users.mateus.id) : linked?.doc.ownerSalesId ?? (n % 2 === 0 ? users.igor.id : users.vinicius.id);
    const dupOf = duplicates[n] ? leads[duplicates[n] - 1] : undefined;
    const contactName = personName();
    const company = linked?.doc.tradeName ?? (rng.chance(0.8) ? `${rng.pick(["Mercadinho", "Loja", "Farmácia", "Restaurante", "Distribuidora", "Ótica"])} ${rng.pick(["Sol", "Lua", "Cariri", "Central", "Serra", "Norte"])}` : undefined);
    const nextActionAt = status === "novo" || status === "em_contato" ? (n % 3 === 0 ? daysAgo(rng.int(1, 4), rng.int(9, 16)) : daysFromNow(rng.int(0, 3), rng.int(9, 16))) : undefined;
    const qualifiedAt = status === "qualificado" || status === "convertido" ? (linked?.journey.qualifiedAt ?? businessTime(addDays(createdAt, rng.int(1, 4)))) : undefined;

    const lead = store.add(COLLECTIONS.leads, id("lead", n), {
      name: contactName,
      company,
      phone: dupOf?.phone ?? phone(city.ddd),
      email: rng.chance(0.7) ? emailFor(contactName, "gmail.com") : undefined,
      city: city.name,
      state: city.state,
      origin,
      campaignId: linked?.doc.campaignId ?? (["anuncio", "instagram", "tiktok"].includes(origin) ? rng.pick(["camp_001", "camp_002"]) : undefined),
      interest,
      productInterestIds: [INTEREST_PRODUCT[interestKey]],
      ownerId,
      score,
      temperature,
      status,
      consent: status !== "novo" || rng.chance(0.6),
      consentAt: status !== "novo" ? businessTime(addDays(createdAt, 0)) : undefined,
      disqualificationReason: status === "desqualificado" ? rng.pick(DISQUALIFY) : undefined,
      duplicateOfId: dupOf?.id,
      clientId: linked?.doc.id,
      opportunityId: status === "convertido" ? id("opp", n) : undefined,
      lastContactAt: status === "novo" ? undefined : businessTime(addDays(createdAt, rng.int(0, 3))),
      nextActionAt,
      nextAction: nextActionAt ? rng.pick(["Ligar para confirmar interesse", "Enviar apresentação por WhatsApp", "Agendar diagnóstico com vendas", "Retornar contato (não atendeu)"]) : undefined,
      qualifiedAt,
      notes: n % 4 === 0 ? "Pediu para ligar depois das 14h." : undefined,
      createdAt,
      updatedAt: qualifiedAt ?? createdAt,
    } satisfies SeedDoc<Lead>);
    leads.push(lead);
    if (linked) linked.doc.leadId = lead.id;
  });
  ctx.leads = leads;
}

// ---------------------------------------------------------------------------
// Oportunidades e propostas
// ---------------------------------------------------------------------------

const PROBABILITY: Record<Opportunity["stage"], number> = { qualificacao: 10, diagnostico: 25, proposta: 50, negociacao: 70, fechamento: 85, ganho: 100, perdido: 0 };

function productLine(ctx: SeedContext, productId: string, quantity = 1): OpportunityProduct {
  const p = ctx.products[productId];
  return { productId, productName: p.name, quantity, setupValue: p.setupPrice * quantity, monthlyValue: p.monthlyPrice * quantity, hardwareValue: p.hardwarePrice * quantity };
}
function totals(products: OpportunityProduct[]) {
  return {
    setupTotal: products.reduce((s, p) => s + p.setupValue, 0),
    monthlyTotal: products.reduce((s, p) => s + p.monthlyValue, 0),
    hardwareTotal: products.reduce((s, p) => s + p.hardwareValue, 0),
  };
}
/** Um produto que o cliente ainda não tem, para upsell/cross-sell. */
function upsellProduct(client: SeededClient): string {
  const owned = new Set(client.products.map((p) => p.productId));
  const candidates = [PRODUCT_IDS.tef, PRODUCT_IDS.omnichannel, PRODUCT_IDS.pabx, PRODUCT_IDS.ponto, PRODUCT_IDS.internotas, PRODUCT_IDS.telefonia, PRODUCT_IDS.maquininha, PRODUCT_IDS.consultoria].filter((p) => !owned.has(p));
  return rng.pick(candidates.length ? candidates : [PRODUCT_IDS.consultoria]);
}

function seedOpportunities(ctx: SeedContext): void {
  const { store, users } = ctx;
  const opps: Opportunity[] = [];
  const proposals: Proposal[] = [];
  let proposalSeq = 0;

  const addProposal = (opp: Opportunity, client: SeededClient, status: Proposal["status"], createdAt: string): Proposal => {
    proposalSeq += 1;
    const items: ProposalItem[] = opp.products.map((p) => ({ ...p, discountPct: 0 }));
    const sentAt = businessTime(addDays(createdAt, 0));
    const proposal = store.add(COLLECTIONS.proposals, id("prop", proposalSeq), {
      clientId: client.doc.id,
      opportunityId: opp.id,
      number: `PR-${createdAt.slice(0, 4)}-${pad(proposalSeq, 4)}`,
      version: 1,
      status,
      items,
      setupTotal: opp.setupTotal,
      monthlyTotal: opp.monthlyTotal,
      hardwareTotal: opp.hardwareTotal,
      discountTotal: 0,
      conditions: "Adesão à vista ou em até 3x no cartão. Mensalidade com vencimento todo dia 10.",
      validUntil: addDays(sentAt, 15),
      sentAt,
      viewedAt: status === "enviada" ? undefined : businessTime(addDays(sentAt, 1)),
      acceptedAt: status === "aceita" ? client.journey.wonAt : undefined,
      ownerId: opp.ownerId,
      createdAt,
      updatedAt: status === "aceita" ? client.journey.wonAt : sentAt,
    } satisfies SeedDoc<Proposal>);
    proposals.push(proposal);
    opp.proposalId = proposal.id;
    return proposal;
  };

  const make = (n: number, client: SeededClient, input: Partial<Opportunity> & { stage: Opportunity["stage"]; kind: Opportunity["kind"]; products: OpportunityProduct[]; createdAt: string }): Opportunity => {
    const t = totals(input.products);
    const opp = store.add(COLLECTIONS.opportunities, id("opp", n), {
      clientId: client.doc.id,
      leadId: input.leadId,
      title: input.title ?? `${input.kind === "nova_venda" ? "Nova venda" : input.kind === "upsell" ? "Upsell" : "Cross-sell"} — ${client.doc.tradeName}`,
      stage: input.stage,
      stageChangedAt: input.stageChangedAt ?? input.createdAt,
      ownerId: input.ownerId ?? client.doc.ownerSalesId ?? users.igor.id,
      temperature: input.temperature ?? (input.stage === "ganho" ? "quente" : rng.pick(["quente", "morno", "morno", "frio"])),
      probability: PROBABILITY[input.stage],
      products: input.products,
      ...t,
      diagnosis: input.diagnosis,
      need: input.need,
      objections: input.objections,
      nextAction: input.nextAction,
      nextActionAt: input.nextActionAt,
      lastActivityAt: input.lastActivityAt ?? input.createdAt,
      billingData: input.billingData,
      originDepartment: input.originDepartment,
      originUserId: input.originUserId,
      kind: input.kind,
      wonAt: input.wonAt,
      lostAt: input.lostAt,
      lossReason: input.lossReason,
      lossCompetitor: input.lossCompetitor,
      lossNotes: input.lossNotes,
      contractId: input.contractId,
      createdAt: input.createdAt,
      updatedAt: input.lastActivityAt ?? input.createdAt,
    } satisfies SeedDoc<Opportunity>);
    opps.push(opp);
    return opp;
  };

  const billingFor = (c: SeededClient) => ({ legalName: c.doc.legalName, document: c.doc.document, email: c.doc.email, address: c.doc.address, paymentCondition: "Adesão à vista, mensalidade dia 10" });

  // 1-3: novas vendas abertas (prospects em Vendas)
  const openStages: Opportunity["stage"][] = ["diagnostico", "proposta", "negociacao"];
  [33, 34, 35].forEach((cn, i) => {
    const client = clientById(ctx, id("client", cn));
    const products = [productLine(ctx, PRODUCT_IDS.erpIntersys), productLine(ctx, PRODUCT_IDS.tef)];
    const opp = make(i + 1, client, {
      leadId: id("lead", i + 1),
      stage: openStages[i],
      stageChangedAt: businessTime(daysAgo(rng.int(1, 5))),
      kind: "nova_venda",
      products,
      diagnosis: "Controle de estoque em planilha e emissão fiscal manual; perde vendas por falta de TEF.",
      need: "ERP com PDV integrado e TEF.",
      objections: i === 2 ? "Achou a adesão alta; pediu parcelamento." : undefined,
      nextAction: ["Agendar visita de diagnóstico", "Apresentar proposta", "Negociar condição da adesão"][i],
      nextActionAt: daysFromNow(rng.int(0, 3), rng.int(9, 16)),
      lastActivityAt: hoursAgo(rng.int(2, 40)),
      createdAt: client.journey.opportunityAt!,
    });
    if (i >= 1) addProposal(opp, client, i === 1 ? "enviada" : "negociacao", client.journey.opportunityAt!);
  });

  // 4-7: ganhas (prospects em Financeiro e dois clientes em implantação)
  [36, 37, 27, 28].forEach((cn, i) => {
    const client = clientById(ctx, id("client", cn));
    const products = client.products.map((p) => productLine(ctx, p.productId, p.quantity));
    const opp = make(i + 4, client, {
      stage: "ganho",
      stageChangedAt: client.journey.wonAt,
      kind: "nova_venda",
      products,
      temperature: "quente",
      diagnosis: "Cliente em crescimento precisa de gestão integrada e meios de pagamento.",
      need: "Pacote ERP + complementos.",
      lastActivityAt: client.journey.wonAt,
      billingData: billingFor(client),
      wonAt: client.journey.wonAt,
      contractId: id("ctr", cn),
      createdAt: client.journey.opportunityAt!,
    });
    addProposal(opp, client, "aceita", client.journey.proposalAt!);
  });

  // 8-9: perdidas
  {
    const c12 = clientById(ctx, "client_012");
    make(8, c12, {
      stage: "perdido",
      stageChangedAt: daysAgo(12),
      kind: "upsell",
      products: [productLine(ctx, PRODUCT_IDS.pabx)],
      temperature: "frio",
      lastActivityAt: daysAgo(12),
      lostAt: daysAgo(12),
      lossReason: "preco",
      lossNotes: "Optou por manter a central antiga; reavaliar em 6 meses.",
      createdAt: daysAgo(40),
    });
    const c42 = clientById(ctx, "client_042");
    make(9, c42, {
      stage: "perdido",
      stageChangedAt: daysAgo(30),
      kind: "cross_sell",
      products: [productLine(ctx, PRODUCT_IDS.tef)],
      temperature: "frio",
      lastActivityAt: daysAgo(30),
      lostAt: daysAgo(30),
      lossReason: "concorrente",
      lossCompetitor: "Adquirente local",
      createdAt: daysAgo(55),
    });
  }

  // 10-22: upsell/cross-sell abertos em clientes ativos
  const upsellClients = [1, 2, 4, 6, 7, 9, 10, 11, 13, 15, 16, 18, 19];
  const upsellStages: Opportunity["stage"][] = ["qualificacao", "diagnostico", "proposta", "negociacao", "fechamento"];
  upsellClients.forEach((cn, i) => {
    const n = i + 10;
    const client = clientById(ctx, id("client", cn));
    const productId = upsellProduct(client);
    const fromSupport = n === 10 || n === 11;
    const overdue = n === 12 || n === 13 || n === 14;
    const noNext = n === 15 || n === 16;
    const stalled = n === 17 || n === 18;
    const stage = upsellStages[i % upsellStages.length];
    const createdAt = businessTime(daysAgo(rng.int(8, 45)));
    const opp = make(n, client, {
      stage,
      stageChangedAt: businessTime(daysAgo(rng.int(1, 7))),
      kind: productId === PRODUCT_IDS.consultoria ? "cross_sell" : "upsell",
      products: [productLine(ctx, productId, productId === PRODUCT_IDS.maquininha ? 2 : 1)],
      diagnosis: fromSupport ? "Identificado pelo suporte durante atendimento: cliente reclamou de filas no WhatsApp." : "Cliente pediu orçamento durante checkpoint de CS.",
      need: `Contratar ${ctx.products[productId].name}.`,
      nextAction: noNext ? undefined : rng.pick(["Enviar proposta", "Ligar para follow-up", "Agendar demonstração", "Confirmar aceite da proposta"]),
      nextActionAt: noNext ? undefined : overdue ? daysAgo(rng.int(1, 5), rng.int(9, 16)) : daysFromNow(rng.int(0, 4), rng.int(9, 16)),
      lastActivityAt: stalled ? daysAgo(rng.int(8, 15), 11) : hoursAgo(rng.int(3, 60)),
      originDepartment: fromSupport ? "suporte" : "cs",
      originUserId: fromSupport ? users.rafael.id : client.doc.ownerCsId,
      createdAt,
    });
    if (n === 12) addProposal(opp, client, "enviada", businessTime(daysAgo(6)));
    if (n === 17) addProposal(opp, client, "visualizada", businessTime(daysAgo(10)));
  });

  ctx.opportunities = opps;
}

// ---------------------------------------------------------------------------
// Contratos e cobranças
// ---------------------------------------------------------------------------

/** Próximo aniversário do contrato depois de hoje. */
function nextAnniversary(startIso: string): string {
  const start = new Date(startIso);
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 12));
  if (d.getTime() <= NOW.getTime()) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

function seedContracts(ctx: SeedContext): void {
  const { store, users } = ctx;
  const contracts: Contract[] = [];
  const billings: Billing[] = [];
  let billingSeq = 0;
  const contractOf: Record<number, Partial<Contract> & { status: Contract["status"] }> = {
    29: { status: "liberado" },
    30: { status: "liberado" },
    31: { status: "assinado", financialStatus: "pendente", pendingReason: undefined },
    32: { status: "pendencia", financialStatus: "pendencia", pendingReason: "Divergência entre CNPJ do contrato e o do cadastro fiscal." },
    36: { status: "aguardando_assinatura", financialStatus: "pendente" },
    37: { status: "aguardando_pagamento", financialStatus: "pendente" },
  };

  for (const client of ctx.clients) {
    const n = Number(client.doc.id.slice(-3));
    const status = client.doc.status;
    const hasContract = status === "ativo" || status === "inativo" || status === "cancelado" || status === "em_implantacao" || (status === "prospect" && client.stage === "financeiro");
    if (!hasContract) continue;
    const j = client.journey;
    const items: ProposalItem[] = client.products.map((p) => ({ productId: p.productId, productName: p.productName, quantity: p.quantity, setupValue: p.setupValue, monthlyValue: p.monthlyValue, hardwareValue: p.hardwareValue, discountPct: 0 }));
    const t = totals(items);
    const override = contractOf[n];
    const cStatus: Contract["status"] = status === "cancelado" ? "cancelado" : override?.status ?? "liberado";
    const signed = ["assinado", "aguardando_pagamento", "pago", "liberado", "pendencia", "cancelado"].includes(cStatus);
    const released = cStatus === "liberado" || cStatus === "cancelado" || status === "inativo";
    const signedAt = signed ? j.signedAt ?? businessTime(addDays(j.contractAt!, 2)) : undefined;
    const releasedAt = released ? j.releasedAt ?? businessTime(addDays(signedAt!, 1)) : undefined;
    const startDate = releasedAt ? releasedAt.slice(0, 10) + "T12:00:00.000Z" : undefined;
    const billingDay = rng.pick([5, 10, 10, 15, 20]);
    const primary = client.contacts.find((c) => c.isPrimary)!;
    const endDate = startDate ? (status === "ativo" ? nextAnniversary(startDate) : addDays(startDate, 365)) : undefined;
    const opp = ctx.opportunities.find((o) => o.clientId === client.doc.id && o.stage === "ganho");

    const contract = store.add(COLLECTIONS.contracts, id("ctr", n), {
      clientId: client.doc.id,
      opportunityId: opp?.id,
      proposalId: opp?.proposalId,
      number: `CT-${j.contractAt!.slice(0, 4)}-${pad(n, 4)}`,
      version: 1,
      status: cStatus,
      items,
      ...t,
      billingDay,
      firstDueDate: startDate ? dayInCompetence(competence(1, new Date(startDate)), billingDay) : undefined,
      recurrence: "mensal",
      termMonths: 12,
      startDate,
      endDate,
      signers: [
        { name: primary.name, email: primary.email ?? client.doc.email!, role: "Contratante", signedAt, status: signed ? "assinado" : "pendente" },
        { name: users.hercules.name, email: users.hercules.email, role: "Contratada", signedAt, status: signed ? "assinado" : "pendente" },
      ],
      signatureProvider: "mock",
      signatureEnvelopeId: `env_${pad(n, 4)}`,
      signedAt,
      documentHash: signed ? `sha256:${cnpj()}${pad(n, 4)}` : undefined,
      paymentCondition: "Adesão à vista; mensalidade por boleto/PIX",
      financialStatus: override?.financialStatus ?? (released ? "aprovado" : "pendente"),
      releasedAt,
      releasedBy: releasedAt ? users.karem.id : undefined,
      pendingReason: override?.pendingReason,
      ownerId: users.karem.id,
      documentIds: [],
      createdAt: j.contractAt!,
      updatedAt: releasedAt ?? signedAt ?? j.contractAt!,
    } satisfies SeedDoc<Contract>);
    contracts.push(contract);
    if (opp) opp.contractId = contract.id;
    for (const p of client.products) p.contractId = contract.id;

    // Cobranças: só contratos liberados de clientes ativos/em implantação.
    if (cStatus !== "liberado" || !startDate) continue;
    const startComp = competence(0, new Date(startDate));
    const firstComp = competence(-5) > startComp ? competence(-5) : startComp;
    const isRisk = client.doc.healthLevel === "risco";
    // Adesão e hardware entram na primeira cobrança de contratos recentes.
    if (startComp >= competence(-5) && (t.setupTotal > 0 || t.hardwareTotal > 0)) {
      for (const [type, amount] of [["setup", t.setupTotal], ["hardware", t.hardwareTotal]] as const) {
        if (amount <= 0) continue;
        billingSeq += 1;
        const dueDate = addDays(startDate, 3);
        const paid = isPast(dueDate);
        billings.push(
          store.add(COLLECTIONS.billing, id("bill", billingSeq, 4), {
            clientId: client.doc.id,
            contractId: contract.id,
            type,
            competence: startComp,
            amount,
            dueDate,
            paidAt: paid ? addDays(dueDate, -1) : undefined,
            paidAmount: paid ? amount : undefined,
            status: paid ? "paga" : "aberta",
            method: paid ? rng.pick(["pix", "boleto", "cartao"]) : undefined,
            createdAt: startDate,
          } satisfies SeedDoc<Billing>),
        );
      }
    }
    if (t.monthlyTotal <= 0) continue;
    let installment = monthsBetween(startComp, firstComp) + 1;
    for (let m = -5; m <= 2; m++) {
      const comp = competence(m);
      if (comp < firstComp) continue;
      const dueDate = dayInCompetence(comp, billingDay);
      const past = isPast(dueDate);
      let bStatus: Billing["status"] = "aberta";
      if (past) bStatus = (isRisk && m === -1) || rng.chance(0.04) ? "vencida" : "paga";
      billingSeq += 1;
      billings.push(
        store.add(COLLECTIONS.billing, id("bill", billingSeq, 4), {
          clientId: client.doc.id,
          contractId: contract.id,
          type: "mensalidade",
          competence: comp,
          installment,
          amount: t.monthlyTotal,
          dueDate,
          paidAt: bStatus === "paga" ? addDays(dueDate, rng.int(-3, 2)) : undefined,
          paidAmount: bStatus === "paga" ? t.monthlyTotal : undefined,
          status: bStatus,
          method: bStatus === "paga" ? rng.pick(["pix", "boleto", "boleto", "cartao"]) : "boleto",
          createdAt: minIso(dayInCompetence(comp, 1), NOW.toISOString()),
        } satisfies SeedDoc<Billing>),
      );
      installment += 1;
    }
  }
  ctx.contracts = contracts;
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// ---------------------------------------------------------------------------
// Visitas, prospecção ativa e comunicações
// ---------------------------------------------------------------------------

function seedVisits(ctx: SeedContext): void {
  const { store, users } = ctx;
  const plan: { client: number; opp?: number; seller: string; when: string; status: Visit["status"]; objective: string; result?: string }[] = [
    { client: 33, opp: 1, seller: users.vinicius.id, when: daysAgo(3, 10), status: "realizada", objective: "Diagnóstico no ponto de venda", result: "Levantados 2 caixas e necessidade de TEF. Proposta a enviar." },
    { client: 34, opp: 2, seller: users.igor.id, when: daysAgo(6, 15), status: "realizada", objective: "Apresentação do ERP e proposta", result: "Proposta apresentada; decisor pediu prazo até sexta." },
    { client: 21, seller: users.vinicius.id, when: daysAgo(10, 9), status: "realizada", objective: "Visita de relacionamento (cliente em risco)", result: "Cliente insatisfeito com lentidão do PDV; chamado aberto." },
    { client: 35, opp: 3, seller: users.vinicius.id, when: daysFromNow(0, 15), status: "agendada", objective: "Negociação final da adesão" },
    { client: 13, opp: 18, seller: users.igor.id, when: daysFromNow(2, 10), status: "agendada", objective: "Demonstração do Omnichannel" },
    { client: 37, opp: 5, seller: users.igor.id, when: daysAgo(1, 16), status: "cancelada", objective: "Coleta de assinatura presencial", result: "Cliente optou por assinatura digital." },
  ];
  plan.forEach((v, i) => {
    const client = clientById(ctx, id("client", v.client));
    store.add(COLLECTIONS.visits, id("visit", i + 1), {
      clientId: client.doc.id,
      opportunityId: v.opp ? id("opp", v.opp) : undefined,
      sellerId: v.seller,
      address: client.doc.address,
      scheduledAt: v.when,
      durationMinutes: rng.pick([45, 60, 90]),
      objective: v.objective,
      result: v.result,
      status: v.status,
      createdAt: pastOnly(addDays(v.when, -rng.int(2, 6))),
    } satisfies SeedDoc<Visit>);
  });
}

function seedProspecting(ctx: SeedContext): void {
  const { store, users } = ctx;
  const lists: (SeedDoc<ProspectList> & { id: string })[] = [
    { id: "plist_001", name: "Supermercados do Cariri sem TEF", description: "Base levantada com contadores parceiros.", segment: "supermercado", ownerId: users.luciano.id, campaignId: "camp_001", status: "ativa", totals: { contacts: 12, attempts: 0, responses: 0, opportunities: 0 } },
    { id: "plist_002", name: "Farmácias de Fortaleza e Sobral", description: "Lista comprada para campanha de Internotas.", segment: "farmacia", ownerId: users.mateus.id, campaignId: "camp_002", status: "ativa", totals: { contacts: 8, attempts: 0, responses: 0, opportunities: 0 } },
  ];
  const statuses: Prospect["status"][] = ["novo", "novo", "novo", "tentativa", "tentativa", "tentativa", "contatado", "contatado", "respondeu", "descartado"];
  let seq = 0;
  for (const { id: listId, ...list } of lists) {
    const doc = store.add(COLLECTIONS.prospectLists, listId, { ...list, createdAt: daysAgo(20) });
    const count = list.totals.contacts;
    for (let i = 0; i < count; i++) {
      seq += 1;
      const status = statuses[i % statuses.length];
      const city = listId === "plist_001" ? rng.pick(CITIES.slice(0, 3)) : rng.pick([CITIES[3], CITIES[4]]);
      const attempts = status === "novo" ? 0 : status === "tentativa" ? rng.int(1, 3) : rng.int(1, 4);
      const name = personName();
      store.add(COLLECTIONS.prospects, id("prospect", seq), {
        listId,
        name,
        company: `${list.segment === "supermercado" ? rng.pick(["Mercadinho", "Supermercado", "Mercantil"]) : rng.pick(["Farmácia", "Drogaria"])} ${rng.pick(["São José", "Central", "Popular", "do Povo", "Santa Rita", "Boa Sorte", "Cariri", "Nova"])}`,
        phone: phone(city.ddd),
        email: rng.chance(0.5) ? emailFor(name, "hotmail.com") : undefined,
        city: city.name,
        ownerId: list.ownerId,
        status,
        attempts,
        lastAttemptAt: attempts ? businessTime(daysAgo(rng.int(0, 10))) : undefined,
        nextActionAt: status === "novo" || status === "tentativa" ? daysFromNow(rng.int(0, 3), rng.int(9, 16)) : undefined,
        result: status === "respondeu" ? "Interessado em conhecer o sistema; pediu contato de vendas." : status === "descartado" ? "Já possui sistema com contrato vigente." : undefined,
        createdAt: daysAgo(20),
      } satisfies SeedDoc<Prospect>);
      doc.totals.attempts += attempts;
      if (status === "respondeu" || status === "contatado") doc.totals.responses += 1;
    }
  }
}

function seedCommunications(ctx: SeedContext): void {
  const { store, users } = ctx;
  const plan: { client: number; channel: Communication["channel"]; direction: Communication["direction"]; user?: string; body?: string; status: Communication["status"]; hoursAgo: number; duration?: number; entity?: { type: string; id: string } }[] = [
    { client: 33, channel: "whatsapp", direction: "saida", user: users.vinicius.id, body: "Olá! Segue a apresentação do ERP Intersys que combinamos na visita.", status: "lida", hoursAgo: 50, entity: { type: "opportunity", id: "opp_001" } },
    { client: 33, channel: "whatsapp", direction: "entrada", body: "Recebi, vou olhar com meu sócio e retorno.", status: "recebida", hoursAgo: 48 },
    { client: 34, channel: "voip", direction: "saida", user: users.igor.id, status: "entregue", hoursAgo: 30, duration: 412, entity: { type: "opportunity", id: "opp_002" } },
    { client: 35, channel: "email", direction: "saida", user: users.vinicius.id, body: "Proposta comercial PR-2026-0002 — Modas Juazeiro", status: "enviada", hoursAgo: 72, entity: { type: "proposal", id: "prop_002" } },
    { client: 36, channel: "email", direction: "saida", user: users.karem.id, body: "Contrato enviado para assinatura digital.", status: "entregue", hoursAgo: 20, entity: { type: "contract", id: "ctr_036" } },
    { client: 3, channel: "whatsapp", direction: "entrada", body: "O PDV travou de novo, estamos sem vender!", status: "recebida", hoursAgo: 5 },
    { client: 3, channel: "whatsapp", direction: "saida", user: users.rafael.id, body: "Já estou acessando remotamente, um minuto.", status: "lida", hoursAgo: 4.8 },
    { client: 21, channel: "voip", direction: "entrada", status: "recebida", hoursAgo: 26, duration: 615 },
    { client: 29, channel: "whatsapp", direction: "saida", user: users.marcos.id, body: "Bom dia! Ainda aguardamos o certificado digital para seguir com a configuração fiscal.", status: "entregue", hoursAgo: 28, entity: { type: "project", id: "proj_003" } },
    { client: 14, channel: "whatsapp", direction: "saida", user: users.camila.id, body: "Oi! Notei que a equipe está usando pouco o módulo de estoque. Posso agendar um reforço de treinamento?", status: "lida", hoursAgo: 60 },
    { client: 38, channel: "whatsapp", direction: "saida", user: users.luciano.id, body: "Olá! Vi que você pediu contato pelo nosso site. Qual o melhor horário para conversarmos?", status: "simulada", hoursAgo: 8, entity: { type: "lead", id: "lead_004" } },
    { client: 39, channel: "whatsapp", direction: "entrada", body: "Quero saber o valor do sistema para ótica.", status: "recebida", hoursAgo: 12, entity: { type: "lead", id: "lead_005" } },
    { client: 25, channel: "email", direction: "saida", user: users.felipe.id, body: "Bem-vindo à Intercert! Seus canais de suporte e sua analista de sucesso.", status: "enviada", hoursAgo: 240 },
    { client: 1, channel: "interno", direction: "saida", user: users.igor.id, body: "Cliente pediu orçamento de PABX durante ligação de follow-up.", status: "simulada", hoursAgo: 100, entity: { type: "opportunity", id: "opp_010" } },
    { client: 31, channel: "whatsapp", direction: "saida", user: users.bruno.id, body: "Treinamento concluído! Amanhã acompanhamos o primeiro dia de operação.", status: "lida", hoursAgo: 18, entity: { type: "project", id: "proj_005" } },
  ];
  plan.forEach((c, i) => {
    const client = clientById(ctx, id("client", c.client));
    store.add(COLLECTIONS.communications, id("comm", i + 1), {
      clientId: client.doc.id,
      contactId: client.contacts[0].id,
      channel: c.channel,
      direction: c.direction,
      userId: c.user,
      entityType: c.entity?.type,
      entityId: c.entity?.id,
      body: c.body,
      status: c.status,
      durationSeconds: c.duration,
      recordingUrl: c.channel === "voip" ? `https://mock.intercert.com.br/gravacoes/${id("comm", i + 1)}.mp3` : undefined,
      externalId: `mock_${pad(i + 1, 4)}`,
      provider: "mock",
      createdAt: hoursAgo(c.hoursAgo),
    } satisfies SeedDoc<Communication>);
  });
}

export async function seedSales(ctx: SeedContext): Promise<void> {
  seedLeads(ctx);
  seedOpportunities(ctx);
  seedContracts(ctx);
  seedVisits(ctx);
  seedProspecting(ctx);
  seedCommunications(ctx);
}
