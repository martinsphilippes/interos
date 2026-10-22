import type { Metadata } from "next";
import Link from "next/link";
import { FileText, PenLine } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
import { getManyByIds, list } from "@/server/db";
import { listSignatureQueue } from "@/server/finance/queries";
import { documentReadinessMany } from "@/server/finance/contract-document";
import { financeCapabilities } from "@/server/finance/access";
import { getSignatureSettings, listContractTemplates } from "@/server/finance/contract-templates";
import { listSignatureInbox } from "@/server/finance/signature-inbox";
import { getIntegrationFlags } from "@/server/integrations/status";
import { COLLECTIONS, type Client, type Contract, type User } from "@/domain/types";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { SignaturesList } from "@/components/finance/signatures-list";
import { FinanceAccessProvider } from "@/components/finance/finance-access";
import { ASSINATURAS_TABS, ASSINATURAS_TAB_LABELS, type AssinaturasTab } from "@/components/finance/signature-model";
import { SignatureInbox } from "@/components/finance/signature-inbox";
import { ContractTemplatesAdmin, type TemplateRow } from "@/components/finance/contract-templates-admin";
import { SignatureSettingsForm } from "@/components/finance/signature-settings-form";
import { ClicksignConnection } from "@/components/finance/clicksign-connection";
import { CLICKSIGN_WEBHOOK_PATH } from "@/domain/clicksign-connection";
import { clicksignConfigured, clicksignEnv, clicksignWebhookSecret } from "@/server/integrations/clicksign";
import { resolvePortalBaseUrl } from "@/server/portal/service";

export const metadata: Metadata = { title: "Assinaturas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Assinatura eletrônica (catálogo financeiro.assinaturas). Abas (?aba=):
 * - fila: contratos aguardando assinatura e prontos para gerar o documento (seções Aguardando / Prontos; escopo da tela;
 *   operações pelas chaves financeiro.contratos.assinatura.*; mensalidade sob os valores do contrato);
 * - entrada: documentos criados direto na Clicksign, à espera do cliente certo (financeiro.assinaturas.entrada.*);
 * - modelos: contrato gerado pelo INTEROS ou Word da Clicksign (financeiro.assinaturas.modelos.*);
 * - configuracao: quem assina pela Intercert e a autenticação padrão (financeiro.assinaturas.configuracao.*).
 */
export default async function SignaturesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.assinaturas");
  const sp = await searchParams;
  const allowed: Record<AssinaturasTab, boolean> = {
    fila: can(user, "financeiro.assinaturas.aguardando.ver") || can(user, "financeiro.assinaturas.prontos.ver"),
    entrada: can(user, "financeiro.assinaturas.entrada.ver"),
    modelos: can(user, "financeiro.assinaturas.modelos.ver"),
    configuracao: can(user, "financeiro.assinaturas.configuracao.ver"),
  };
  const visible = ASSINATURAS_TABS.filter((t) => allowed[t]);
  const asked = first(sp.aba);
  const tab: AssinaturasTab | undefined = visible.find((t) => t === asked) ?? visible[0];
  const integrations = getIntegrationFlags();
  const providerConnected = integrations.assinatura === "conectado";

  return (
    <FinanceAccessProvider value={financeCapabilities(user)}>
      <PageContainer size={tab === "fila" ? "narrow" : undefined}>
        <PageHeader
          title="Assinaturas"
          description={providerConnected ? "Contratos em assinatura na Clicksign, modelos e a caixa de entrada." : "Fila de assinatura, modelos de contrato e configuração. Clicksign ainda não conectada: envio manual e registro com evidência."}
          breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Assinaturas" }]}
        />
        {!tab ? (
          <EmptyState title="Sem acesso às seções" description="Seu perfil não inclui as seções de assinatura." />
        ) : (
          <>
            {visible.length > 1 ? (
              <nav role="tablist" aria-label="Seções" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
                {visible.map((t) => (
                  <Link
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    href={`/financeiro/assinaturas?aba=${t}`}
                    className={cn("-mb-px inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors", tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground")}
                  >
                    {ASSINATURAS_TAB_LABELS[t]}
                  </Link>
                ))}
              </nav>
            ) : null}
            {tab === "fila" ? <QueueTab user={user} /> : null}
            {tab === "entrada" ? <InboxTab canEdit={can(user, "financeiro.assinaturas.entrada.vincular")} providerConnected={providerConnected} focusId={first(sp.item)} /> : null}
            {tab === "modelos" ? <TemplatesTab canEdit={can(user, "financeiro.assinaturas.modelos.editar")} /> : null}
            {tab === "configuracao" ? <SettingsTab canEdit={can(user, "financeiro.assinaturas.configuracao.editar")} canTest={can(user, "financeiro.assinaturas.configuracao.testar")} providerConnected={providerConnected} /> : null}
          </>
        )}
      </PageContainer>
    </FinanceAccessProvider>
  );
}

/** Até quantos contratos da fila "prontos" têm as pendências do modelo calculadas (leitura em lote). */
const READINESS_LIMIT = 40;

/** Contrato → motivo do bloqueio (dados do modelo em aberto). Contratos além do limite ficam sem aviso: o envio confere. */
async function readinessBlocks(contractIds: string[]): Promise<Record<string, string>> {
  const ids = contractIds.slice(0, READINESS_LIMIT);
  if (ids.length === 0) return {};
  try {
    const contracts = await getManyByIds<Contract>(COLLECTIONS.contracts, ids);
    const readiness = await documentReadinessMany(ids.map((id) => contracts.get(id)).filter((c): c is Contract => Boolean(c)));
    const out: Record<string, string> = {};
    for (const [id, r] of readiness) {
      if (!r || r.gaps.length === 0) continue;
      const labels = r.gaps.map((g) => (g.reason === "sem_ligacao" ? `{{${g.variable}}} sem ligação` : g.label));
      out[id] = `Modelo «${r.templateName}»: ${r.gaps.length} dado(s) em aberto — ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? "…" : ""}. Revise o contrato.`;
    }
    return out;
  } catch (error) {
    // Sem o cálculo a fila continua utilizável: o envio confere as pendências e recusa com a lista.
    console.error("[assinaturas] pendências do modelo na fila", error);
    return {};
  }
}

async function QueueTab({ user }: { user: Awaited<ReturnType<typeof requireScreen>> }) {
  const caps = financeCapabilities(user);
  const show = { waiting: can(user, "financeiro.assinaturas.aguardando.ver"), toSend: can(user, "financeiro.assinaturas.prontos.ver") };
  const fetched = await listSignatureQueue({ scope: await resolveDataScope(user, "financeiro.assinaturas"), hideValues: !caps.contractValues });
  // Seção negada: a lista não é enviada ao cliente (nem entra nos indicadores).
  const queue = { waiting: show.waiting ? fetched.waiting : [], toSend: show.toSend ? fetched.toSend : [] };
  const integrations = getIntegrationFlags();
  // Prontos para gerar: o que o modelo ainda exige do cadastro (o botão fica bloqueado com o motivo, como no contrato).
  const blocked = caps.contracts.signatureSend ? await readinessBlocks(queue.toSend.map((r) => r.contractId)) : {};
  const pendingSigners = queue.waiting.reduce((s, r) => s + r.pendingCount, 0);
  const oldest = queue.waiting.reduce((m, r) => Math.max(m, r.daysWaiting), 0);
  const reminders = queue.waiting.reduce((s, r) => s + r.remindersSent, 0);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Aguardando assinatura" value={formatNumber(queue.waiting.length)} icon={<PenLine />} tone={queue.waiting.length > 0 ? "info" : "neutral"} compact />
        <StatCard label="Signatários pendentes" value={formatNumber(pendingSigners)} tone={pendingSigners > 0 ? "warning" : "success"} compact />
        <StatCard label="Maior espera" value={`${oldest} dia(s)`} tone={oldest > 5 ? "danger" : oldest > 2 ? "warning" : "neutral"} compact />
        <StatCard label="Lembretes enviados" value={formatNumber(reminders)} hint="desde a geração do documento" compact />
      </div>

      {show.waiting ? (
        <section className="mb-8">
          <SectionTitle title="Aguardando assinatura" count={queue.waiting.length} description="Mais antigos primeiro." />
          {queue.waiting.length === 0 ? (
            <Card>
              <EmptyState size="sm" icon={<PenLine />} title="Nenhum contrato aguardando assinatura" description="Contratos com documento gerado aparecem aqui até todos assinarem." />
            </Card>
          ) : (
            <SignaturesList rows={queue.waiting} mode="waiting" integrations={integrations} />
          )}
        </section>
      ) : null}

      {show.toSend ? (
        <section>
          <SectionTitle title="Prontos para gerar o documento" count={queue.toSend.length} description="Contratos que ainda não tiveram o documento gerado para assinatura." />
          {queue.toSend.length === 0 ? (
            <Card>
              <EmptyState size="sm" icon={<FileText />} title="Nada pendente" description="Todos os contratos já têm o documento gerado para assinatura." />
            </Card>
          ) : (
            <SignaturesList rows={queue.toSend} mode="toSend" integrations={integrations} blocked={blocked} />
          )}
        </section>
      ) : null}
    </>
  );
}

async function InboxTab({ canEdit, providerConnected, focusId }: { canEdit: boolean; providerConnected: boolean; focusId?: string }) {
  const [items, clients, contracts] = await Promise.all([listSignatureInbox(), list<Client>(COLLECTIONS.clients), list<Contract>(COLLECTIONS.contracts)]);
  return (
    <SignatureInbox
      items={items}
      clients={clients.map((c) => ({ id: c.id, tradeName: c.tradeName, status: c.status })).sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"))}
      contracts={contracts.filter((c) => c.status !== "cancelado").map((c) => ({ id: c.id, number: c.number, clientId: c.clientId, status: c.status }))}
      canEdit={canEdit}
      providerConnected={providerConnected}
      focusId={focusId}
    />
  );
}

async function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const templates = await listContractTemplates();
  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    description: t.description,
    active: t.active,
    isDefault: t.isDefault,
    version: t.version,
    title: t.title,
    clauses: t.clauses,
    fileName: t.fileName,
    fileSize: t.fileSize,
    variables: t.variables,
    updatedAt: t.updatedAt,
    createdByName: t.createdByName,
    updatedByName: t.updatedByName,
    providerTemplateKey: t.providerTemplateKey,
  }));
  return <ContractTemplatesAdmin templates={rows} canEdit={canEdit} />;
}

async function SettingsTab({ canEdit, canTest, providerConnected }: { canEdit: boolean; canTest: boolean; providerConnected: boolean }) {
  const [settings, users, base] = await Promise.all([getSignatureSettings(), list<User>(COLLECTIONS.users, { where: [["active", "==", true]] }), resolvePortalBaseUrl()]);
  return (
    <>
    <ClicksignConnection info={{ connected: clicksignConfigured(), env: clicksignEnv(), webhookReady: Boolean(clicksignWebhookSecret()), webhookUrl: `${base ?? "https://<dominio>"}${CLICKSIGN_WEBHOOK_PATH}` }} canTest={canTest} />
    <SignatureSettingsForm
      settings={settings}
      users={users.map((u) => ({ id: u.id, name: u.name, email: u.email })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))}
      canEdit={canEdit}
      providerConnected={providerConnected}
    />
    </>
  );
}
