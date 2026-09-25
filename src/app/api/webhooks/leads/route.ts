import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { MarketingError, createLeadFromWebhook } from "@/server/marketing/service";
import { webhookLeadSchema } from "@/server/marketing/schemas";

/**
 * Webhook de entrada de leads (site, formulários, integrações de anúncios).
 *
 * POST /api/webhooks/leads
 * Header: x-interos-token: <LEADS_WEBHOOK_TOKEN>
 * Corpo JSON: { nome, empresa?, telefone?, email?, cidade?, origem?, campanha?, interesse?, consentimento? }
 *   - telefone ou email obrigatório; origem = chave ou nome da origem cadastrada (padrão "site");
 *   - campanha = id ou nome da campanha; consentimento aceita true/"sim"/1.
 * Respostas: 201 { id, score, temperature, possibleDuplicates } · 400 JSON inválido · 401 token inválido ·
 *            422 dados inválidos · 503 token não configurado em produção.
 */

function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = process.env.LEADS_WEBHOOK_TOKEN;
  if (!expected) {
    // Sem token configurado o webhook só funciona em desenvolvimento.
    if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Webhook de leads não configurado (LEADS_WEBHOOK_TOKEN ausente)" }, { status: 503 });
  } else if (!tokenMatches(request.headers.get("x-interos-token") ?? "", expected)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const parsed = webhookLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
  }

  let result: Awaited<ReturnType<typeof createLeadFromWebhook>>;
  try {
    result = await createLeadFromWebhook(parsed.data);
  } catch (error) {
    if (error instanceof MarketingError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("[webhook:leads] falha ao criar lead", error);
    return NextResponse.json({ error: "Falha ao registrar o lead" }, { status: 500 });
  }
  try {
    revalidatePath("/marketing", "layout");
  } catch (error) {
    // O lead já foi gravado; falhar a revalidação do cache não deve fazer o remetente reenviar.
    console.error("[webhook:leads] falha ao revalidar /marketing", error);
  }
  const { lead, duplicates } = result;
  return NextResponse.json({ id: lead.id, score: lead.score, temperature: lead.temperature, possibleDuplicates: duplicates.map((d) => d.id) }, { status: 201 });
}
