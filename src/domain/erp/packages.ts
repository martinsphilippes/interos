/**
 * Pacotes iniciais do ERP Intercert por segmento: PONTO DE PARTIDA da seleção de módulos (no provisionamento e na
 * ficha), nunca uma versão diferente do ERP. A seleção final de cada empresa é personalizada e o que muda em relação
 * ao pacote aparece na revisão. Módulo puro.
 *
 * Modelos iniciais, a refinar com o uso real dos clientes (fase de pacotes comerciais, com preço e versão): só
 * unidades vendáveis hoje. Ficam de fora por decisão do ERP: emissão de NF-e/NFC-e/NFS-e e Banco Intercert (aguardam
 * homologação da integração externa) e Canais (em desenvolvimento). Food Service (módulo 14) ainda não existe no ERP.
 */
import { compareCodes, isUnitSellable, type ErpCatalogIndex } from "./catalog";

export interface ErpPackage {
  key: string;
  name: string;
  description: string;
  /** Tipo de empresa no ERP a que o pacote se aplica. */
  kind: "varejo" | "escritorio_contabil" | "parceiro_rede";
  units: readonly string[];
}

const ESSENCIAL = ["01.02", "01.03", "01.04", "06.01", "07.01", "07.02", "08.04", "10.01", "18.01", "18.02", "18.03", "21.02"];

export const ERP_PACKAGES: readonly ErpPackage[] = [
  {
    key: "varejo_essencial",
    name: "Varejo essencial",
    description: "Cadastros, PDV e caixa, trocas, estoque, contas a pagar e a receber, fluxo de caixa e relatórios gerenciais.",
    kind: "varejo",
    units: ESSENCIAL,
  },
  {
    key: "moda_calcados",
    name: "Loja de roupas e calçados",
    description: "Varejo essencial + etiquetas, alteração em massa, transferências, inventário, promoções, fidelidade, crediário, carnê e cobrança.",
    kind: "varejo",
    units: [...ESSENCIAL, "09.13", "09.22", "10.05", "10.09", "25.01", "20.03", "07.27", "18.42", "18.13", "18.41", "05.04", "05.06"],
  },
  {
    key: "supermercado",
    name: "Supermercado, mercadinho e mercearia",
    description: "Varejo essencial + balança, etiquetas, inventário, lotes, promoções, compras com reposição, conciliação, cartões e taxas.",
    kind: "varejo",
    units: [...ESSENCIAL, "46.01", "09.13", "10.09", "10.10", "25.01", "05.04", "05.06", "05.08", "18.10", "18.11", "18.44"],
  },
  {
    key: "deposito_bebidas",
    name: "Depósito de bebidas e distribuidora",
    description: "Varejo essencial + pré-venda, loja virtual, compras, transferências, inadimplência e baixa em lote.",
    kind: "varejo",
    units: [...ESSENCIAL, "06.09", "12.01", "12.09", "05.04", "05.06", "10.05", "18.13", "18.43"],
  },
  {
    key: "ecommerce",
    name: "E-commerce",
    description: "Cadastros, documentos comerciais, estoque, loja virtual com promoções e financeiro básico.",
    kind: "varejo",
    units: ["01.02", "01.03", "01.04", "06.01", "10.01", "12.01", "12.09", "25.01", "18.01", "18.02", "18.03"],
  },
  {
    key: "escritorio_contabil",
    name: "Escritório contábil",
    description: "Carteira de clientes do escritório, caixa de entregas, certificados e financeiro do escritório.",
    kind: "escritorio_contabil",
    units: ["51.01", "51.04", "48.06", "18.01", "18.02"],
  },
];

export function findPackage(key: string | null | undefined): ErpPackage | null {
  return ERP_PACKAGES.find((p) => p.key === key) ?? null;
}

/** Unidades do pacote que existem e são vendáveis no catálogo vigente (o resto é ignorado, com aviso na tela). */
export function packageUnits(index: ErpCatalogIndex, pkg: ErpPackage): { units: string[]; skipped: string[] } {
  const units: string[] = [];
  const skipped: string[] = [];
  for (const code of new Set(pkg.units)) {
    const item = index.byCode.get(code);
    if (item && isUnitSellable(item)) units.push(code);
    else skipped.push(code);
  }
  return { units: units.sort(compareCodes), skipped: skipped.sort(compareCodes) };
}

/** Personalizações da seleção em relação ao pacote de partida. */
export function packageCustomizations(pkgUnits: readonly string[], selection: readonly string[]): { added: string[]; removed: string[] } {
  const base = new Set(pkgUnits);
  const sel = new Set(selection);
  return { added: [...sel].filter((c) => !base.has(c)).sort(compareCodes), removed: [...base].filter((c) => !sel.has(c)).sort(compareCodes) };
}
