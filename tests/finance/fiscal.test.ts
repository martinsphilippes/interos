/**
 * Faturamento (regras puras): configuração fiscal com padrões, situação da cobrança na fila, itens da nota a partir do
 * contrato e do perfil fiscal do produto, chave de acesso da NF-e e texto do envio.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVOICE_RULES,
  fillInvoiceMessage,
  invoiceItems,
  invoiceKindFor,
  invoiceNumberKey,
  invoiceQueueState,
  isValidAccessKey,
  normalizeAccessKey,
  normalizeFiscalSettings,
} from "@/domain/fiscal";
import type { Billing, ProposalItem } from "@/domain/types";

const TODAY = "2026-10-26";

describe("configuração fiscal", () => {
  it("sem nada gravado: ligada, padrões por tipo, 5 dias antes do vencimento, controle a partir do início do mês", () => {
    const s = normalizeFiscalSettings(null, TODAY);
    expect(s).toMatchObject({ enabled: true, rules: DEFAULT_INVOICE_RULES, moment: "vencimento", leadDays: 5, since: "2026-10-01", stored: false });
  });

  it("valores inválidos caem no padrão; válidos ficam", () => {
    const s = normalizeFiscalSettings({ enabled: false, rules: { hardware: "nenhuma", setup: "xx" }, moment: "pagamento", leadDays: 99, since: "ontem", regime: "simples", defaultIssRate: "2,5" }, TODAY);
    expect(s.enabled).toBe(false);
    expect(s.rules).toEqual({ ...DEFAULT_INVOICE_RULES, hardware: "nenhuma" });
    expect(s.moment).toBe("pagamento");
    expect(s.leadDays).toBe(5);
    expect(s.since).toBe("2026-10-01");
    expect(s.regime).toBe("simples");
    expect(s.defaultIssRate).toBe(2.5);
    expect(s.stored).toBe(true);
  });
});

describe("situação da cobrança no faturamento", () => {
  const settings = normalizeFiscalSettings({ since: "2026-10-01", leadDays: 5 }, TODAY);
  const b = (patch: Partial<Billing>) => ({ type: "mensalidade", status: "aberta", dueDate: "2026-10-30", ...patch }) as Billing;

  it("chega na fila N dias antes do vencimento; antes disso aguarda", () => {
    expect(invoiceQueueState(b({ dueDate: "2026-10-31" }), settings, TODAY)).toBe("a_faturar");
    expect(invoiceQueueState(b({ dueDate: "2026-11-01" }), settings, TODAY)).toBe("aguardando");
    expect(invoiceQueueState(b({ dueDate: "2026-10-20", status: "vencida" }), settings, TODAY)).toBe("a_faturar");
  });

  it("depois do pagamento: só a paga entra na fila", () => {
    const paid = normalizeFiscalSettings({ moment: "pagamento", since: "2026-01-01" }, TODAY);
    expect(invoiceQueueState(b({ status: "aberta", dueDate: "2026-10-01" }), paid, TODAY)).toBe("aguardando");
    expect(invoiceQueueState(b({ status: "paga", dueDate: "2026-10-01" }), paid, TODAY)).toBe("a_faturar");
  });

  it("nota registrada, enviada, dispensada, cancelada, antes do controle e tipo sem nota", () => {
    expect(invoiceQueueState(b({ invoiceId: "i1" }), settings, TODAY)).toBe("emitida");
    expect(invoiceQueueState(b({ invoiceId: "i1", invoiceSentAt: "2026-10-26T10:00:00Z" }), settings, TODAY)).toBe("enviada");
    expect(invoiceQueueState(b({ invoiceWaived: { reason: "cortesia", at: "x", by: "u" } }), settings, TODAY)).toBe("dispensada");
    expect(invoiceQueueState(b({ status: "cancelada" }), settings, TODAY)).toBe("fora");
    expect(invoiceQueueState(b({ dueDate: "2026-09-30" }), settings, TODAY)).toBe("fora");
    const noHw = normalizeFiscalSettings({ rules: { hardware: "nenhuma" } }, TODAY);
    expect(invoiceQueueState(b({ type: "hardware" }), noHw, TODAY)).toBe("sem_nota");
    expect(invoiceQueueState(b({}), normalizeFiscalSettings({ enabled: false }, TODAY), TODAY)).toBe("sem_nota");
  });

  it("que nota cada tipo pede pelo padrão: serviço NFS-e, hardware NF-e", () => {
    expect(invoiceKindFor({ type: "mensalidade" }, settings)).toBe("nfse");
    expect(invoiceKindFor({ type: "setup" }, settings)).toBe("nfse");
    expect(invoiceKindFor({ type: "hardware" }, settings)).toBe("nfe");
  });
});

describe("itens da nota", () => {
  const items: ProposalItem[] = [
    { productId: "erp", productName: "ERP", quantity: 1, setupValue: 1200, monthlyValue: 290, hardwareValue: 0, discountPct: 0 },
    { productId: "pdv", productName: "PDV", quantity: 2, setupValue: 0, monthlyValue: 100, hardwareValue: 3000, discountPct: 10 },
  ];
  const products = new Map([
    ["erp", { name: "ERP Gdoor Web", fiscal: { nature: "software" as const, serviceCode: "1.05", issRate: 2 } }],
    ["pdv", { name: "Terminal PDV", fiscal: { nature: "equipamento" as const, ncm: "84705000", cfop: "5102", invoiceDescription: "Terminal PDV touch" } }],
  ]);
  const settings = { defaultServiceCode: "1.07", defaultIssRate: 5, defaultNcm: "84710000", defaultCfop: "5405" };

  it("mensalidade: cada produto com valor mensal (com desconto), código de serviço do produto ou o padrão", () => {
    const r = invoiceItems({ type: "mensalidade", amount: 380 }, items, products, settings);
    expect(r.scaled).toBe(false);
    expect(r.items).toEqual([
      expect.objectContaining({ productId: "erp", description: "ERP Gdoor Web", total: 290, serviceCode: "1.05", issRate: 2 }),
      expect.objectContaining({ productId: "pdv", description: "Terminal PDV touch", quantity: 2, unitValue: 45, total: 90, serviceCode: "1.07", issRate: 5 }),
    ]);
  });

  it("hardware: só os produtos com equipamento, NCM/CFOP do produto", () => {
    const r = invoiceItems({ type: "hardware", amount: 2700 }, items, products, settings);
    expect(r.items).toEqual([expect.objectContaining({ productId: "pdv", quantity: 2, unitValue: 1350, total: 2700, ncm: "84705000", cfop: "5102" })]);
  });

  it("cobrança diferente da soma (reajuste, parcela): valores proporcionais e a soma bate com a cobrança", () => {
    const r = invoiceItems({ type: "mensalidade", amount: 397.1 }, items, products, settings);
    expect(r.scaled).toBe(true);
    expect(r.items.reduce((s, i) => s + i.total, 0)).toBeCloseTo(397.1, 2);
  });

  it("serviço avulso não tem itens do contrato", () => {
    expect(invoiceItems({ type: "servico", amount: 100 }, items, products, settings).items).toEqual([]);
  });
});

describe("chave, número e mensagem", () => {
  it("chave de acesso: 44 dígitos com dígito verificador", () => {
    const key = "35201012345678000190550010000001231000001234";
    // Dígito verificador calculado: troca o último para o certo.
    const body = key.slice(0, 43);
    let sum = 0;
    let w = 2;
    for (let i = body.length - 1; i >= 0; i--) {
      sum += Number(body[i]) * w;
      w = w === 9 ? 2 : w + 1;
    }
    const dv = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    const valid = `${body}${dv}`;
    expect(isValidAccessKey(valid)).toBe(true);
    expect(isValidAccessKey(`${body}${(dv + 1) % 10}`)).toBe(false);
    expect(isValidAccessKey("123")).toBe(false);
    expect(normalizeAccessKey("3520 1012 3456.78")).toBe("3520101234567" + "8");
  });

  it("número da nota compara sem zeros à esquerda", () => {
    expect(invoiceNumberKey("000123")).toBe(invoiceNumberKey("123"));
  });

  it("mensagem: variáveis preenchidas, {linkPortal} fica para o envio", () => {
    expect(fillInvoiceMessage("Olá {cliente}, nota {nota} de {valor} ({cobranca}). {linkPortal}", { cliente: "Philippe", nota: "NFS-e nº 10", valor: "R$ 290,00", cobranca: "mensalidade de outubro" })).toBe(
      "Olá Philippe, nota NFS-e nº 10 de R$ 290,00 (mensalidade de outubro). {linkPortal}",
    );
  });
});
