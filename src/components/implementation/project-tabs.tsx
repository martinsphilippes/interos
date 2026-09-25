"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ProjectTab {
  value: string;
  label: string;
  count?: number;
  /** Destaque (ex.: pendência aberta). */
  alert?: boolean;
  content: React.ReactNode;
}

/** Abas do projeto sincronizadas com ?aba= (links diretos e voltar do navegador funcionam). */
export function ProjectTabs({ tabs, defaultTab }: { tabs: ProjectTab[]; defaultTab: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("aba");
  const value = tabs.some((t) => t.value === requested) ? requested! : defaultTab;

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultTab) params.delete("aba");
    else params.set("aba", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="w-full">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
            {t.count !== undefined ? <span className="rounded-full bg-surface-hover px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span> : null}
            {t.alert ? <span className="size-1.5 rounded-full bg-warning" aria-label="pendente" /> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
