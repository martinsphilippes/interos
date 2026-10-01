"use client";

import * as React from "react";
import { Download } from "lucide-react";
import type { LegacyImportPlan } from "@/domain/finance-registry";
import { importFinanceRegistryAction } from "@/server/finance-registry/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useFinanceAction } from "@/components/finance/use-finance-action";

/**
 * "Importar da configuração atual" (manual, idempotente): cria centros e categorias de despesa a partir de
 * Configurações › Contas a pagar, guardando a chave antiga. Não altera títulos nem a configuração.
 */
export function ImportButton({ plan, variant = "outline" }: { plan: LegacyImportPlan; variant?: "outline" | "primary" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} className="h-11 md:h-9" onClick={() => setOpen(true)}>
        <Download /> Importar da configuração
      </Button>
      {open ? <ImportDialog plan={plan} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ImportDialog({ plan, onClose }: { plan: LegacyImportPlan; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [defaultCenter, setDefaultCenter] = React.useState("");
  const nothing = plan.centers.length === 0 && plan.categories.length === 0;
  const missingDefault = plan.needsDefaultCenter && !defaultCenter;
  const submit = () =>
    void run(
      () => importFinanceRegistryAction({ defaultCenterName: defaultCenter || undefined }),
      (d) => (d.centers || d.categories ? `Importado: ${d.centers} centro(s) e ${d.categories} categoria(s)` : "Nada novo a importar: tudo já estava cadastrado"),
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Importar da configuração atual</DialogTitle>
          <DialogDescription>Cria centros de custo e categorias de despesa a partir de Configurações › Contas a pagar. Só cria o que falta; títulos antigos e a configuração ficam como estão.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 text-sm" data-testid="import-plan">
          {nothing ? (
            <p className="text-muted">Tudo da configuração já está cadastrado. Importar de novo não cria nada.</p>
          ) : (
            <>
              <div>
                <p className="font-medium">Centros de custo a criar ({plan.centers.length})</p>
                <p className="text-muted">{plan.centers.length ? plan.centers.map((c) => c.name).join(", ") : "Nenhum"}</p>
              </div>
              <div>
                <p className="font-medium">Categorias de despesa a criar ({plan.categories.length})</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                  {plan.categories.map((c) => (
                    <li key={c.legacyKey} className="break-words">
                      {c.name} → {c.centerSource === "historico" ? `${c.centerName} (mais usado nos títulos)` : defaultCenter ? `${defaultCenter} (padrão)` : "centro padrão"}
                    </li>
                  ))}
                </ul>
              </div>
              {plan.needsDefaultCenter ? (
                <FormField label="Centro padrão para as categorias sem histórico" htmlFor={`${id}-c`} required hint="Toda categoria precisa de um centro; depois dá para trocar em massa">
                  <Select id={`${id}-c`} value={defaultCenter} onChange={(e) => setDefaultCenter(e.target.value)} placeholder="Escolha o centro" options={plan.centerOptions.map((n) => ({ value: n, label: n }))} />
                </FormField>
              ) : null}
            </>
          )}
          {plan.skippedCenters.length || plan.skippedCategories.length ? <p className="text-xs text-muted">Já cadastrados (ficam como estão): {[...plan.skippedCenters, ...plan.skippedCategories].join(", ")}.</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {nothing ? "Fechar" : "Cancelar"}
          </Button>
          {!nothing ? (
            <Button onClick={submit} loading={pending} disabled={missingDefault}>
              Importar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
