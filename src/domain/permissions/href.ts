/**
 * Casamento de href interno com os padrões de rota do catálogo (A11), puro e sem o catálogo: usado pelo servidor
 * (canSeeHref em src/server/auth/permissions.ts) e pelo cliente (useCanSee/ScreenLink, que recebem do servidor só o
 * mapa já avaliado — HrefAccessMap). Assim as duas pontas decidem "visível" com o mesmo algoritmo.
 *
 * Regras: a query e o hash não entram no casamento; o padrão mais específico vence (segmento fixo vale mais que
 * dinâmico); catch-all ("[...x]") não é tela; percent-encoding malformado = não visível; `?aba=<x>` exige também
 * uma das seções daquela aba quando a tela tem seções por aba.
 */

export interface RoutePattern {
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly score: number;
}

/** Compila um padrão de rota ("/clientes/[id]"); catch-all devolve null (não é tela). */
export function compileRoute(pattern: string): RoutePattern | null {
  if (pattern.includes("[...")) return null;
  const segments = pattern.split("/").filter(Boolean);
  const score = segments.reduce((s, seg) => s + (seg.startsWith("[") ? 1 : 3), 0);
  return { pattern, segments, score };
}

/** Ordena do mais específico ao mais genérico (a primeira rota que casa decide). */
export function sortRoutes<T extends RoutePattern>(routes: T[]): T[] {
  return routes.sort((a, b) => b.score - a.score || b.segments.length - a.segments.length);
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Segmentos do caminho de um href interno (sem query/hash), ou null quando não é interno ou está malformado. */
export function hrefPathParts(href: string): string[] | null {
  const path = href.split(/[?#]/)[0] || "/";
  if (!path.startsWith("/")) return null;
  const parts: string[] = [];
  for (const raw of path.split("/").filter(Boolean)) {
    // Percent-encoding malformado ("/vendas/%") não é tela: não visível, sem derrubar a renderização.
    const decoded = safeDecode(raw);
    if (decoded === null) return null;
    parts.push(decoded);
  }
  return parts;
}

function matches(route: RoutePattern, parts: readonly string[]): boolean {
  if (route.segments.length !== parts.length) return false;
  return route.segments.every((seg, i) => seg.startsWith("[") || seg === parts[i]);
}

/** Primeira rota (lista já ordenada por sortRoutes) que casa com o href. */
export function findRoute<T extends RoutePattern>(routes: readonly T[], href: string): T | null {
  const parts = hrefPathParts(href);
  if (!parts) return null;
  return routes.find((r) => matches(r, parts)) ?? null;
}

/** Valor de `?aba=` do href (ou undefined). */
export function hrefTab(href: string): string | undefined {
  const query = href.split("#")[0].split("?")[1];
  if (!query) return undefined;
  return new URLSearchParams(query).get("aba") || undefined;
}

// ---------------------------------------------------------------------------
// Mapa serializável (servidor → cliente), só para OCULTAR links
// ---------------------------------------------------------------------------

/** Uma rota do catálogo já avaliada para o usuário: visível? e, por aba com seções, visível? */
export interface HrefAccessEntry {
  /** Padrão de rota. */
  readonly p: string;
  /** Tela (ou seção com página) visível. */
  readonly v: boolean;
  /** Abas (`?aba=`) com seções no catálogo → visível. Aba ausente vale como a própria tela. */
  readonly t?: Readonly<Record<string, boolean>>;
}

/**
 * Visibilidade das rotas para um usuário, calculada no servidor (hrefAccessMap) e entregue ao shell. Não autoriza
 * nada: páginas, actions e APIs revalidam sempre no servidor.
 */
export interface HrefAccessMap {
  /** Rotas na ordem de especificidade (a primeira que casa decide). */
  readonly routes: readonly HrefAccessEntry[];
}

const compiled = new WeakMap<HrefAccessMap, (RoutePattern & { entry: HrefAccessEntry })[]>();

function compiledRoutes(map: HrefAccessMap): (RoutePattern & { entry: HrefAccessEntry })[] {
  let list = compiled.get(map);
  if (!list) {
    list = [];
    for (const entry of map.routes) {
      const route = compileRoute(entry.p);
      if (route) list.push({ ...route, entry });
    }
    compiled.set(map, list);
  }
  return list;
}

/** O href é visível segundo o mapa? Mesmo resultado de canSeeHref no servidor para o mesmo usuário. */
export function canSeeHrefIn(map: HrefAccessMap, href: string): boolean {
  const found = findRoute(compiledRoutes(map), href);
  if (!found || !found.entry.v) return false;
  const tab = hrefTab(href);
  if (!tab || !found.entry.t || !Object.hasOwn(found.entry.t, tab)) return true;
  return found.entry.t[tab] === true;
}
