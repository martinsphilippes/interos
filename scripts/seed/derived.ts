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
import { COLLECTIONS, type Billing, type Contract, type Payable } from "../../src/domain/types";
import { getById, getManyByIds, list } from "../../src/server/db";
import { dateKey } from "../../src/lib/format";
import { NOW, addDays, daysAgo, daysFromNow } from "./lib";
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
  const nextMonth = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const amendment = await createAmendment(
    { contractId: contract.id, effectiveFrom: nextMonth, reason: "Inclusão do controle de ponto a pedido do cliente (ajuste interno acordado por e-mail)", requiresSignature: false, items },
    karem,
    { emit: false },
  );
  const r = await applyAmendment(amendment.id, karem, { emit: false, notifyIndexPending: false });
  return { applied: [amendment.number], version: r.contract.version };
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
 * elegíveis do mês → metade aprovada, metade prevista.
 */
export async function seedCommissionEngine(): Promise<CommissionSeedResult> {
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
      await payPayable(p.id, { paidAt: dateKey(p.dueDate), paymentMethod: "folha" }, karem, { emit: false, at: p.dueDate });
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
