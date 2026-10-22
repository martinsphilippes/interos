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
    // Um principal só recebe a instrução (editar o endereço); o outro é sobra — nunca "recadastre" nos dois (422).
    const lines = connectionCheckLines({ env: "producao", checkedAt: "x", token: { ok: true }, webhooks: r });
    expect(lines.slice(1, 3).map((l) => l.tone)).toEqual(["error", "warn"]);
    expect(lines[1].text).toMatch(/termina com barra.*edite o endereço deste webhook/);
    expect(lines[2].text).toContain("Outro webhook do INTEROS (http://interos.app.br/api/webhooks/clicksign: endereço começa com http://) não é o principal");
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
    expect(lines[1].text).toMatch(/Nenhum webhook da Clicksign aponta para este INTEROS/);
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
    expect(lines[3].text).toContain("Webhook com o caminho do INTEROS em outro domínio (https://antigo.vercel.app/api/webhooks/clicksign): se for um endereço antigo deste INTEROS, pode apagá-lo");
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
    expect(lines[2].text).toContain("(https://antigo.vercel.app/api/webhooks/clicksign): se for um endereço antigo deste INTEROS, pode apagá-lo na Clicksign; se for outro sistema, não mexa");
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
    expect(lines[3].text).toContain("(https://interos-xyz.vercel.app/api/webhooks/clicksign): se for um endereço antigo deste INTEROS");
  });

  it("dois que recebem os avisos: o outro é sobra que também recebe (aviso em dobro), pelo endereço", () => {
    const lines = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks([hook(), hook({ endpoint: `${ADDR}?copia=1` })], "interos.app.br") });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "ok", "warn", "ok"]);
    expect(lines[2].text).toContain(`(${ADDR}?copia=1: também recebe os avisos (cada aviso chega mais de uma vez)) não é o principal`);
  });

  it("ninguém recebe os avisos: ainda assim um principal só leva as instruções; os outros são sobras (sem instruções concorrentes)", () => {
    // Inativo com o segredo certo × ativo com segredo diferente: corrigir os dois deixaria um recusado.
    const lines = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook({ endpoint: `${ADDR}?v=1`, status: "inactive" }), hook({ secretMatches: false })], "interos.app.br"),
    });
    expect(lines.filter((l) => /ative-o|copie o segredo/.test(l.text))).toHaveLength(1);
    expect(lines[1].text).toContain(`Webhook do INTEROS (${ADDR}): `);
    expect(lines[2].text).toContain(`Outro webhook do INTEROS (${ADDR}?v=1: inativo) não é o principal`);
    // Dois com segredo diferente: só o do domínio deste INTEROS recebe a instrução de copiar.
    const two = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://interos.vercel.app/api/webhooks/clicksign", secretMatches: false }), hook({ secretMatches: false })], "interos.app.br"),
    });
    expect(two.filter((l) => /copie o segredo/.test(l.text))).toHaveLength(1);
    expect(two[1].text).toContain(`(${ADDR})`);
  });

  it("mesmo caminho em outro domínio pode ser outro sistema: parâmetros ocultos e «se for outro sistema, não mexa»", () => {
    const lines = connectionCheckLines({
      ...base,
      token: { ok: true },
      webhooks: classifyClicksignWebhooks([hook(), hook({ endpoint: "https://erp.exemplo.com/api/webhooks/clicksign?token=abc123secreto", secretMatches: false })], "interos.app.br"),
    });
    expect(lines[2].text).toContain("(https://erp.exemplo.com/api/webhooks/clicksign?…): se for um endereço antigo deste INTEROS, pode apagá-lo na Clicksign; se for outro sistema, não mexa");
    expect(JSON.stringify(lines)).not.toContain("abc123secreto");
    expect(JSON.stringify(classifyClicksignWebhooks([hook({ endpoint: "https://erp.exemplo.com/api/webhooks/clicksign?token=abc123secreto" })], "interos.app.br"))).not.toContain("abc123secreto");
  });

  it("endereço como cadastrado: senha mascarada, caixa e «?» preservados; dois que sairiam iguais ganham a posição na lista", () => {
    const r = classifyClicksignWebhooks(
      [hook(), hook({ endpoint: `${ADDR}?`, secretMatches: false }), hook({ endpoint: "https://usuario:senha123@Interos.App.br/api/webhooks/clicksign", secretMatches: false })],
      "interos.app.br",
    );
    const shown = r.interos.map((h) => h.endpoint);
    expect(shown).toEqual([ADDR, `${ADDR}?`, "https://•••@Interos.App.br/api/webhooks/clicksign"]);
    expect(JSON.stringify(r)).not.toContain("usuario");
    expect(new Set(shown).size).toBe(shown.length);
    expect(JSON.stringify(r)).not.toContain("senha123");
    const same = classifyClicksignWebhooks([hook({ endpoint: "https://a:x@interos.app.br/api/webhooks/clicksign" }), hook({ endpoint: "https://a:y@interos.app.br/api/webhooks/clicksign", secretMatches: false })], "interos.app.br");
    expect(same.interos.map((h) => h.endpoint)).toEqual(["https://•••@interos.app.br/api/webhooks/clicksign [1º da lista de webhooks]", "https://•••@interos.app.br/api/webhooks/clicksign [2º da lista de webhooks]"]);
  });

  it("só webhook de outro domínio, que não funciona (talvez outro sistema): nenhuma instrução para ele; cadastre o do INTEROS", () => {
    for (const secretConfigured of [true, false]) {
      const lines = connectionCheckLines({
        ...base,
        token: { ok: true },
        webhooks: classifyClicksignWebhooks([hook({ endpoint: "https://APIKEY_abc123:X@erp.empresa.com.br/api/webhooks/clicksign/", secretMatches: secretConfigured ? false : null })], "interos.app.br", { secretConfigured }),
      });
      const text = lead(lines);
      expect(text).toMatch(/Nenhum webhook da Clicksign aponta para este INTEROS/);
      expect(text).toContain("(https://erp.empresa.com.br/api/webhooks/clicksign/): se for um endereço antigo deste INTEROS, pode apagá-lo na Clicksign; se for outro sistema, não mexa");
      expect(text).not.toMatch(/edite o endereço|copie o segredo do webhook https:\/\/erp|APIKEY_abc123/);
    }
  });

  it("endereço errado nunca ganha do exato no mesmo domínio (sem depender da ordem da lista)", () => {
    for (const order of [0, 1]) {
      const list = [hook({ endpoint: `${ADDR}/` }), hook({ status: "inactive", secretMatches: false, events: ["upload"] })];
      const lines = connectionCheckLines({ ...base, token: { ok: true }, webhooks: classifyClicksignWebhooks(order ? list.reverse() : list, "interos.app.br") });
      expect(lines[1].text).toContain(`Webhook do INTEROS (${ADDR}): `);
      expect(lead(lines)).toContain(`Outro webhook do INTEROS (${ADDR}/: `);
      expect(lead(lines)).not.toMatch(/edite o endereço/);
    }
  });

  it("lista de webhooks que não veio vira alerta, sem esconder que a chave foi aceita", () => {
    const lines = connectionCheckLines({ ...base, token: { ok: true }, webhooks: { error: "Clicksign respondeu 403" } });
    expect(lines.map((l) => l.tone)).toEqual(["ok", "warn"]);
  });
});
