import type { Metadata } from "next";
import { AuthHero } from "@/components/auth/auth-hero";
import { ActivateAccountForm } from "@/components/auth/activate-account-form";

export const metadata: Metadata = { title: "Ativar minha conta" };

export default function AtivarContaPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16 lg:py-10">
      <AuthHero className="hidden lg:flex" />
      <ActivateAccountForm />
    </div>
  );
}
