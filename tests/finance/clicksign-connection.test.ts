/**
 * «Testar conexão» da Clicksign: conferência dos webhooks cadastrados (do INTEROS × de outros serviços) e o texto
 * mostrado na tela.
 */
import { describe, expect, it } from "vitest";
import { CLICKSIGN_WEBHOOK_EVENTS, classifyClicksignWebhooks, connectionCheckLines, interosWebhookReady, type ClicksignConnectionCheck, type ClicksignWebhookInfo } from "@/domain/clicksign-connection";

const ALL = CLICKSIGN_WEBHOOK_EVENTS.map((e) => e.key);
const hook = (patch: Partial<ClicksignWebhookInfo> = {}): ClicksignWebhookInfo => ({
  endpoint: "https://interos.app.br/api/webhooks/clicksign",
  status: "active",
  events: [...ALL, "add_signer"],
  secretMatches: true,
  ...patch,
});

describe("webhooks da Clicksign: do INTEROS e de outros serviços", () => {
  it("webhook do INTEROS completo fica pronto; barra no fim e domínio em maiúsculas não atrapalham", () => {
    const r = classifyClicksignWebhooks([hook({ endpoint: "https://Interos.App.br/api/webhooks/clicksign/" })], "interos.app.br");
    expect(r.interos).toHaveLength(1);
    expect(r.others).toEqual([]);
    expect(interosWebhookReady(r.interos[0])).toBe(true);
  });

  it("inativo, eventos faltando, segredo diferente e outro domínio aparecem", () => {
    const [check] = classifyClicksignWebhooks([hook({ status: "inactive", events: ["sign"], secretMatches: false, endpoint: "https://interos-git-x.vercel.app/api/webhooks/clicksign" })], "interos.app.br").interos;
    expect(check).toMatchObject({ host: "interos-git-x.vercel.app", active: false, secretMatches: false, otherHost: true });
    expect(check.missingEvents).toContain("Recusa");
    expect(check.missingEvents).not.toContain("Assinatura");
    expect(interosWebhookReady(check)).toBe(false);
  });

  it("sem domínio conhecido não acusa outro domínio", () => {
    expect(classifyClicksignWebhooks([hook()], null).interos[0].otherHost).toBe(false);
  });

  it("outros serviços aparecem só pelo domínio (o endereço completo pode carregar chave de acesso)", () => {
    const r = classifyClicksignWebhooks([hook({ endpoint: "https://hooks.pluga.co/hook/abc123secreto?token=xyz", status: "inactive" }), hook({ endpoint: "não é url" })], "interos.app.br");
    expect(r.interos).toEqual([]);
    expect(r.others).toEqual([
      { host: "hooks.pluga.co", active: false },
      { host: "endereço inválido", active: true },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/abc123secreto|xyz/);
  });
});

describe("texto do teste de conexão", () => {
  const base = { env: "producao", checkedAt: "2026-10-22T12:00:00.000Z" } as const;

  it("chave recusada: só a mensagem do problema", () => {
    const check: ClicksignConnectionCheck = { ...base, token: { ok: false, problem: "recusado", message: "A Clicksign recusou a chave da API (401)." }, webhooks: null };
    expect(connectionCheckLines(check)).toEqual([{ tone: "error", text: "A Clicksign recusou a chave da API (401)." }]);
  });

  it("tudo certo: chave, webhook do INTEROS e nenhum outro serviço", () => {
    const check: ClicksignConnectionCheck = { ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook()], "interos.app.br") };
    const lines = connectionCheckLines(check);
    expect(lines.map((l) => l.tone)).toEqual(["ok", "ok", "ok"]);
    expect(lines[0].text).toMatch(/produção/);
  });

  it("sem webhook do INTEROS é problema; webhook da Pluga sobrando é alerta", () => {
    const check: ClicksignConnectionCheck = { ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://hooks.pluga.co/x" })], "interos.app.br") };
    const lines = connectionCheckLines(check);
    expect(lines[1]).toMatchObject({ tone: "error" });
    expect(lines[1].text).toMatch(/Nenhum webhook da Clicksign aponta para o INTEROS/);
    expect(lines[2]).toMatchObject({ tone: "warn" });
    expect(lines[2].text).toMatch(/hooks\.pluga\.co \(ativo\)/);
  });

  it("segredo diferente bloqueia; outro domínio e eventos faltando só alertam", () => {
    const wrongSecret = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ secretMatches: false })], "interos.app.br") });
    expect(wrongSecret[1].tone).toBe("error");
    expect(wrongSecret[1].text).toMatch(/segredo/);
    const otherHost = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://interos.vercel.app/api/webhooks/clicksign", events: ["sign"] })], "interos.app.br") });
    expect(otherHost[1].tone).toBe("warn");
    expect(otherHost[1].text).toMatch(/interos\.app\.br/);
    expect(otherHost[1].text).toMatch(/faltam os eventos/);
  });

  it("lista de webhooks que não veio vira alerta, sem esconder que a chave foi aceita", () => {
    const lines = connectionCheckLines({ ...base, token: { ok: true }, webhooks: { error: "Clicksign respondeu 403" } });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "warn"]);
  });
});
