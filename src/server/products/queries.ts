import "server-only";

/** Leituras da Gestão de Produtos (abas Módulos, Pacotes e Simulador de /admin/produtos). */
import { compareCodes } from "@/domain/erp/catalog";
import { ERP_PACKAGES, packageUnits } from "@/domain/erp/packages";
import type { CommercialModule, ProductPackage } from "@/domain/products/commercial";
import type { QuoteUnit } from "@/domain/products/quote";
import { getCommercialCatalog, quoteUnitsOf } from "./catalog";
import { listCommercialModules, listProductPackages, todayKey } from "./service";

export interface CatalogUnitView extends QuoteUnit {
  devStatus: string;
  description: string | null;
}

export interface StarterPackageView {
  key: string;
  name: string;
  description: string;
  kind: string;
  units: string[];
  /** Códigos do pacote de partida que não existem ou não são vendáveis no catálogo em uso. */
  skipped: string[];
}

export interface ProductManagementView {
  today: string;
  catalog: { source: "erp" | "referencia"; version: string; status: string | null; importedAt: string | null; units: number; sellable: number };
  /** Módulos do ERP (NN) que têm unidades comerciais, em ordem. */
  erpModules: { code: string; name: string }[];
  units: CatalogUnitView[];
  records: CommercialModule[];
  /** Fichas cujo código não existe mais no catálogo em uso (para revisar). */
  orphanCodes: string[];
  packages: ProductPackage[];
  starters: StarterPackageView[];
}

export async function loadProductManagement(): Promise<ProductManagementView> {
  const [catalog, records, packages] = await Promise.all([getCommercialCatalog(), listCommercialModules(), listProductPackages()]);
  const { index } = catalog;
  const quoteUnits = quoteUnitsOf(index);
  const units: CatalogUnitView[] = [...quoteUnits.values()].map((u) => {
    const item = index.byCode.get(u.code);
    return { ...u, devStatus: item?.devStatus ?? "NAO", description: item?.description ?? null };
  });
  const moduleCodes = [...new Set(units.map((u) => u.module))].sort(compareCodes);
  return {
    today: todayKey(),
    catalog: { source: catalog.source, version: catalog.version, status: catalog.status, importedAt: catalog.importedAt, units: units.length, sellable: units.filter((u) => u.sellable).length },
    erpModules: moduleCodes.map((code) => ({ code, name: index.byCode.get(code)?.name ?? code })),
    units,
    records,
    orphanCodes: records.filter((r) => !quoteUnits.has(r.code)).map((r) => r.code),
    packages,
    starters: ERP_PACKAGES.map((p) => {
      const { units: kept, skipped } = packageUnits(index, p);
      return { key: p.key, name: p.name, description: p.description, kind: p.kind, units: kept, skipped };
    }),
  };
}
