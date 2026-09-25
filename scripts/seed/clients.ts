/**
 * Clientes (45), contatos e produtos contratados. Também define os marcos da jornada de cada
 * cliente (ctx.clients[].journey), que os demais módulos usam para manter datas coerentes.
 */
import { COLLECTIONS, type Client, type ClientProduct, type Contact } from "../../src/domain/types";
import type { HealthLevel, JourneyStage } from "../../src/domain/constants";
import { CITIES, addDays, address, businessTime, cnpj, daysAgo, daysFromNow, emailFor, id, landline, personName, phone, rng, type SeedDoc, type Segment } from "./lib";
import type { Journey, SeedContext, SeededClient } from "./context";
import { LEAD_SOURCE_KEYS, PRODUCT_IDS, splitOrigin } from "./catalog";

type Status = Client["status"];

interface ClientSpec {
  tradeName: string;
  legalName: string;
  segment: Segment;
  city: number; // índice em CITIES
}

// 45 empresas fictícias do Cariri e Nordeste, na ordem dos IDs client_001..client_045.
const SPECS: ClientSpec[] = [
  { tradeName: "Supermercado Bom Jesus", legalName: "Bom Jesus Comércio de Alimentos LTDA", segment: "supermercado", city: 0 },
  { tradeName: "Farmácia Padre Cícero", legalName: "Drogaria Padre Cícero LTDA", segment: "farmacia", city: 0 },
  { tradeName: "Churrascaria Cariri Grill", legalName: "Cariri Grill Restaurante LTDA", segment: "restaurante", city: 1 },
  { tradeName: "Atacadão do Sertão", legalName: "Sertão Distribuidora de Alimentos LTDA", segment: "atacado", city: 0 },
  { tradeName: "Modas Araripe", legalName: "Araripe Confecções e Comércio LTDA", segment: "loja_de_roupas", city: 2 },
  { tradeName: "Auto Center Nordeste", legalName: "Nordeste Autopeças e Serviços LTDA", segment: "autopecas", city: 3 },
  { tradeName: "Construmax Juazeiro", legalName: "Juazeiro Materiais de Construção LTDA", segment: "material_de_construcao", city: 0 },
  { tradeName: "Ótica Visão Real", legalName: "Visão Real Ótica LTDA", segment: "otica", city: 1 },
  { tradeName: "Agropet Vitória", legalName: "Vitória Pet Shop e Agropecuária LTDA", segment: "pet_shop", city: 0 },
  { tradeName: "Magazine Popular", legalName: "Popular Magazine Comércio LTDA", segment: "varejo", city: 4 },
  { tradeName: "Mercadinho Santa Clara", legalName: "Santa Clara Mercantil LTDA", segment: "supermercado", city: 2 },
  { tradeName: "Drogaria Central", legalName: "Central Drogaria e Perfumaria LTDA", segment: "farmacia", city: 5 },
  { tradeName: "Pizzaria Bella Serra", legalName: "Bella Serra Alimentos LTDA", segment: "restaurante", city: 1 },
  { tradeName: "Distribuidora Líder", legalName: "Líder Distribuidora de Bebidas LTDA", segment: "atacado", city: 6 },
  { tradeName: "Boutique Primavera", legalName: "Primavera Modas LTDA", segment: "loja_de_roupas", city: 3 },
  { tradeName: "Peças & Cia Cariri", legalName: "Cariri Peças e Acessórios LTDA", segment: "autopecas", city: 0 },
  { tradeName: "Casa do Construtor Crato", legalName: "Crato Materiais e Ferragens LTDA", segment: "material_de_construcao", city: 1 },
  { tradeName: "Óticas Horizonte", legalName: "Horizonte Comércio de Óculos LTDA", segment: "otica", city: 7 },
  { tradeName: "Clínica Veterinária Amigo Fiel", legalName: "Amigo Fiel Serviços Veterinários LTDA", segment: "pet_shop", city: 3 },
  { tradeName: "Bazar Estrela", legalName: "Estrela Variedades LTDA", segment: "varejo", city: 8 },
  { tradeName: "Hipermercado Cidade", legalName: "Cidade Hipermercados LTDA", segment: "supermercado", city: 3 },
  { tradeName: "Farmácias Aliança", legalName: "Aliança Rede de Farmácias LTDA", segment: "farmacia", city: 0 },
  { tradeName: "Lanchonete Ponto Certo", legalName: "Ponto Certo Lanches LTDA", segment: "restaurante", city: 2 },
  { tradeName: "Atacado Preço Bom", legalName: "Preço Bom Atacadista LTDA", segment: "atacado", city: 4 },
  { tradeName: "Confecções Serrano", legalName: "Serrano Indústria e Comércio de Roupas LTDA", segment: "loja_de_roupas", city: 0 },
  { tradeName: "Supermercado Família", legalName: "Família Supermercados LTDA", segment: "supermercado", city: 1 },
  // 27-32: em implantação
  { tradeName: "Autopeças Moderna", legalName: "Moderna Autopeças LTDA", segment: "autopecas", city: 5 },
  { tradeName: "Construmax Barbalha", legalName: "Barbalha Materiais de Construção LTDA", segment: "material_de_construcao", city: 2 },
  { tradeName: "Ótica São Francisco", legalName: "São Francisco Ótica LTDA", segment: "otica", city: 0 },
  { tradeName: "Pet Shop Boa Vista", legalName: "Boa Vista Pet LTDA", segment: "pet_shop", city: 6 },
  { tradeName: "Loja Ideal", legalName: "Ideal Comércio Varejista LTDA", segment: "varejo", city: 0 },
  { tradeName: "Mercantil Progresso", legalName: "Progresso Mercantil LTDA", segment: "supermercado", city: 7 },
  // 33-37: prospects
  { tradeName: "Drogaria Novo Horizonte", legalName: "Novo Horizonte Drogaria LTDA", segment: "farmacia", city: 1 },
  { tradeName: "Restaurante Sabor do Sertão", legalName: "Sabor do Sertão Restaurante LTDA", segment: "restaurante", city: 0 },
  { tradeName: "Distribuidora Big", legalName: "Big Distribuidora LTDA", segment: "atacado", city: 3 },
  { tradeName: "Modas Juazeiro", legalName: "Juazeiro Confecções LTDA", segment: "loja_de_roupas", city: 0 },
  { tradeName: "Auto Center Sul", legalName: "Sul Autopeças LTDA", segment: "autopecas", city: 8 },
  // 38-41: leads
  { tradeName: "Materiais Econômica", legalName: "Econômica Materiais de Construção LTDA", segment: "material_de_construcao", city: 4 },
  { tradeName: "Ótica Real", legalName: "Real Ótica LTDA", segment: "otica", city: 2 },
  { tradeName: "Agropet Sertão", legalName: "Sertão Agropecuária LTDA", segment: "pet_shop", city: 5 },
  { tradeName: "Variedades Bom Preço", legalName: "Bom Preço Variedades LTDA", segment: "varejo", city: 0 },
  // 42-43: inativos
  { tradeName: "Mercadinho Serrano", legalName: "Serrano Mercadinho LTDA", segment: "supermercado", city: 2 },
  { tradeName: "Farmácia Vitória", legalName: "Vitória Farmácia LTDA", segment: "farmacia", city: 6 },
  // 44-45: cancelados
  { tradeName: "Pizzaria Estrela", legalName: "Estrela Pizzaria LTDA", segment: "restaurante", city: 1 },
  { tradeName: "Loja Real Modas", legalName: "Real Modas LTDA", segment: "loja_de_roupas", city: 7 },
];

function statusFor(n: number): Status {
  if (n <= 26) return "ativo";
  if (n <= 32) return "em_implantacao";
  if (n <= 37) return "prospect";
  if (n <= 41) return "lead";
  if (n <= 43) return "inativo";
  return "cancelado";
}

function stageFor(n: number, status: Status): JourneyStage {
  if (status === "ativo") return n <= 8 || n >= 25 ? "cs" : "suporte";
  if (status === "em_implantacao") return "implantacao";
  if (status === "prospect") return n <= 35 ? "vendas" : "financeiro";
  if (status === "lead") return "marketing";
  if (status === "inativo") return "cs";
  return "suporte";
}

const RISK_CLIENTS = [3, 14, 21];
const ATTENTION_CLIENTS = [5, 9, 12, 17, 23];
function healthFor(n: number): { score: number; level: HealthLevel } {
  if (RISK_CLIENTS.includes(n)) return { score: rng.int(25, 49), level: "risco" };
  if (ATTENTION_CLIENTS.includes(n)) return { score: rng.int(50, 74), level: "atencao" };
  return { score: rng.int(75, 96), level: "saudavel" };
}

/** Data alguns dias antes de outra, em horário comercial; nunca depois da referência. */
function before(isoDate: string, minDays: number, maxDays: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() - rng.int(minDays, maxDays));
  const candidate = businessTime(d.toISOString());
  if (candidate < isoDate) return candidate;
  return new Date(new Date(isoDate).getTime() - rng.int(1, 3) * 3_600_000).toISOString();
}

/** Marcos anteriores ao início da implantação, contados para trás. */
function backfillToImplementation(implementationStartAt: string): Journey {
  const releasedAt = before(implementationStartAt, 1, 3);
  const paidAt = before(releasedAt, 0, 1);
  const signedAt = before(paidAt, 1, 5);
  const contractAt = before(signedAt, 1, 4);
  const wonAt = before(contractAt, 0, 2);
  const proposalAt = before(wonAt, 3, 15);
  const opportunityAt = before(proposalAt, 2, 10);
  const qualifiedAt = before(opportunityAt, 0, 3);
  const leadAt = before(qualifiedAt, 1, 10);
  return { leadAt, qualifiedAt, opportunityAt, proposalAt, wonAt, contractAt, signedAt, paidAt, releasedAt, implementationStartAt };
}

function journeyFor(n: number, status: Status, stage: JourneyStage): Journey {
  if (status === "ativo" || status === "inativo" || status === "cancelado") {
    let activatedDaysAgo: number;
    if (n === 25) activatedDaysAgo = 12;
    else if (n === 26) activatedDaysAgo = 18;
    else if (status === "ativo" && stage === "cs") activatedDaysAgo = rng.int(10, 25);
    else if (status === "ativo") activatedDaysAgo = rng.int(45, 1095);
    else if (status === "inativo") activatedDaysAgo = rng.int(400, 800);
    else activatedDaysAgo = rng.int(500, 700);
    const activatedAt = businessTime(daysAgo(activatedDaysAgo));
    const goLiveAt = before(activatedAt, 0, 2);
    const trainingAt = before(goLiveAt, 1, 3);
    const implementationStartAt = before(trainingAt, 6, 15);
    const j = backfillToImplementation(implementationStartAt);
    return { ...j, trainingAt, goLiveAt, activatedAt, cancelledAt: status === "cancelado" ? businessTime(daysAgo(rng.int(20, 60))) : undefined };
  }
  if (status === "em_implantacao") {
    const implementationStartAt = businessTime(daysAgo(rng.int(3, 16)));
    const j = backfillToImplementation(implementationStartAt);
    // O treinamento só aconteceu nos projetos mais adiantados (definido no módulo de implantação).
    return j;
  }
  if (status === "prospect" && stage === "financeiro") {
    const contractAt = businessTime(daysAgo(rng.int(1, 3)));
    const wonAt = before(contractAt, 0, 2);
    const proposalAt = before(wonAt, 3, 12);
    const opportunityAt = before(proposalAt, 2, 8);
    const qualifiedAt = before(opportunityAt, 0, 3);
    const leadAt = before(qualifiedAt, 1, 8);
    return { leadAt, qualifiedAt, opportunityAt, proposalAt, wonAt, contractAt };
  }
  if (status === "prospect") {
    const opportunityAt = businessTime(daysAgo(rng.int(5, 25)));
    const qualifiedAt = before(opportunityAt, 0, 3);
    const leadAt = before(qualifiedAt, 1, 8);
    return { leadAt, qualifiedAt, opportunityAt };
  }
  return { leadAt: businessTime(daysAgo(rng.int(0, 2))) };
}

const SEGMENT_TAGS: Record<Segment, string> = {
  varejo: "varejo",
  supermercado: "supermercado",
  farmacia: "farmacia",
  restaurante: "food-service",
  atacado: "atacado",
  loja_de_roupas: "moda",
  autopecas: "autopecas",
  material_de_construcao: "construcao",
  otica: "otica",
  pet_shop: "pet",
};

/** Produtos contratados por segmento: ERP quase sempre, mais 0-3 complementares. */
function productMix(segment: Segment, n: number): string[] {
  const erp = rng.chance(0.7) ? PRODUCT_IDS.erpIntersys : PRODUCT_IDS.erpGdoor;
  const extras: string[] = [];
  const bySegment: Record<Segment, string[]> = {
    supermercado: [PRODUCT_IDS.tef, PRODUCT_IDS.maquininha, PRODUCT_IDS.ponto, PRODUCT_IDS.banco],
    restaurante: [PRODUCT_IDS.tef, PRODUCT_IDS.omnichannel, PRODUCT_IDS.maquininha],
    farmacia: [PRODUCT_IDS.internotas, PRODUCT_IDS.certificado, PRODUCT_IDS.tef],
    atacado: [PRODUCT_IDS.telefonia, PRODUCT_IDS.pabx, PRODUCT_IDS.internotas, PRODUCT_IDS.ponto],
    loja_de_roupas: [PRODUCT_IDS.omnichannel, PRODUCT_IDS.maquininha, PRODUCT_IDS.tef],
    autopecas: [PRODUCT_IDS.tef, PRODUCT_IDS.telefonia, PRODUCT_IDS.internotas],
    material_de_construcao: [PRODUCT_IDS.tef, PRODUCT_IDS.pabx, PRODUCT_IDS.ponto],
    otica: [PRODUCT_IDS.maquininha, PRODUCT_IDS.omnichannel],
    pet_shop: [PRODUCT_IDS.maquininha, PRODUCT_IDS.omnichannel, PRODUCT_IDS.certificado],
    varejo: [PRODUCT_IDS.tef, PRODUCT_IDS.maquininha, PRODUCT_IDS.internotas],
  };
  const count = n % 4 === 0 ? 0 : rng.int(1, 3);
  extras.push(...rng.pickN(bySegment[segment], count));
  // Um cliente sem ERP (só maquininha + TEF) para variar.
  if (n === 20) return [PRODUCT_IDS.maquininha, PRODUCT_IDS.tef];
  return [erp, ...extras];
}

export async function seedClients(ctx: SeedContext): Promise<void> {
  const { store, users } = ctx;
  const clients: SeededClient[] = [];
  let contactSeq = 0;
  let productSeq = 0;

  SPECS.forEach((spec, idx) => {
    const n = idx + 1;
    const clientId = id("client", n);
    const status = statusFor(n);
    const stage = stageFor(n, status);
    const journey = journeyFor(n, status, stage);
    const city = CITIES[spec.city];
    const isCustomer = status === "ativo" || status === "inativo" || status === "cancelado";
    const health = status === "ativo" ? healthFor(n) : undefined;
    const pickedOrigin = rng.pick(LEAD_SOURCE_KEYS);
    const campaignId = ["anuncio", "instagram", "tiktok", "evento"].includes(pickedOrigin) ? rng.pick(["camp_001", "camp_002", "camp_004", "camp_005"]) : undefined;
    const origin = splitOrigin(pickedOrigin, n);
    let lastInteraction =
      status === "ativo"
        ? health?.level === "risco"
          ? daysAgo(rng.int(25, 40), rng.int(9, 16))
          : daysAgo(rng.int(0, 20), rng.int(9, 16))
        : status === "em_implantacao"
          ? daysAgo(rng.int(0, 4), rng.int(9, 16))
          : status === "prospect" || status === "lead"
            ? daysAgo(rng.int(0, 12), rng.int(9, 16))
            : status === "inativo"
              ? daysAgo(rng.int(60, 120))
              : journey.cancelledAt;
    if (lastInteraction && journey.activatedAt && lastInteraction < journey.activatedAt) lastInteraction = businessTime(addDays(journey.activatedAt, 1));
    const nextInteraction =
      status === "ativo" ? (rng.chance(0.3) ? daysAgo(rng.int(1, 6), 10) : daysFromNow(rng.int(1, 30), 10)) : status === "em_implantacao" || status === "prospect" || status === "lead" ? daysFromNow(rng.int(0, 5), rng.int(9, 16)) : undefined;

    const contractId = isCustomer || status === "em_implantacao" || stage === "financeiro" ? id("ctr", n) : undefined;
    const productIds = status === "lead" || (status === "prospect" && stage === "vendas") ? [] : productMix(spec.segment, n);
    const products: ClientProduct[] = [];
    let mrr = 0;
    for (const productId of productIds) {
      const p = ctx.products[productId];
      productSeq += 1;
      const cpStatus: ClientProduct["status"] = status === "ativo" ? "ativo" : status === "inativo" ? "suspenso" : status === "cancelado" ? "cancelado" : "em_implantacao";
      const quantity = productId === PRODUCT_IDS.maquininha ? rng.int(1, 3) : 1;
      const cp = store.add(COLLECTIONS.clientProducts, id("cp", productSeq, 4), {
        clientId,
        productId,
        productName: p.name,
        quantity,
        setupValue: p.setupPrice,
        monthlyValue: p.monthlyPrice * quantity,
        hardwareValue: p.hardwarePrice * quantity,
        status: cpStatus,
        contractId,
        startedAt: journey.activatedAt ?? journey.implementationStartAt,
        cancelledAt: journey.cancelledAt,
        createdAt: journey.contractAt ?? journey.leadAt,
      } satisfies SeedDoc<ClientProduct>);
      products.push(cp);
      if (cpStatus === "ativo") mrr += cp.monthlyValue;
    }

    const tags = [SEGMENT_TAGS[spec.segment], city.name.toLowerCase().split(" ")[0]];
    if (productIds.length >= 3) tags.push("pacote");
    if (origin === "indicacao") tags.push("indicacao");
    if (health?.level === "risco") tags.push("risco-churn");
    if (n === 25 || n === 26) tags.push("recem-ativado");

    const doc = store.add(COLLECTIONS.clients, clientId, {
      legalName: spec.legalName,
      tradeName: spec.tradeName,
      document: cnpj(),
      segment: spec.segment,
      status,
      origin,
      campaignId,
      leadId: undefined, // preenchido em journey-sales
      phone: landline(city.ddd),
      whatsapp: phone(city.ddd),
      email: `contato@${slugDomain(spec.tradeName)}`,
      website: rng.chance(0.4) ? `https://www.${slugDomain(spec.tradeName)}` : undefined,
      address: address(city, n % 3 === 0),
      ownerSalesId: n % 2 === 0 ? users.igor.id : users.vinicius.id,
      ownerCsId: isCustomer ? (n % 3 === 0 ? users.camila.id : users.felipe.id) : undefined,
      ownerImplementationId: isCustomer || status === "em_implantacao" ? (n % 2 === 0 ? users.marcos.id : users.bruno.id) : undefined,
      mrr,
      healthScore: health?.score,
      healthLevel: health?.level,
      tags,
      notes: n % 5 === 0 ? "Cliente prefere contato por WhatsApp no período da tarde." : undefined,
      activatedAt: journey.activatedAt,
      lastInteractionAt: lastInteraction,
      nextInteractionAt: nextInteraction,
      workflowInstanceId: undefined, // preenchido em journey-workflow
      currentStage: stage,
      createdAt: journey.leadAt,
      updatedAt: lastInteraction ?? journey.leadAt,
    } satisfies SeedDoc<Client>);

    const contacts: Contact[] = [];
    const contactCount = rng.int(1, 3);
    for (let c = 0; c < contactCount; c++) {
      contactSeq += 1;
      const name = personName();
      contacts.push(
        store.add(COLLECTIONS.contacts, id("contact", contactSeq), {
          clientId,
          name,
          role: c === 0 ? rng.pick(["Proprietário", "Sócio", "Gerente geral"]) : rng.pick(["Gerente", "Financeiro", "Operador de caixa", "Contador", "Comprador"]),
          phone: phone(city.ddd),
          whatsapp: phone(city.ddd),
          email: emailFor(name, slugDomain(spec.tradeName)),
          isPrimary: c === 0,
          isDecisionMaker: c === 0 || rng.chance(0.3),
          createdAt: journey.leadAt,
        } satisfies SeedDoc<Contact>),
      );
    }

    clients.push({ doc, city, segment: spec.segment, journey, contacts, products, stage });
  });

  ctx.clients = clients;
}

function slugDomain(tradeName: string): string {
  return `${tradeName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")}.com.br`;
}
