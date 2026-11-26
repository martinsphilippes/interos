import { Info } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { ProductManagementView } from "@/server/products/queries";

/** Diz qual catálogo do ERP a Gestão de Produtos está usando (importado ou o de referência embutido). */
export function CatalogSourceNotice({ catalog }: { catalog: ProductManagementView["catalog"] }) {
  if (catalog.source === "erp") {
    return (
      <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Catálogo do ERP {catalog.version}
          {catalog.importedAt ? `, importado em ${formatDateTime(catalog.importedAt)}` : ""}. {catalog.units} unidades comerciais, {catalog.sellable} já vendidas pelo ERP.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info-fg">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Catálogo de referência {catalog.version} (proposta do ERP, ainda não validada): a integração com o ERP ainda não está ligada. Os códigos são os do ERP, então fichas, preços e pacotes continuam valendo
        quando o catálogo oficial for importado; as diferenças aparecem aqui.
      </span>
    </p>
  );
}
