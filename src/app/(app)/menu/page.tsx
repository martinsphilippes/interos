import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CURRENT_WAVE } from "@/domain/constants";
import { requireScreen } from "@/server/auth/session";
import { filterNavigation } from "@/server/auth/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { NavIcon } from "@/components/layout/nav-icon";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Menu" };

/** Página "Mais" (mobile): todas as seções e itens acessíveis (menu derivado das permissões efetivas). */
export default async function MenuPage() {
  const user = await requireScreen("inicio.menu");
  const sections = filterNavigation(user);

  return (
    <PageContainer>
      <PageHeader title="Menu" description="Todos os módulos disponíveis para o seu perfil." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.key} className="overflow-hidden">
            <p className="label-caps border-b border-border px-4 py-2.5">{section.label}</p>
            <ul className="divide-y divide-border">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex min-h-[48px] items-center gap-3 px-4 text-sm transition-colors hover:bg-surface-hover">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface-hover text-brand-fg">
                      <NavIcon name={item.icon} className="size-4" />
                    </span>
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    {(item.wave ?? 1) > CURRENT_WAVE ? <span className="text-xs text-muted">em breve</span> : null}
                    <ChevronRight className="size-4 text-muted-light" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
