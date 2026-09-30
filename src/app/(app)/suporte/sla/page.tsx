import { redirect } from "next/navigation";
import { requireScreen } from "@/server/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * O SLA do suporte agora é uma visão da Gestão de SLA global (/sla filtrada em chamados). ?mes= vira ?periodo=.
 * A rota legada pertence à tela operacao.sla (catálogo): passa pela mesma guarda antes de redirecionar.
 */
export default async function SupportSlaRedirect({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("operacao.sla");
  const sp = await searchParams;
  const mes = Array.isArray(sp.mes) ? sp.mes[0] : sp.mes;
  const params = new URLSearchParams({ tipo: "chamado" });
  if (mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) params.set("periodo", mes);
  redirect(`/sla?${params.toString()}`);
}
