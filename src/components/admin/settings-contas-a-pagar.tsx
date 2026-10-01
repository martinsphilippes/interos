"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import type { ContasAPagarConfig } from "@/server/admin/schemas";
import { PAYABLE_CATEGORIES, payableCategoryLabel } from "@/domain/commissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

const FIXED = new Set<string>(PAYABLE_CATEGORIES);

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Categorias e centros de custo dos títulos a pagar (D28). Categorias fixas do circuito não podem ser removidas. */
export function SettingsContasAPagar({ value, stored }: { value: ContasAPagarConfig; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("contas_a_pagar");
  const [categories, setCategories] = React.useState<string[]>(() => Array.from(new Set(value.categorias)));
  const [centers, setCenters] = React.useState<string[]>(() => Array.from(new Set(value.centrosDeCusto)));
  const [categoryDraft, setCategoryDraft] = React.useState("");
  const [centerDraft, setCenterDraft] = React.useState("");

  const addCategory = () => {
    const key = slug(categoryDraft);
    if (key.length < 2) {
      setError("Informe o nome da categoria (mín. 2 letras)");
      return;
    }
    if (categories.includes(key)) {
      setError(`A categoria "${payableCategoryLabel(key)}" já existe`);
      return;
    }
    setError(null);
    setCategories((c) => [...c, key]);
    setCategoryDraft("");
  };
  const addCenter = () => {
    const name = centerDraft.trim();
    if (name.length < 2) {
      setError("Informe o nome do centro de custo (mín. 2 letras)");
      return;
    }
    if (centers.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setError(`O centro de custo "${name}" já existe`);
      return;
    }
    setError(null);
    setCenters((c) => [...c, name]);
    setCenterDraft("");
  };

  return (
    <SettingsSection
      title="Contas a pagar"
      description="Categorias e centros de custo aceitos nos títulos manuais. Comissão comercial, bônus, outros e estorno são do circuito e continuam válidos mesmo fora da lista. Categoria nova vira chave em minúsculas (ex.: 'Serviços' → servicos)."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        save({ categorias: categories, centrosDeCusto: centers } satisfies ContasAPagarConfig, "Contas a pagar: categorias e centros de custo salvos");
      }}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3" data-testid="cap-categorias">
          <FormField label="Adicionar categoria" htmlFor="cap-cat">
            <div className="flex items-center gap-2">
              <Input
                id="cap-cat"
                value={categoryDraft}
                onChange={(e) => setCategoryDraft(e.target.value)}
                placeholder="Ex.: Marketing"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCategory();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addCategory} className="h-10 md:h-9">
                <Plus /> Adicionar
              </Button>
            </div>
          </FormField>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c}>
                <Badge variant={FIXED.has(c) ? "muted" : "info"} size="md" className="gap-1 pr-1">
                  {payableCategoryLabel(c)} <span className="font-mono text-[10px] text-muted">{c}</span>
                  {!FIXED.has(c) ? (
                    <button type="button" aria-label={`Remover categoria ${payableCategoryLabel(c)}`} className="ml-1 rounded p-0.5 hover:bg-surface-hover" onClick={() => setCategories((list) => list.filter((x) => x !== c))}>
                      <X className="size-3" />
                    </button>
                  ) : null}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3" data-testid="cap-centros">
          <FormField label="Adicionar centro de custo" htmlFor="cap-cc">
            <div className="flex items-center gap-2">
              <Input
                id="cap-cc"
                value={centerDraft}
                onChange={(e) => setCenterDraft(e.target.value)}
                placeholder="Ex.: Comercial"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCenter();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addCenter} className="h-10 md:h-9">
                <Plus /> Adicionar
              </Button>
            </div>
          </FormField>
          {centers.length === 0 ? <p className="text-sm text-muted">Nenhum centro de custo: o campo fica opcional nos títulos.</p> : null}
          <ul className="flex flex-wrap gap-2">
            {centers.map((c) => (
              <li key={c}>
                <Badge variant="secondary" size="md" className="gap-1 pr-1">
                  {c}
                  <button type="button" aria-label={`Remover centro de custo ${c}`} className="ml-1 rounded p-0.5 hover:bg-surface-hover" onClick={() => setCenters((list) => list.filter((x) => x !== c))}>
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
}
