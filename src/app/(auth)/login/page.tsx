import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

type SearchParams = Promise<{ next?: string | string[] }>;

/** Só aceita caminhos relativos internos para evitar redirecionamento aberto. */
function safeNext(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return undefined;
  return raw;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (user) redirect("/meu-dia");
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} />;
}
