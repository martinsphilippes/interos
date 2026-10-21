import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { can, requireScreen } from "@/server/auth/session";
import { getPabx, pabxHistory } from "@/server/telephony/service";
import { pabxQuality } from "@/server/telephony/queries";
import { listQueues } from "@/server/conversations/queues";
import { getIntegration, isConnected } from "@/server/integrations/status";
import { list } from "@/server/db";
import { COLLECTIONS, type User } from "@/domain/types";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ChangesView, ExtensionsAdmin, PabxConfigAdmin, ProviderStatus, QualityView } from "@/components/telephony/pabx-view";
import { PABX_TABS, type PabxTab } from "@/components/telephony/model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "PABX" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const LABEL: Record<PabxTab, string> = { ramais: "Ramais", numeros: "Números", horarios: "Horários e correio de voz", provedor: "Provedor", qualidade: "Qualidade", mudancas: "Histórico de mudanças" };

/** PABX (catálogo comunicacao.pabx): uma aba por seção; edição com comunicacao.pabx.editar. */
export default async function PabxPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.pabx");
  const sp = await searchParams;
  const visible = PABX_TABS.filter((t) => can(user, `comunicacao.pabx.${t}.ver`));
  const asked = Array.isArray(sp.aba) ? sp.aba[0] : sp.aba;
  const tab = visible.find((t) => t === asked) ?? visible[0];
  const canEdit = can(user, "comunicacao.pabx.editar");

  let content: React.ReactNode = null;
  if (tab === "ramais") {
    const [users, queues] = await Promise.all([list<User>(COLLECTIONS.users), listQueues()]);
    content = (
      <ExtensionsAdmin
        canEdit={canEdit}
        rows={users
          .filter((u) => u.active !== false)
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
          .map((u) => ({ userId: u.id, name: u.name, department: DEPARTMENT_LABELS[u.departmentId] ?? u.departmentId, extension: u.central?.extension ?? "", queues: queues.filter((q) => q.memberIds.includes(u.id)).map((q) => q.name), online: u.presence === "online" }))}
      />
    );
  } else if (tab === "numeros" || tab === "horarios") {
    const [{ stored, ...config }, queues] = await Promise.all([getPabx(), listQueues()]);
    void stored;
    content = <PabxConfigAdmin key={tab} part={tab} config={config} canEdit={canEdit} queues={queues.filter((q) => q.active).map((q) => ({ id: q.id, name: q.name }))} />;
  } else if (tab === "provedor") {
    const h = await headers();
    const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "<dominio>"}`;
    const voip = getIntegration("voip");
    content = <ProviderStatus base={base} connected={isConnected("voip")} vars={voip.envVars.filter((v) => v.name.startsWith("TWILIO_")).map((v) => ({ name: v.name, present: v.present, description: v.description ?? "" }))} />;
  } else if (tab === "qualidade") {
    content = <QualityView q={await pabxQuality()} />;
  } else if (tab === "mudancas") {
    content = <ChangesView events={(await pabxHistory()).map((e) => ({ id: e.id, at: e.occurredAt, title: e.title, description: e.description }))} />;
  }

  return (
    <PageContainer>
      <PageHeader title="PABX" description="Ramais, números, horário e correio de voz, provedor e qualidade das ligações." breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "PABX" }]} />
      {!tab ? (
        <EmptyState title="Sem acesso às seções" description="Seu perfil não inclui as seções do PABX." />
      ) : (
        <>
          <nav role="tablist" aria-label="Seções" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
            {visible.map((t) => (
              <Link key={t} role="tab" aria-selected={tab === t} href={`/comunicacao/pabx?aba=${t}`} className={cn("-mb-px inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors", tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground")}>
                {LABEL[t]}
              </Link>
            ))}
          </nav>
          {content}
        </>
      )}
    </PageContainer>
  );
}
