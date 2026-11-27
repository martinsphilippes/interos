"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Link2, Search } from "lucide-react";
import type { ErpCompanyView } from "@/server/erp/company-view";
import { findErpCompanyAction, linkErpCompanyAction } from "@/server/erp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ErpProvisionDialog, type ProvisionDefaults } from "./erp-provision-dialog";

type Found = { companyId: string; name: string; cnpj: string | null; kind: string; status: string; isDemo: boolean };

const KIND_LABELS: Record<string, string> = { retail: "varejo", varejo: "varejo", accounting: "escritório contábil", escritorio_contabil: "escritório contábil", certification: "certificação digital" };
const STATUS_LABELS: Record<string, string> = { active: "ativa", ativa: "ativa", inactive: "inativa", inativa: "inativa", suspended: "suspensa", suspensa: "suspensa" };
const fmtCnpj = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (v ?? "sem CNPJ");
};

/** Cliente sem empresa do ERP: criar pelo INTEROS ou vincular uma que já existe. */
export function ErpLinkPanel({ clientId, view, canProvision, defaults }: { clientId: string; view: ErpCompanyView; canProvision: boolean; defaults: ProvisionDefaults }) {
  const router = useRouter();
  const [provisionOpen, setProvisionOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [found, setFound] = React.useState<Found[] | null>(null);
  const [linking, setLinking] = React.useState<string | null>(null);
  const [codeOpen, setCodeOpen] = React.useState(false);
  const blockedByProvisioning = view.provisioning && (view.provisioning.status === "enviando" || view.provisioning.status === "falhou");

  async function search() {
    setSearching(true);
    const res = await findErpCompanyAction({ clientId }).catch(() => ({ ok: false as const, error: "A conexão caiu. Tente de novo." }));
    setSearching(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setFound(res.data);
  }

  async function linkFound(companyId: string) {
    setLinking(companyId);
    const res = await linkErpCompanyAction({ method: "identificacao", clientId, erpCompanyId: companyId }).catch(() => ({ ok: false as const, error: "A conexão caiu. Recarregue a aba." }));
    setLinking(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Empresa vinculada a este cliente.");
    router.refresh();
  }

  if (!canProvision) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        Este cliente ainda não está ligado a uma empresa do ERP Intercert. Quem tem a permissão de criar ou vincular empresas no ERP faz isso aqui.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Este cliente ainda não está ligado a uma empresa do ERP Intercert{view.environmentLabel ? ` (${view.environmentLabel.toLowerCase()})` : ""}. Escolha como ligar:</p>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4 text-muted" aria-hidden /> Criar a empresa no ERP
          </h3>
          <p className="text-sm text-muted">Cria a empresa, a unidade inicial, os módulos escolhidos, o administrador e o convite. A licença passa a ser comandada pelo INTEROS.</p>
          <Button className="mt-auto self-start" onClick={() => setProvisionOpen(true)} disabled={Boolean(blockedByProvisioning) || view.state === "sem_catalogo"}>
            Criar empresa no ERP
          </Button>
          {blockedByProvisioning ? <p className="text-xs text-warning-fg">Há uma criação em andamento para este cliente: retome-a acima em vez de começar outra.</p> : null}
        </section>
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-muted" aria-hidden /> Vincular empresa que já usa o ERP
          </h3>
          <p className="text-sm text-muted">Procura pelo CNPJ deste cliente entre as empresas que o ERP libera para o INTEROS. Uma empresa que ainda não foi liberada se vincula com o código gerado pelo administrador dela no ERP.</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={search} loading={searching}>
              <Search aria-hidden /> Procurar pelo CNPJ
            </Button>
            <Button variant="ghost" onClick={() => setCodeOpen(true)}>
              Tenho o código de vínculo
            </Button>
          </div>
          {found ? (
            found.length ? (
              <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border">
                {found.map((c) => (
                  <li key={c.companyId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block font-mono text-xs text-muted">
                        {c.companyId} · {fmtCnpj(c.cnpj)} · {KIND_LABELS[c.kind] ?? c.kind} · {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </span>
                    {c.isDemo ? (
                      <Badge variant="muted" size="sm">
                        demonstração
                      </Badge>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => linkFound(c.companyId)} loading={linking === c.companyId} disabled={Boolean(linking)}>
                      Vincular
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Nenhuma empresa liberada para o INTEROS com o CNPJ deste cliente. Se ela já usa o ERP, peça ao administrador dela o código de vínculo e use “Tenho o código de vínculo”.</p>
            )
          ) : null}
        </section>
      </div>
      <ErpProvisionDialog open={provisionOpen} onOpenChange={setProvisionOpen} clientId={clientId} view={view} defaults={defaults} />
      {codeOpen ? <LinkCodeDialog clientId={clientId} cnpj={defaults.cnpj} onClose={() => setCodeOpen(false)} /> : null}
    </div>
  );
}

function LinkCodeDialog({ clientId, cnpj: initialCnpj, onClose }: { clientId: string; cnpj: string; onClose: () => void }) {
  const router = useRouter();
  const [erpCompanyId, setErpCompanyId] = React.useState("");
  const [cnpj, setCnpj] = React.useState(initialCnpj);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ok = erpCompanyId.trim().length >= 8 && cnpj.replace(/\D/g, "").length === 14 && code.trim().length >= 6;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await linkErpCompanyAction({ method: "codigo", clientId, erpCompanyId: erpCompanyId.trim(), cnpj, code: code.trim() }).catch(() => ({ ok: false as const, error: "A conexão caiu. Tente de novo." }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("Empresa vinculada a este cliente.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Vincular com o código</DialogTitle>
          <DialogDescription>
            No ERP, o administrador abre Administração › Empresas › (a empresa) › cartão “Vínculo com o Interos”: lá estão o ID ERP e o botão “Gerar código de vínculo” (XXXXX-XXXXX, vale uma vez, por 72 horas).
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {error ? <p className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
          <FormField label="ID da empresa no ERP" htmlFor="erp-l-id" required>
            <Input id="erp-l-id" value={erpCompanyId} onChange={(e) => setErpCompanyId(e.target.value)} maxLength={64} className="font-mono" />
          </FormField>
          <FormField label="CNPJ" htmlFor="erp-l-cnpj" required>
            <Input id="erp-l-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} maxLength={18} inputMode="numeric" />
          </FormField>
          <FormField label="Código de vínculo" htmlFor="erp-l-code" required>
            <Input id="erp-l-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} autoComplete="off" placeholder="XXXXX-XXXXX" className="font-mono" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ok}>
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
