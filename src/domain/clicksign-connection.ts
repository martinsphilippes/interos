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

function parseEndpoint(endpoint: string): { host: string; path: string; protocol: string } | null {
  try {
    const url = new URL(endpoint.trim());
    return { host: url.host.toLowerCase(), path: url.pathname, protocol: url.protocol };
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
  for (const hook of hooks) {
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
    });
  }
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

/** Cadastrado certo do lado da Clicksign (ativo, endereço exato, eventos essenciais); o segredo pode faltar na Vercel. */
function registeredRight(check: InterosWebhookCheck): boolean {
  return check.active && check.addressProblem === null && !check.missingEssential;
}

/** O que torna o webhook diferente do que funciona, em poucas palavras (para dizer qual apagar). */
function differences(hook: InterosWebhookCheck): string[] {
  const out: string[] = [];
  if (!hook.active) out.push("inativo");
  if (hook.addressProblem === "barra_final") out.push("endereço termina com barra");
  if (hook.addressProblem === "http") out.push("endereço começa com http://");
  if (hook.secretMatches === false) out.push("segredo diferente do da Vercel");
  if (hook.missingEssential) out.push("faltam eventos");
  if (hook.otherHost) out.push("outro domínio");
  return out;
}

function webhookLine(hook: InterosWebhookCheck, report: ClicksignWebhooksReport): CheckLine {
  if (interosWebhookReady(hook)) return { tone: "ok", text: `Webhook do INTEROS ativo (${hook.host}), com todos os eventos e o mesmo segredo da Vercel.` };
  const problems: string[] = [];
  if (!hook.active) problems.push("está inativo na Clicksign (ative-o)");
  if (hook.addressProblem === "http") problems.push("o endereço começa com http://; o INTEROS redireciona para https e a Clicksign não segue redirecionamento, então os avisos não chegam (cadastre exatamente o endereço abaixo)");
  if (hook.addressProblem === "barra_final") problems.push("o endereço termina com barra; o INTEROS redireciona para o endereço sem barra e a Clicksign não segue redirecionamento, então os avisos não chegam (cadastre exatamente o endereço abaixo)");
  if (hook.missingEvents.length) problems.push(`faltam os eventos ${hook.missingEvents.join(", ")}: esses avisos não chegam ao INTEROS`);
  // Sem segredo na Vercel a instrução de copiar sai uma vez só, no topo (com qual webhook copiar).
  if (report.secretConfigured && hook.secretMatches === false) problems.push("o segredo na Clicksign é diferente do CLICKSIGN_WEBHOOK_SECRET da Vercel, então os avisos são recusados (copie o segredo do webhook para a Vercel e publique de novo)");
  else if (report.secretConfigured && hook.secretMatches === null) problems.push("a Clicksign não informou o segredo deste webhook; não deu para conferir");
  // Outro domínio pode ser o mesmo sistema (ex.: endereço .vercel.app e domínio próprio): só alerta.
  if (hook.otherHost) problems.push(`o endereço deste INTEROS é ${report.expectedHost ?? "outro"}; confira se os dois são o mesmo sistema`);
  if (problems.length === 0) return { tone: "ok", text: `Webhook do INTEROS (${hook.host}) cadastrado certo na Clicksign: ativo, com o endereço exato e os eventos.` };
  const blocking = !hook.active || hook.addressProblem !== null || hook.missingEssential || (report.secretConfigured && hook.secretMatches === false);
  return { tone: blocking ? "error" : "warn", text: `Webhook do INTEROS (${hook.host}): ${problems.join("; ")}.` };
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
  // O webhook que funciona (ou funcionaria, faltando só o segredo na Vercel): os demais com o caminho do INTEROS são
  // sobras. Preferir o do domínio deste INTEROS. Instruir a "corrigir" uma sobra poderia trocar o segredo da Vercel
  // e quebrar o que funciona.
  const byHost = (list: InterosWebhookCheck[]) => list.find((h) => !h.otherHost) ?? list[0];
  const receiving = hooks.interos.filter(interosWebhookReceives);
  const primary = receiving.length > 0 ? byHost(receiving) : !hooks.secretConfigured ? byHost(hooks.interos.filter(registeredRight)) : undefined;
  if (!hooks.secretConfigured) {
    lines.push({
      tone: "error",
      text: primary
        ? `Falta o CLICKSIGN_WEBHOOK_SECRET na Vercel: o INTEROS recusa todos os avisos. Copie o segredo do webhook ${primary.host} (o ativo, com o endereço exato) na Clicksign para a Vercel e publique de novo.`
        : "Falta o CLICKSIGN_WEBHOOK_SECRET na Vercel: o INTEROS recusa todos os avisos. Cadastre (ou corrija) o webhook abaixo na Clicksign, copie o segredo dele para a Vercel e publique de novo.",
    });
  }
  if (hooks.interos.length === 0) {
    lines.push({ tone: "error", text: "Nenhum webhook da Clicksign aponta para o INTEROS: assinaturas, recusas e o PDF assinado não voltam sozinhos. Cadastre o endereço abaixo na Clicksign (Configurações › API › Webhooks)." });
  } else if (primary) {
    lines.push(webhookLine(primary, hooks));
    const otherReceiving = receiving.filter((h) => h !== primary);
    if (otherReceiving.length > 0) lines.push({ tone: "warn", text: `Há ${otherReceiving.length + 1} webhooks que recebem os avisos do INTEROS: a Clicksign manda cada aviso mais de uma vez. Um basta; apague os outros na Clicksign.` });
    for (const extra of hooks.interos.filter((h) => h !== primary && !otherReceiving.includes(h))) {
      lines.push({ tone: "warn", text: `Outro webhook com o caminho do INTEROS (${extra.host}: ${differences(extra).join(", ")}) não é o que recebe os avisos: pode apagá-lo na Clicksign (Configurações › API › Webhooks).` });
    }
  } else {
    lines.push(...hooks.interos.map((h) => webhookLine(h, hooks)));
  }
  if (hooks.others.length) {
    const list = hooks.others.map((o) => `${o.host} (${o.active ? "ativo" : "inativo"})`).join(", ");
    lines.push({ tone: "warn", text: `Outros webhooks na Clicksign: ${list}. Se não usa mais esse serviço, apague-o na Clicksign (Configurações › API › Webhooks).` });
  } else {
    lines.push({ tone: "ok", text: "Nenhum webhook de outro serviço cadastrado na Clicksign." });
  }
  return lines;
}
