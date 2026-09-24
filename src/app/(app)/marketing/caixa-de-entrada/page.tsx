import type { Metadata } from "next";
import { Info } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getInbox } from "@/server/marketing/queries";
import { getCommunicationChannelStatus } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { InboxView } from "@/components/marketing/inbox-view";

export const metadata: Metadata = { title: "Caixa de Entrada" };

/** Caixa de Entrada do Marketing: mensagens recebidas e leads novos sem responsável. */
export default async function CaixaDeEntradaPage() {
  const user = await requireUser();
  const data = await getInbox();
  const channels = getCommunicationChannelStatus();

  return (
    <PageContainer>
      <PageHeader
        title="Caixa de Entrada"
        description="Mensagens de WhatsApp e e-mail recebidas e leads novos aguardando responsável."
        breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Caixa de Entrada" }]}
      />
      {!channels.whatsapp || !channels.email ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-info/30 bg-info-soft/60 p-3 text-sm text-info-fg" role="note">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>{!channels.whatsapp && !channels.email ? "WhatsApp e e-mail não conectados." : !channels.whatsapp ? "WhatsApp não conectado." : "E-mail não conectado."}</strong> Nenhuma mensagem sai do
            sistema por esses canais: responda pelo seu aparelho e registre aqui (registro manual) para o histórico do lead e a timeline do cliente. O administrador configura os canais em Administração → Integrações.
          </p>
        </div>
      ) : null}
      <InboxView data={data} currentUserId={user.id} channels={{ whatsapp: channels.whatsapp, email: channels.email }} />
    </PageContainer>
  );
}
