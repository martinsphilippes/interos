"use client";

/**
 * Visibilidade de links no cliente (A11): o shell recebe do servidor o mapa de rotas já avaliado para o usuário
 * (hrefAccessMap) e estes componentes só ESCONDEM o que ele não pode abrir. Nunca use para liberar uma operação:
 * páginas, server actions e APIs revalidam a permissão no servidor em toda chamada.
 */
import * as React from "react";
import Link from "next/link";
import { canSeeHrefIn, type HrefAccessMap } from "@/domain/permissions/href";

const AccessContext = React.createContext<HrefAccessMap | null>(null);

export function AccessProvider({ access, children }: { access: HrefAccessMap; children: React.ReactNode }) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/**
 * O usuário vê este href interno? Mesmo resultado de canSeeHref no servidor. Fora do shell (sem AccessProvider)
 * devolve false: na dúvida, o link não aparece.
 */
export function useCanSee(href: string): boolean {
  const access = React.useContext(AccessContext);
  return access ? canSeeHrefIn(access, href) : false;
}

/** Função de visibilidade para listas (evita um hook por item). */
export function useCanSeeFn(): (href: string) => boolean {
  const access = React.useContext(AccessContext);
  return React.useCallback((href: string) => (access ? canSeeHrefIn(access, href) : false), [access]);
}

export type ScreenLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Renderizado no lugar do link quando o usuário não vê a tela (padrão: nada). */
  fallback?: React.ReactNode;
};

/** Link para uma tela do catálogo: não renderiza (ou mostra `fallback`) quando o usuário não vê a tela. */
export function ScreenLink({ href, fallback = null, ...props }: ScreenLinkProps) {
  const visible = useCanSee(href);
  if (!visible) return <>{fallback}</>;
  return <Link href={href} {...props} />;
}

/** Renderiza os filhos só quando o usuário vê o href (cards e itens de lista inteiros). */
export function CanSee({ href, children, fallback = null }: { href: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  return <>{useCanSee(href) ? children : fallback}</>;
}
