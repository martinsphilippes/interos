import "server-only";
/**
 * Assistente de ativação (fase 0): o que falta para ligar cada canal, lido da configuração real (variáveis de ambiente
 * — só se existem, nunca os valores —, registros técnicos, filas, agendador e configurações). Nada aqui é estimado.
 */
import { list } from "@/server/db";
import { isConnected } from "@/server/integrations/status";
import { COLLECTIONS, type ChannelEvent, type Settings, type User } from "@/domain/types";
import { listQueues } from "./queues";
import { listTemplates } from "./templates";
import { getAutoMessages } from "./auto-messages";
import { getRecordingPolicy } from "./ops-settings";
import { STATE_SETTING } from "./scheduler";

export type StepStatus = "pronto" | "pendente" | "opcional" | "depois";

export interface ActivationStep {
  key: string;
  title: string;
  status: StepStatus;
  /** O que está acontecendo, em português simples. */
  detail: string;
  /** Onde resolver (texto) e link interno, quando houver. */
  fix?: string;
  href?: string;
}

export interface ActivationGroup {
  key: string;
  title: string;
  steps: ActivationStep[];
}

const has = (name: string) => Boolean(process.env[name]?.trim());

export async function getSchedulerStatus(): Promise<{ lastRunAt?: string; lastRunOk?: boolean }> {
  const v = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", STATE_SETTING]] }))[0]?.value as { lastRunAt?: string; lastRunOk?: boolean } | undefined;
  return { lastRunAt: v?.lastRunAt, lastRunOk: v?.lastRunOk };
}

export async function getActivationChecklist(now: number = Date.now()): Promise<ActivationGroup[]> {
  const [queues, users, templates, events, auto, scheduler, policy] = await Promise.all([
    listQueues(),
    list<User>(COLLECTIONS.users),
    listTemplates(),
    list<ChannelEvent>(COLLECTIONS.channelEvents, { where: [["kind", "==", "mensagem_recebida"]] }),
    getAutoMessages(),
    getSchedulerStatus(),
    getRecordingPolicy(),
  ]);
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const received = (channel: "whatsapp" | "email") => events.filter((e) => e.channel === channel && e.result === "processado" && e.occurredAt >= weekAgo).length;
  const approved = templates.filter((t) => t.status === "aprovado");
  const active = queues.filter((q) => q.active);
  const empty = active.filter((q) => q.memberIds.length === 0);
  const defaultQueue = active.find((q) => q.isDefault);
  const activeUsers = new Set(users.filter((u) => u.active !== false).map((u) => u.id));
  const operators = new Set(active.flatMap((q) => q.memberIds).filter((id) => activeUsers.has(id)));
  const lastRunMin = scheduler.lastRunAt ? Math.floor((now - new Date(scheduler.lastRunAt).getTime()) / 60_000) : undefined;
  const wa = isConnected("whatsapp");
  const mail = isConnected("email");

  return [
    {
      key: "whatsapp",
      title: "WhatsApp Business (Meta)",
      steps: [
        { key: "wa-cred", title: "Número conectado à Meta", status: wa ? "pronto" : "pendente", detail: wa ? "O INTEROS envia e recebe pelo WhatsApp Business." : "Sem credenciais: as respostas saem pelo WhatsApp do aparelho (registro manual).", fix: wa ? undefined : "Vercel: WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID (número decidido pela empresa)." },
        { key: "wa-hook", title: "Assinatura do webhook conferida", status: has("WHATSAPP_APP_SECRET") ? "pronto" : "pendente", detail: has("WHATSAPP_APP_SECRET") ? "Todo aviso da Meta tem a assinatura conferida." : "Sem o App Secret, o webhook não confere a assinatura (em produção, só com token próprio).", fix: has("WHATSAPP_APP_SECRET") ? undefined : "Vercel: WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN; na Meta, apontar o webhook para /api/webhooks/whatsapp." },
        { key: "wa-in", title: "Mensagens chegando", status: received("whatsapp") > 0 ? "pronto" : wa ? "pendente" : "depois", detail: received("whatsapp") > 0 ? `${received("whatsapp")} mensagem(ns) recebida(s) nos últimos 7 dias.` : "Nenhuma mensagem recebida nos últimos 7 dias.", href: "/comunicacao/canais?aba=registros" },
        {
          key: "wa-tpl",
          title: "Modelos aprovados (fora da janela de 24 h)",
          status: approved.length > 0 ? "pronto" : has("WHATSAPP_BUSINESS_ACCOUNT_ID") ? "pendente" : "depois",
          detail: approved.length > 0 ? `${approved.length} modelo(s) aprovado(s) pela Meta.` : "Sem modelo aprovado, quem não escreveu nas últimas 24 h só recebe pelo aparelho.",
          fix: has("WHATSAPP_BUSINESS_ACCOUNT_ID") ? undefined : "Vercel: WHATSAPP_BUSINESS_ACCOUNT_ID; depois cadastrar os modelos.",
          href: "/comunicacao/canais?aba=modelos",
        },
      ],
    },
    {
      key: "email",
      title: "E-mail",
      steps: [
        { key: "mail-out", title: "Envio", status: mail ? "pronto" : "pendente", detail: mail ? "As respostas saem pelo Resend." : "Sem o Resend, o e-mail sai pelo programa de e-mail do aparelho (registro manual).", fix: mail ? undefined : "Vercel: RESEND_API_KEY e EMAIL_FROM (domínio verificado no Resend)." },
        {
          key: "mail-in",
          title: "Recebimento na Central",
          status: has("RESEND_WEBHOOK_SECRET") || has("EMAIL_INBOUND_TOKEN") ? "pronto" : "pendente",
          detail: has("RESEND_WEBHOOK_SECRET") || has("EMAIL_INBOUND_TOKEN") ? `Webhook configurado.${received("email") > 0 ? ` ${received("email")} e-mail(s) nos últimos 7 dias.` : ""}` : "E-mails dos clientes ainda não entram na Central.",
          fix: has("RESEND_WEBHOOK_SECRET") || has("EMAIL_INBOUND_TOKEN") ? undefined : "Resend: ativar o recebimento e o webhook email.received → /api/webhooks/email; Vercel: RESEND_WEBHOOK_SECRET.",
        },
        { key: "mail-reply", title: "Respostas voltam para a Central", status: has("EMAIL_REPLY_TO") ? "pronto" : "pendente", detail: has("EMAIL_REPLY_TO") ? "O cliente responde para a caixa de recebimento." : "Sem EMAIL_REPLY_TO, a resposta do cliente vai para o remetente e não entra na Central.", fix: has("EMAIL_REPLY_TO") ? undefined : "Vercel: EMAIL_REPLY_TO (endereço de recebimento do Resend)." },
      ],
    },
    {
      key: "operacao",
      title: "Operação da Central",
      steps: [
        {
          key: "cron",
          title: "Agendador (a cada 5 minutos)",
          status: lastRunMin !== undefined && lastRunMin <= 15 ? "pronto" : "pendente",
          detail:
            lastRunMin === undefined
              ? "Ainda não rodou: transbordo, avisos, encerramento por falta de resposta, limpeza e alertas não acontecem."
              : lastRunMin <= 15
                ? `Rodou há ${lastRunMin} min${scheduler.lastRunOk === false ? " (com falha em algum passo — veja o log da Vercel)" : ""}.`
                : `Última execução há ${lastRunMin} min: o pg_cron parou?`,
          fix: lastRunMin !== undefined && lastRunMin <= 15 ? undefined : `${has("CRON_SECRET") ? "" : "Vercel: CRON_SECRET. "}Supabase: guardar o mesmo valor no Vault (interos_cron_secret) e rodar supabase/agendador-central.sql com o domínio.`,
        },
        {
          key: "filas",
          title: "Filas com operadores",
          status: empty.length === 0 && active.length > 0 ? "pronto" : "pendente",
          detail: empty.length === 0 ? `${active.length} fila(s) ativa(s), ${operators.size} operador(es).` : `Sem operador: ${empty.map((q) => q.name).join(", ")}.${defaultQueue && empty.includes(defaultQueue) ? " É a fila padrão: números desconhecidos caem nela." : ""}`,
          href: "/comunicacao/canais?aba=filas",
        },
        { key: "auto", title: "Mensagens automáticas", status: "opcional", detail: auto.stored ? "Configuradas (cada uma liga e desliga separadamente)." : "Todas desligadas (padrão).", href: "/comunicacao/canais?aba=automaticas" },
      ],
    },
    {
      key: "telefonia",
      title: "Telefonia",
      steps: [
        { key: "voip", title: "Provedor de telefonia", status: isConnected("voip") ? "pronto" : "depois", detail: isConnected("voip") ? "Softphone no navegador: ligações recebidas pelas filas e feitas pelo INTEROS." : "Provedor a definir pela empresa (adaptador pronto para a Twilio). Até lá, «Ligar» abre o discador do aparelho e a ligação é registrada à mão.", fix: isConnected("voip") ? undefined : "Vercel: as variáveis TWILIO_*; na Twilio, os endereços mostrados em PABX › Provedor.", href: "/comunicacao/pabx?aba=provedor" },
        { key: "pabx", title: "Números e ramais", status: "opcional", detail: "Cadastre os números da empresa (para qual fila vão) e os ramais de quem atende.", href: "/comunicacao/pabx?aba=numeros" },
        { key: "rec", title: "Política de gravação", status: policy.stored ? "pronto" : "pendente", detail: policy.stored ? `${policy.enabled ? `Grava as ligações, guarda por ${policy.retentionDays} dias` : "Não grava as ligações"}.` : "Política aprovada pela empresa: registre abaixo o aviso, o prazo e quem pode ouvir." },
      ],
    },
  ];
}
