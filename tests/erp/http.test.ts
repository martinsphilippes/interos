/**
 * Cliente HTTP do ERP: credencial por família, cabeçalhos de rastreio/idempotência/versão, assinatura HMAC das
 * escritas de licença, envelopes de sucesso e erro das duas famílias de contrato, repetição só em falha temporária e
 * "não configurado" sem chamar a rede.
 */
import { afterEach, describe, expect, it } from "vitest";
import { erpRequest, setErpFetch, buildErpUrl } from "@/server/erp/http";
import { ErpError, classifyErpError } from "@/server/erp/errors";
import { normalizeErpBaseUrl, erpIntegrationState, type ErpConfig } from "@/server/erp/config";
import { signBody, verifySignature, parseSignatureHeader, hmacHex } from "@/server/erp/signature";

const CONFIG: ErpConfig = {
  environment: "homologacao",
  baseUrl: "https://erp.example",
  licenseToken: "tok-licencas",
  licenseSigningSecret: "segredo-de-assinatura-com-mais-de-32-caracteres",
  provisioningCredential: "interos-prov.SEGREDO",
  towerCredential: "interos-torre.SEGREDO",
  eventsSecret: "segredo-dos-eventos-com-mais-de-32-caracteres",
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: Captured[] = [];
  let i = 0;
  setErpFetch(async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return next();
  });
  return calls;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

afterEach(() => setErpFetch(null));

describe("configuração", () => {
  it("aceita só https (http apenas em localhost) e guarda só a origem", () => {
    expect(normalizeErpBaseUrl("https://erp.example/api/interos/v1")).toBe("https://erp.example");
    expect(normalizeErpBaseUrl("http://erp.example")).toBeNull();
    expect(normalizeErpBaseUrl("http://localhost:3301")).toBe("http://localhost:3301");
    expect(normalizeErpBaseUrl("não é url")).toBeNull();
  });

  it("estado sem valores: o que cada família consegue e o que falta", () => {
    const state = erpIntegrationState({ ...CONFIG, licenseSigningSecret: null, towerCredential: null });
    expect(state.apis.licencas).toEqual({ read: true, write: false });
    expect(state.apis.torre.read).toBe(false);
    expect(state.events).toBe(true);
    expect(erpIntegrationState({ ...CONFIG, eventsSecret: null }).events).toBe(false);
    expect(JSON.stringify(state)).not.toContain("tok-licencas");
    expect(JSON.stringify(state)).not.toContain("segredo-dos-eventos");
  });
});

describe("erpRequest", () => {
  it("licenças: Bearer do token, X-Request-Id, If-Match entre aspas, ator, chave e o envelope { data, meta }", async () => {
    const calls = fakeFetch([json(201, { data: { operationId: "op1", status: "applied" }, meta: { apiVersion: "v1", requestId: "r-erp" } }, { etag: '"8"', "x-request-id": "r-erp" })]);
    const res = await erpRequest<{ operationId: string }>({
      api: "licencas",
      method: "POST",
      path: "/api/interos/v1/companies/c1/modules/apply",
      body: { changes: [] },
      idempotencyKey: "chg-1",
      ifMatch: 7,
      actor: "ana@interos.example",
      config: CONFIG,
    });
    expect(res.status).toBe(201);
    expect(res.data.operationId).toBe("op1");
    expect(res.meta?.apiVersion).toBe("v1");
    expect(res.etag).toBe('"8"');
    expect(res.requestId).toBe("r-erp");
    const init = calls[0].init;
    expect(header(init, "authorization")).toBe("Bearer tok-licencas");
    expect(header(init, "if-match")).toBe('"7"');
    expect(header(init, "idempotency-key")).toBe("chg-1");
    expect(header(init, "x-interos-actor")).toBe("ana@interos.example");
    expect(header(init, "x-request-id")).toMatch(/^itr_[0-9a-f]{24}$/);
    expect(init.body).toBe('{"changes":[]}');
  });

  it("assina o corpo EXATO enviado e o ERP consegue conferir", async () => {
    const calls = fakeFetch([json(200, { data: { appliedVersion: 3 } })]);
    await erpRequest({ api: "licencas", method: "PUT", path: "/api/interos/v2/companies/c1/license", body: { licenseVersion: 3, items: [] }, sign: true, eventId: "evt-1", config: CONFIG });
    const init = calls[0].init;
    const signature = header(init, "x-interos-signature");
    expect(header(init, "x-interos-event-id")).toBe("evt-1");
    expect(verifySignature(CONFIG.licenseSigningSecret as string, signature, init.body as string)).toBe("ok");
    expect(verifySignature(CONFIG.licenseSigningSecret as string, signature, `${init.body} `)).toBe("mismatch");
  });

  it("provisionamento: credencial <id>.<segredo>, corpo direto e erro { erro: { codigo, campos } }", async () => {
    fakeFetch([json(422, { erro: { codigo: "validacao", mensagem: "Há campos inválidos.", campos: [{ campo: "empresa.cnpj", mensagem: "CNPJ inválido." }] }, requestId: "req-x" })]);
    const error = await erpRequest({ api: "provisionamento", method: "POST", path: "/api/interos/v1/empresas", body: {}, idempotencyKey: "k-123456", config: CONFIG }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErpError);
    const e = error as ErpError;
    expect(e.code).toBe("validacao");
    expect(e.kind).toBe("rejected");
    expect(e.fields).toEqual([{ field: "empresa.cnpj", message: "CNPJ inválido." }]);
    expect(e.requestId).toBe("req-x");
    expect(e.retryable).toBe(false);
  });

  it("erro do envelope de licenças com código e detalhes; conflito de versão não se repete sozinho", async () => {
    const calls = fakeFetch([json(409, { error: { code: "version_conflict", message: "Versão divergente.", details: { current: 9 } }, meta: { requestId: "r1" } })]);
    const e = (await erpRequest({ api: "licencas", method: "POST", path: "/x", body: {}, retries: 3, config: CONFIG }).catch((x: unknown) => x)) as ErpError;
    expect(e.code).toBe("version_conflict");
    expect(e.kind).toBe("conflict");
    expect(e.details).toEqual({ current: 9 });
    expect(calls).toHaveLength(1);
  });

  it("repete leitura em 503/429 respeitando Retry-After e devolve a resposta seguinte", async () => {
    const calls = fakeFetch([json(429, { error: { code: "rate_limited", message: "Calma" } }, { "retry-after": "0" }), json(200, { data: { ok: true } })]);
    const res = await erpRequest<{ ok: boolean }>({ api: "licencas", method: "GET", path: "/api/interos/v2/catalog", config: CONFIG });
    expect(res.data.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("rede/tempo esgotado viram erro temporário (repetível com a mesma chave)", async () => {
    setErpFetch(async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    const e = (await erpRequest({ api: "torre", method: "GET", path: "/api/interos/v1/empresas/x/torre/resumo", retries: 0, config: CONFIG }).catch((x: unknown) => x)) as ErpError;
    expect(e.code).toBe("timeout");
    expect(e.retryable).toBe(true);
  });

  it("resposta sem envelope (página HTML, rota inexistente) vira http_<status>", async () => {
    fakeFetch([() => new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } })]);
    const e = (await erpRequest({ api: "licencas", method: "GET", path: "/api/interos/v2/nada", retries: 0, config: CONFIG }).catch((x: unknown) => x)) as ErpError;
    expect(e.code).toBe("http_404");
    expect(e.kind).toBe("not_found");
  });

  it("sem credencial da família: não chama a rede", async () => {
    const calls = fakeFetch([json(200, {})]);
    const e = (await erpRequest({ api: "torre", method: "GET", path: "/x", config: { ...CONFIG, towerCredential: null } }).catch((x: unknown) => x)) as ErpError;
    expect(e.kind).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });

  it("monta a URL na origem com parâmetros repetidos e sem vazios", () => {
    expect(buildErpUrl("https://erp.example", "/api/x", { a: "1", b: ["u1", "u2"], c: undefined, d: "" })).toBe("https://erp.example/api/x?a=1&b=u1&b=u2");
  });
});

describe("assinatura e classificação", () => {
  it("formato t=<unix>,v1=<hex> e janela de 5 minutos", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const value = signBody("s", "{}", now);
    expect(value).toBe(`t=${now / 1000},v1=${hmacHex("s", `${now / 1000}.{}`)}`);
    expect(parseSignatureHeader(value)?.t).toBe(now / 1000);
    expect(verifySignature("s", value, "{}", now + 299_000)).toBe("ok");
    expect(verifySignature("s", value, "{}", now + 301_000)).toBe("expired");
    expect(verifySignature("s", "lixo", "{}", now)).toBe("malformed");
    expect(verifySignature("s", null, "{}", now)).toBe("missing");
  });

  it("decide pelo código: não configurado, autenticação, conflito, temporário", () => {
    expect(classifyErpError(503, "servico_nao_configurado")).toBe("not_configured");
    expect(classifyErpError(503, "integration_not_configured")).toBe("not_configured");
    expect(classifyErpError(503, "http_503")).toBe("unavailable");
    expect(classifyErpError(401, "nao_autenticado")).toBe("auth");
    expect(classifyErpError(409, "solicitacao_em_andamento")).toBe("conflict");
    expect(new ErpError({ api: "provisionamento", status: 409, code: "solicitacao_em_andamento", message: "" }).retryable).toBe(true);
    expect(classifyErpError(422, "changes_rejected")).toBe("rejected");
  });
});
