import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listDemoUsers } from "@/server/auth/demo";
import { LoginForm } from "@/components/auth/login-form";
import { AuthHero } from "@/components/auth/auth-hero";

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
  const [{ next }, quickAccessUsers] = await Promise.all([searchParams, listDemoUsers()]);
  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16 lg:py-10">
      <AuthHero className="hidden lg:flex" />
      <LoginForm next={safeNext(next)} quickAccessUsers={quickAccessUsers} />
    </div>
  );
}
