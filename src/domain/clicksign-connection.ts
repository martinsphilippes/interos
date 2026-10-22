/**
 * Conexão com a Clicksign: os eventos que o webhook do INTEROS precisa receber e a conferência feita pelo botão
 * «Testar conexão» (Financeiro › Assinaturas › Configuração). Só regra e tipos, sem rede: a consulta fica em
 * src/server/integrations/clicksign.ts.
 */

export type ClicksignEnv = "sandbox" | "producao";

/** Caminho do aviso no INTEROS (rota src/app/api/webhooks/clicksign/route.ts). */
export const CLICKSIGN_WEBHOOK_PATH = "/api/webhooks/clicksign";

/** Eventos que o webhook do INTEROS precisa ter marcados na Clicksign. */
export const CLICKSIGN_WEBHOOK_EVENTS: readonly { key: string; label: string }[] = [
  { key: "upload", label: "Upload (documento criado)" },
  { key: "sign", label: "Assinatura" },
  { key: "refusal", label: "Recusa" },
  { key: "auto_close", label: "Finalização automática" },
  { key: "close", label: "Finalização" },
  { key: "document_closed", label: "Documento finalizado (PDF pronto)" },
  { key: "cancel", label: "Cancelamento" },
  { key: "deadline", label: "Prazo vencido" },
];

/** Webhook como a Clicksign devolve, já sem o segredo (o servidor só diz se ele confere). */
export interface ClicksignWebhookInfo {
  endpoint: string;
  status: string;
  events: string[];
  /** Segredo igual ao CLICKSIGN_WEBHOOK_SECRET? null = não deu para conferir (falta de um dos lados). */
  secretMatches: boolean | null;
}

/**
 * Endereço do INTEROS escrito de um jeito que recebe redirecionamento (308): barra no fim ou http://. A Clicksign não
 * segue redirecionamento e trata como erro, então nenhum aviso chega.
 */
export type WebhookAddressProblem = "barra_final" | "http";

export interface InterosWebhookCheck {
  host: string;
  active: boolean;
  /** Rótulos dos eventos obrigatórios que não estão marcados. */
  missingEvents: string[];
  /** Falta algum evento que o INTEROS processa (só "upload" é dispensável). */
  missingEssential: boolean;
  secretMatches: boolean | null;
  /** Aponta para outro domínio que não o endereço deste INTEROS (ex.: um endereço de prévia da Vercel). */
  otherHost: boolean;
  addressProblem: WebhookAddressProblem | null;
  /** Endereço com parâmetros (?…): funciona; só desempata na escolha do principal. */
  hasQuery: boolean;
  /**
   * Endereço como cadastrado, para a tela dizer qual manter e qual apagar (a Clicksign não aceita dois webhooks com o
   * mesmo endereço). Em outro domínio, sem os parâmetros: pode ser outro sistema com o mesmo caminho.
   */
  endpoint: string;
  /** Posição na lista de webhooks da Clicksign (1 = primeiro): desempata endereços que saem iguais na tela. */
  position: number;
}

export interface ClicksignWebhooksReport {
  /** Domínio deste INTEROS, quando conhecido. */
  expectedHost: string | null;
  /** CLICKSIGN_WEBHOOK_SECRET configurado na Vercel (sem ele a rota recusa todo aviso com 503). */
  secretConfigured: boolean;
  /** Webhooks cadastrados com o endereço de avisos do INTEROS. */
  interos: InterosWebhookCheck[];
  /** Os demais webhooks da conta: só o domínio, porque o endereço completo pode carregar chave de acesso. */
  others: { host: string; active: boolean }[];
}

/** Eventos sem os quais o INTEROS não fica sabendo de assinatura, recusa, finalização, cancelamento ou prazo. */
const OPTIONAL_EVENTS = new Set(["upload"]);

/**
 * Endereço para a tela. Neste domínio: como foi cadastrado (é por ele que a pessoa acha o webhook na Clicksign), com o
 * "usuário:senha@" inteiro trocado por "•••@" (a chave pode estar no usuário). Em outro domínio — talvez outro sistema
 * com o mesmo caminho — só protocolo, domínio e caminho, e "?…" se houver parâmetros (podem carregar chave).
 */
function displayEndpoint(raw: string, otherDomain: boolean): string {
  const text = raw.trim();
  if (otherDomain) {
    try {
      const url = new URL(text);
      return `${url.protocol}//${url.host}${url.pathname}${url.search.length > 1 ? "?…" : ""}`;
    } catch {
      return "endereço inválido";
    }
  }
  const scheme = text.indexOf("://");
  let out = text;
  if (scheme >= 0) {
    const start = scheme + 3;
    const rest = text.slice(start);
    const end = rest.search(/[/?#]/);
    const authority = end >= 0 ? rest.slice(0, end) : rest;
    const at = authority.lastIndexOf("@");
    if (at >= 0) out = `${text.slice(0, start)}•••@${authority.slice(at + 1)}${end >= 0 ? rest.slice(end) : ""}`;
  }
  return out.length > 300 ? `${out.slice(0, 150)}…${out.slice(-140)}` : out;
}

function parseEndpoint(endpoint: string): { host: string; path: string; protocol: string; hasQuery: boolean } | null {
  try {
    const url = new URL(endpoint.trim());
    return { host: url.host.toLowerCase(), path: url.pathname, protocol: url.protocol, hasQuery: url.search.length > 1 };
  } catch {
    return null;
  }
}

/**
 * Separa os webhooks do INTEROS (caminho /api/webhooks/clicksign, qualquer domínio, com ou sem barra no fim) dos demais
 * e diz o que falta em cada um: ativo, eventos obrigatórios, segredo, domínio e endereço sem redirecionamento.
 * `expectedHost` = domínio deste INTEROS, quando conhecido.
 */
export function classifyClicksignWebhooks(hooks: ClicksignWebhookInfo[], expectedHost?: string | null, opts: { secretConfigured?: boolean } = {}): ClicksignWebhooksReport {
  const expected = expectedHost?.trim().toLowerCase() || null;
  const report: ClicksignWebhooksReport = { expectedHost: expected, secretConfigured: opts.secretConfigured ?? true, interos: [], others: [] };
  for (const [index, hook] of hooks.entries()) {
    const active = hook.status === "active";
    const parsed = parseEndpoint(hook.endpoint);
    if (!parsed || parsed.path.replace(/\/+$/, "") !== CLICKSIGN_WEBHOOK_PATH) {
      report.others.push({ host: parsed?.host || "endereço inválido", active });
      continue;
    }
    const marked = new Set(hook.events);
    const missing = CLICKSIGN_WEBHOOK_EVENTS.filter((e) => !marked.has(e.key));
    report.interos.push({
      host: parsed.host,
      active,
      missingEvents: missing.map((e) => e.label),
      missingEssential: missing.some((e) => !OPTIONAL_EVENTS.has(e.key)),
      secretMatches: hook.secretMatches,
      otherHost: expected !== null && parsed.host !== expected,
      addressProblem: parsed.protocol !== "https:" ? "http" : parsed.path !== CLICKSIGN_WEBHOOK_PATH ? "barra_final" : null,
      hasQuery: parsed.hasQuery,
      // Neste domínio o endereço é do próprio INTEROS: mostra como cadastrado (os parâmetros distinguem um webhook do
      // outro). Em outro domínio pode ser OUTRO sistema com o mesmo caminho: parâmetros ocultos (podem carregar chave).
      endpoint: displayEndpoint(hook.endpoint, expected !== null && parsed.host !== expected),
      position: index + 1,
    });
  }
  // Dois endereços diferentes para a Clicksign que saem iguais na tela (senha mascarada, parâmetros ocultos): numera
  // pela posição na lista, para "manter este / apagar aquele" nunca ser ambíguo.
  const seen = new Map<string, number>();
  for (const h of report.interos) seen.set(h.endpoint, (seen.get(h.endpoint) ?? 0) + 1);
  report.interos = report.interos.map((h) => ((seen.get(h.endpoint) ?? 0) < 2 ? h : { ...h, endpoint: `${h.endpoint} [${h.position}º da lista de webhooks]` }));
  return report;
}

/**
 * O webhook do INTEROS está pronto: ativo, endereço exato em https, com todos os eventos, segredo conferido e no
 * domínio deste INTEROS.
 */
export function interosWebhookReady(check: InterosWebhookCheck): boolean {
  return check.active && check.addressProblem === null && check.missingEvents.length === 0 && check.secretMatches === true && !check.otherHost;
}

export type ClicksignTokenCheck = { ok: true } | { ok: false; problem: "sem_token" | "recusado" | "indisponivel"; message: string };

/** Resultado do «Testar conexão». */
export interface ClicksignConnectionCheck {
  env: ClicksignEnv;
  checkedAt: string;
  token: ClicksignTokenCheck;
  /** Webhooks da conta (só quando o token foi aceito); `error` quando a lista não veio. */
  webhooks: ClicksignWebhooksReport | { error: string } | null;
}

export type CheckTone = "ok" | "warn" | "error";

export interface CheckLine {
  tone: CheckTone;
  text: string;
}

/**
 * O webhook recebe os avisos de fato: ativo, endereço exato em https, segredo conferido e os eventos essenciais. Pode
 * ainda ter alerta (sem o upload, outro domínio do mesmo sistema) — mas é ele que funciona.
 */
export function interosWebhookReceives(check: InterosWebhookCheck): boolean {
  return check.active && check.addressProblem === null && check.secretMatches === true && !check.missingEssential;
}


/** O que o webhook tem de pior, em poucas palavras. */
function flaws(hook: InterosWebhookCheck, report: ClicksignWebhooksReport): string[] {
  const out: string[] = [];
  if (!hook.active) out.push("inativo");
  if (hook.addressProblem === "barra_final") out.push("endereço termina com barra");
  if (hook.addressProblem === "http") out.push("endereço começa com http://");
  if (hook.secretMatches === false) out.push("segredo diferente do da Vercel");
  if (report.secretConfigured && hook.secretMatches === null) out.push("segredo não conferido");
  if (hook.missingEvents.length) out.push(hook.missingEssential ? "faltam eventos" : `sem o evento ${hook.missingEvents.join(", ")}`);
  if (hook.otherHost) out.push("outro domínio");
  return out;
}

/**
 * Qual webhook do INTEROS é o principal — sempre um, o melhor para manter: pronto; recebe os avisos neste domínio;
 * recebe em outro domínio; depois, do que dá menos trabalho de corrigir (neste domínio, endereço exato, ativo, segredo
 * certo, eventos). Parâmetros no endereço só desempatam. A ordem em que a Clicksign lista não decide nada. Só o
 * principal recebe instruções de correção; os demais são sobras ("pode apagá-lo"), para a tela nunca dar instruções
 * concorrentes (ex.: ativar um e copiar o segredo de outro).
 */
function rank(h: InterosWebhookCheck, report: ClicksignWebhooksReport): number {
  const tie = h.hasQuery ? 0.5 : 0;
  if (interosWebhookReady(h)) return tie;
  if (interosWebhookReceives(h)) return (h.otherHost ? 2 : 1) + tie;
  return (
    10 +
    (h.otherHost ? 16 : 0) +
    // Endereço errado pesa mais que inativo + segredo + eventos juntos: o de endereço exato sempre é o principal.
    (h.addressProblem ? 9 : 0) +
    (h.active ? 0 : 4) +
    (report.secretConfigured && h.secretMatches === false ? 2 : 0) +
    (h.missingEssential ? 2 : h.missingEvents.length > 0 ? 1 : 0) +
    tie
  );
}

function webhookLine(hook: InterosWebhookCheck, report: ClicksignWebhooksReport): CheckLine {
  if (interosWebhookReady(hook)) return { tone: "ok", text: `Webhook do INTEROS ativo (${hook.endpoint}), com todos os eventos e o mesmo segredo da Vercel.` };
  const problems: string[] = [];
  if (!hook.active) problems.push("está inativo na Clicksign (ative-o)");
  if (hook.addressProblem === "http") problems.push("o endereço começa com http://; o INTEROS redireciona para https e a Clicksign não segue redirecionamento, então os avisos não chegam (edite o endereço deste webhook na Clicksign para exatamente o endereço abaixo)");
  if (hook.addressProblem === "barra_final") problems.push("o endereço termina com barra; o INTEROS redireciona para o endereço sem barra e a Clicksign não segue redirecionamento, então os avisos não chegam (edite o endereço deste webhook na Clicksign para exatamente o endereço abaixo)");
  if (hook.missingEvents.length) problems.push(`faltam os eventos ${hook.missingEvents.join(", ")}: esses avisos não chegam ao INTEROS`);
  // Sem segredo na Vercel a instrução de copiar sai uma vez só, no topo (com qual webhook copiar).
  if (report.secretConfigured && hook.secretMatches === false) problems.push("o segredo na Clicksign é diferente do CLICKSIGN_WEBHOOK_SECRET da Vercel, então os avisos são recusados (copie o segredo do webhook para a Vercel e publique de novo)");
  else if (report.secretConfigured && hook.secretMatches === null) problems.push("a Clicksign não informou o segredo deste webhook; não deu para conferir");
  // Outro domínio pode ser o mesmo sistema (ex.: endereço .vercel.app e domínio próprio): só alerta.
  if (hook.otherHost) problems.push(`o endereço deste INTEROS é ${report.expectedHost ?? "outro"}; confira se os dois são o mesmo sistema`);
  if (problems.length === 0) return { tone: "ok", text: `Webhook do INTEROS (${hook.endpoint}) cadastrado certo na Clicksign: ativo, com o endereço exato e os eventos.` };
  const blocking = !hook.active || hook.addressProblem !== null || hook.missingEssential || (report.secretConfigured && hook.secretMatches === false);
  return { tone: blocking ? "error" : "warn", text: `Webhook do INTEROS (${hook.endpoint}): ${problems.join("; ")}.` };
}

/** Transforma o resultado do teste em linhas legíveis (certo / atenção / problema). */
export function connectionCheckLines(check: ClicksignConnectionCheck): CheckLine[] {
  if (!check.token.ok) return [{ tone: "error", text: check.token.message }];
  const lines: CheckLine[] = [{ tone: "ok", text: `A Clicksign aceitou a chave da API (${check.env === "producao" ? "produção" : "ambiente de testes"}).` }];
  const hooks = check.webhooks;
  if (!hooks) return lines;
  if ("error" in hooks) {
    lines.push({ tone: "warn", text: `Não deu para ler os webhooks da Clicksign: ${hooks.error}` });
    return lines;
  }
  // Um principal sempre (o melhor para manter); só ele recebe instruções de correção. Os demais são sobras: neste
  // domínio, "pode apagá-lo"; em outro domínio, pode ser outro sistema com o mesmo caminho — só se for este INTEROS.
  // Principal só entre os deste domínio ou que já recebem os avisos: um webhook de outro domínio que não funciona pode
  // ser de OUTRO sistema (mesmo caminho) — instruir a editá-lo ou copiar o segredo dele quebraria esse sistema.
  const eligible = hooks.interos.filter((h) => !h.otherHost || interosWebhookReceives(h));
  const primary = eligible.length > 0 ? eligible.reduce((best, h) => (rank(h, hooks) < rank(best, hooks) ? h : best)) : undefined;
  const leftovers = primary ? hooks.interos.filter((h) => h !== primary) : [];
  if (!hooks.secretConfigured) {
    lines.push({
      tone: "error",
      text: primary
        ? `Falta o CLICKSIGN_WEBHOOK_SECRET na Vercel: o INTEROS recusa todos os avisos. Na Clicksign, copie o segredo do webhook ${primary.endpoint} para a Vercel e publique de novo.`
        : "Falta o CLICKSIGN_WEBHOOK_SECRET na Vercel: o INTEROS recusa todos os avisos. Cadastre o webhook abaixo na Clicksign, copie o segredo dele para a Vercel e publique de novo.",
    });
  }
  if (!primary) {
    lines.push({ tone: "error", text: "Nenhum webhook da Clicksign aponta para este INTEROS: assinaturas, recusas e o PDF assinado não voltam sozinhos. Cadastre o endereço abaixo na Clicksign (Configurações › API › Webhooks)." });
    for (const extra of hooks.interos) {
      lines.push({ tone: "warn", text: `Webhook com o caminho do INTEROS em outro domínio (${extra.endpoint}): se for um endereço antigo deste INTEROS, pode apagá-lo na Clicksign; se for outro sistema, não mexa.` });
    }
  } else {
    lines.push(webhookLine(primary, hooks));
    for (const extra of leftovers) {
      if (extra.otherHost) {
        lines.push({ tone: "warn", text: `Webhook com o caminho do INTEROS em outro domínio (${extra.endpoint}): se for um endereço antigo deste INTEROS, pode apagá-lo na Clicksign; se for outro sistema, não mexa.` });
        continue;
      }
      const notes = flaws(extra, hooks);
      // Também recebe os avisos: a Clicksign manda cada aviso mais de uma vez (o INTEROS ignora o repetido).
      const twice = interosWebhookReceives(extra) ? "também recebe os avisos (cada aviso chega mais de uma vez)" : "";
      const detail = [twice, ...notes].filter(Boolean).join(", ");
      lines.push({ tone: "warn", text: `Outro webhook do INTEROS (${extra.endpoint}${detail ? `: ${detail}` : ""}) não é o principal: pode apagá-lo na Clicksign (Configurações › API › Webhooks).` });
    }
  }
  if (hooks.others.length) {
    const list = hooks.others.map((o) => `${o.host} (${o.active ? "ativo" : "inativo"})`).join(", ");
    lines.push({ tone: "warn", text: `Outros webhooks na Clicksign: ${list}. Se não usa mais esse serviço, apague-o na Clicksign (Configurações › API › Webhooks).` });
  } else {
    lines.push({ tone: "ok", text: "Nenhum webhook de outro serviço cadastrado na Clicksign." });
  }
  return lines;
}
