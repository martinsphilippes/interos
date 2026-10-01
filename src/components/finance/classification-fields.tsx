"use client";

import Link from "next/link";
import { Tags } from "lucide-react";
import { categoriesForCenter, subcategoriesOf, type ClassificationOptions } from "@/domain/title-classification";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";

export interface ClassificationValue {
  costCenterId: string;
  categoryId: string;
  subcategoryId: string;
}

export const EMPTY_CLASSIFICATION: ClassificationValue = { costCenterId: "", categoryId: "", subcategoryId: "" };

/**
 * Centro de custo → Categoria → Subcategoria (etapa CP/CR 4), dos cadastros financeiros. Escolher o centro limita as
 * categorias às daquele centro; escolher a categoria preenche o centro (editável); a subcategoria lista só as filhas
 * ativas. A lista de categorias já vem do tipo certo (a pagar = despesa; a receber = receita).
 */
export function ClassificationFields({ id, options, value, onChange, categoryDisabled, categoryHint }: { id: string; options: ClassificationOptions; value: ClassificationValue; onChange: (next: ClassificationValue) => void; categoryDisabled?: boolean; categoryHint?: string }) {
  const categories = categoriesForCenter(options, value.costCenterId, value.categoryId);
  const subcategories = subcategoriesOf(options, value.categoryId);
  const kind = options.type === "despesa" ? "despesa" : "receita";
  return (
    <>
      <FormField label="Centro de custo" htmlFor={`${id}-cc`} hint={value.categoryId ? "Preenchido pela categoria (pode trocar)" : "Escolha para filtrar as categorias"}>
        <Select
          id={`${id}-cc`}
          value={value.costCenterId}
          onChange={(e) => onChange({ ...value, costCenterId: e.target.value })}
          placeholder={value.categoryId ? "O da categoria" : "Sem centro de custo"}
          options={options.centers}
          data-testid="classification-center"
        />
      </FormField>
      <FormField label={`Categoria (${kind})`} htmlFor={`${id}-cat`} hint={categoryHint ?? (value.costCenterId && categories.length === 0 ? "Nenhuma categoria neste centro" : `Só categorias de ${kind}`)}>
        <Select
          id={`${id}-cat`}
          value={value.categoryId}
          disabled={categoryDisabled}
          onChange={(e) => {
            const categoryId = e.target.value;
            const center = options.categories.find((c) => c.value === categoryId)?.costCenterId;
            // Escolher a categoria preenche o centro (editável) e limpa a subcategoria de outra mãe.
            onChange({ categoryId, subcategoryId: "", costCenterId: categoryId ? (center ?? value.costCenterId) : value.costCenterId });
          }}
          placeholder="Sem categoria"
          options={categories.map((c) => ({ value: c.value, label: c.label }))}
          data-testid="classification-category"
        />
      </FormField>
      <FormField label="Subcategoria" htmlFor={`${id}-sub`} hint={!value.categoryId ? "Escolha a categoria antes" : subcategories.length === 0 ? "Esta categoria não tem subcategorias" : "Opcional: só as da categoria escolhida"}>
        <Select
          id={`${id}-sub`}
          value={value.subcategoryId}
          disabled={categoryDisabled || subcategories.length === 0}
          onChange={(e) => onChange({ ...value, subcategoryId: e.target.value })}
          placeholder="Sem subcategoria"
          options={subcategories.map((c) => ({ value: c.value, label: c.label }))}
          data-testid="classification-subcategory"
        />
      </FormField>
    </>
  );
}

/** Aviso do formulário sem cadastros ativos do tipo (volta ao comportamento anterior). */
export function NoClassificationNotice({ kind, className }: { kind: "despesa" | "receita"; className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-fg ${className ?? ""}`} data-testid="classification-missing">
      <Tags className="mt-0.5 size-4 shrink-0" />
      <span>
        Nenhuma categoria de {kind} ativa nos cadastros financeiros: o título usa a classificação anterior. Cadastre centros e categorias em{" "}
        <Link href="/financeiro/cadastros?aba=categorias" className="font-medium text-brand-fg hover:underline">
          Financeiro › Cadastros financeiros
        </Link>
        .
      </span>
    </p>
  );
}
