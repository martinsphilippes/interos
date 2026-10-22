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
  it("webhook do INTEROS completo fica pronto; domínio em maiúsculas não atrapalha", () => {
    const r = classifyClicksignWebhooks([hook({ endpoint: "https://Interos.App.br/api/webhooks/clicksign" })], "interos.app.br");
    expect(r.interos).toHaveLength(1);
    expect(r.others).toEqual([]);
    expect(interosWebhookReady(r.interos[0])).toBe(true);
  });

  it("barra no fim ou http:// é do INTEROS, mas não fica pronto: recebe redirecionamento, que a Clicksign não segue", () => {
    const r = classifyClicksignWebhooks(
      [hook({ endpoint: "https://interos.app.br/api/webhooks/clicksign/" }), hook({ endpoint: "http://interos.app.br/api/webhooks/clicksign" })],
      "interos.app.br",
    );
    expect(r.interos.map((h) => h.addressProblem)).toEqual(["barra_final", "http"]);
    expect(r.interos.some(interosWebhookReady)).toBe(false);
    const lines = connectionCheckLines({ env: "producao", checkedAt: "x", token: { ok: true }, webhooks: r });
    expect(lines.slice(1, 3).map((l) => l.tone)).toEqual(["error", "error"]);
    expect(lines[1].text).toMatch(/termina com barra/);
    expect(lines[2].text).toMatch(/http:\/\//);
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

  it("segredo diferente e evento essencial faltando bloqueiam; outro domínio e só o upload faltando alertam", () => {
    const wrongSecret = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ secretMatches: false })], "interos.app.br") });
    expect(wrongSecret[1].tone).toBe("error");
    expect(wrongSecret[1].text).toMatch(/segredo/);
    const noSign = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ events: ALL.filter((e) => e !== "sign") })], "interos.app.br") });
    expect(noSign[1].tone).toBe("error");
    expect(noSign[1].text).toMatch(/faltam os eventos Assinatura/);
    const otherHost = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://interos.vercel.app/api/webhooks/clicksign", events: ALL.filter((e) => e !== "upload") })], "interos.app.br") });
    expect(otherHost[1].tone).toBe("warn");
    expect(otherHost[1].text).toMatch(/interos\.app\.br/);
    expect(otherHost[1].text).toMatch(/faltam os eventos Upload/);
  });

  const ADDR = "https://interos.app.br/api/webhooks/clicksign";
  const lead = (lines: { text: string }[]) => lines.map((l) => l.text).join("\n");

  it("sem CLICKSIGN_WEBHOOK_SECRET na Vercel: um problema só no topo, dizendo pelo endereço de qual webhook copiar o segredo", () => {
    const lines = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://antigo.vercel.app/api/webhooks/clicksign", secretMatches: null }), hook({ secretMatches: null })], "interos.app.br", { secretConfigured: false }),
    });
    expect(lines[1]).toMatchObject({ tone: "error" });
    expect(lines[1].text).toContain(`Falta o CLICKSIGN_WEBHOOK_SECRET na Vercel`);
    expect(lines[1].text).toContain(`copie o segredo do webhook ${ADDR} para a Vercel`);
    expect(lines.filter((l) => /[Cc]opie o segredo/.test(l.text))).toHaveLength(1);
    expect(lines[2]).toMatchObject({ tone: "ok" });
    expect(lines[3].text).toContain("Outro webhook do INTEROS (https://antigo.vercel.app/api/webhooks/clicksign: outro domínio) não é o principal");
    const unknown = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ secretMatches: null })], "interos.app.br", { secretConfigured: true }) });
    expect(unknown[1].tone).toBe("warn");
  });

  it("com um webhook do INTEROS pronto, sobras (domínio antigo, desativado) são só alerta, sem instrução de corrigir", () => {
    const lines = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://antigo.vercel.app/api/webhooks/clicksign", status: "inactive", secretMatches: false }), hook()], "interos.app.br"),
    });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "ok", "warn", "ok"]);
    expect(lines[1].text).toContain(`Webhook do INTEROS ativo (${ADDR})`);
    expect(lines[2].text).toContain("(https://antigo.vercel.app/api/webhooks/clicksign: inativo, segredo diferente do da Vercel, outro domínio) não é o principal: pode apagá-lo");
    expect(lines[2].text).not.toMatch(/ative-o|copie o segredo/);
  });

  it("o que recebe os avisos sem ser «pronto» (falta só o upload) ainda protege: a sobra não vira instrução de corrigir", () => {
    const lines = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://antigo.vercel.app/api/webhooks/clicksign", status: "inactive", secretMatches: false }), hook({ events: ALL.filter((e) => e !== "upload") })], "interos.app.br"),
    });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "warn", "warn", "ok"]);
    expect(lines[1].text).toContain(`(${ADDR}): faltam os eventos Upload`);
    expect(lead(lines)).not.toMatch(/ative-o|copie o segredo/);
  });

  it("cada sobra é identificada pelo endereço completo (a Clicksign não aceita dois iguais): barra no fim, parâmetros", () => {
    const slash = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ endpoint: `${ADDR}/` }), hook()], "interos.app.br") });
    expect(slash[1].tone).toBe("ok");
    expect(slash[1].text).toContain(`(${ADDR})`);
    expect(slash[2].text).toContain(`Outro webhook do INTEROS (${ADDR}/: endereço termina com barra)`);
    const query = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook({ endpoint: `${ADDR}?x=1`, secretMatches: false }), hook()], "interos.app.br") });
    expect(query[1].text).toContain(`(${ADDR})`);
    expect(query[2].text).toContain(`(${ADDR}?x=1: segredo diferente do da Vercel) não é o principal`);
  });

  it("o principal é o mais completo, não o primeiro da lista: o incompleto é que vira sobra (com e sem segredo na Vercel)", () => {
    for (const secretConfigured of [true, false]) {
      const secretMatches = secretConfigured ? true : null;
      const lines = connectionCheckLines({
        ...base,
        token: { ok: true },
        webhooks: classifyClicksignWebhooks([hook({ endpoint: `${ADDR}?v=1`, events: ALL.filter((e) => e !== "upload"), secretMatches }), hook({ secretMatches })], "interos.app.br", { secretConfigured }),
      });
      expect(lead(lines)).toContain(`(${ADDR}?v=1: `);
      expect(lead(lines)).toMatch(/sem o evento Upload \(documento criado\)\) não é o principal/);
      expect(lead(lines)).not.toMatch(/: \)/);
    }
  });

  it("parâmetros no endereço só desempatam: o do domínio deste INTEROS ganha do de outro domínio", () => {
    const lines = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook({ endpoint: `${ADDR}?x=1`, secretMatches: null }), hook({ endpoint: "https://interos-xyz.vercel.app/api/webhooks/clicksign", secretMatches: null })], "interos.app.br", { secretConfigured: false }),
    });
    expect(lines[1].text).toContain(`copie o segredo do webhook ${ADDR}?x=1 para a Vercel`);
    expect(lines[3].text).toContain("(https://interos-xyz.vercel.app/api/webhooks/clicksign: outro domínio) não é o principal");
  });

  it("dois que recebem os avisos: o outro é sobra que também recebe (aviso em dobro), pelo endereço", () => {
    const lines = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook(), hook({ endpoint: `${ADDR}?copia=1` })], "interos.app.br") });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "ok", "warn", "ok"]);
    expect(lines[2].text).toContain(`(${ADDR}?copia=1: também recebe os avisos (cada aviso chega mais de uma vez)) não é o principal`);
  });

  it("lista de webhooks que não veio vira alerta, sem esconder que a chave foi aceita", () => {
    const lines = connectionCheckLines({ ...base, token: { ok: true }, webhooks: { error: "Clicksign respondeu 403" } });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "warn"]);
  });
});
