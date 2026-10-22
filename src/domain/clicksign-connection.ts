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

export interface InterosWebhookCheck {
  host: string;
  active: boolean;
  /** Rótulos dos eventos obrigatórios que não estão marcados. */
  missingEvents: string[];
  secretMatches: boolean | null;
  /** Aponta para outro domínio que não o endereço deste INTEROS (ex.: um endereço de prévia da Vercel). */
  otherHost: boolean;
}

export interface ClicksignWebhooksReport {
  /** Domínio deste INTEROS, quando conhecido. */
  expectedHost: string | null;
  /** Webhooks cadastrados com o endereço de avisos do INTEROS. */
  interos: InterosWebhookCheck[];
  /** Os demais webhooks da conta: só o domínio, porque o endereço completo pode carregar chave de acesso. */
  others: { host: string; active: boolean }[];
}

function parseEndpoint(endpoint: string): { host: string; path: string } | null {
  try {
    const url = new URL(endpoint.trim());
    return { host: url.host.toLowerCase(), path: url.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/**
 * Separa os webhooks do INTEROS (caminho /api/webhooks/clicksign, qualquer domínio) dos demais e diz o que falta em
 * cada um: ativo, eventos obrigatórios, segredo e domínio. `expectedHost` = domínio deste INTEROS, quando conhecido.
 */
export function classifyClicksignWebhooks(hooks: ClicksignWebhookInfo[], expectedHost?: string | null): ClicksignWebhooksReport {
  const expected = expectedHost?.trim().toLowerCase() || null;
  const report: ClicksignWebhooksReport = { expectedHost: expected, interos: [], others: [] };
  for (const hook of hooks) {
    const active = hook.status === "active";
    const parsed = parseEndpoint(hook.endpoint);
    if (parsed?.path !== CLICKSIGN_WEBHOOK_PATH) {
      report.others.push({ host: parsed?.host || "endereço inválido", active });
      continue;
    }
    const marked = new Set(hook.events);
    report.interos.push({
      host: parsed.host,
      active,
      missingEvents: CLICKSIGN_WEBHOOK_EVENTS.filter((e) => !marked.has(e.key)).map((e) => e.label),
      secretMatches: hook.secretMatches,
      otherHost: expected !== null && parsed.host !== expected,
    });
  }
  return report;
}

/** O webhook do INTEROS está pronto: ativo, com todos os eventos, segredo conferido e no domínio deste INTEROS. */
export function interosWebhookReady(check: InterosWebhookCheck): boolean {
  return check.active && check.missingEvents.length === 0 && check.secretMatches === true && !check.otherHost;
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

function webhookLine(hook: InterosWebhookCheck, expectedHost: string | null): CheckLine {
  if (interosWebhookReady(hook)) return { tone: "ok", text: `Webhook do INTEROS ativo (${hook.host}), com todos os eventos e o mesmo segredo da Vercel.` };
  const problems: string[] = [];
  if (!hook.active) problems.push("está inativo na Clicksign (ative-o)");
  if (hook.missingEvents.length) problems.push(`faltam os eventos ${hook.missingEvents.join(", ")}`);
  if (hook.secretMatches === false) problems.push("o segredo na Clicksign é diferente do CLICKSIGN_WEBHOOK_SECRET da Vercel, então os avisos são recusados (copie o segredo do webhook para a Vercel e publique de novo)");
  if (hook.secretMatches === null) problems.push("não deu para conferir o segredo (falta o CLICKSIGN_WEBHOOK_SECRET na Vercel ou a Clicksign não o informou)");
  // Outro domínio pode ser o mesmo sistema (ex.: endereço .vercel.app e domínio próprio): só alerta.
  if (hook.otherHost) problems.push(`o endereço deste INTEROS é ${expectedHost ?? "outro"}; confira se os dois são o mesmo sistema`);
  const blocking = !hook.active || hook.secretMatches === false;
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
  if (hooks.interos.length === 0) {
    lines.push({ tone: "error", text: "Nenhum webhook da Clicksign aponta para o INTEROS: assinaturas, recusas e o PDF assinado não voltam sozinhos. Cadastre o endereço abaixo na Clicksign (Configurações › API › Webhooks)." });
  } else {
    lines.push(...hooks.interos.map((h) => webhookLine(h, hooks.expectedHost)));
    if (hooks.interos.length > 1) lines.push({ tone: "warn", text: `Há ${hooks.interos.length} webhooks com o endereço do INTEROS; um basta.` });
  }
  if (hooks.others.length) {
    const list = hooks.others.map((o) => `${o.host} (${o.active ? "ativo" : "inativo"})`).join(", ");
    lines.push({ tone: "warn", text: `Outros webhooks na Clicksign: ${list}. Se não usa mais esse serviço, apague-o na Clicksign (Configurações › API › Webhooks).` });
  } else {
    lines.push({ tone: "ok", text: "Nenhum webhook de outro serviço cadastrado na Clicksign." });
  }
  return lines;
}
