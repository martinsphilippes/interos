/**
 * Portal do Cliente (D31, etapa 6B): token/hash, validade, revogação, evento de acesso 1×/dia, `{linkPortal}` nas
 * mensagens e montagem do conteúdo SEM campos internos.
 */
import { describe, expect, it } from "vitest";
import {
  clampPortalDays,
  fillPortalLink,
  isPortalLinkId,
  isPortalLinkUsable,
  isPortalTokenFormat,
  PORTAL_DEFAULT_DAYS,
  PORTAL_MAX_DAYS,
  PORTAL_MESSAGE_DAYS,
  PORTAL_URL_MASK,
  portalExpiresAt,
  portalLinkState,
  redactPortalUrl,
  shouldEmitPortalAccess,
  templateUsesPortalLink,
} from "@/domain/portal";
import { generatePortalToken, hashPortalToken, portalLinkIdFor } from "@/server/portal/token";
import { buildPortalContent, clientSafeContract, clientSafeSummary, isContractVisibleInPortal, portalBillingStatus } from "@/server/portal/content";
import { createPortalLinkSchema, revokePortalLinkSchema, sendPortalLinkSchema } from "@/server/portal/schemas";
import type { Billing, Client, Contract, ContractAmendment } from "@/domain/types";

const DAY = 24 * 60 * 60 * 1000;

describe("token e hash", () => {
  it("token = 32 bytes em base64url (43 caracteres), único a cada geração", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generatePortalToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, "base64url").length).toBe(32);
      expect(isPortalTokenFormat(t)).toBe(true);
    }
  });

  it("id do link = sha256(token) em hex (64), determinístico e diferente do token", () => {
    const t = generatePortalToken();
    const id = hashPortalToken(t);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalToken(t)).toBe(id);
    expect(id).not.toContain(t);
    expect(isPortalLinkId(id)).toBe(true);
    // Vetor conhecido: sha256("abc").
    expect(hashPortalToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("formato inválido não vira consulta (null): curto, longo, caracteres fora do base64url, vazio", () => {
    for (const bad of ["", "abc", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}/`, `${"A".repeat(42)}.`, " ".repeat(43), undefined, null]) {
      expect(portalLinkIdFor(bad as string)).toBeNull();
    }
    expect(portalLinkIdFor("A".repeat(43))).toBe(hashPortalToken("A".repeat(43)));
    expect(isPortalLinkId("A".repeat(64))).toBe(false);
  });
});

describe("validade e revogação", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");

  it("validade padrão 90 dias (tela) e 30 dias (mensagem), limitada a 1–365", () => {
    expect(PORTAL_DEFAULT_DAYS).toBe(90);
    expect(PORTAL_MESSAGE_DAYS).toBe(30);
    expect(portalExpiresAt(90, now)).toBe(new Date(now.getTime() + 90 * DAY).toISOString());
    expect(clampPortalDays(0)).toBe(1);
    expect(clampPortalDays(9999)).toBe(PORTAL_MAX_DAYS);
    expect(clampPortalDays(undefined)).toBe(90);
    expect(clampPortalDays(undefined, 30)).toBe(30);
    expect(clampPortalDays(12.6)).toBe(13);
  });

  it("ativo até expirar; expirado no instante da validade; revogado vence expirado", () => {
    const active = { expiresAt: new Date(now.getTime() + DAY).toISOString() };
    const expired = { expiresAt: new Date(now.getTime() - 1).toISOString() };
    const atLimit = { expiresAt: now.toISOString() };
    expect(portalLinkState(active, now)).toBe("ativo");
    expect(portalLinkState(expired, now)).toBe("expirado");
    expect(portalLinkState(atLimit, now)).toBe("expirado");
    expect(portalLinkState({ ...active, revokedAt: now.toISOString() }, now)).toBe("revogado");
    expect(portalLinkState({ ...expired, revokedAt: now.toISOString() }, now)).toBe("revogado");
    expect(isPortalLinkUsable(active, now)).toBe(true);
    expect(isPortalLinkUsable(expired, now)).toBe(false);
    expect(isPortalLinkUsable({ ...active, revokedAt: "2026-09-30T00:00:00.000Z" }, now)).toBe(false);
    expect(isPortalLinkUsable(null, now)).toBe(false);
  });

  it("evento portal.accessed no máximo 1×/dia por link (dia de São Paulo)", () => {
    expect(shouldEmitPortalAccess({}, "2026-10-01")).toBe(true);
    expect(shouldEmitPortalAccess({ lastAccessEventDay: "2026-10-01" }, "2026-10-01")).toBe(false);
    expect(shouldEmitPortalAccess({ lastAccessEventDay: "2026-09-30" }, "2026-10-01")).toBe(true);
  });

  it("schemas: validade 1–365 (padrão 90), id de 64 hex, token de 43 caracteres", () => {
    expect(createPortalLinkSchema.parse({ clientId: "client_1" }).days).toBe(90);
    expect(() => createPortalLinkSchema.parse({ clientId: "client_1", days: 0 })).toThrow();
    expect(() => createPortalLinkSchema.parse({ clientId: "client_1", days: 366 })).toThrow();
    expect(() => revokePortalLinkSchema.parse({ linkId: "x".repeat(64) })).toThrow();
    expect(revokePortalLinkSchema.parse({ linkId: "a".repeat(64), reason: "  " }).reason).toBeUndefined();
    expect(() => sendPortalLinkSchema.parse({ linkId: "a".repeat(64), token: "curto", channel: "whatsapp" })).toThrow();
    expect(sendPortalLinkSchema.parse({ linkId: "a".repeat(64), token: "A".repeat(43), channel: "email" }).channel).toBe("email");
  });
});

describe("{linkPortal} nas mensagens", () => {
  const url = "https://interos.example/portal/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";

  it("só gera link quando o texto pede {linkPortal}", () => {
    expect(templateUsesPortalLink("Olá {contato}")).toBe(false);
    expect(templateUsesPortalLink("Acesse {linkPortal}")).toBe(true);
    expect(templateUsesPortalLink(undefined)).toBe(false);
  });

  it("vira 'Portal do cliente: <link>' e some sem link (como hoje)", () => {
    expect(fillPortalLink("Olá!\n{linkPortal}Obrigado.", url)).toBe(`Olá!\nPortal do cliente: ${url}\nObrigado.`);
    expect(fillPortalLink("Olá! {linkPortal}\nObrigado.", "")).toBe("Olá!\nObrigado.");
    expect(fillPortalLink("Olá! {linkPortal}", null)).toBe("Olá!");
  });

  it("o texto gravado mascara o link (o token nunca é gravado)", () => {
    const text = fillPortalLink("Olá!\n{linkPortal}", url);
    const recorded = redactPortalUrl(text, url);
    expect(recorded).not.toContain(url);
    expect(recorded).not.toMatch(/\/portal\/[A-Za-z0-9_-]{43}/);
    expect(recorded).toContain(PORTAL_URL_MASK);
    expect(redactPortalUrl("sem link", undefined)).toBe("sem link");
  });

  it("renderBillingTemplate preserva {linkPortal} para o envio e remove em tarefa/notificação", async () => {
    const { renderBillingTemplate } = await import("@/server/finance/billing-message");
    const ctx = {
      billing: { type: "mensalidade", installment: 3, amount: 100, dueDate: "2026-10-10T12:00:00.000Z" } as Billing,
      client: { tradeName: "Cliente X" } as Client,
      contactName: "Maria Silva",
    };
    expect(renderBillingTemplate("Olá {contato}! {linkPortal}Até.", ctx)).toBe("Olá Maria! {linkPortal}Até.");
    expect(renderBillingTemplate("Olá {contato}! {linkPortal}Até.", ctx, { linkPortal: "" })).toBe("Olá Maria! Até.");
    expect(renderBillingTemplate("Olá! {linkPortal}Até.", ctx, { linkPortal: url })).toBe(`Olá! Portal do cliente: ${url}\nAté.`);
  });
});

// ---------------------------------------------------------------------------
// Conteúdo do portal
// ---------------------------------------------------------------------------

const TODAY = "2026-10-01";
const base = { organizationId: "intercert", createdAt: "2026-01-10T12:00:00.000Z", updatedAt: "2026-01-10T12:00:00.000Z" };
const client: Client = { ...base, id: "client_a", tradeName: "Padaria Aurora", legalName: "Aurora Pães Ltda", document: "12345678000190", email: "fin@aurora.com", status: "ativo", ownerSalesId: "user_seller" } as unknown as Client;

function contract(id: string, over: Partial<Contract> = {}): Contract {
  return {
    ...base,
    id,
    clientId: "client_a",
    opportunityId: "opp_secreta",
    number: `CT-2026-${id.slice(-4)}`,
    version: 1,
    status: "liberado",
    items: [{ productId: "prod_interno", productName: "Intercert ERP", quantity: 1, setupValue: 500, monthlyValue: 300, hardwareValue: 0, discountPct: 0, since: { amendmentId: "cta_x_1", installment: 2 } }],
    setupTotal: 500,
    monthlyTotal: 300,
    hardwareTotal: 0,
    billingDay: 10,
    recurrence: "mensal",
    termMonths: 12,
    startDate: "2026-02-01T12:00:00.000Z",
    endDate: "2027-01-31T12:00:00.000Z",
    signers: [
      { name: "Ana Cliente", email: "ana@aurora.com", role: "Contratante", status: "assinado", signedAt: "2026-01-20T12:00:00.000Z", method: "manual", evidence: "PDF assinado", evidenceUrl: "https://drive/evidencia", registeredBy: "user_karem" },
      { name: "Hércules Diretor", email: "hercules@intercert.com.br", role: "Contratada", status: "assinado", signedAt: "2026-01-20T12:00:00.000Z" },
    ],
    signatureEnvelopeId: "env_interno_123",
    documentHash: "abc123",
    financialStatus: "aprovado",
    ownerId: "user_karem",
    documentIds: ["doc_1"],
    sellerId: "user_seller",
    saleNumber: "VEN-2026-0007",
    commercialNotes: "Comissão negociada 12% — NÃO mostrar",
    implementationNotes: "Cliente difícil, cuidado",
    pendingReason: "Pendência interna antiga",
    ...over,
  } as Contract;
}

function billing(id: string, over: Partial<Billing> = {}): Billing {
  return { ...base, id, clientId: "client_a", contractId: "ctr_0001", type: "mensalidade", competence: "2026-10", installment: 9, amount: 300, dueDate: "2026-10-10T12:00:00.000Z", status: "aberta", ...over } as Billing;
}

describe("conteúdo do portal (sem campos internos)", () => {
  const contracts = [
    contract("ctr_0001"),
    contract("ctr_0002", { status: "cancelado" }),
    contract("ctr_0003", { status: "aguardando_contrato", signatureEnvelopeId: undefined, signers: [] }),
    contract("ctr_0004", { status: "liberado", endDate: "2026-08-31T12:00:00.000Z" }),
    contract("ctr_0005", { status: "aguardando_assinatura", signers: [{ name: "Ana Cliente", email: "ana@aurora.com", role: "Contratante", status: "pendente" }] }),
  ];
  const billings = [
    billing("bill_open", { boleto: { linhaDigitavel: "75691.23456 01234.567890 12345.678901 1 99990000030000", pdfUrl: "https://banco/boleto.pdf", nossoNumero: "NN-INTERNO", documentId: "doc_interno" }, pix: { copiaECola: "00020126PIXCODE" }, externalId: "ext_provedor_1", provider: "asaas" }),
    billing("bill_overdue", { installment: 8, competence: "2026-09", dueDate: "2026-09-10T12:00:00.000Z", status: "aberta" }),
    billing("bill_paid", { installment: 7, competence: "2026-08", dueDate: "2026-08-10T12:00:00.000Z", status: "paga", paidAt: "2026-08-09T15:00:00.000Z", paidAmount: 300, boleto: { linhaDigitavel: "linha-paga" }, receiptDocumentId: "doc_comprovante" }),
    billing("bill_cancel", { installment: 6, status: "cancelada", cancelReason: "duplicada", cancelledBy: "user_karem" }),
    billing("bill_link", { installment: 10, competence: "2026-11", dueDate: "2026-11-10T12:00:00.000Z", paymentUrl: "https://provedor/pagar/123" }),
    billing("bill_other_client", { clientId: "client_b", installment: 1 }),
  ];
  const amendments = [
    { ...base, id: "cta_ctr_0001_1", contractId: "ctr_0001", clientId: "client_a", number: "CT-2026-0001-A01", kind: "itens", status: "aplicado", effectiveFrom: "2026-06-01", reason: "Ajuste interno acordado — margem baixa", appliedAt: "2026-06-01T12:00:00.000Z", appliedVersion: 2, appliedBy: "user_karem", before: { items: [] }, after: { items: [] }, changes: {}, requiresSignature: false } as unknown as ContractAmendment,
  ];
  const content = buildPortalContent({ client, contracts, billings, amendments, today: TODAY });
  const json = JSON.stringify(content);

  it("contratos vigentes: sem cancelado, vencido e rascunho interno; com o aguardando assinatura (sem documento)", () => {
    expect(content.contracts.map((c) => c.number).sort()).toEqual(["CT-2026-0001", "CT-2026-0005"]);
    const signed = content.contracts.find((c) => c.number === "CT-2026-0001")!;
    const waiting = content.contracts.find((c) => c.number === "CT-2026-0005")!;
    expect(signed.signed).toBe(true);
    expect(signed.document).not.toBeNull();
    expect(waiting.signed).toBe(false);
    expect(waiting.document).toBeNull();
    expect(isContractVisibleInPortal({ status: "cancelado", signatureEnvelopeId: "x" }, TODAY)).toBe(false);
    expect(isContractVisibleInPortal({ status: "liberado", endDate: "2026-09-30T12:00:00.000Z" }, TODAY)).toBe(false);
  });

  it("nenhum campo interno: vendedor, venda, comissão/observações, responsável, pendência, ids, e-mails de usuários, evidências", () => {
    for (const leak of ["user_seller", "VEN-2026-0007", "Comissão negociada", "Cliente difícil", "user_karem", "Pendência interna", "opp_secreta", "prod_interno", "cta_x_1", "env_interno_123", "hercules@intercert.com.br", "ana@aurora.com", "evidencia", "doc_1", "ctr_000", "bill_", "client_a", "ext_provedor_1", "NN-INTERNO", "doc_interno", "doc_comprovante", "duplicada", "margem baixa", "cta_ctr_0001_1"]) {
      expect(json, leak).not.toContain(leak);
    }
    const signed = content.contracts.find((c) => c.number === "CT-2026-0001")!;
    expect(signed.summary.sellerName).toBeUndefined();
    expect(signed.summary.saleNumber).toBeUndefined();
    expect(signed.summary.commercialNotes).toBeUndefined();
    expect(signed.summary.implementationNotes).toBeUndefined();
    expect(signed.summary.contactEmail).toBeUndefined();
    expect(signed.document!.contract.signers.every((s) => s.email === "" && !s.evidence && !s.evidenceUrl && !s.registeredBy)).toBe(true);
    expect(signed.document!.contract.signatureEnvelopeId).toBe("gerado");
    expect(signed.document!.amendments).toHaveLength(1);
    expect(signed.document!.amendments[0].reason).toBeUndefined();
  });

  it("cobranças: do cliente, sem canceladas, em aberto/vencidas antes das pagas, chave posicional (sem id)", () => {
    expect(content.billings.map((b) => `${b.installment}:${b.status}`)).toEqual(["8:vencida", "9:aberta", "10:aberta", "7:paga"]);
    expect(content.billings.map((b) => b.key)).toEqual(["b1", "b2", "b3", "b4"]);
    expect(content.openCount).toBe(2);
    expect(content.overdueCount).toBe(1);
    expect(content.billings.every((b) => b.contractNumber === "CT-2026-0001")).toBe(true);
  });

  it("linha digitável, PDF e PIX só quando existem; link de pagamento só sem PDF; nada para paga", () => {
    const [overdue, open, linkOnly, paid] = content.billings;
    expect(open.linhaDigitavel).toBe("75691.23456 01234.567890 12345.678901 1 99990000030000");
    expect(open.pdfUrl).toBe("https://banco/boleto.pdf");
    expect(open.paymentUrl).toBeUndefined();
    expect(open.pixCopiaECola).toBe("00020126PIXCODE");
    expect(overdue.linhaDigitavel ?? overdue.pdfUrl ?? overdue.paymentUrl ?? overdue.pixCopiaECola).toBeUndefined();
    expect(linkOnly.paymentUrl).toBe("https://provedor/pagar/123");
    expect(paid.linhaDigitavel).toBeUndefined();
    expect(paid.paidAt).toBe("2026-08-09T15:00:00.000Z");
  });

  it("situação exibida sem gravar: aberta com vencimento passado = vencida", () => {
    expect(portalBillingStatus({ status: "aberta", dueDate: "2026-09-30T12:00:00.000Z" }, TODAY)).toBe("vencida");
    expect(portalBillingStatus({ status: "aberta", dueDate: "2026-10-01T12:00:00.000Z" }, TODAY)).toBe("aberta");
    expect(portalBillingStatus({ status: "cancelada", dueDate: "2026-10-01T12:00:00.000Z" }, TODAY)).toBeNull();
  });

  it("clientSafeSummary/clientSafeContract não carregam ids nem textos internos", () => {
    const c = clientSafeContract(contract("ctr_0009"));
    expect(c.id).toBe("");
    expect(c.clientId).toBe("");
    expect(c.items[0]).toEqual({ productId: "", productName: "Intercert ERP", quantity: 1, setupValue: 500, monthlyValue: 300, hardwareValue: 0, discountPct: 0 });
    expect(JSON.stringify(c)).not.toMatch(/user_|VEN-|Comissão|difícil|opp_|doc_1|env_interno/);
    const summary = clientSafeSummary({ ...content.contracts[0].summary, sellerName: "Vendedor X", saleNumber: "VEN-1", commercialNotes: "nota", contactEmail: "x@intercert.com.br", opportunityId: "opp_1", id: "ctr_1" });
    expect(JSON.stringify(summary)).not.toMatch(/Vendedor X|VEN-1|nota|intercert\.com\.br|opp_1|ctr_1/);
  });
});
