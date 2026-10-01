/**
 * Dados derivados, calculados pelos próprios motores depois que o seed foi gravado:
 * - comissões e títulos a pagar pelo MOTOR DE COMISSÕES (D19) a partir dos contratos, cobranças e regras do seed,
 *   com a data de referência do seed (sem eventos: o seed não dispara notificações/automações); em seguida parte dos
 *   títulos percorre o fluxo real (aprovar → programar → pagar) pelos mesmos serviços da tela;
 * - kpi_snapshots dos 7 meses anteriores (empresa, departamentos e colaboradores), com IDs determinísticos
 *   do motor (snap_<kpi>_<período>_<escopo>_<id>) — assim histórico, tendência e drill-down batem;
 * - fechamento do bônus da competência anterior (bonus_<userId>_<AAAA-MM>), como o botão "Fechar competência".
 *
 * Requer o seed rodando com `--conditions=react-server` (os motores são server-only).
 */
import { listRecentMonths, previousPeriod, currentMonthKey, monthPeriod } from "../../src/server/kpis/period";
import { COLLECTIONS, type Billing, type Contract, type FinanceCategory, type Payable, type Settings } from "../../src/domain/types";
import { getById, getManyByIds, list, update } from "../../src/server/db";
import { dateKey } from "../../src/lib/format";
import { NOW, addDays, competence, daysAgo, daysFromNow } from "./lib";
import { PRODUCT_IDS } from "./catalog";

/**
 * Boletos registrados manualmente (D32) pelo serviço `registerBoleto` em 2 cobranças abertas de contratos liberados
 * (sem provedor de cobrança: emitidos "no banco" e registrados na cobrança), sem emitir eventos.
 */
export async function seedBoletos(): Promise<{ registered: string[] }> {
  const { registerBoleto } = await import("../../src/server/finance/service");
  const open = (await list<Billing>(COLLECTIONS.billing, { where: [["status", "==", "aberta"]] })).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const contracts = await getManyByIds<Contract>(COLLECTIONS.contracts, open.map((b) => b.contractId));
  const chosen = open.filter((b) => contracts.get(b.contractId)?.status === "liberado").slice(0, 2);
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const registered: string[] = [];
  for (const [i, b] of chosen.entries()) {
    const seq = String(i + 1).padStart(2, "0");
    await registerBoleto(
      {
        billingId: b.id,
        linhaDigitavel: `75691.23456 01234.567890 12345.678901 ${i + 1} 9${dateKey(b.dueDate).replace(/-/g, "").slice(2)}0${String(Math.round(b.amount * 100)).padStart(10, "0")}`.slice(0, 54),
        nossoNumero: `2026${seq}${b.id.replace(/\D/g, "").padStart(6, "0")}`,
        banco: "Sicoob",
        emitidoEm: dateKey(addDays(b.dueDate, -12) < NOW.toISOString() ? addDays(b.dueDate, -12) : NOW.toISOString()),
      },
      karem,
      { emit: false },
    );
    registered.push(b.id);
  }
  return { registered };
}

/**
 * Aditivo aplicado (D32) no contrato liberado de client_028 (venda com fechamento estruturado e vendedor): inclusão
 * do Intercert Ponto com vigência no mês que vem, sem assinatura do cliente (aplicação direta). Passa pelo serviço
 * real: contrato v2 com a v1 preservada, cobranças futuras refeitas (mesma numeração), produtos do cliente
 * sincronizados e comissões previstas recalculadas. Sem eventos (o seed não dispara notificações).
 */
export async function seedAmendments(): Promise<{ applied: string[]; version: number | null }> {
  const { applyAmendment, createAmendment } = await import("../../src/server/finance/amendments");
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const contract = await getById<Contract>(COLLECTIONS.contracts, "ctr_028");
  if (!contract || contract.status !== "liberado") return { applied: [], version: null };
  const ponto = contract.items.some((i) => i.productId === PRODUCT_IDS.ponto);
  const items = [...contract.items.map((i) => ({ ...i })), ...(ponto ? [] : [{ productId: PRODUCT_IDS.ponto, productName: "Intercert Ponto", quantity: 1, setupValue: 300, monthlyValue: 79, hardwareValue: 0, discountPct: 0 }])];
  const nextMonth = `${competence(1)}-01`;
  const amendment = await createAmendment(
    { contractId: contract.id, effectiveFrom: nextMonth, reason: "Inclusão do controle de ponto a pedido do cliente (ajuste interno acordado por e-mail)", requiresSignature: false, items },
    karem,
    { emit: false },
  );
  const r = await applyAmendment(amendment.id, karem, { emit: false, notifyIndexPending: false });
  return { applied: [amendment.number], version: r.contract.version };
}

/**
 * Portal do Cliente (D32/D31): 1 link ativo (90 dias, origem "manual") para o cliente da 1ª cobrança com boleto
 * registrado (contrato liberado), pelo serviço real e sem eventos. O token é descartado aqui (só o hash é gravado): o
 * e2e gera o próprio link pela tela.
 */
export async function seedPortalLinks(billingIds: string[]): Promise<{ clientId: string | null; links: number }> {
  const { createPortalLink } = await import("../../src/server/portal/service");
  const billings = await getManyByIds<Billing>(COLLECTIONS.billing, billingIds);
  const first = billingIds.map((id) => billings.get(id)).find((b): b is Billing => Boolean(b));
  if (!first) return { clientId: null, links: 0 };
  const contract = await getById<Contract>(COLLECTIONS.contracts, first.contractId);
  if (!contract || contract.status !== "liberado") return { clientId: null, links: 0 };
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  await createPortalLink({ clientId: contract.clientId, contractId: contract.id, days: 90, label: "Financeiro do cliente (demonstração)", origin: "manual" }, karem, { emit: false, now: new Date(daysAgo(3)) });
  return { clientId: contract.clientId, links: 1 };
}

/**
 * Contas a Pagar geral (D32): 2 fornecedores, 1 título parcelado (3x) e 1 recorrente mensal, pelos serviços reais
 * (sem eventos). Os títulos nascem "previstos": aprovar/pagar é exercício das telas/e2e.
 */
export async function seedPayablesGeneral(): Promise<{ suppliers: number; parcels: number; recurring: number }> {
  const { saveSupplier } = await import("../../src/server/commissions/suppliers");
  const { createManualPayable } = await import("../../src/server/commissions/payables");
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const imobiliaria = await saveSupplier({ name: "Imobiliária Cariri Salas Comerciais", document: "12345678000195", email: "financeiro@caririsalas.com.br", phone: "88999120001", pixKey: "12345678000195", bank: { banco: "Sicoob", agencia: "3001", conta: "12345-6" }, category: "aluguel", notes: "Sala 402 — contrato de locação anual.", active: true }, karem, { emit: false });
  const nuvem = await saveSupplier({ name: "Nuvem Sul Hospedagem e Licenças", email: "cobranca@nuvemsul.com.br", pixKey: "cobranca@nuvemsul.com.br", category: "software", notes: "Servidores e licenças do ERP hospedado.", active: true }, karem, { emit: false });
  const month = dateKey(NOW).slice(0, 7);
  const firstDue = daysFromNow(12).slice(0, 10);
  const parcelado = await createManualPayable(
    { creditorType: "fornecedor", supplierId: nuvem.supplier.id, category: "software", costCenter: "Tecnologia", description: "Renovação anual das licenças de servidor", amount: 5400, competence: month, dueDate: firstDue, installments: 3, notes: "Parcelado em 3x conforme proposta do fornecedor.", attachmentUrl: "https://drive.example.com/nf/nuvem-sul-2026.pdf", attachmentName: "NF Nuvem Sul — licenças" },
    karem,
    { emit: false, createdAt: daysAgo(2) },
  );
  const recorrente = await createManualPayable(
    { creditorType: "fornecedor", supplierId: imobiliaria.supplier.id, category: "aluguel", costCenter: "Administrativo", description: "Aluguel da sala 402", amount: 2800, competence: month, dueDate: `${month}-10`, recurrence: { frequency: "mensal", dayOfMonth: 10 }, notes: "Série mensal; reajuste anual pelo índice do contrato de locação." },
    karem,
    { emit: false, createdAt: daysAgo(20) },
  );
  return { suppliers: 2, parcels: parcelado.parcels?.length ?? 1, recurring: recorrente.seriesId ? 1 : 0 };
}

/**
 * Baixa parcial e título a receber avulso (etapa CP/CR 3), pelos serviços reais e sem eventos: 1 título a pagar de
 * fornecedor aprovado/programado com BAIXA PARCIAL de 40% na conta corrente (fica "Parcial", vence em 8 dias) e 1 título
 * a receber AVULSO (consultoria fora de contrato, categoria de receita) com RECEBIMENTO PARCIAL na conta corrente. Cada
 * baixa grava o lançamento de caixa na mesma transação.
 */
export async function seedSettlements(bankAccountId: string): Promise<{ payableId: string; receivableId: string; entries: number }> {
  const { createManualPayable, approvePayable, schedulePayable, partialPayPayable } = await import("../../src/server/commissions/payables");
  const { createReceivables, receiveReceivable } = await import("../../src/server/receivables/service");
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const quiet = { emit: false } as const;
  const month = dateKey(NOW).slice(0, 7);
  const due = daysFromNow(8).slice(0, 10);
  const payable = await createManualPayable({ creditorType: "fornecedor", creditorName: "Climatiza Cariri Refrigeração", category: "outros", costCenter: "Administrativo", description: "Manutenção preventiva dos aparelhos de ar-condicionado", amount: 1800, competence: month, dueDate: due, notes: "Contrato semestral; pagamento combinado em duas vezes." }, karem, { emit: false, createdAt: daysAgo(6) });
  await approvePayable(payable.id, karem, undefined, { emit: false, at: daysAgo(5) });
  await schedulePayable(payable.id, {}, karem, { emit: false, at: daysAgo(5) });
  await partialPayPayable(payable.id, { paidAt: daysAgo(2).slice(0, 10), paymentMethod: "pix", accountId: bankAccountId, amount: 720, notes: "Sinal de 40% na aprovação do orçamento." }, karem, { ...quiet, at: daysAgo(2) });
  const categories = await list<FinanceCategory>(COLLECTIONS.financeCategories);
  const outras = categories.find((c) => c.name === "Outras receitas" && c.type === "receita");
  const [receivable] = await createReceivables({ description: "Consultoria avulsa de parametrização fiscal", amount: 2400, dueDate: daysFromNow(10).slice(0, 10), clientId: "client_003", categoryId: outras?.id, accountId: bankAccountId, documentNumber: "NFS-e 2026/0418", notes: "Serviço fora do contrato: 2 dias de consultoria presencial." }, karem, { emit: false, createdAt: daysAgo(4) });
  await receiveReceivable("parcial", receivable.id, { paidAt: daysAgo(1).slice(0, 10), method: "pix", accountId: bankAccountId, amount: 1000, notes: "Adiantamento combinado." }, karem, { ...quiet, at: daysAgo(1) });
  return { payableId: payable.id, receivableId: receivable.id, entries: 2 };
}

/**
 * Cadastros financeiros (etapa CP/CR 1), pelos serviços reais e sem eventos: 2 contas (conta corrente e caixa), os
 * centros de custo padrão de Contas a Pagar (com a chave antiga) e categorias de receita e despesa com algumas
 * subcategorias. Parte das categorias da configuração fica de fora de propósito: "Importar da configuração" ainda tem
 * o que criar (exercitado pelo e2e 80).
 * Etapa CP/CR 2: roda ANTES do motor de comissões (os títulos pagos pelo seed já baixam com a conta corrente e geram
 * lançamento de caixa) e grava a conta corrente como conta padrão de recebimento (`financeiro_baixa`).
 */
export async function seedFinanceRegistry(): Promise<{ accounts: number; centers: number; categories: number; subcategories: number; bankAccountId: string }> {
  const { saveCostCenter, saveFinanceCategory, saveFinancialAccount } = await import("../../src/server/finance-registry/service");
  const { SETTING_DEFAULTS } = await import("../../src/server/admin/schemas");
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const quiet = { emit: false } as const;
  const bank = (await saveFinancialAccount({ name: "Banco do Brasil — conta movimento", type: "corrente", initialBalance: 48250.35, bankName: "Banco do Brasil", agency: "1234-5", accountNumber: "67890-1", notes: "Conta principal: recebimentos de boletos e PIX." }, karem, quiet)).account;
  // Conta padrão das baixas automáticas (provedor/conciliação) e pré-seleção do "Registrar pagamento".
  await update<Settings>(COLLECTIONS.settings, "setting_financeiro_baixa", { value: { ...SETTING_DEFAULTS.financeiro_baixa, contaRecebimentoPadraoId: bank.id } });
  await saveFinancialAccount({ name: "Caixa da empresa", type: "dinheiro", initialBalance: 650, notes: "Dinheiro em espécie para pequenas despesas." }, karem, quiet);
  const centers = new Map<string, string>();
  for (const name of SETTING_DEFAULTS.contas_a_pagar.centrosDeCusto) centers.set(name, (await saveCostCenter({ name, legacyKey: name }, karem, quiet)).center.id);
  let categories = 0;
  let subcategories = 0;
  const tree: { name: string; type: "receita" | "despesa"; center: string; legacyKey?: string; subs?: string[] }[] = [
    { name: "Comissão comercial", type: "despesa", center: "Comercial", legacyKey: "comissao_comercial" },
    { name: "Aluguel", type: "despesa", center: "Administrativo", legacyKey: "aluguel" },
    { name: "Software e assinaturas", type: "despesa", center: "Tecnologia", legacyKey: "software", subs: ["Licenças", "Hospedagem"] },
    { name: "Deslocamento", type: "despesa", center: "Operações", subs: ["Diárias", "Combustível"] },
    { name: "Pessoal", type: "despesa", center: "Administrativo", subs: ["Salários", "Benefícios"] },
    { name: "Receita de contratos", type: "receita", center: "Comercial", subs: ["Adesão", "Mensalidades"] },
    { name: "Outras receitas", type: "receita", center: "Administrativo" },
  ];
  for (const t of tree) {
    const parent = (await saveFinanceCategory({ name: t.name, type: t.type, parentId: null, costCenterId: centers.get(t.center)!, legacyKey: t.legacyKey }, karem, quiet)).category;
    categories++;
    for (const name of t.subs ?? []) {
      await saveFinanceCategory({ name, parentId: parent.id, costCenterId: null }, karem, quiet);
      subcategories++;
    }
  }
  return { accounts: 2, centers: centers.size, categories, subcategories, bankAccountId: bank.id };
}

export interface CommissionSeedResult {
  commissions: number;
  payables: number;
  paid: number;
  scheduled: number;
  approved: number;
}

/**
 * Comissões pelo motor (data de referência = NOW do seed) e títulos em estados variados pelo fluxo real:
 * elegíveis de meses anteriores → pagos no vencimento (menos os 2 mais recentes, que ficam vencidos a pagar);
 * elegíveis do mês → metade aprovada, metade prevista. Com `accountId` (etapa CP/CR 2), cada pagamento baixa com a conta e
 * grava o lançamento de despesa na mesma transação (como a tela).
 */
export async function seedCommissionEngine(accountId?: string): Promise<CommissionSeedResult> {
  const { reconcileCommissions } = await import("../../src/server/commissions/engine");
  const { approvePayable, schedulePayable, payPayable } = await import("../../src/server/commissions/payables");
  const r = await reconcileCommissions({ now: NOW, emit: false, backfill: true });
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const today = dateKey(NOW);
  const month = today.slice(0, 7);
  const payables = (await list<Payable>(COLLECTIONS.payables)).filter((p) => p.origin === "comissao_automatica").sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const out: CommissionSeedResult = { commissions: r.created, payables: payables.length, paid: 0, scheduled: 0, approved: 0 };
  const past = payables.filter((p) => p.competence < month);
  const current = payables.filter((p) => p.competence >= month);
  const due = past.filter((p) => dateKey(p.dueDate) <= today);
  // Todos os vencidos são pagos no vencimento, menos os 2 mais recentes (exemplo de título vencido a pagar).
  const unpaid = new Set(due.slice(-2).map((p) => p.id));
  for (const p of past) {
    const approvedAt = addDays(p.createdAt, 2) < NOW.toISOString() ? addDays(p.createdAt, 2) : NOW.toISOString();
    await approvePayable(p.id, karem, undefined, { emit: false, at: approvedAt });
    await schedulePayable(p.id, {}, karem, { emit: false, at: approvedAt });
    out.scheduled++;
    if (dateKey(p.dueDate) <= today && !unpaid.has(p.id)) {
      await payPayable(p.id, { paidAt: dateKey(p.dueDate), paymentMethod: "folha", accountId }, karem, { emit: false, at: p.dueDate });
      out.paid++;
    }
  }
  for (const [i, p] of current.entries()) {
    if (i % 2 === 1) continue;
    await approvePayable(p.id, karem, undefined, { emit: false });
    out.approved++;
  }
  return out;
}

export async function seedDerived(): Promise<{ snapshots: number; skipped: number; bonus: number }> {
  const { storeSnapshots, invalidateDataBundleCache } = await loadEngine();
  const { storeBonusResults } = await import("../../src/server/performance/bonus");
  invalidateDataBundleCache();
  const current = monthPeriod(currentMonthKey());
  const months = listRecentMonths(7, previousPeriod(current));
  let snapshots = 0;
  let skipped = 0;
  for (const m of months) {
    const r = await storeSnapshots(m);
    snapshots += r.written;
    skipped += r.skipped;
  }
  const bonus = await storeBonusResults(previousPeriod(current));
  return { snapshots, skipped, bonus: bonus.written };
}

async function loadEngine() {
  const engine = await import("../../src/server/kpis/engine");
  const formulas = await import("../../src/server/kpis/formulas");
  return { storeSnapshots: engine.storeSnapshots, invalidateDataBundleCache: formulas.invalidateDataBundle };
}
