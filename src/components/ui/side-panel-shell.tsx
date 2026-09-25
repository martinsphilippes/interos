"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

const XL_QUERY = "(min-width: 1280px)";

function useIsXl(): boolean | null {
  const [isXl, setIsXl] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const mq = window.matchMedia(XL_QUERY);
    const sync = () => setIsXl(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isXl;
}

/**
 * Painel de detalhe de "tabela com painel lateral" (Design System): coluna fixa à direita a partir de `xl`; abaixo
 * disso vira Drawer, aberto só quando o usuário escolheu um item (?<param>=<id>). Fechar o Drawer remove o parâmetro.
 */
export function SidePanelShell({
  explicit,
  title,
  param,
  ariaLabel,
  children,
}: {
  /** O item foi escolhido explicitamente na URL (abre o Drawer abaixo de xl). */
  explicit: boolean;
  title: string;
  /** Parâmetro da URL que seleciona o item (ex.: "contrato"). */
  param: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const isXl = useIsXl();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const close = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <>
      {/* Antes da hidratação o CSS decide; depois, só um dos dois monta o conteúdo. */}
      {isXl !== false ? <aside className="hidden min-w-0 flex-col gap-4 xl:flex" aria-label={ariaLabel ?? title}>{children}</aside> : null}
      {isXl === false ? (
        <Drawer open={explicit} onOpenChange={(open) => !open && close()}>
          <DrawerContent size="md">
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="flex flex-col gap-4">{children}</DrawerBody>
          </DrawerContent>
        </Drawer>
      ) : null}
    </>
  );
}
