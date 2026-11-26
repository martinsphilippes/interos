import "server-only";

/**
 * Catálogo usado pela Gestão de Produtos: o catálogo do ERP importado no ambiente configurado (Administração ›
 * Integrações) ou, enquanto a integração não está ligada, o CATÁLOGO DE REFERÊNCIA embutido (`catalog-reference.json`,
 * cópia enxuta do catálogo v2 que o ERP publicou como proposta). A tela sempre diz qual dos dois está em uso; os
 * códigos são os mesmos, então a ficha comercial e os preços continuam valendo quando o catálogo do ERP chegar.
 */
import { compareCodes, indexCatalog, isUnitSellable, normalizeCatalog, type ErpCatalogIndex } from "@/domain/erp/catalog";
import type { QuoteUnit } from "@/domain/products/quote";
import { getCurrentCatalog } from "@/server/erp/catalog-store";
import reference from "./catalog-reference.json";

export interface CommercialCatalog {
  source: "erp" | "referencia";
  version: string;
  status: string | null;
  /** Quando o catálogo do ERP foi importado (null para o de referência). */
  importedAt: string | null;
  index: ErpCatalogIndex;
}

let referenceIndex: ErpCatalogIndex | null = null;

/** Índice do catálogo de referência (normalizado uma vez por processo). */
export function referenceCatalogIndex(): ErpCatalogIndex {
  if (!referenceIndex) referenceIndex = indexCatalog(normalizeCatalog(reference));
  return referenceIndex;
}

export async function getCommercialCatalog(): Promise<CommercialCatalog> {
  const current = await getCurrentCatalog().catch((error: unknown) => {
    console.error("[produtos] catálogo do ERP indisponível; usando o de referência", error);
    return null;
  });
  if (current) return { source: "erp", version: current.catalog.catalogVersion, status: current.catalog.status, importedAt: current.record.importedAt ?? null, index: current.index };
  const index = referenceCatalogIndex();
  return { source: "referencia", version: index.catalog.catalogVersion, status: index.catalog.status, importedAt: null, index };
}

/** Unidades comerciais do catálogo no formato da simulação (dependências já resolvidas para unidades). */
export function quoteUnitsOf(index: ErpCatalogIndex): Map<string, QuoteUnit> {
  const units = new Map<string, QuoteUnit>();
  for (const item of [...index.units].sort((a, b) => compareCodes(a.code, b.code))) {
    units.set(item.code, {
      code: item.code,
      name: item.name,
      module: item.module,
      moduleName: index.byCode.get(item.module)?.name ?? item.module,
      requires: [...index.requiredUnitsOf(item.code)].sort(compareCodes),
      sellable: isUnitSellable(item),
    });
  }
  return units;
}
