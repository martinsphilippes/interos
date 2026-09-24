import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** O SLA do suporte agora é uma visão da Gestão de SLA global (/sla filtrada em chamados). ?mes= vira ?periodo=. */
export default async function SupportSlaRedirect({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const mes = Array.isArray(sp.mes) ? sp.mes[0] : sp.mes;
  const params = new URLSearchParams({ tipo: "chamado" });
  if (mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) params.set("periodo", mes);
  redirect(`/sla?${params.toString()}`);
}
