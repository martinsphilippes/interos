import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ACCESS_DENIED_REDIRECT, can, requireScreen } from "@/server/auth/session";
import { getCommandCenter } from "@/server/conversations/supervision";
import { PageContainer } from "@/components/layout/page-container";
import { TvBoard } from "@/components/conversations/tv-board";

export const metadata: Metadata = { title: "Painel para TV" };

/** Painel para TV (catálogo comunicacao.supervisao, seção painel): filas e SLA em letras grandes. */
export default async function TvPage() {
  const user = await requireScreen("comunicacao.supervisao");
  if (!can(user, "comunicacao.supervisao.painel.ver")) redirect(ACCESS_DENIED_REDIRECT);
  return (
    <PageContainer size="full">
      <TvBoard data={await getCommandCenter(user)} />
    </PageContainer>
  );
}
