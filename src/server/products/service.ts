import "server-only";

/**
 * Gestão de Produtos (servidor): ficha comercial dos módulos do ERP, versões de preço e pacotes. Cada gravação lê e
 * escreve o documento dentro de uma transação (a leitura trava o documento: duas versões criadas ao mesmo tempo não
 * recebem o mesmo número nem se intercalam) e registra o antes e o depois em um evento de auditoria.
 */
import { COLLECTIONS } from "@/domain/types";
import { compareCodes, type ErpCatalogIndex } from "@/domain/erp/catalog";
import {
  appendVersion,
  cancelVersion,
  COMMERCIAL_SEGMENT_LABELS,
  COMMERCIAL_STATUS_LABELS,
  CommercialRuleError,
  describePrice,
  PACKAGE_STATUS_LABELS,
  priceProblems,
  versionAt,
  type Actor,
  type CommercialModule,
  type PackageVersion,
  type PriceVersion,
  type ProductPackage,
} from "@/domain/products/commercial";
import { packageUnitProblems, type QuoteUnit } from "@/domain/products/quote";
import { normalizeSearch } from "@/domain/erp/catalog";
import { dateKey, formatCurrency, formatDateKey } from "@/lib/format";
import { col, list, newId, nowIso, ORG_ID, stripUndefined, txGetOwn } from "@/server/db";
import { docdb, type Transaction } from "@/server/docdb";
import { emitEvent } from "@/server/events";
import { BusinessError } from "@/server/auth/error-classes";
import type { DepartmentKey } from "@/domain/constants";
import type { z } from "zod";
import type { cancelPackageVersionSchema, cancelPriceSchema, createPackageSchema, packageVersionSchema, priceSchema, saveModuleSchema, updatePackageSchema } from "./schemas";

type ModuleDoc = CommercialModule & { organizationId: string };
type PackageDoc = ProductPackage & { organizationId: string };

export interface ProductActor extends Actor {
  departmentId?: string;
}

const moduleRef = (code: string) => col(COLLECTIONS.productModules).doc(code);
const packageRef = (id: string) => col(COLLECTIONS.productPackages).doc(id);
const actorRef = (a: ProductActor): Actor => ({ id: a.id, name: a.name });
const brl = (v: number) => formatCurrency(v);

/** Hoje (AAAA-MM-DD) no fuso da operação: a vigência dos preços é por dia. */
export function todayKey(): string {
  return dateKey(new Date());
}

function toModule(doc: ModuleDoc): CommercialModule {
  const { organizationId: _org, ...rest } = doc;
  void _org;
  return { ...rest, segments: rest.segments ?? [], requiresCommercial: rest.requiresCommercial ?? [], prices: rest.prices ?? [] };
}

function toPackage(doc: PackageDoc): ProductPackage {
  const { organizationId: _org, ...rest } = doc;
  void _org;
  return { ...rest, versions: rest.versions ?? [] };
}

export async function listCommercialModules(): Promise<CommercialModule[]> {
  return (await list<ModuleDoc>(COLLECTIONS.productModules)).map(toModule).sort((a, b) => compareCodes(a.code, b.code));
}

export async function listProductPackages(): Promise<ProductPackage[]> {
  return (await list<PackageDoc>(COLLECTIONS.productPackages)).map(toPackage).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Regra do domínio vira erro de negócio (mensagem exibida na tela). */
async function inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await docdb.runTransaction(fn);
  } catch (error) {
    if (error instanceof CommercialRuleError) throw new BusinessError(error.message);
    throw error;
  }
}

async function readModule(tx: Transaction, code: string): Promise<ModuleDoc | null> {
  const snap = await txGetOwn(tx, moduleRef(code));
  return snap ? ({ ...(snap.data() as Omit<ModuleDoc, "id">), id: snap.id } as ModuleDoc) : null;
}

async function readPackage(tx: Transaction, id: string): Promise<PackageDoc | null> {
  const snap = await txGetOwn(tx, packageRef(id));
  return snap ? ({ ...(snap.data() as Omit<PackageDoc, "id">), id: snap.id } as PackageDoc) : null;
}

/** Ficha nova com os padrões: nome do catálogo, em definição. */
function blankModule(unit: QuoteUnit, actor: Actor, now: string): ModuleDoc {
  return { id: unit.code, organizationId: ORG_ID, code: unit.code, name: unit.name, summary: null, status: "rascunho", segments: [], requiresCommercial: [], notes: null, prices: [], createdAt: now, updatedAt: now, updatedBy: actor };
}

function eventDepartment(actor: ProductActor): DepartmentKey | undefined {
  return actor.departmentId as DepartmentKey | undefined;
}

// ---------------------------------------------------------------------------
// Ficha comercial
// ---------------------------------------------------------------------------

export async function saveCommercialModule(input: z.output<typeof saveModuleSchema>, actor: ProductActor, units: ReadonlyMap<string, QuoteUnit>): Promise<CommercialModule> {
  const unit = units.get(input.code);
  if (input.status === "a_venda" && !unit?.sellable) {
    throw new BusinessError("O ERP ainda não vende esta unidade (não homologada ou fora do catálogo): deixe em definição ou sob consulta.");
  }
  const requires = [...new Set(input.requiresCommercial)].sort(compareCodes);
  if (requires.includes(input.code)) throw new BusinessError("Um módulo não pode depender dele mesmo.");
  const unknown = requires.filter((c) => !units.has(c));
  if (unknown.length) throw new BusinessError(`Dependência fora do catálogo: ${unknown.join(", ")}.`);
  const segments = [...new Set(input.segments)];
  const now = nowIso();

  let before: ModuleDoc | null = null;
  let after: ModuleDoc | null = null;
  await inTransaction(async (tx) => {
    const current = await readModule(tx, input.code);
    if (!current && !unit) throw new BusinessError("Este código não é uma unidade comercial do catálogo do ERP.");
    before = current;
    const base = current ?? blankModule(unit as QuoteUnit, actorRef(actor), now);
    const next: ModuleDoc = { ...base, name: input.name, summary: input.summary, status: input.status, segments, requiresCommercial: requires, notes: input.notes, updatedAt: now, updatedBy: actorRef(actor) };
    const same = current && current.name === next.name && current.summary === next.summary && current.status === next.status && sameList(current.segments, segments) && sameList(current.requiresCommercial, requires) && current.notes === next.notes;
    if (same) {
      after = current;
      return;
    }
    tx.set(moduleRef(input.code), stripUndefined({ ...next, id: undefined }));
    after = next;
  });
  const saved = after as ModuleDoc | null;
  if (!saved) throw new BusinessError("Módulo não encontrado.");
  const prev = before as ModuleDoc | null;
  if (saved === prev) return toModule(saved);

  const changes: Record<string, { from: string; to: string }> = {};
  const put = (label: string, from: string, to: string) => {
    if (from !== to) changes[label] = { from, to };
  };
  put("Nome", prev?.name ?? "—", saved.name);
  put("Situação", prev ? COMMERCIAL_STATUS_LABELS[prev.status] : "—", COMMERCIAL_STATUS_LABELS[saved.status]);
  put("Segmentos", segmentText(prev?.segments ?? []), segmentText(saved.segments));
  put("Dependências comerciais", (prev?.requiresCommercial ?? []).join(", ") || "—", saved.requiresCommercial.join(", ") || "—");
  if ((prev?.summary ?? null) !== saved.summary) changes["Texto para proposta"] = { from: prev?.summary ? "anterior" : "—", to: saved.summary ? "alterado" : "—" };
  if ((prev?.notes ?? null) !== saved.notes) changes["Observações"] = { from: prev?.notes ? "anteriores" : "—", to: saved.notes ? "alteradas" : "—" };
  await safeEmit({
    type: "product_module.updated",
    actor: actorRef(actor),
    entity: { type: "product_module", id: saved.code },
    title: `Ficha comercial: ${saved.code} ${saved.name}`,
    description: describeChanges(changes),
    department: eventDepartment(actor),
    payload: { code: saved.code, changes },
  });
  return toModule(saved);
}

function segmentText(list: readonly string[]): string {
  return list.map((s) => COMMERCIAL_SEGMENT_LABELS[s as keyof typeof COMMERCIAL_SEGMENT_LABELS] ?? s).join(", ") || "todos";
}

function sameList(a: readonly string[] | undefined, b: readonly string[]): boolean {
  const x = [...(a ?? [])].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// ---------------------------------------------------------------------------
// Preço
// ---------------------------------------------------------------------------

/** Campos do preço conforme o modelo (o que não se aplica ao modelo é zerado, para a versão guardar só o que vale). */
function priceFields(input: z.output<typeof priceSchema>): Pick<PriceVersion, "model" | "monthly" | "unitPrice" | "includedQuantity" | "unitLabel" | "tiers" | "setup"> {
  const unitLabel = input.unitLabel?.trim() || null;
  if (input.model === "fixo") return { model: "fixo", monthly: input.monthly, unitPrice: 0, includedQuantity: 0, unitLabel: null, tiers: [], setup: input.setup };
  if (input.model === "por_quantidade") return { model: "por_quantidade", monthly: input.monthly, unitPrice: input.unitPrice, includedQuantity: input.includedQuantity, unitLabel, tiers: [], setup: input.setup };
  return { model: "por_faixa", monthly: 0, unitPrice: 0, includedQuantity: 0, unitLabel, tiers: input.tiers.map((t) => ({ upTo: t.upTo, monthly: t.monthly })), setup: input.setup };
}

export async function addModulePrice(input: z.output<typeof priceSchema>, actor: ProductActor, units: ReadonlyMap<string, QuoteUnit>): Promise<{ code: string; version: number }> {
  const fields = priceFields(input);
  const problems = priceProblems(fields);
  if (problems.length) throw new BusinessError(problems.join(" "));
  const unit = units.get(input.code);
  // Código fora do catálogo em uso (ficha antiga): guarda o histórico, mas não recebe preço novo.
  if (!unit) throw new BusinessError("Este código não está no catálogo do ERP em uso: não recebe preço novo.");
  const today = todayKey();
  const now = nowIso();

  let saved: { doc: ModuleDoc; created: PriceVersion; previous: PriceVersion | null } | null = null;
  await inTransaction(async (tx) => {
    const current = await readModule(tx, input.code);
    const doc = current ?? blankModule(unit, actorRef(actor), now);
    const previous = versionAt(doc.prices, input.validFrom);
    const { versions, created } = appendVersion<PriceVersion>(doc.prices, { ...fields, validFrom: input.validFrom, reason: input.reason, createdAt: now, createdBy: actorRef(actor) }, today);
    const next: ModuleDoc = { ...doc, prices: versions, updatedAt: now, updatedBy: actorRef(actor) };
    tx.set(moduleRef(input.code), stripUndefined({ ...next, id: undefined }));
    saved = { doc: next, created, previous };
  });
  const result = saved as { doc: ModuleDoc; created: PriceVersion; previous: PriceVersion | null } | null;
  if (!result) throw new BusinessError("Não foi possível gravar o preço.");
  const { doc, created, previous } = result;
  const to = describePrice(created, brl);
  const changes: Record<string, { from: string; to: string }> = { Preço: { from: previous ? describePrice(previous, brl) : "—", to }, "Início da vigência": { from: previous ? formatDateKey(previous.validFrom) : "—", to: formatDateKey(created.validFrom) } };
  await safeEmit({
    type: "product_price.created",
    actor: actorRef(actor),
    entity: { type: "product_module", id: doc.code },
    title: `Preço de ${doc.code} ${doc.name}: versão ${created.version}`,
    description: `${to} a partir de ${formatDateKey(created.validFrom)} · ${created.reason}`,
    department: eventDepartment(actor),
    payload: { code: doc.code, version: created.version, validFrom: created.validFrom, model: created.model, monthly: created.monthly, unitPrice: created.unitPrice, includedQuantity: created.includedQuantity, unitLabel: created.unitLabel, tiers: created.tiers, setup: created.setup, reason: created.reason, changes },
  });
  return { code: doc.code, version: created.version };
}

export async function cancelModulePrice(input: z.output<typeof cancelPriceSchema>, actor: ProductActor): Promise<void> {
  const today = todayKey();
  const now = nowIso();
  let saved: { doc: ModuleDoc; cancelled: PriceVersion } | null = null;
  await inTransaction(async (tx) => {
    const doc = await readModule(tx, input.code);
    if (!doc) throw new BusinessError("Módulo não encontrado.");
    const { versions, cancelled } = cancelVersion<PriceVersion>(doc.prices, input.version, today, actorRef(actor), input.reason, now);
    const next: ModuleDoc = { ...doc, prices: versions, updatedAt: now, updatedBy: actorRef(actor) };
    tx.set(moduleRef(input.code), stripUndefined({ ...next, id: undefined }));
    saved = { doc: next, cancelled };
  });
  const result = saved as { doc: ModuleDoc; cancelled: PriceVersion } | null;
  if (!result) return;
  const now2 = versionAt(result.doc.prices, today);
  await safeEmit({
    type: "product_price.cancelled",
    actor: actorRef(actor),
    entity: { type: "product_module", id: result.doc.code },
    title: `Preço de ${result.doc.code} ${result.doc.name}: versão ${result.cancelled.version} cancelada`,
    description: `${describePrice(result.cancelled, brl)} (a partir de ${formatDateKey(result.cancelled.validFrom)}) · ${input.reason}`,
    department: eventDepartment(actor),
    payload: { code: result.doc.code, version: result.cancelled.version, reason: input.reason, changes: { "Preço vigente": { from: describePrice(result.cancelled, brl), to: now2 ? describePrice(now2, brl) : "sem preço" } } },
  });
}

// ---------------------------------------------------------------------------
// Pacotes
// ---------------------------------------------------------------------------

function sortedUnits(codes: readonly string[]): string[] {
  return [...new Set(codes)].sort(compareCodes);
}

async function assertUniquePackageName(name: string, exceptId: string | null): Promise<void> {
  const key = normalizeSearch(name);
  const clash = (await listProductPackages()).find((p) => p.id !== exceptId && normalizeSearch(p.name) === key);
  if (clash) throw new BusinessError(`Já existe o pacote "${clash.name}". Use outro nome ou crie uma versão nova dele.`);
}

function checkUnits(codes: readonly string[], units: ReadonlyMap<string, QuoteUnit>, modules: ReadonlyMap<string, CommercialModule>): string[] {
  const { errors, warnings } = packageUnitProblems(codes, units, modules);
  if (errors.length) throw new BusinessError(errors.join(" "));
  return warnings;
}

export async function createProductPackage(input: z.output<typeof createPackageSchema>, actor: ProductActor, units: ReadonlyMap<string, QuoteUnit>, modules: ReadonlyMap<string, CommercialModule>): Promise<{ id: string; warnings: string[] }> {
  const codes = sortedUnits(input.units);
  const warnings = checkUnits(codes, units, modules);
  await assertUniquePackageName(input.name, null);
  const today = todayKey();
  const now = nowIso();
  const id = newId(COLLECTIONS.productPackages);
  let created: PackageDoc | null = null;
  await inTransaction(async (tx) => {
    if (await readPackage(tx, id)) throw new BusinessError("Tente de novo.");
    const { versions } = appendVersion<PackageVersion>([], { units: codes, monthly: input.monthly, setup: input.setup, validFrom: input.validFrom, reason: input.reason, createdAt: now, createdBy: actorRef(actor) }, today);
    const doc: PackageDoc = { id, organizationId: ORG_ID, name: input.name, segment: input.segment, description: input.description, status: "rascunho", basedOn: input.basedOn, versions, createdAt: now, updatedAt: now, updatedBy: actorRef(actor) };
    tx.set(packageRef(id), stripUndefined({ ...doc, id: undefined }));
    created = doc;
  });
  const doc = created as PackageDoc | null;
  if (!doc) throw new BusinessError("Não foi possível criar o pacote.");
  await safeEmit({
    type: "product_package.created",
    actor: actorRef(actor),
    entity: { type: "product_package", id },
    title: `Pacote criado: ${doc.name}`,
    description: `${codes.length} módulos · ${brl(input.monthly)}/mês${input.setup > 0 ? ` · implantação ${brl(input.setup)}` : ""} a partir de ${formatDateKey(input.validFrom)}`,
    department: eventDepartment(actor),
    payload: { packageId: id, units: codes, monthly: input.monthly, setup: input.setup, validFrom: input.validFrom, basedOn: input.basedOn, reason: input.reason },
  });
  return { id, warnings };
}

export async function updateProductPackage(input: z.output<typeof updatePackageSchema>, actor: ProductActor, units: ReadonlyMap<string, QuoteUnit>): Promise<void> {
  await assertUniquePackageName(input.name, input.id);
  const today = todayKey();
  const now = nowIso();
  let result: { before: PackageDoc; after: PackageDoc } | null = null;
  await inTransaction(async (tx) => {
    const doc = await readPackage(tx, input.id);
    if (!doc) throw new BusinessError("Pacote não encontrado.");
    if (input.status === "a_venda") {
      const active = doc.versions.filter((v) => !v.cancelledAt);
      const current = versionAt(doc.versions, today) ?? active.sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0] ?? null;
      if (!current) throw new BusinessError("Para colocar à venda, o pacote precisa de uma versão vigente ou agendada.");
      const missing = current.units.filter((c) => !units.has(c));
      if (missing.length) throw new BusinessError(`A versão ${current.version} inclui códigos fora do catálogo do ERP (${missing.join(", ")}): crie uma versão nova sem eles.`);
    }
    const after: PackageDoc = { ...doc, name: input.name, segment: input.segment, description: input.description, status: input.status, updatedAt: now, updatedBy: actorRef(actor) };
    if (doc.name === after.name && doc.segment === after.segment && doc.description === after.description && doc.status === after.status) return;
    tx.set(packageRef(input.id), stripUndefined({ ...after, id: undefined }));
    result = { before: doc, after };
  });
  const r = result as { before: PackageDoc; after: PackageDoc } | null;
  if (!r) return;
  const changes: Record<string, { from: string; to: string }> = {};
  if (r.before.name !== r.after.name) changes.Nome = { from: r.before.name, to: r.after.name };
  if (r.before.segment !== r.after.segment) changes.Segmento = { from: COMMERCIAL_SEGMENT_LABELS[r.before.segment], to: COMMERCIAL_SEGMENT_LABELS[r.after.segment] };
  if (r.before.status !== r.after.status) changes["Situação"] = { from: PACKAGE_STATUS_LABELS[r.before.status], to: PACKAGE_STATUS_LABELS[r.after.status] };
  if (r.before.description !== r.after.description) changes["Descrição"] = { from: r.before.description ? "anterior" : "—", to: r.after.description ? "alterada" : "—" };
  await safeEmit({
    type: "product_package.updated",
    actor: actorRef(actor),
    entity: { type: "product_package", id: r.after.id },
    title: `Pacote alterado: ${r.after.name}`,
    description: describeChanges(changes),
    department: eventDepartment(actor),
    payload: { packageId: r.after.id, changes },
  });
}

export async function addProductPackageVersion(input: z.output<typeof packageVersionSchema>, actor: ProductActor, units: ReadonlyMap<string, QuoteUnit>, modules: ReadonlyMap<string, CommercialModule>): Promise<{ version: number; warnings: string[] }> {
  const codes = sortedUnits(input.units);
  const warnings = checkUnits(codes, units, modules);
  const today = todayKey();
  const now = nowIso();
  let result: { doc: PackageDoc; created: PackageVersion; previous: PackageVersion | null } | null = null;
  await inTransaction(async (tx) => {
    const doc = await readPackage(tx, input.id);
    if (!doc) throw new BusinessError("Pacote não encontrado.");
    const previous = versionAt(doc.versions, input.validFrom);
    const { versions, created } = appendVersion<PackageVersion>(doc.versions, { units: codes, monthly: input.monthly, setup: input.setup, validFrom: input.validFrom, reason: input.reason, createdAt: now, createdBy: actorRef(actor) }, today);
    const next: PackageDoc = { ...doc, versions, updatedAt: now, updatedBy: actorRef(actor) };
    tx.set(packageRef(input.id), stripUndefined({ ...next, id: undefined }));
    result = { doc: next, created, previous };
  });
  const r = result as { doc: PackageDoc; created: PackageVersion; previous: PackageVersion | null } | null;
  if (!r) throw new BusinessError("Não foi possível gravar a versão.");
  const prevUnits = new Set(r.previous?.units ?? []);
  const added = codes.filter((c) => !prevUnits.has(c));
  const removed = [...prevUnits].filter((c) => !codes.includes(c)).sort(compareCodes);
  const changes: Record<string, { from: string; to: string }> = {};
  if (added.length || removed.length) changes["Módulos"] = { from: `${prevUnits.size} módulos`, to: `${codes.length} módulos (${[added.length ? `+${added.join(", +")}` : "", removed.length ? `−${removed.join(", −")}` : ""].filter(Boolean).join("; ")})` };
  if (!r.previous || r.previous.monthly !== r.created.monthly) changes["Mensalidade"] = { from: r.previous ? brl(r.previous.monthly) : "—", to: brl(r.created.monthly) };
  if (!r.previous || r.previous.setup !== r.created.setup) changes["Implantação"] = { from: r.previous ? brl(r.previous.setup) : "—", to: brl(r.created.setup) };
  changes["Início da vigência"] = { from: r.previous ? formatDateKey(r.previous.validFrom) : "—", to: formatDateKey(r.created.validFrom) };
  await safeEmit({
    type: "product_package.version_created",
    actor: actorRef(actor),
    entity: { type: "product_package", id: r.doc.id },
    title: `Pacote ${r.doc.name}: versão ${r.created.version}`,
    description: `${codes.length} módulos · ${brl(r.created.monthly)}/mês a partir de ${formatDateKey(r.created.validFrom)} · ${r.created.reason}`,
    department: eventDepartment(actor),
    payload: { packageId: r.doc.id, version: r.created.version, units: codes, monthly: r.created.monthly, setup: r.created.setup, validFrom: r.created.validFrom, reason: r.created.reason, changes },
  });
  return { version: r.created.version, warnings };
}

export async function cancelProductPackageVersion(input: z.output<typeof cancelPackageVersionSchema>, actor: ProductActor): Promise<void> {
  const today = todayKey();
  const now = nowIso();
  let result: { doc: PackageDoc; cancelled: PackageVersion } | null = null;
  await inTransaction(async (tx) => {
    const doc = await readPackage(tx, input.id);
    if (!doc) throw new BusinessError("Pacote não encontrado.");
    const { versions, cancelled } = cancelVersion<PackageVersion>(doc.versions, input.version, today, actorRef(actor), input.reason, now);
    if (doc.status === "a_venda" && !versions.some((v) => !v.cancelledAt)) {
      throw new BusinessError("Este pacote está à venda e esta é a única versão: crie outra versão antes ou mude a situação do pacote.");
    }
    const next: PackageDoc = { ...doc, versions, updatedAt: now, updatedBy: actorRef(actor) };
    tx.set(packageRef(input.id), stripUndefined({ ...next, id: undefined }));
    result = { doc: next, cancelled };
  });
  const r = result as { doc: PackageDoc; cancelled: PackageVersion } | null;
  if (!r) return;
  await safeEmit({
    type: "product_package.version_cancelled",
    actor: actorRef(actor),
    entity: { type: "product_package", id: r.doc.id },
    title: `Pacote ${r.doc.name}: versão ${r.cancelled.version} cancelada`,
    description: `${brl(r.cancelled.monthly)}/mês a partir de ${formatDateKey(r.cancelled.validFrom)} · ${input.reason}`,
    department: eventDepartment(actor),
    payload: { packageId: r.doc.id, version: r.cancelled.version, reason: input.reason },
  });
}

// ---------------------------------------------------------------------------
// Detalhe de uma unidade no catálogo
// ---------------------------------------------------------------------------

export interface UnitDetail {
  code: string;
  name: string;
  description: string | null;
  notes: string | null;
  devStatus: string;
  /** Itens que a unidade carrega (submódulos e recursos incluídos, inclusive em cadeia). */
  includes: { code: string; name: string; level: string; devStatus: string }[];
  requires: { code: string; name: string }[];
  dependents: { code: string; name: string }[];
}

export function unitDetail(index: ErpCatalogIndex, code: string): UnitDetail | null {
  const item = index.byCode.get(code);
  if (!item?.unit) return null;
  const nameOf = (c: string) => index.byCode.get(c)?.name ?? c;
  const includes = index.catalog.items
    .filter((i) => i.code !== code && index.ownerUnitOf(i.code) === code)
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((i) => ({ code: i.code, name: i.name, level: i.level, devStatus: i.devStatus }));
  return {
    code,
    name: item.name,
    description: item.description,
    notes: item.notes,
    devStatus: item.devStatus,
    includes,
    requires: [...index.requiredUnitsOf(code)].sort(compareCodes).map((c) => ({ code: c, name: nameOf(c) })),
    dependents: [...index.dependentUnitsOf(code)].sort(compareCodes).map((c) => ({ code: c, name: nameOf(c) })),
  };
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

function describeChanges(changes: Record<string, { from: string; to: string }>): string {
  const text = Object.entries(changes)
    .map(([k, v]) => `${k}: ${v.from} → ${v.to}`)
    .join(" · ");
  return text || "Sem alterações relevantes";
}

/** A gravação já aconteceu: falha ao registrar o evento vai para o log, sem desfazer nem mascarar a operação. */
async function safeEmit(input: Parameters<typeof emitEvent>[0]): Promise<void> {
  try {
    await emitEvent(input);
  } catch (error) {
    console.error("[produtos] alteração sem registro na auditoria", error);
  }
}
