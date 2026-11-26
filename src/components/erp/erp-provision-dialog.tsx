"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy } from "lucide-react";
import { compareCodes } from "@/domain/erp/catalog";
import { packageCustomizations } from "@/domain/erp/packages";
import { isValidCnpj } from "@/domain/documents";
import type { ErpCompanyView, ErpItemRow } from "@/server/erp/company-view";
import { provisionErpCompanyAction, type ProvisionOutcome } from "@/server/erp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export interface ProvisionDefaults {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: { cep: string; logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; uf: string };
}

type Step = "empresa" | "modulos" | "admin" | "revisao";
const STEPS: { key: Step; label: string }[] = [
  { key: "empresa", label: "Empresa" },
  { key: "modulos", label: "Módulos" },
  { key: "admin", label: "Administrador" },
  { key: "revisao", label: "Revisão" },
];

const REGIMES = [
  { value: "", label: "Não informado" },
  { value: "simples", label: "Simples Nacional" },
  { value: "simples_excesso", label: "Simples (excesso de sublimite)" },
  { value: "presumido", label: "Lucro Presumido" },
  { value: "real", label: "Lucro Real" },
  { value: "mei", label: "MEI" },
];

/** Unidades exigidas (fecho transitivo) por quem foi escolhido. */
function withDependencies(selected: ReadonlySet<string>, byCode: ReadonlyMap<string, ErpItemRow>): { all: string[]; added: Map<string, string> } {
  const all = new Set(selected);
  const added = new Map<string, string>();
  const queue = [...selected];
  while (queue.length) {
    const code = queue.shift() as string;
    for (const req of byCode.get(code)?.requires ?? []) {
      if (!all.has(req) && byCode.get(req)?.role === "unit") {
        all.add(req);
        added.set(req, code);
        queue.push(req);
      }
    }
  }
  return { all: [...all].sort(compareCodes), added };
}

export function ErpProvisionDialog({ open, onOpenChange, clientId, view, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; clientId: string; view: ErpCompanyView; defaults: ProvisionDefaults }) {
  return open ? <ProvisionInner onOpenChange={onOpenChange} clientId={clientId} view={view} defaults={defaults} /> : null;
}

function ProvisionInner({ onOpenChange, clientId, view, defaults }: { onOpenChange: (open: boolean) => void; clientId: string; view: ErpCompanyView; defaults: ProvisionDefaults }) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("empresa");
  const [tipo, setTipo] = React.useState<"varejo" | "escritorio_contabil">("varejo");
  const [company, setCompany] = React.useState({ ...defaults, inscricaoEstadual: "", inscricaoMunicipal: "", regime: "" });
  const [addr, setAddr] = React.useState(defaults.endereco);
  const packages = view.packages.filter((p) => p.kind === tipo);
  const [packageKey, setPackageKey] = React.useState<string>(packages[0]?.key ?? "");
  const pkg = view.packages.find((p) => p.key === packageKey) ?? null;
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(packages[0]?.units ?? []));
  const [search, setSearch] = React.useState("");
  const [admin, setAdmin] = React.useState({ nome: "", email: "", telefone: "" });
  const [entrega, setEntrega] = React.useState<"interos" | "erp">("interos");
  const [reason, setReason] = React.useState("");
  const [contractRef, setContractRef] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<ProvisionOutcome | null>(null);

  const byCode = React.useMemo(() => new Map(view.items.map((i) => [i.code, i])), [view.items]);
  const sellable = React.useMemo(() => view.items.filter((i) => i.role === "unit" && i.sellable), [view.items]);
  const moduleName = React.useMemo(() => new Map(view.modules.map((m) => [m.code, m.name])), [view.modules]);
  const finalSet = React.useMemo(() => withDependencies(selected, byCode), [selected, byCode]);
  const custom = pkg ? packageCustomizations(pkg.units, [...selected]) : null;

  const cnpjOk = isValidCnpj(company.cnpj);
  const companyOk = company.razaoSocial.trim().length >= 2 && cnpjOk && (!company.email || /.+@.+\..+/.test(company.email)) && (!addr.uf || addr.uf.length === 2);
  const adminOk = admin.nome.trim().length >= 2 && /.+@.+\..+/.test(admin.email);
  const canNext: Record<Step, boolean> = { empresa: companyOk, modulos: selected.size > 0, admin: adminOk, revisao: reason.trim().length >= 3 && !sending };

  const choosePackage = (key: string) => {
    setPackageKey(key);
    const next = view.packages.find((p) => p.key === key);
    if (next) setSelected(new Set(next.units));
  };
  const toggle = (code: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });

  async function submit() {
    setSending(true);
    setError(null);
    const res = await provisionErpCompanyAction({
      clientId,
      company: {
        tipo,
        razaoSocial: company.razaoSocial,
        nomeFantasia: company.nomeFantasia || null,
        cnpj: company.cnpj,
        inscricaoEstadual: company.inscricaoEstadual || null,
        inscricaoMunicipal: company.inscricaoMunicipal || null,
        regimeTributario: company.regime || null,
        email: company.email || null,
        telefone: company.telefone || null,
        endereco: addr.logradouro || addr.cep ? { cep: addr.cep || null, logradouro: addr.logradouro || null, numero: addr.numero || null, complemento: addr.complemento || null, bairro: addr.bairro || null, municipio: addr.municipio || null, uf: addr.uf || null } : null,
      },
      units: finalSet.all,
      packageKey: packageKey || null,
      admin: { nome: admin.nome, email: admin.email, telefone: admin.telefone || null },
      entregaConvite: entrega,
      contractReference: contractRef || null,
      reason,
    }).catch(() => ({ ok: false as const, error: "A conexão caiu durante a criação. Recarregue a aba: se o ERP recebeu, a criação aparece em andamento e pode ser retomada sem duplicar." }));
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      router.refresh();
      return;
    }
    setOutcome(res.data);
    router.refresh();
  }

  const close = () => (sending ? undefined : onOpenChange(false));
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const query = search.trim().toLowerCase();
  const grouped = React.useMemo(() => {
    const map = new Map<string, ErpItemRow[]>();
    for (const u of sellable) {
      if (query && !`${u.code} ${u.name} ${moduleName.get(u.module) ?? ""}`.toLowerCase().includes(query)) continue;
      map.set(u.module, [...(map.get(u.module) ?? []), u]);
    }
    return [...map.entries()].sort((a, b) => compareCodes(a[0], b[0]));
  }, [sellable, query, moduleName]);

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{outcome ? "Empresa criada no ERP" : "Criar a empresa no ERP Intercert"}</DialogTitle>
          <DialogDescription>
            {outcome ? "Resultado devolvido pelo ERP." : "Cria a empresa, a unidade inicial, os módulos escolhidos, o administrador e o convite de acesso. Vale só para este cliente."}
          </DialogDescription>
        </DialogHeader>
        {!outcome ? (
          <ol className="flex gap-1 px-5 text-xs" aria-label="Etapas">
            {STEPS.map((s, i) => (
              <li key={s.key} className={`flex-1 rounded-md border px-2 py-1 text-center ${i === stepIndex ? "border-brand/40 bg-brand-soft text-brand-fg" : i < stepIndex ? "border-border text-foreground" : "border-border text-muted"}`} aria-current={i === stepIndex ? "step" : undefined}>
                {i + 1}. {s.label}
              </li>
            ))}
          </ol>
        ) : null}
        <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          {error ? <p className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}

          {outcome ? <ProvisionResult outcome={outcome} /> : null}

          {!outcome && step === "empresa" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Tipo de empresa" htmlFor="erp-p-tipo">
                <Select
                  id="erp-p-tipo"
                  value={tipo}
                  onChange={(e) => {
                    const next = e.target.value as "varejo" | "escritorio_contabil";
                    setTipo(next);
                    const first = view.packages.find((p) => p.kind === next);
                    setPackageKey(first?.key ?? "");
                    setSelected(new Set(first?.units ?? []));
                  }}
                  options={[
                    { value: "varejo", label: "Varejo" },
                    { value: "escritorio_contabil", label: "Escritório contábil" },
                  ]}
                />
              </FormField>
              <FormField label="CNPJ" htmlFor="erp-p-cnpj" required error={company.cnpj && !cnpjOk ? "CNPJ inválido (confira os dígitos)" : undefined}>
                <Input id="erp-p-cnpj" value={company.cnpj} onChange={(e) => setCompany({ ...company, cnpj: e.target.value })} inputMode="numeric" maxLength={18} />
              </FormField>
              <FormField label="Razão social" htmlFor="erp-p-razao" required className="sm:col-span-2">
                <Input id="erp-p-razao" value={company.razaoSocial} onChange={(e) => setCompany({ ...company, razaoSocial: e.target.value })} maxLength={200} />
              </FormField>
              <FormField label="Nome fantasia" htmlFor="erp-p-fantasia">
                <Input id="erp-p-fantasia" value={company.nomeFantasia} onChange={(e) => setCompany({ ...company, nomeFantasia: e.target.value })} maxLength={200} />
              </FormField>
              <FormField label="Regime tributário" htmlFor="erp-p-regime">
                <Select id="erp-p-regime" value={company.regime} onChange={(e) => setCompany({ ...company, regime: e.target.value })} options={REGIMES} />
              </FormField>
              <FormField label="Inscrição estadual" htmlFor="erp-p-ie">
                <Input id="erp-p-ie" value={company.inscricaoEstadual} onChange={(e) => setCompany({ ...company, inscricaoEstadual: e.target.value })} maxLength={30} />
              </FormField>
              <FormField label="Inscrição municipal" htmlFor="erp-p-im">
                <Input id="erp-p-im" value={company.inscricaoMunicipal} onChange={(e) => setCompany({ ...company, inscricaoMunicipal: e.target.value })} maxLength={30} />
              </FormField>
              <FormField label="E-mail da empresa" htmlFor="erp-p-email">
                <Input id="erp-p-email" type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} maxLength={200} />
              </FormField>
              <FormField label="Telefone" htmlFor="erp-p-tel">
                <Input id="erp-p-tel" value={company.telefone} onChange={(e) => setCompany({ ...company, telefone: e.target.value })} maxLength={20} />
              </FormField>
              <FormField label="CEP" htmlFor="erp-p-cep">
                <Input id="erp-p-cep" value={addr.cep} onChange={(e) => setAddr({ ...addr, cep: e.target.value })} maxLength={9} />
              </FormField>
              <FormField label="Logradouro" htmlFor="erp-p-rua">
                <Input id="erp-p-rua" value={addr.logradouro} onChange={(e) => setAddr({ ...addr, logradouro: e.target.value })} maxLength={200} />
              </FormField>
              <FormField label="Número" htmlFor="erp-p-num">
                <Input id="erp-p-num" value={addr.numero} onChange={(e) => setAddr({ ...addr, numero: e.target.value })} maxLength={20} />
              </FormField>
              <FormField label="Bairro" htmlFor="erp-p-bairro">
                <Input id="erp-p-bairro" value={addr.bairro} onChange={(e) => setAddr({ ...addr, bairro: e.target.value })} maxLength={100} />
              </FormField>
              <FormField label="Município" htmlFor="erp-p-mun">
                <Input id="erp-p-mun" value={addr.municipio} onChange={(e) => setAddr({ ...addr, municipio: e.target.value })} maxLength={100} />
              </FormField>
              <FormField label="UF" htmlFor="erp-p-uf">
                <Input id="erp-p-uf" value={addr.uf} onChange={(e) => setAddr({ ...addr, uf: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
              </FormField>
            </div>
          ) : null}

          {!outcome && step === "modulos" ? (
            <div className="flex flex-col gap-3">
              <FormField label="Ponto de partida" htmlFor="erp-p-pacote" hint="O pacote só preenche a seleção inicial: o que você mudar vale só para esta empresa.">
                <Select id="erp-p-pacote" value={packageKey} onChange={(e) => choosePackage(e.target.value)} options={[...packages.map((p) => ({ value: p.key, label: p.name })), { value: "", label: "Nenhum (escolher do zero)" }]} />
              </FormField>
              {pkg ? <p className="text-xs text-muted">{pkg.description}</p> : null}
              {custom && (custom.added.length || custom.removed.length) ? (
                <p className="text-xs">
                  Personalização desta empresa: <strong>+{custom.added.length}</strong> adicionada{custom.added.length === 1 ? "" : "s"}, <strong>−{custom.removed.length}</strong> retirada{custom.removed.length === 1 ? "" : "s"} em relação ao pacote.
                </p>
              ) : null}
              <SearchInput value={search} onChange={setSearch} debounceMs={100} placeholder="Buscar unidade (código ou nome)" aria-label="Buscar unidade" />
              <ul className="flex flex-col gap-3">
                {grouped.map(([module, units]) => (
                  <li key={module}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                      {module} · {moduleName.get(module) ?? module}
                    </p>
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {units.map((u) => {
                        const viaDep = !selected.has(u.code) && finalSet.added.has(u.code);
                        return (
                          <li key={u.code} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={selected.has(u.code) || viaDep} disabled={viaDep} onCheckedChange={(v) => toggle(u.code, v === true)} label={`${u.code} ${u.name}`} />
                            {viaDep ? (
                              <Badge variant="info" size="sm">
                                exigido por {finalSet.added.get(u.code)}
                              </Badge>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!outcome && step === "admin" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Nome do administrador" htmlFor="erp-p-anome" required>
                <Input id="erp-p-anome" value={admin.nome} onChange={(e) => setAdmin({ ...admin, nome: e.target.value })} maxLength={120} />
              </FormField>
              <FormField label="E-mail do administrador" htmlFor="erp-p-aemail" required>
                <Input id="erp-p-aemail" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} maxLength={200} />
              </FormField>
              <FormField label="Telefone" htmlFor="erp-p-atel">
                <Input id="erp-p-atel" value={admin.telefone} onChange={(e) => setAdmin({ ...admin, telefone: e.target.value })} maxLength={20} />
              </FormField>
              <FormField label="Convite de acesso" htmlFor="erp-p-entrega" hint="O link do convite nunca é gravado no INTEROS.">
                <Select
                  id="erp-p-entrega"
                  value={entrega}
                  onChange={(e) => setEntrega(e.target.value as "interos" | "erp")}
                  options={[
                    { value: "interos", label: "Mostrar o link uma vez aqui (eu envio)" },
                    { value: "erp", label: "O ERP envia por e-mail" },
                  ]}
                />
              </FormField>
            </div>
          ) : null}

          {!outcome && step === "revisao" ? (
            <div className="flex flex-col gap-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted">Empresa</dt>
                <dd>
                  {company.razaoSocial} · CNPJ {company.cnpj} · {tipo === "varejo" ? "varejo" : "escritório contábil"}
                </dd>
                <dt className="text-muted">Administrador</dt>
                <dd>
                  {admin.nome} ({admin.email}) · convite {entrega === "interos" ? "mostrado aqui" : "enviado pelo ERP"}
                </dd>
                <dt className="text-muted">Pacote</dt>
                <dd>{pkg ? `${pkg.name}${custom && (custom.added.length || custom.removed.length) ? ` (personalizado: +${custom.added.length} / −${custom.removed.length})` : ""}` : "Nenhum"}</dd>
              </dl>
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Conjunto final enviado ao ERP ({finalSet.all.length} unidades)</h3>
                <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                  {finalSet.all.map((code) => (
                    <li key={code} className="flex items-center gap-2">
                      <span className="w-12 font-mono text-muted">{code}</span>
                      <span className="min-w-0 flex-1 truncate">{byCode.get(code)?.name ?? code}</span>
                      {finalSet.added.has(code) ? (
                        <Badge variant="info" size="sm">
                          dependência
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">Depois de criada, a empresa passa a seguir o contrato no ERP (só o que está acima fica liberado). Cadastros e administração são da plataforma.</p>
              </section>
              <FormField label="Motivo" htmlFor="erp-p-motivo" required hint="Ex.: implantação do contrato 2026-118.">
                <Textarea id="erp-p-motivo" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
              </FormField>
              <FormField label="Referência do contrato" htmlFor="erp-p-contrato">
                <Input id="erp-p-contrato" value={contractRef} onChange={(e) => setContractRef(e.target.value)} maxLength={100} />
              </FormField>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {outcome ? (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => (stepIndex === 0 ? close() : setStep(STEPS[stepIndex - 1].key))} disabled={sending}>
                {stepIndex === 0 ? "Cancelar" : "Voltar"}
              </Button>
              {step === "revisao" ? (
                <Button onClick={submit} loading={sending} disabled={!canNext.revisao}>
                  Criar empresa no ERP
                </Button>
              ) : (
                <Button onClick={() => setStep(STEPS[stepIndex + 1].key)} disabled={!canNext[step]}>
                  Continuar
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProvisionResult({ outcome }: { outcome: ProvisionOutcome }) {
  const [copied, setCopied] = React.useState(false);
  const link = outcome.invite?.link ?? null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-success-fg">
        <CheckCircle2 className="size-4" aria-hidden /> Empresa criada e vinculada a este cliente{outcome.implantacao ? ` (implantação: ${outcome.implantacao})` : ""}.
      </p>
      {link ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2">
          <p className="text-xs font-medium text-warning-fg">Link de acesso do administrador — mostrado só agora, não fica gravado:</p>
          <p className="mt-1 break-all font-mono text-xs">{link}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => toast.error("Não foi possível copiar: selecione o link e copie."),
              );
            }}
          >
            <Copy aria-hidden /> {copied ? "Copiado" : "Copiar link"}
          </Button>
          {outcome.invite?.expiresAt ? <p className="mt-1 text-xs text-muted">Vale até {new Date(outcome.invite.expiresAt).toLocaleString("pt-BR")}.</p> : null}
        </div>
      ) : outcome.invite?.delivered ? (
        <p className="text-xs text-muted">O ERP enviou o convite{outcome.invite.channel ? ` por ${outcome.invite.channel}` : ""}.</p>
      ) : outcome.invite?.detail ? (
        <p className="text-xs text-warning-fg">{outcome.invite.detail}</p>
      ) : null}
      {outcome.license ? (
        <p className="text-xs">
          Licença inicial: <strong>{outcome.license.status === "aplicada" ? `aplicada (versão ${outcome.license.licenseVersion})` : outcome.license.status === "falhou" ? "aguardando sincronização (nova tentativa automática)" : outcome.license.status}</strong>.
        </p>
      ) : outcome.licenseError ? (
        <p className="text-xs text-warning-fg">Licença inicial não enviada: {outcome.licenseError} Envie pela aba Módulos ERP.</p>
      ) : null}
    </div>
  );
}
