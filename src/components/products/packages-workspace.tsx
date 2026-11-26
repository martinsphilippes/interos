"use client";

/**
 * Aba Pacotes da Gestão de Produtos: pacotes por segmento com versões (módulos incluídos, mensalidade e implantação a
 * partir de uma data). Novo pacote parte de um pacote de partida do ERP ou do zero; a tela mostra, enquanto se monta, o
 * que falta de dependência, o que o ERP ainda não vende e quanto o pacote economiza sobre os mesmos módulos avulsos.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Boxes, Plus, Save } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMERCIAL_SEGMENTS,
  COMMERCIAL_SEGMENT_LABELS,
  PACKAGE_STATUSES,
  PACKAGE_STATUS_LABELS,
  SUMMARY_MAX,
  versionAt,
  versionState,
  type CommercialModule,
  type CommercialSegment,
  type PackageStatus,
  type PackageVersion,
  type ProductPackage,
} from "@/domain/products/commercial";
import { comparePackage, packageUnitProblems, type QuoteUnit } from "@/domain/products/quote";
import { addPackageVersionAction, cancelPackageVersionAction, createPackageAction, updatePackageAction } from "@/server/products/actions";
import type { ProductManagementView } from "@/server/products/queries";
import { formatCurrency, formatDateKey, formatDateTime } from "@/lib/format";
import { CatalogSourceNotice } from "./catalog-source";
import { CancelVersionDialog } from "./module-drawer";
import { numberToInput, PackageStatusBadge, toNumber, UnitPicker, VersionStateBadge } from "./shared";

export interface PackagePermissions {
  edit: boolean;
}

function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Primeira data aceita para uma versão nova: hoje, ou o dia seguinte ao início da última versão ativa. */
function firstFreeDay(versions: readonly PackageVersion[], today: string): string {
  const last = versions.filter((v) => !v.cancelledAt).reduce((max, v) => (v.validFrom > max ? v.validFrom : max), "");
  return last && last >= today ? nextDay(last) : today;
}

export function PackagesWorkspace({ view, permissions }: { view: ProductManagementView; permissions: PackagePermissions }) {
  const [creating, setCreating] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const units = React.useMemo(() => new Map<string, QuoteUnit>(view.units.map((u) => [u.code, u])), [view.units]);
  const modules = React.useMemo(() => new Map<string, CommercialModule>(view.records.map((r) => [r.code, r])), [view.records]);
  const pkg = open ? (view.packages.find((p) => p.id === open) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <CatalogSourceNotice catalog={view.catalog} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">O que está no pacote não é cobrado de novo como avulso. Cada versão vale a partir de uma data; a anterior fica no histórico.</p>
        {permissions.edit ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus /> Novo pacote
          </Button>
        ) : null}
      </div>
      {view.packages.length === 0 ? (
        <EmptyState icon={<Boxes />} title="Nenhum pacote ainda" description="Crie a partir de um pacote de partida do ERP (varejo essencial, supermercado, moda…) ou do zero." action={permissions.edit ? <Button onClick={() => setCreating(true)}><Plus /> Novo pacote</Button> : undefined} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {view.packages.map((p) => {
            const current = versionAt(p.versions, view.today);
            const next = p.versions.find((v) => versionState(v, view.today) === "agendada") ?? null;
            const cmp = current ? comparePackage(current, modules, view.today) : null;
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(p.id)} className="flex h-full w-full flex-col gap-2 rounded-lg border border-border p-4 text-left hover:border-border-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <PackageStatusBadge status={p.status} />
                  </span>
                  <span className="text-xs text-muted">{COMMERCIAL_SEGMENT_LABELS[p.segment]}</span>
                  {current ? (
                    <>
                      <span className="text-lg font-semibold tabular-nums">
                        {formatCurrency(current.monthly)}
                        <span className="text-sm font-normal text-muted">/mês</span>
                      </span>
                      <span className="text-xs text-muted">
                        {current.units.length} módulos{current.setup > 0 ? ` · implantação ${formatCurrency(current.setup)}` : ""} · versão {current.version}
                      </span>
                      {cmp && cmp.savingPct !== null && cmp.unpriced.length === 0 ? (
                        <span className={cmp.savingMonthly >= 0 ? "text-xs text-success-fg" : "text-xs text-warning-fg"}>
                          {cmp.savingMonthly >= 0 ? `Economia de ${formatCurrency(cmp.savingMonthly)}/mês (${cmp.savingPct}%) sobre os avulsos` : `${formatCurrency(-cmp.savingMonthly)}/mês mais caro que os avulsos`}
                        </span>
                      ) : cmp && cmp.unpriced.length ? (
                        <span className="text-xs text-muted">{cmp.unpriced.length} módulos sem preço avulso para comparar</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-muted">Sem versão vigente hoje</span>
                  )}
                  {next ? <span className="text-xs text-info-fg">Nova versão em {formatDateKey(next.validFrom)}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating ? <PackageEditor mode="create" view={view} units={units} modules={modules} onClose={() => setCreating(false)} /> : null}
      <PackageDrawer pkg={pkg} view={view} units={units} modules={modules} canEdit={permissions.edit} onClose={() => setOpen(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Novo pacote / nova versão
// ---------------------------------------------------------------------------

function PackageEditor({ mode, view, units, modules, pkg, onClose }: { mode: "create" | "version"; view: ProductManagementView; units: ReadonlyMap<string, QuoteUnit>; modules: ReadonlyMap<string, CommercialModule>; pkg?: ProductPackage; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const base = pkg ? (versionAt(pkg.versions, view.today) ?? [...pkg.versions].filter((v) => !v.cancelledAt).sort((a, b) => b.version - a.version)[0] ?? null) : null;
  const [name, setName] = React.useState("");
  const [segment, setSegment] = React.useState<CommercialSegment>("varejo");
  const [description, setDescription] = React.useState("");
  const [starter, setStarter] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(base?.units ?? []));
  const [monthly, setMonthly] = React.useState(numberToInput(base?.monthly ?? 0));
  const [setup, setSetup] = React.useState(numberToInput(base?.setup ?? 0));
  const [validFrom, setValidFrom] = React.useState(pkg ? firstFreeDay(pkg.versions, view.today) : view.today);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const codes = [...selected];
  const { errors, warnings } = packageUnitProblems(codes, units, modules);
  const monthlyValue = toNumber(monthly);
  const setupValue = toNumber(setup);
  const cmp = codes.length && monthlyValue !== null ? comparePackage({ units: codes, monthly: monthlyValue, setup: setupValue ?? 0 }, modules, view.today) : null;
  const invalid = Boolean(errors.length) || monthlyValue === null || setupValue === null || reason.trim().length < 3 || (mode === "create" && name.trim().length < 2);

  const applyStarter = (key: string) => {
    setStarter(key);
    const s = view.starters.find((x) => x.key === key);
    if (!s) return;
    setSelected(new Set(s.units));
    if (!name.trim()) setName(s.name);
    if (!description.trim()) setDescription(s.description);
    if (COMMERCIAL_SEGMENTS.includes(s.kind as CommercialSegment)) setSegment(s.kind as CommercialSegment);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setError(null);
    startTransition(async () => {
      const common = { units: codes, monthly: monthlyValue ?? 0, setup: setupValue ?? 0, validFrom, reason };
      const result = mode === "create" ? await createPackageAction({ name, segment, description: description || null, basedOn: starter || null, ...common }) : await addPackageVersionAction({ id: pkg?.id, ...common });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(mode === "create" ? "Pacote criado (em definição)" : `Versão ${"version" in result.data ? result.data.version : ""} gravada`, { description: result.data.warnings.length ? `${result.data.warnings.length} aviso(s) para revisar.` : undefined });
      onClose();
      router.refresh();
    });
  };

  const starterInfo = view.starters.find((s) => s.key === starter);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Novo pacote" : `Nova versão · ${pkg?.name}`}</DialogTitle>
            <DialogDescription>{mode === "create" ? "O pacote nasce em definição: confira e coloque à venda depois." : "A versão nova vale a partir da data escolhida; a atual fica no histórico."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {mode === "create" ? (
              <>
                <FormField label="Começar de um pacote de partida do ERP" htmlFor="pk-starter" hint="Opcional: preenche os módulos, o nome e o segmento.">
                  <Select id="pk-starter" value={starter} onChange={(e) => applyStarter(e.target.value)} options={[{ value: "", label: "Do zero" }, ...view.starters.map((s) => ({ value: s.key, label: `${s.name} (${s.units.length} módulos)` }))]} />
                </FormField>
                {starterInfo?.skipped.length ? <p className="text-xs text-muted">Ficaram de fora por não estarem à venda no ERP: {starterInfo.skipped.join(", ")}.</p> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Nome" htmlFor="pk-name" required>
                    <Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
                  </FormField>
                  <FormField label="Segmento" htmlFor="pk-segment">
                    <Select id="pk-segment" value={segment} onChange={(e) => setSegment(e.target.value as CommercialSegment)} options={COMMERCIAL_SEGMENTS.map((s) => ({ value: s, label: COMMERCIAL_SEGMENT_LABELS[s] }))} />
                  </FormField>
                  <FormField label="Descrição para proposta" htmlFor="pk-desc" className="sm:col-span-2">
                    <Textarea id="pk-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={SUMMARY_MAX} rows={2} />
                  </FormField>
                </div>
              </>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Módulos incluídos ({codes.length})</span>
              <UnitPicker units={view.units} erpModules={view.erpModules} selected={selected} onChange={setSelected} idPrefix={`pk-${pkg?.id ?? "novo"}`} />
            </div>
            {errors.length || warnings.length ? (
              <ul className="flex flex-col gap-1 text-xs">
                {errors.map((w) => (
                  <li key={w} className="text-danger-fg">
                    {w}
                  </li>
                ))}
                {warnings.map((w) => (
                  <li key={w} className="text-warning-fg">
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Mensalidade do pacote (R$)" htmlFor="pk-monthly" required>
                <Input id="pk-monthly" type="number" inputMode="decimal" min={0} step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} className="tabular-nums" required />
              </FormField>
              <FormField label="Implantação (R$, uma vez)" htmlFor="pk-setup">
                <Input id="pk-setup" type="number" inputMode="decimal" min={0} step="0.01" value={setup} onChange={(e) => setSetup(e.target.value)} className="tabular-nums" />
              </FormField>
              <FormField label="Vale a partir de" htmlFor="pk-from" required>
                <DateInput id="pk-from" value={validFrom} min={view.today} onChange={(e) => setValidFrom(e.target.value)} required />
              </FormField>
            </div>
            {cmp ? (
              <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
                Os mesmos módulos avulsos: {formatCurrency(cmp.monthly)}/mês{cmp.setup > 0 ? ` + ${formatCurrency(cmp.setup)} de implantação` : ""}
                {cmp.unpriced.length ? ` (sem preço avulso: ${cmp.unpriced.join(", ")})` : ""}.{" "}
                {cmp.savingPct !== null && !cmp.unpriced.length ? (cmp.savingMonthly >= 0 ? `O pacote economiza ${formatCurrency(cmp.savingMonthly)}/mês (${cmp.savingPct}%).` : `O pacote sai ${formatCurrency(-cmp.savingMonthly)}/mês mais caro.`) : ""}
              </p>
            ) : null}
            <FormField label="Motivo" htmlFor="pk-reason" required hint="Ex.: lançamento, tabela 2027, inclui a loja virtual.">
              <Input id="pk-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} required />
            </FormField>
            {error ? (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={invalid}>
              {mode === "create" ? "Criar pacote" : "Gravar versão"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ficha do pacote
// ---------------------------------------------------------------------------

function PackageDrawer({ pkg, view, units, modules, canEdit, onClose }: { pkg: ProductPackage | null; view: ProductManagementView; units: ReadonlyMap<string, QuoteUnit>; modules: ReadonlyMap<string, CommercialModule>; canEdit: boolean; onClose: () => void }) {
  return (
    <Drawer open={pkg !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="lg">{pkg ? <PackageDrawerInner key={`${pkg.id}-${pkg.updatedAt}`} pkg={pkg} view={view} units={units} modules={modules} canEdit={canEdit} /> : null}</DrawerContent>
    </Drawer>
  );
}

function PackageDrawerInner({ pkg, view, units, modules, canEdit }: { pkg: ProductPackage; view: ProductManagementView; units: ReadonlyMap<string, QuoteUnit>; modules: ReadonlyMap<string, CommercialModule>; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(pkg.name);
  const [segment, setSegment] = React.useState<CommercialSegment>(pkg.segment);
  const [description, setDescription] = React.useState(pkg.description ?? "");
  const [status, setStatus] = React.useState<PackageStatus>(pkg.status);
  const [error, setError] = React.useState<string | null>(null);
  const [versioning, setVersioning] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<PackageVersion | null>(null);
  const current = versionAt(pkg.versions, view.today);
  const history = [...pkg.versions].sort((a, b) => b.version - a.version);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updatePackageAction({ id: pkg.id, name, segment, description: description || null, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Pacote salvo");
      router.refresh();
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader>
        <DrawerTitle>{pkg.name}</DrawerTitle>
        <DrawerDescription className="flex flex-wrap items-center gap-2">
          <PackageStatusBadge status={pkg.status} /> {COMMERCIAL_SEGMENT_LABELS[pkg.segment]}
          {pkg.basedOn ? <span>· a partir de {view.starters.find((s) => s.key === pkg.basedOn)?.name ?? pkg.basedOn}</span> : null}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-6">
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome" htmlFor={`pd-name-${pkg.id}`} required>
              <Input id={`pd-name-${pkg.id}`} value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} disabled={!canEdit} required />
            </FormField>
            <FormField label="Situação" htmlFor={`pd-status-${pkg.id}`} hint={status === "a_venda" ? "Oferecido em propostas." : status === "rascunho" ? "Ainda não oferecido." : "Não entra em vendas novas."}>
              <Select id={`pd-status-${pkg.id}`} value={status} onChange={(e) => setStatus(e.target.value as PackageStatus)} disabled={!canEdit} options={PACKAGE_STATUSES.map((s) => ({ value: s, label: PACKAGE_STATUS_LABELS[s] }))} />
            </FormField>
            <FormField label="Segmento" htmlFor={`pd-seg-${pkg.id}`}>
              <Select id={`pd-seg-${pkg.id}`} value={segment} onChange={(e) => setSegment(e.target.value as CommercialSegment)} disabled={!canEdit} options={COMMERCIAL_SEGMENTS.map((s) => ({ value: s, label: COMMERCIAL_SEGMENT_LABELS[s] }))} />
            </FormField>
            <FormField label="Descrição para proposta" htmlFor={`pd-desc-${pkg.id}`} className="sm:col-span-2">
              <Textarea id={`pd-desc-${pkg.id}`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={SUMMARY_MAX} rows={2} disabled={!canEdit} />
            </FormField>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          ) : null}
          {canEdit ? (
            <div>
              <Button type="submit" loading={pending}>
                <Save /> Salvar pacote
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-muted">Última alteração: {pkg.updatedBy.name}, {formatDateTime(pkg.updatedAt)}</p>
        </form>

        <section aria-labelledby={`pv-${pkg.id}`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`pv-${pkg.id}`} className="text-sm font-semibold">
              Versões
            </h3>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setVersioning(true)}>
                <Plus /> Nova versão
              </Button>
            ) : null}
          </div>
          {current ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">
                Vigente: {formatCurrency(current.monthly)}/mês{current.setup > 0 ? ` · implantação ${formatCurrency(current.setup)}` : ""} · versão {current.version}
              </p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {current.units.map((c) => (
                  <li key={c} className="text-xs">
                    <span className="tabular-nums text-muted">{c}</span> {modules.get(c)?.name ?? units.get(c)?.name ?? c}
                    {!units.has(c) ? <span className="text-warning-fg"> (fora do catálogo)</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">Sem versão vigente hoje.</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Versões do pacote {pkg.name}</caption>
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Versão</th>
                  <th className="px-3 py-2 font-medium">Vigência</th>
                  <th className="px-3 py-2 font-medium">Preço</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((v) => {
                  const state = versionState(v, view.today);
                  return (
                    <tr key={v.version} className={state === "cancelada" ? "text-muted" : undefined}>
                      <td className="px-3 py-2 align-top">
                        <span className="tabular-nums">v{v.version}</span> <VersionStateBadge state={state} />
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums">
                        {formatDateKey(v.validFrom)}
                        {v.validTo ? ` → ${formatDateKey(v.validTo)}` : " → sem fim"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {formatCurrency(v.monthly)}/mês · {v.units.length} módulos
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {v.reason}
                        <span className="block text-muted">
                          {v.createdBy.name}, {formatDateTime(v.createdAt)}
                        </span>
                        {v.cancelledAt ? (
                          <span className="block text-danger-fg">
                            Cancelada por {v.cancelledBy?.name}: {v.cancelReason}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        {canEdit && !v.cancelledAt && v.validFrom >= view.today ? (
                          <Button type="button" size="sm" variant="ghost" className="text-danger-fg" onClick={() => setCancelling(v)} aria-label={`Cancelar a versão ${v.version}`}>
                            <Ban /> Cancelar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </DrawerBody>
      {versioning ? <PackageEditor mode="version" view={view} units={units} modules={modules} pkg={pkg} onClose={() => setVersioning(false)} /> : null}
      {cancelling ? (
        <CancelVersionDialog
          title={`Cancelar a versão ${cancelling.version} do pacote?`}
          description={`${formatCurrency(cancelling.monthly)}/mês a partir de ${formatDateKey(cancelling.validFrom)}${cancelling.validFrom > view.today ? "" : " (começou hoje; a versão anterior volta a valer)"}. Fica no histórico como cancelada.`}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => cancelPackageVersionAction({ id: pkg.id, version: cancelling.version, reason })}
        />
      ) : null}
    </div>
  );
}
