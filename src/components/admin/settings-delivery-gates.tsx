"use client";

import * as React from "react";
import type { CsAtivacaoConfig, GoLiveConfig } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

/** Gates de entrega: aprovação do go-live (Implantação) e ativação do cliente (Customer Success). */
export function SettingsDeliveryGates({ goLive, activation, storedGoLive, storedActivation }: { goLive: GoLiveConfig; activation: CsAtivacaoConfig; storedGoLive: boolean; storedActivation: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <GoLiveForm value={goLive} stored={storedGoLive} />
      <ActivationForm value={activation} stored={storedActivation} />
    </div>
  );
}

function GoLiveForm({ value, stored }: { value: GoLiveConfig; stored: boolean }) {
  const { pending, error, save } = useSaveSetting("go_live");
  const [form, setForm] = React.useState<GoLiveConfig>(value);
  return (
    <SettingsSection
      title="Go-live da implantação"
      description="O go-live só é aprovado com o gate completo (checklist obrigatório, tarefas obrigatórias, treinamento realizado, validação e aceite do cliente). Aqui se define quem pode aprovar."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        save(form, "Regra de aprovação do go-live salva");
      }}
    >
      <Switch
        label="Exigir aprovação de gestor"
        description="Ligado: só gestores de implantação e administradores aprovam. Desligado: o responsável do projeto também aprova."
        checked={form.exigeAprovacaoGestor}
        onCheckedChange={(v) => setForm({ exigeAprovacaoGestor: v })}
        className="w-full rounded-lg border border-border px-3 py-2 sm:max-w-xl"
      />
    </SettingsSection>
  );
}

function ActivationForm({ value, stored }: { value: CsAtivacaoConfig; stored: boolean }) {
  const { pending, error, save } = useSaveSetting("cs_ativacao");
  const [adoption, setAdoption] = React.useState(String(value.adocaoMinimaPct));
  const [exigePlano, setExigePlano] = React.useState(value.exigePlano);
  return (
    <SettingsSection
      title="Ativação do cliente (Customer Success)"
      description="Critérios do gate “Cliente ativado”: adoção mínima registrada no checkpoint, responsável de CS definido e, opcionalmente, plano de sucesso ativo. Ao ativar, a jornada avança para Suporte."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        save({ adocaoMinimaPct: Number(adoption), exigePlano }, "Critérios de ativação salvos");
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Adoção mínima (%)" htmlFor="csa-adocao" required hint="Percentual dos módulos contratados em uso.">
          <Input id="csa-adocao" type="number" min={0} max={100} step={1} inputMode="numeric" value={adoption} onChange={(e) => setAdoption(e.target.value)} required />
        </FormField>
        <Switch label="Exigir plano de sucesso ativo" description="O cliente só é ativado com um plano de sucesso em andamento." checked={exigePlano} onCheckedChange={setExigePlano} className="w-full rounded-lg border border-border px-3 py-2" />
      </div>
    </SettingsSection>
  );
}
