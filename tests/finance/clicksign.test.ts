/**
 * Clicksign (API v3): assinatura dos avisos (HMAC), leitura do aviso, papéis e nomes aceitos, e o cliente da API com o
 * fetch simulado (cabeçalhos, corpo JSON:API, nova tentativa em 429, erro legível).
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDocument, addSigner, clicksignApi, clicksignConfigured, clicksignEnv, clicksignHost, clicksignSignatureValid, createEnvelope, parseClicksignWebhook } from "@/server/integrations/clicksign";
import { clicksignRole, clicksignSignerNameProblem } from "@/domain/contract-templates";

const SECRET = "segredo-de-teste";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("aviso da Clicksign: assinatura HMAC", () => {
  const body = JSON.stringify({ event: { name: "sign" } });
  it("aceita o Content-Hmac certo (com ou sem o prefixo sha256=)", () => {
    expect(clicksignSignatureValid(body, sign(body), SECRET)).toBe(true);
    expect(clicksignSignatureValid(body, sign(body).replace("sha256=", ""), SECRET)).toBe(true);
  });
  it("recusa corpo alterado, segredo errado, cabeçalho ausente ou segredo não configurado", () => {
    expect(clicksignSignatureValid(`${body} `, sign(body), SECRET)).toBe(false);
    expect(clicksignSignatureValid(body, sign(body, "outro"), SECRET)).toBe(false);
    expect(clicksignSignatureValid(body, null, SECRET)).toBe(false);
    expect(clicksignSignatureValid(body, sign(body), undefined)).toBe(false);
    expect(clicksignSignatureValid(body, "sha256=abc", SECRET)).toBe(false);
  });
});

describe("aviso da Clicksign: leitura", () => {
  const document = {
    key: "doc-1",
    filename: "Contrato CT-1.pdf",
    status: "closed",
    finished_at: "2026-10-20T15:00:00.000Z",
    metadata: { interos_contract_id: "c1", interos_version: 2 },
    signers: [{ key: "s1", name: "Maria Silva", email: "Maria@Acme.com.br", documentation: "123.456.789-00" }],
    downloads: { signed_file_url: "https://s3.amazonaws.com/x/assinado.pdf", original_file_url: "/2026/10/20/original.pdf" },
  };

  it("lê evento, documento, metadados (números viram texto), signatários e o link absoluto do PDF assinado", () => {
    const hook = parseClicksignWebhook({ event: { name: "auto_close", occurred_at: "2026-10-20T15:00:01.000Z", data: {} }, document });
    expect(hook).toMatchObject({
      event: "auto_close",
      occurredAt: "2026-10-20T15:00:01.000Z",
      documentKey: "doc-1",
      filename: "Contrato CT-1.pdf",
      documentStatus: "closed",
      finishedAt: "2026-10-20T15:00:00.000Z",
      metadata: { interos_contract_id: "c1", interos_version: "2" },
      signedFileUrl: "https://s3.amazonaws.com/x/assinado.pdf",
    });
    expect(hook?.signers).toEqual([{ key: "s1", name: "Maria Silva", email: "maria@acme.com.br", documentation: "123.456.789-00" }]);
  });

  it("assinatura e recusa trazem quem; o nome do evento pode vir só no cabeçalho", () => {
    const signed = parseClicksignWebhook({ event: { data: { signer: { key: "s1", email: "maria@acme.com.br", name: "Maria Silva" } } }, document }, "sign");
    expect(signed?.event).toBe("sign");
    expect(signed?.signer).toMatchObject({ key: "s1", email: "maria@acme.com.br" });
    const refused = parseClicksignWebhook({ event: { name: "refusal", data: { signer: { email: "maria@acme.com.br" }, refusal: { reasons: ["Conteúdo do documento"], comment: "Valor errado" } } }, document });
    expect(refused?.refusal).toEqual({ reasons: ["Conteúdo do documento"], comment: "Valor errado" });
  });

  it("link relativo do PDF é descartado; metadados em texto JSON são lidos; documento em lista vale o primeiro", () => {
    const hook = parseClicksignWebhook({ event: { name: "close" }, document: [{ ...document, metadata: '{"interos_contract_id":"c9"}', downloads: { signed_file_url: "/2026/10/20/assinado.pdf" } }] });
    expect(hook?.signedFileUrl).toBeUndefined();
    expect(hook?.metadata).toEqual({ interos_contract_id: "c9" });
  });

  it("corpo sem evento não é aviso", () => {
    expect(parseClicksignWebhook(null)).toBeNull();
    expect(parseClicksignWebhook({ document })).toBeNull();
  });
});

describe("papéis e nomes aceitos pela Clicksign", () => {
  it("papel do signatário", () => {
    expect(clicksignRole({ party: "contratada", role: "Diretor" })).toBe("contractee");
    expect(clicksignRole({ role: "Testemunha" })).toBe("witness");
    expect(clicksignRole({ role: "Fiador" })).toBe("guarantor");
    expect(clicksignRole({ role: "Procurador" })).toBe("attorney");
    expect(clicksignRole({ role: "Representante legal" })).toBe("legal_representative");
    expect(clicksignRole({ role: "Sócio-administrador" })).toBe("contractor");
  });
  it("nome com sobrenome e sem números", () => {
    expect(clicksignSignerNameProblem("Maria Silva")).toBeNull();
    expect(clicksignSignerNameProblem("Maria")).toMatch(/sobrenome/);
    expect(clicksignSignerNameProblem("Maria Silva 2")).toMatch(/números/);
  });
});

describe("cliente da API v3", () => {
  const saved = { ...process.env };
  let calls: { url: string; init: RequestInit }[] = [];
  let responses: Response[] = [];

  beforeEach(() => {
    calls = [];
    responses = [];
    process.env.CLICKSIGN_API_TOKEN = "tok-teste";
    delete process.env.CLICKSIGN_ENV;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return responses.shift() ?? new Response(JSON.stringify({ data: { id: "x", type: "x" } }), { status: 201 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.env = { ...saved };
  });

  it("ambiente: sandbox por padrão, produção com CLICKSIGN_ENV=producao", () => {
    expect(clicksignConfigured()).toBe(true);
    expect(clicksignEnv()).toBe("sandbox");
    expect(clicksignHost()).toBe("https://sandbox.clicksign.com");
    process.env.CLICKSIGN_ENV = "producao";
    expect(clicksignHost()).toBe("https://app.clicksign.com");
  });

  it("envelope: token sem Bearer, JSON:API, pt-BR, finalização automática e bloqueio após recusa", async () => {
    responses.push(new Response(JSON.stringify({ data: { id: "env-1", type: "envelopes" } }), { status: 201 }));
    expect(await createEnvelope({ name: "Contrato CT-1 v1 · ACME", remindInterval: 3 })).toBe("env-1");
    const [call] = calls;
    expect(call.url).toBe("https://sandbox.clicksign.com/api/v3/envelopes");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({ Authorization: "tok-teste", Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" });
    expect(JSON.parse(String(call.init.body))).toEqual({ data: { type: "envelopes", attributes: { name: "Contrato CT-1 v1 · ACME", locale: "pt-BR", auto_close: true, remind_interval: "3", block_after_refusal: true } } });
  });

  it("documento em base64 com os metadados; signatário com celular e recusa permitida", async () => {
    await addDocument("env-1", { filename: "c.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF"), metadata: { interos_contract_id: "c1" } });
    expect(JSON.parse(String(calls[0].init.body)).data.attributes).toEqual({ filename: "c.pdf", content_base64: "data:application/pdf;base64,JVBERg==", metadata: { interos_contract_id: "c1" } });
    await addSigner("env-1", { name: "Maria Silva", email: "maria@acme.com.br", phone: "88999990000" });
    expect(calls[1].url).toBe("https://sandbox.clicksign.com/api/v3/envelopes/env-1/signers");
    expect(JSON.parse(String(calls[1].init.body)).data.attributes).toMatchObject({ name: "Maria Silva", email: "maria@acme.com.br", phone_number: "88999990000", refusable: true });
  });

  it("429 espera e tenta de novo; erro de validação vira mensagem legível sem nova tentativa", async () => {
    vi.useFakeTimers();
    responses.push(new Response("", { status: 429 }), new Response(JSON.stringify({ data: { id: "ok", type: "envelopes" } }), { status: 200 }));
    const pending = clicksignApi("/envelopes/ok");
    await vi.runAllTimersAsync();
    expect((await pending).data.id).toBe("ok");
    expect(calls).toHaveLength(2);
    vi.useRealTimers();

    responses.push(new Response(JSON.stringify({ errors: [{ title: "Inválido", detail: "nome precisa de sobrenome", source: { pointer: "/data/attributes/name" } }] }), { status: 422 }));
    await expect(clicksignApi("/envelopes/env-1/signers", { method: "POST", body: {} })).rejects.toThrow("Clicksign: Inválido: nome precisa de sobrenome (name)");
    expect(calls).toHaveLength(3);
  });

  it("sem token não chama a API", async () => {
    delete process.env.CLICKSIGN_API_TOKEN;
    await expect(clicksignApi("/envelopes")).rejects.toThrow(/não configurada/);
    expect(calls).toHaveLength(0);
  });
});
