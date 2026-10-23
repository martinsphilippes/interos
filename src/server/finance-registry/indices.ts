import "server-only";
/**
 * Cadastro «Índices de reajuste» (Financeiro › Cadastros financeiros › Índices). Cada índice guarda a variação mensal
 * de cada mês (`values`, AAAA-MM → %), buscada sozinha na fonte oficial (Banco Central/SGS ou planilha do ICTI no
 * IPEA) pela varredura diária `indices_reajuste` ou pelo botão «Atualizar agora». O acumulado de 12 meses e a prévia
 * de cada contrato são CALCULADOS na leitura: um mês novo atualiza na hora todos os contratos indexados.
 *
 * Os 5 índices padrão (IPCA, IGP-M, INPC, IGP-DI, ICTI) são criados na primeira leitura (ids fixos: os contratos
 * guardam o id). Nada é excluído: desativar só some das listas de escolha e exige que nenhum contrato ativo use o
 * índice. Valor oficial sempre vence: o lançamento manual só preenche mês que a fonte ainda não trouxe (ou índice
 * manual). Toda mudança gera evento de auditoria (`payload.changes` de → para).
 */
import { col, createIfAbsent, getById, list, nowIso } from "@/server/db";
import { docdb, FieldValue } from "@/server/docdb";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { auditChanges, describeChanges } from "@/server/audit";
import { BusinessError } from "@/server/auth/error-classes";
import { getDepartmentManager } from "@/server/workflow/service";
import { dateKey } from "@/lib/format";
import {
  addCompetence,
  competenceLabel,
  DEFAULT_READJUSTMENT_INDICES,
  describeIndexSource,
  formatPct,
  indexHint,
  isCompetence,
  latestCompetence,
  sourceLagMonths,
  summarizeIndex,
  type ReadjustmentIndexOption,
} from "@/domain/readjustment";
import { AMENDMENT_OPEN_STATUSES } from "@/domain/contract-snapshot";
import { COLLECTIONS, type Contract, type ContractAmendment, type ContractReadjustment, type ReadjustmentIndex, type ReadjustmentIndexMonth, type ReadjustmentIndexSource, type UserRef } from "@/domain/types";
import { fetchIctiMonthly, fetchSgsMonthly, IndexSourceError } from "@/server/integrations/indices";

const SYSTEM: UserRef = { id: "system", name: "INTEROS (automação)" };
/** Busca de novo mesmo «em dia» depois de N dias (pega revisões da fonte). */
const REFETCH_AFTER_DAYS = 7;
/** Aviso ao Financeiro quando a busca falha há N dias. */
const FAILURE_NOTICE_DAYS = 3;
/** Tempo máximo de cada fonte na varredura (todas em paralelo). */
const SOURCE_DEADLINE_MS = 15_000;
/** Meses buscados no Banco Central a cada vez (2 anos: cobre o acumulado e revisões). */
const SGS_WINDOW_MONTHS = 24;

const ORDER = new Map(DEFAULT_READJUSTMENT_INDICES.map((d, i) => [d.id, i]));
const byOrder = (a: ReadjustmentIndex, b: ReadjustmentIndex) => (ORDER.get(a.id) ?? 99) - (ORDER.get(b.id) ?? 99) || a.name.localeCompare(b.name, "pt-BR");

const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

/** Todos os índices (os padrão são criados na primeira leitura), na ordem: padrão e depois por nome. */
export async function listReadjustmentIndices(): Promise<ReadjustmentIndex[]> {
  const rows = await list<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices);
  for (const d of DEFAULT_READJUSTMENT_INDICES) {
    if (rows.some((r) => r.id === d.id)) continue;
    const r = await createIfAbsent<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, d.id, { name: d.name, description: d.description, source: d.source, negativePolicy: "manter", values: {}, builtIn: true, archived: false, createdBy: SYSTEM.id });
    rows.push(r.doc);
  }
  return rows.map((r) => ({ ...r, values: r.values ?? {} })).sort(byOrder);
}

export async function getReadjustmentIndexMap(): Promise<Map<string, ReadjustmentIndex>> {
  return new Map((await listReadjustmentIndices()).map((i) => [i.id, i]));
}

/** Opções para as listas de escolha: ativos + o desativado que o registro atual já usa. */
export async function listReadjustmentIndexOptions(): Promise<ReadjustmentIndexOption[]> {
  return (await listReadjustmentIndices()).map((i) => ({ id: i.id, name: i.name, ...(i.archived ? { archived: true } : {}), ...(indexHint(i.values) ? { hint: indexHint(i.values) } : {}) }));
}

/** Contratos (não cancelados) que usam cada índice. */
export async function countIndexedContracts(): Promise<Map<string, Contract[]>> {
  const contracts = await list<Contract>(COLLECTIONS.contracts, { where: [["readjustment.type", "==", "indice"]] });
  const out = new Map<string, Contract[]>();
  for (const c of contracts) {
    if (c.status === "cancelado" || !c.readjustment?.index) continue;
    out.set(c.readjustment.index, [...(out.get(c.readjustment.index) ?? []), c]);
  }
  return out;
}

/**
 * Confere o reajuste escolhido numa tela (venda, condições, aditivo, renovação) e devolve o que gravar: índice precisa
 * existir e estar ativo — exceto quando é o mesmo que o registro já usa (`current`), para não travar a edição de outros
 * campos — e leva o nome do índice (`indexName`), que o documento e o portal mostram.
 */
export async function normalizeReadjustment<T extends ContractReadjustment | undefined>(r: T, current?: ContractReadjustment): Promise<T> {
  if (!r || r.type !== "indice") return r;
  if (!r.index) throw new BusinessError("Escolha o índice do reajuste");
  const index = (await getReadjustmentIndexMap()).get(r.index);
  if (!index) throw new BusinessError("Índice de reajuste não encontrado no cadastro");
  if (index.archived && current?.index !== r.index) throw new BusinessError(`O índice ${index.name} está desativado no cadastro de índices`);
  return { ...r, indexName: index.name } as T;
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export interface ReadjustmentIndexInput {
  id?: string;
  name: string;
  description?: string;
  sourceKind: ReadjustmentIndexSource["kind"];
  seriesCode?: number;
  negativePolicy: ReadjustmentIndex["negativePolicy"];
}

const NEGATIVE_LABELS: Record<ReadjustmentIndex["negativePolicy"], string> = { manter: "manter o valor", reduzir: "reduzir o valor" };

function indexView(i: Partial<ReadjustmentIndex>) {
  return { name: i.name, description: i.description, source: i.source ? describeIndexSource(i.source) : undefined, negativePolicy: i.negativePolicy ? NEGATIVE_LABELS[i.negativePolicy] : undefined, archived: i.archived };
}
const INDEX_FIELDS = ["name", "description", "source", "negativePolicy", "archived"] as const;
const INDEX_LABELS: Record<string, string> = { name: "Nome", description: "Descrição", source: "Fonte", negativePolicy: "Acumulado negativo", archived: "Desativado" };
const describeIndexAudit = (audit: ReturnType<typeof auditChanges>) => describeChanges(audit, INDEX_LABELS, (_f, v) => (v === null ? "—" : typeof v === "boolean" ? (v ? "sim" : "não") : String(v))) || undefined;

function sourceOf(input: ReadjustmentIndexInput): ReadjustmentIndexSource {
  if (input.sourceKind === "bcb_sgs") {
    if (!input.seriesCode || !Number.isInteger(input.seriesCode) || input.seriesCode <= 0) throw new BusinessError("Informe o código da série no Banco Central (SGS)");
    return { kind: "bcb_sgs", seriesCode: input.seriesCode };
  }
  if (input.sourceKind === "ipea_icti") return { kind: "ipea_icti" };
  return { kind: "manual" };
}

const sameSource = (a: ReadjustmentIndexSource, b: ReadjustmentIndexSource) => a.kind === b.kind && (a.kind !== "bcb_sgs" || (b.kind === "bcb_sgs" && a.seriesCode === b.seriesCode));

function slugId(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "indice";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export async function saveReadjustmentIndex(input: ReadjustmentIndexInput, actor: UserRef): Promise<{ index: ReadjustmentIndex; created: boolean; refresh?: IndexRefreshItem }> {
  const all = await listReadjustmentIndices();
  const name = input.name.trim().replace(/\s+/g, " ");
  const dup = all.find((i) => !i.archived && i.id !== input.id && nameKey(i.name) === nameKey(name));
  if (dup) throw new BusinessError(`Já existe o índice "${dup.name}"`);
  const description = input.description?.trim() || undefined;
  if (input.id) {
    const current = all.find((i) => i.id === input.id);
    if (!current) throw new BusinessError("Índice não encontrado");
    // Índice padrão não troca de fonte (os contratos dependem dela); o ICTI só existe como padrão.
    const source = current.builtIn ? current.source : sourceOf(input);
    if (!current.builtIn && source.kind === "ipea_icti") throw new BusinessError("A planilha do ICTI só serve para o índice ICTI padrão");
    const changedSource = !sameSource(current.source, source);
    const next: ReadjustmentIndex = { ...current, name, description, source, negativePolicy: input.negativePolicy };
    const audit = auditChanges(indexView(current), indexView(next), INDEX_FIELDS);
    if (Object.keys(audit.changes).length === 0) return { index: current, created: false };
    const ref = col(COLLECTIONS.readjustmentIndices).doc(current.id);
    await docdb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const doc = snap.data() as Omit<ReadjustmentIndex, "id"> | undefined;
      if (!doc) throw new BusinessError("Índice não encontrado");
      const patch: Record<string, unknown> = { name, description: description ?? FieldValue.delete(), source, negativePolicy: input.negativePolicy, updatedBy: actor.id, updatedAt: nowIso() };
      // Fonte nova: os meses da fonte antiga deixam de valer (os lançados à mão ficam); a próxima busca traz os novos.
      // Lidos na transação: um mês gravado por uma busca em andamento também sai.
      if (changedSource) {
        for (const [k, v] of Object.entries(doc.values ?? {})) if (v.source !== "manual") patch[`values.${k}`] = FieldValue.delete();
        patch.lastFetchAt = FieldValue.delete();
        patch.lastFetchOk = FieldValue.delete();
        patch.lastFetchError = FieldValue.delete();
        patch.failingSince = FieldValue.delete();
      }
      tx.update(ref, patch);
    });
    await emitEvent({ type: "readjustment_index.updated", actor, entity: { type: "readjustment_index", id: current.id }, title: `Índice ${name} alterado`, description: describeIndexAudit(audit), department: "financeiro", payload: { indexId: current.id, ...audit }, timeline: false });
    const saved = (await getById<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, current.id)) ?? next;
    const refresh = changedSource && source.kind !== "manual" ? (await refreshReadjustmentIndices({ force: true, ids: [current.id], actor })).items[0] : undefined;
    return { index: saved, created: false, refresh };
  }
  const source = sourceOf(input);
  if (source.kind === "ipea_icti") throw new BusinessError("A planilha do ICTI só serve para o índice ICTI padrão");
  if (source.kind === "bcb_sgs") {
    const same = all.find((i) => !i.archived && i.source.kind === "bcb_sgs" && i.source.seriesCode === source.seriesCode);
    if (same) throw new BusinessError(`A série ${source.seriesCode} já é o índice ${same.name}`);
  }
  const id = slugId(name, new Set(all.map((i) => i.id)));
  const r = await createIfAbsent<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, id, { name, description, source, negativePolicy: input.negativePolicy, values: {}, archived: false, createdBy: actor.id, updatedBy: actor.id });
  if (!r.created) throw new BusinessError("Não foi possível cadastrar o índice; tente de novo");
  await emitEvent({ type: "readjustment_index.created", actor, entity: { type: "readjustment_index", id }, title: `Índice ${name} cadastrado`, description: describeIndexSource(source), department: "financeiro", payload: { indexId: id, ...auditChanges(null, indexView(r.doc), INDEX_FIELDS) }, timeline: false });
  // Busca na hora (melhor esforço): o Financeiro já vê os meses ou o erro da série.
  const refresh = source.kind !== "manual" ? (await refreshReadjustmentIndices({ force: true, ids: [id], actor })).items[0] : undefined;
  return { index: (await getById<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, id)) ?? r.doc, created: true, refresh };
}

export async function setReadjustmentIndexArchived(id: string, archived: boolean, reason: string | undefined, actor: UserRef): Promise<ReadjustmentIndex> {
  const all = await listReadjustmentIndices();
  const current = all.find((i) => i.id === id);
  if (!current) throw new BusinessError("Índice não encontrado");
  if (Boolean(current.archived) === archived) return current;
  if (archived) {
    const using = (await countIndexedContracts()).get(id) ?? [];
    // Só a contagem: os números dos contratos podem estar fora do escopo de quem desativa.
    if (using.length > 0) throw new BusinessError(`O ${current.name} está em ${using.length} contrato(s) ativo(s): troque o índice desses contratos (aba Índices › Ver meses lista os que você vê) antes de desativar`);
    // Aditivo em andamento que passa um contrato para este índice também segura a desativação.
    const open = (await list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["status", "in", [...AMENDMENT_OPEN_STATUSES]]] })).filter((a) => a.after?.readjustment?.index === id || a.readjustment?.index === id);
    if (open.length > 0) throw new BusinessError(`O ${current.name} está em ${open.length} aditivo(s) em andamento: aplique ou cancele antes de desativar`);
  } else {
    const dup = all.find((i) => !i.archived && i.id !== id && nameKey(i.name) === nameKey(current.name));
    if (dup) throw new BusinessError(`Já existe um índice ativo com o nome "${dup.name}"`);
  }
  const patch = archived ? { archived: true, archivedAt: nowIso(), archivedBy: actor.id, archiveReason: reason?.trim(), updatedBy: actor.id } : { archived: false, updatedBy: actor.id };
  await col(COLLECTIONS.readjustmentIndices)
    .doc(id)
    .update({ ...patch, ...(archived ? {} : { archivedAt: FieldValue.delete(), archivedBy: FieldValue.delete(), archiveReason: FieldValue.delete() }), updatedAt: nowIso() });
  const next = { ...current, ...patch };
  await emitEvent({
    type: archived ? "readjustment_index.archived" : "readjustment_index.reactivated",
    actor,
    entity: { type: "readjustment_index", id },
    title: `Índice ${current.name} ${archived ? "desativado" : "reativado"}`,
    description: reason?.trim() || undefined,
    department: "financeiro",
    payload: { indexId: id, ...auditChanges(indexView(current), indexView(next), ["archived"], reason) },
    timeline: false,
  });
  return next;
}

/**
 * Lança (ou corrige) a variação de um mês à mão. Índice manual: qualquer mês até o atual (null apaga). Índice com
 * fonte automática: só mês que a fonte ainda não trouxe — o valor oficial substitui o manual quando sair.
 */
export async function setReadjustmentIndexValue(input: { indexId: string; competence: string; pct: number | null; reason?: string }, actor: UserRef): Promise<ReadjustmentIndex> {
  if (!isCompetence(input.competence)) throw new BusinessError("Mês inválido");
  const currentMonth = dateKey(new Date()).slice(0, 7);
  if (input.competence > currentMonth) throw new BusinessError("Não dá para lançar um mês que ainda não chegou");
  if (input.pct !== null && (!Number.isFinite(input.pct) || Math.abs(input.pct) > 50)) throw new BusinessError("Variação fora do esperado (entre -50% e 50%)");
  const ref = col(COLLECTIONS.readjustmentIndices).doc(input.indexId);
  const { before, after, index } = await docdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new BusinessError("Índice não encontrado");
    const index = { ...(snap.data() as Omit<ReadjustmentIndex, "id">), id: input.indexId } as ReadjustmentIndex;
    if (index.archived) throw new BusinessError("Reative o índice antes de lançar valores");
    const existing = index.values?.[input.competence];
    if (index.source.kind !== "manual" && existing && existing.source !== "manual") throw new BusinessError(`O ${competenceLabel(input.competence)} do ${index.name} já veio da fonte oficial (${formatPct(existing.pct)}) e não pode ser trocado à mão`);
    if (input.pct === null) {
      if (!existing) throw new BusinessError("Esse mês não tem valor para apagar");
      tx.update(ref, { [`values.${input.competence}`]: FieldValue.delete(), updatedBy: actor.id, updatedAt: nowIso() });
      return { before: existing.pct, after: null, index };
    }
    const value: ReadjustmentIndexMonth = { pct: Math.round(input.pct * 1e6) / 1e6, source: "manual", at: nowIso(), by: actor.id };
    tx.update(ref, { [`values.${input.competence}`]: value, updatedBy: actor.id, updatedAt: nowIso() });
    return { before: existing?.pct ?? null, after: value.pct, index };
  });
  const field = `Variação de ${competenceLabel(input.competence)}`;
  await emitEvent({
    type: "readjustment_index.value_set",
    actor,
    entity: { type: "readjustment_index", id: index.id },
    title: `${index.name}: ${competenceLabel(input.competence)} ${after === null ? "apagado" : `lançado à mão (${formatPct(after)})`}`,
    description: input.reason?.trim() || undefined,
    department: "financeiro",
    payload: { indexId: index.id, competence: input.competence, changes: { [field]: { from: before === null ? null : formatPct(before), to: after === null ? null : formatPct(after) } }, ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}) },
    timeline: false,
  });
  return (await getById<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, index.id)) ?? index;
}

// ---------------------------------------------------------------------------
// Atualização automática (varredura diária e botão «Atualizar agora»)
// ---------------------------------------------------------------------------

export interface IndexRefreshItem {
  id: string;
  name: string;
  status: "atualizado" | "sem_novidade" | "em_dia" | "manual" | "erro";
  /** Meses novos (AAAA-MM). */
  newMonths: string[];
  /** Meses que a fonte revisou (ou que substituíram lançamento manual). */
  revisedMonths: string[];
  /** Meses lançados à mão que a fonte oficial substituiu por outro valor. */
  replacedManual: { competence: string; manual: number; official: number }[];
  error?: string;
}

/** A fonte pode ter mês novo? (último mês < esperado pela defasagem, ou última busca há mais de 7 dias). */
export function indexNeedsFetch(index: Pick<ReadjustmentIndex, "source" | "values" | "lastFetchAt" | "lastFetchOk">, now: Date): boolean {
  if (index.source.kind === "manual") return false;
  if (!index.lastFetchAt || index.lastFetchOk === false) return true;
  const expected = addCompetence(dateKey(now).slice(0, 7), -sourceLagMonths(index.source));
  const latest = latestCompetence(Object.fromEntries(Object.entries(index.values ?? {}).filter(([, v]) => v.source !== "manual")));
  if (!latest || latest < expected) return true;
  return now.getTime() - Date.parse(index.lastFetchAt) > REFETCH_AFTER_DAYS * 86_400_000;
}

async function fetchSource(index: ReadjustmentIndex, now: Date): Promise<Record<string, number>> {
  const work = (async () => {
    if (index.source.kind === "bcb_sgs") {
      const to = dateKey(now).slice(0, 7);
      return fetchSgsMonthly(index.source.seriesCode, addCompetence(to, -SGS_WINDOW_MONTHS), to);
    }
    if (index.source.kind === "ipea_icti") return (await fetchIctiMonthly()).values;
    return {};
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IndexSourceError("a fonte demorou demais para responder")), SOURCE_DEADLINE_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const sourceName = (s: ReadjustmentIndexSource) => (s.kind === "bcb_sgs" ? "Banco Central" : s.kind === "ipea_icti" ? "IPEA" : "fonte");

async function markFetchError(index: ReadjustmentIndex, stamp: string, message: string): Promise<IndexRefreshItem> {
  await col(COLLECTIONS.readjustmentIndices)
    .doc(index.id)
    .update({ lastFetchAt: stamp, lastFetchOk: false, lastFetchError: message.slice(0, 300), failingSince: index.failingSince ?? stamp, updatedAt: nowIso() });
  return { id: index.id, name: index.name, status: "erro", newMonths: [], revisedMonths: [], replacedManual: [], error: message };
}

async function refreshOne(index: ReadjustmentIndex, now: Date, force: boolean): Promise<IndexRefreshItem> {
  const base: IndexRefreshItem = { id: index.id, name: index.name, status: "em_dia", newMonths: [], revisedMonths: [], replacedManual: [] };
  if (index.source.kind === "manual") return { ...base, status: "manual" };
  if (!force && !indexNeedsFetch(index, now)) return base;
  const ref = col(COLLECTIONS.readjustmentIndices).doc(index.id);
  const stamp = now.toISOString();
  let fetched: Record<string, number>;
  try {
    fetched = await fetchSource(index, now);
  } catch (error) {
    const message = `${sourceName(index.source)}: ${error instanceof Error ? error.message : String(error)}${index.source.kind === "bcb_sgs" && /tempo|demorou/.test(String((error as Error)?.message)) ? " (confira o código da série)" : ""}`;
    return markFetchError(index, stamp, message);
  }
  // Série mensal válida sempre tem valores numa janela de 2 anos: vazio = código errado ou série parada.
  if (Object.keys(fetched).length === 0) return markFetchError(index, stamp, `${sourceName(index.source)}: a série não tem valores nos últimos ${SGS_WINDOW_MONTHS} meses (confira o código da série)`);
  const kind = index.source.kind;
  const result = await docdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = snap.data() as Omit<ReadjustmentIndex, "id"> | undefined;
    // A fonte mudou enquanto a busca rodava (alguém trocou a série): descarta o resultado da fonte antiga.
    if (!doc || !sameSource(doc.source, index.source)) return null;
    const current = doc.values ?? {};
    const patch: Record<string, unknown> = { lastFetchAt: stamp, lastFetchOk: true, lastFetchError: FieldValue.delete(), failingSince: FieldValue.delete(), updatedAt: nowIso() };
    const newMonths: string[] = [];
    const revisedMonths: string[] = [];
    const replacedManual: IndexRefreshItem["replacedManual"] = [];
    for (const [competence, pct] of Object.entries(fetched)) {
      if (!isCompetence(competence) || !Number.isFinite(pct)) continue;
      const existing = current[competence];
      if (existing && existing.source === kind && Math.abs(existing.pct - pct) < 1e-9) continue;
      if (existing) {
        revisedMonths.push(competence);
        if (existing.source === "manual" && Math.abs(existing.pct - pct) >= 0.005) replacedManual.push({ competence, manual: existing.pct, official: pct });
      } else newMonths.push(competence);
      patch[`values.${competence}`] = { pct, source: kind, at: stamp } satisfies ReadjustmentIndexMonth;
    }
    tx.update(ref, patch);
    return { newMonths: newMonths.sort(), revisedMonths: revisedMonths.sort(), replacedManual };
  });
  if (!result) return { ...base, status: "sem_novidade" };
  return { ...base, status: result.newMonths.length || result.revisedMonths.length ? "atualizado" : "sem_novidade", newMonths: result.newMonths, revisedMonths: result.revisedMonths, replacedManual: result.replacedManual };
}

export interface IndexRefreshResult {
  items: IndexRefreshItem[];
  updated: number;
  errors: number;
}

/**
 * Busca os índices ativos nas fontes (em paralelo, cada um com tempo-limite). Sem `force`, só os que podem ter mês
 * novo. Mês novo → evento de auditoria e aviso ao gestor do Financeiro (se algum contrato usa o índice); busca
 * falhando há 3 dias → aviso único.
 */
export async function refreshReadjustmentIndices(options: { now?: Date; force?: boolean; ids?: string[]; actor?: UserRef } = {}): Promise<IndexRefreshResult> {
  const now = options.now ?? new Date();
  const actor = options.actor ?? SYSTEM;
  const indices = (await listReadjustmentIndices()).filter((i) => !i.archived && (!options.ids || options.ids.includes(i.id)));
  // Um índice que falha (rede, banco) não derruba os outros: vira «erro» só dele.
  const items = await Promise.all(
    indices.map((i) =>
      refreshOne(i, now, options.force === true).catch((error): IndexRefreshItem => ({ id: i.id, name: i.name, status: "erro", newMonths: [], revisedMonths: [], replacedManual: [], error: error instanceof Error ? error.message : String(error) })),
    ),
  );
  const changed = items.filter((i) => i.status === "atualizado");
  const failing = items.filter((i) => i.status === "erro");
  if (changed.length > 0 || failing.length > 0) {
    const [fresh, using, manager] = await Promise.all([getReadjustmentIndexMap(), countIndexedContracts(), getDepartmentManager("financeiro")]);
    for (const item of changed) {
      const index = fresh.get(item.id);
      if (!index) continue;
      const summary = summarizeIndex(index.values);
      const contracts = (using.get(item.id) ?? []).length;
      const acc = summary.accumulated12m;
      const months = [...item.newMonths, ...item.revisedMonths.map((m) => `${m} (revisado)`)];
      await emitEvent({
        type: "readjustment_index.values_updated",
        actor,
        entity: { type: "readjustment_index", id: item.id },
        title: `${index.name}: ${item.newMonths.length ? `${item.newMonths.length} mês(es) novo(s)` : "meses revisados"} (${describeIndexSource(index.source)})`,
        description: [summary.latest ? `último mês ${competenceLabel(summary.latest.competence)}: ${formatPct(summary.latest.pct)}` : null, acc ? `acumulado de ${competenceLabel(acc.from)} a ${competenceLabel(acc.to)}: ${formatPct(acc.pct)}` : null, `${contracts} contrato(s) indexado(s) com a prévia atualizada`].filter(Boolean).join(" · "),
        department: "financeiro",
        payload: { indexId: item.id, newMonths: item.newMonths, revisedMonths: item.revisedMonths, months, latest: summary.latest, accumulated12m: acc, contracts },
        timeline: false,
      });
      // «Último mês» do aviso = o último OFICIAL (um mês lançado à mão mais novo não esconde a publicação).
      const official = summarizeIndex(Object.fromEntries(Object.entries(index.values).filter(([, v]) => v.source !== "manual")));
      const latest = official.latest?.competence;
      if (manager && contracts > 0 && item.replacedManual.length > 0) {
        await notify({
          userIds: [manager.id],
          kind: "atencao",
          key: `indice_manual_${item.id}_${item.replacedManual.map((r) => r.competence).join("_")}`,
          title: `${index.name}: valor oficial diferente do lançado à mão`,
          body: `${item.replacedManual.map((r) => `${competenceLabel(r.competence)}: lançado ${formatPct(r.manual)}, oficial ${formatPct(r.official)}`).join(" · ")}. Reajustes já aplicados com o valor lançado não mudam sozinhos: confira os contratos que usam o ${index.name}.`,
          href: `/financeiro/cadastros?aba=indices&item=${item.id}`,
          entity: { type: "readjustment_index", id: item.id },
        });
      }
      if (manager && contracts > 0 && latest && item.newMonths.includes(latest)) {
        await notify({
          userIds: [manager.id],
          kind: "informativa",
          key: `indice_${item.id}_${latest}`,
          title: `${index.name} de ${competenceLabel(latest)} publicado: ${formatPct(official.latest!.pct)}${official.accumulated12m ? ` · 12 meses: ${formatPct(official.accumulated12m.pct)}` : ""}`,
          body: `${contracts} contrato(s) usam o ${index.name}: a prévia do próximo reajuste de cada um já usa o valor novo. O reajuste entra sozinho na data-base de cada contrato.`,
          href: `/financeiro/cadastros?aba=indices&item=${item.id}`,
          entity: { type: "readjustment_index", id: item.id },
        });
      }
    }
    for (const item of failing) {
      const index = fresh.get(item.id);
      if (!index?.failingSince || !manager) continue;
      if (now.getTime() - Date.parse(index.failingSince) < FAILURE_NOTICE_DAYS * 86_400_000) continue;
      if (((using.get(item.id) ?? []).length ?? 0) === 0) continue;
      await notify({
        userIds: [manager.id],
        kind: "atencao",
        key: `indice_falha_${item.id}_${dateKey(index.failingSince)}`,
        title: `Não consigo buscar o ${index.name} desde ${dateKey(index.failingSince).split("-").reverse().join("/")}`,
        body: `${item.error ?? "Falha na fonte"}. Os contratos que usam o ${index.name} esperam o índice para reajustar; se a fonte continuar fora, lance o mês à mão em Cadastros › Índices.`,
        href: `/financeiro/cadastros?aba=indices&item=${item.id}`,
        entity: { type: "readjustment_index", id: item.id },
      });
    }
  }
  return { items, updated: changed.length, errors: failing.length };
}
