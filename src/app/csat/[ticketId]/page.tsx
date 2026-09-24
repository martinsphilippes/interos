import type { Metadata } from "next";
import { CheckCircle2, Clock, LinkIcon } from "lucide-react";
import { getCsatTicketInfo, isValidCsatToken } from "@/server/support/service";
import { formatDate } from "@/lib/format";
import { CsatForm } from "@/components/support/csat-form";

export const metadata: Metadata = { title: "Avalie seu atendimento" };

type Params = Promise<{ ticketId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-10 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-foreground">
          INTERCERT <span className="font-normal text-muted">· Suporte</span>
        </p>
        {children}
      </div>
    </main>
  );
}

function Message({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <span className="text-muted [&_svg]:size-10">{icon}</span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

/**
 * Página PÚBLICA de avaliação (sem login). O link enviado ao cliente carrega ?t=<token>, os 8 primeiros
 * caracteres do HMAC-SHA256 do id do chamado; sem token válido nada do chamado é exibido.
 */
export default async function CsatPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { ticketId } = await params;
  const sp = await searchParams;
  const token = (Array.isArray(sp.t) ? sp.t[0] : sp.t) ?? "";

  if (!isValidCsatToken(ticketId, token)) {
    return (
      <Shell>
        <Message icon={<LinkIcon />} title="Link de avaliação inválido" text="Confira se o endereço foi copiado por completo ou peça um novo link ao suporte." />
      </Shell>
    );
  }
  const info = await getCsatTicketInfo(ticketId);
  if (!info) {
    return (
      <Shell>
        <Message icon={<LinkIcon />} title="Atendimento não encontrado" text="Este chamado não existe mais. Se precisar, fale com o suporte." />
      </Shell>
    );
  }
  if (info.alreadyAnswered) {
    return (
      <Shell>
        <Message icon={<CheckCircle2 />} title="Avaliação já registrada" text={`Obrigado! Recebemos sua nota${info.score !== undefined ? ` ${info.score}` : ""} para o chamado ${info.number}.`} />
      </Shell>
    );
  }
  if (!info.available) {
    return (
      <Shell>
        <Message icon={<Clock />} title="Atendimento em andamento" text={`O chamado ${info.number} ainda não foi concluído. Você poderá avaliar assim que ele for resolvido.`} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">Como foi seu atendimento?</h1>
        <p className="mt-2 text-sm text-muted">
          {info.clientName} · chamado {info.number}
          {info.resolvedAt ? ` · resolvido em ${formatDate(info.resolvedAt)}` : ""}
        </p>
        <p className="mt-1 text-sm">
          “{info.subject}”{info.attendantName ? ` · atendido por ${info.attendantName}` : ""}
        </p>
      </div>
      <CsatForm ticketId={ticketId} token={token} />
    </Shell>
  );
}
