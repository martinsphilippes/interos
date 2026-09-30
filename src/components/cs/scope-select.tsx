"use client";

import { Select } from "@/components/ui/select";
import { useCsUrl } from "./use-cs";

/**
 * Escopo da carteira: um responsável de CS ou a equipe inteira (?responsavel=todos|<id>). Com o escopo do usuário
 * restrito (`restricted`), "todos" significa toda a carteira que ele pode ver e só os responsáveis dela aparecem.
 */
export function ScopeSelect({ owners, value, className, restricted }: { owners: { id: string; name: string }[]; value: string; className?: string; restricted?: boolean }) {
  const { navigate } = useCsUrl();
  return (
    <Select
      aria-label="Carteira"
      size="sm"
      className={className ?? "w-full sm:w-56"}
      value={value}
      onChange={(e) => navigate({ responsavel: e.target.value })}
      options={[{ value: "todos", label: restricted ? "Toda a sua carteira" : "Toda a equipe" }, ...owners.map((o) => ({ value: o.id, label: `Carteira de ${o.name}` }))]}
    />
  );
}
