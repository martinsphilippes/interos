"use client";

import { updateGoLiveSettings } from "@/server/implementation/actions";
import { Switch } from "@/components/ui/switch";
import { useImplementationAction } from "./use-implementation-action";

/** Regra de aprovação do go-live (setting "go_live"): só gestores podem alterar. */
export function GoLiveSettingsSwitch({ value, canEdit }: { value: boolean; canEdit: boolean }) {
  const { pending, run } = useImplementationAction();
  return (
    <Switch
      label="Exigir aprovação de gestor"
      description={value ? "Só gestores/administradores aprovam o go-live." : "O responsável pelo projeto também pode aprovar."}
      checked={value}
      disabled={!canEdit || pending}
      onCheckedChange={(checked) => run(() => updateGoLiveSettings({ exigeAprovacaoGestor: checked }), checked ? "Go-live exige aprovação de gestor" : "Responsável do projeto pode aprovar o go-live")}
      className="rounded-lg border border-border bg-surface px-3 py-2 md:max-w-sm"
    />
  );
}
