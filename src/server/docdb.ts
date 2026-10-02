import "server-only";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

/**
 * Armazenamento de documentos no Postgres (Supabase) com a mesma API do Firestore Admin usada pelo INTEROS.
 *
 * Por que uma API compatível: os serviços do domínio foram escritos sobre documentos (mapas aninhados, caminhos
 * "a.b", FieldValue, transações otimistas). Manter a API isola a troca de banco neste arquivo e em
 * supabase/migrations, sem reescrever regra de negócio. Novos módulos continuam usando src/server/db.ts.
 *
 * Modelo: tabela interos.<coleção> (id text, data jsonb). Ver supabase/migrations/*_interos_docstore.sql.
 *
 * Semântica preservada do Firestore:
 * - doc().set(data) substitui; set(data, { merge: true }) mescla mapas aninhados; update(data) exige o documento
 *   (erro code 5 NOT_FOUND) e interpreta chaves "a.b" como caminho; create() falha com code 6 ALREADY_EXISTS.
 * - FieldValue.delete() remove o campo; FieldValue.increment(n) soma atomicamente.
 * - runTransaction: leituras travam o documento (FOR UPDATE + lock consultivo, inclusive de documento ainda
 *   inexistente) e as escritas são aplicadas no fim, na mesma transação. Conflitos (40001/40P01) repetem a função.
 * - Consultas: ==, !=, in, not-in, array-contains, array-contains-any, <, <=, >, >=, orderBy, limit. Como no
 *   Firestore, orderBy e desigualdades ignoram documentos sem o campo.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------------------------------------------------

type Sql = postgres.Sql;
type TxSql = postgres.TransactionSql;
type Runner = Sql | TxSql;

const SCHEMA = "interos";

/**
 * Parâmetros de URL que pertencem a outros clientes (Prisma etc.) e que o painel do Supabase às vezes inclui
 * (ex.: `?pgbouncer=true`). O postgres.js repassa parâmetro desconhecido ao servidor como parâmetro de sessão, e o
 * Postgres recusa a conexão ("unrecognized configuration parameter").
 */
const CLIENT_ONLY_PARAMS = ["pgbouncer", "connection_limit", "pool_timeout", "schema", "statement_cache_size", "socket_timeout"];

/** DATABASE_URL sem os parâmetros de outros clientes. Inválida ou sem query string: devolve como veio. */
export function sanitizeDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (!url.search) return raw;
  for (const key of CLIENT_ONLY_PARAMS) url.searchParams.delete(key);
  return url.toString();
}

/** Papel da conexão (`interos_app.<ref>` no pooler do Supabase → "interos_app"). */
export function databaseRole(raw: string): string | null {
  try {
    return decodeURIComponent(new URL(raw).username).split(".")[0] || null;
  } catch {
    return null;
  }
}

/**
 * DATABASE_URL: string de conexão do papel `interos_app`. Na Vercel use o pooler do Supabase em modo transação
 * (porta 6543); por isso `prepare: false` (o pooler não mantém prepared statements entre transações).
 */
function connect(): Sql {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL não configurada. Veja .env.example.");
  const url = sanitizeDatabaseUrl(raw);
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Funciona, mas o superusuário ignora o isolamento do schema (RLS, auth.*): o servidor deve usar interos_app.
  if (!local && databaseRole(url) === "postgres") {
    console.warn("[docdb] DATABASE_URL usa o papel postgres; troque para interos_app.<ref> (menor privilégio).");
  }
  return postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : "require",
    onnotice: () => undefined,
    // jsonb volta como objeto; números grandes (int8/numeric) não aparecem: tudo é jsonb.
  });
}

// Uma instância por processo (o Next pode avaliar o módulo mais de uma vez; o Fast Refresh também).
const globalForSql = globalThis as unknown as { __interosSql?: Sql };
function sql(): Sql {
  globalForSql.__interosSql ??= connect();
  return globalForSql.__interosSql;
}

/** Fecha o pool (scripts de linha de comando e testes). */
export async function closeDocdb(): Promise<void> {
  const current = globalForSql.__interosSql;
  globalForSql.__interosSql = undefined;
  await current?.end({ timeout: 5 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Tipos e utilitários
// ---------------------------------------------------------------------------------------------------------------------

export type DocumentData = Record<string, unknown>;
export type WhereFilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";
export type OrderByDirection = "asc" | "desc";

/** Erro com `code` gRPC, como os do Firestore (5 NOT_FOUND, 6 ALREADY_EXISTS, 10 ABORTED). */
export class DocdbError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "DocdbError";
  }
}

const AUTO_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Id aleatório de 20 caracteres, no mesmo formato dos ids automáticos do Firestore. */
export function autoId(): string {
  const bytes = randomBytes(40);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < 20; i++) {
    // Rejeita bytes acima do maior múltiplo de 62 para manter a distribuição uniforme.
    if (bytes[i] < 248) out += AUTO_ID_CHARS[bytes[i] % 62];
  }
  return out.length === 20 ? out : out + autoId().slice(out.length);
}

function table(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Nome de coleção inválido: ${name}`);
  return `${SCHEMA}."${name}"`;
}

function splitPath(field: string): string[] {
  const parts = field.split(".");
  if (parts.some((p) => p === "")) throw new Error(`Caminho de campo inválido: ${field}`);
  return parts;
}

function getPath(data: DocumentData | undefined, path: string[]): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Converte para JSON como o Firestore com ignoreUndefinedProperties: undefined some, Date vira ISO. */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof FieldValue ? undefined : v));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPrimitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** Objeto aninhado { a: { b: value } } para o caminho informado (filtro por containment, que usa o índice GIN). */
function nestAt(path: string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------------------
// FieldValue
// ---------------------------------------------------------------------------------------------------------------------

export class FieldValue {
  private constructor(
    readonly kind: "delete" | "increment",
    readonly operand?: number,
  ) {}
  static delete(): FieldValue {
    return new FieldValue("delete");
  }
  static increment(n: number): FieldValue {
    return new FieldValue("increment", n);
  }
  isEqual(other: FieldValue): boolean {
    return other instanceof FieldValue && other.kind === this.kind && other.operand === this.operand;
  }
}

type PatchOp = { op: "set" | "delete" | "increment"; path: string[]; value?: unknown };

/** Operações de patch para update(): cada chave é um caminho ("a.b"); valores substituem o campo inteiro. */
function updateOps(data: DocumentData): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const path = splitPath(key);
    ops.push(valueOp(path, value));
  }
  return ops;
}

/** Operações para set(data, { merge: true }): mapas aninhados são mesclados folha a folha (chaves são literais). */
function mergeOps(data: DocumentData, prefix: string[] = []): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const path = [...prefix, key];
    if (isPlainObject(value) && Object.keys(value).length > 0) ops.push(...mergeOps(value, path));
    else ops.push(valueOp(path, value));
  }
  return ops;
}

function valueOp(path: string[], value: unknown): PatchOp {
  if (value instanceof FieldValue) {
    return value.kind === "delete" ? { op: "delete", path } : { op: "increment", path, value: value.operand };
  }
  return { op: "set", path, value: JSON.parse(toJson(value)) as unknown };
}

/** Documento completo para set() sem merge: FieldValue.delete some; increment vira o próprio valor (como no Firestore). */
function plainDoc(data: DocumentData): DocumentData {
  const walk = (value: unknown): unknown => {
    if (value instanceof FieldValue) return value.kind === "increment" ? value.operand : undefined;
    if (Array.isArray(value)) return value.map(walk);
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        const next = walk(v);
        if (next !== undefined) out[k] = next;
      }
      return out;
    }
    return value;
  };
  return walk(data) as DocumentData;
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapshots e referências
// ---------------------------------------------------------------------------------------------------------------------

export class DocumentSnapshot<T extends DocumentData = DocumentData> {
  constructor(
    readonly ref: DocumentReference<T>,
    private readonly payload: T | undefined,
  ) {}
  get id(): string {
    return this.ref.id;
  }
  get exists(): boolean {
    return this.payload !== undefined;
  }
  data(): T | undefined {
    return this.payload;
  }
  get(field: string): unknown {
    return getPath(this.payload, splitPath(field));
  }
}

export class QueryDocumentSnapshot<T extends DocumentData = DocumentData> extends DocumentSnapshot<T> {
  override data(): T {
    return super.data() as T;
  }
}

export class QuerySnapshot<T extends DocumentData = DocumentData> {
  constructor(readonly docs: QueryDocumentSnapshot<T>[]) {}
  get empty(): boolean {
    return this.docs.length === 0;
  }
  get size(): number {
    return this.docs.length;
  }
  forEach(fn: (doc: QueryDocumentSnapshot<T>) => void): void {
    this.docs.forEach(fn);
  }
}

export class DocumentReference<T extends DocumentData = DocumentData> {
  constructor(
    readonly collectionName: string,
    readonly id: string,
  ) {
    if (!id || id.includes("/")) throw new Error(`Id de documento inválido: "${id}"`);
  }
  get path(): string {
    return `${this.collectionName}/${this.id}`;
  }
  get parent(): CollectionReference<T> {
    return new CollectionReference<T>(this.collectionName);
  }
  isEqual(other: DocumentReference): boolean {
    return other.collectionName === this.collectionName && other.id === this.id;
  }
  async get(): Promise<DocumentSnapshot<T>> {
    return readDoc(sql(), this, false);
  }
  async set(data: Partial<T> | DocumentData, options?: { merge?: boolean }): Promise<WriteResult> {
    await writeSet(sql(), this, data as DocumentData, options);
    return new WriteResult();
  }
  async update(data: Partial<T> | DocumentData): Promise<WriteResult> {
    await writeUpdate(sql(), this, data as DocumentData);
    return new WriteResult();
  }
  async create(data: Partial<T> | DocumentData): Promise<WriteResult> {
    await writeCreate(sql(), this, data as DocumentData);
    return new WriteResult();
  }
  async delete(): Promise<WriteResult> {
    await writeDelete(sql(), this);
    return new WriteResult();
  }
}

export class WriteResult {
  readonly writeTime = new Date().toISOString();
}

// ---------------------------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------------------------

interface Filter {
  path: string[];
  op: WhereFilterOp;
  value: unknown;
}

export class Query<T extends DocumentData = DocumentData> {
  constructor(
    readonly collectionName: string,
    protected readonly filters: readonly Filter[] = [],
    protected readonly order: readonly { path: string[]; dir: OrderByDirection }[] = [],
    protected readonly max?: number,
  ) {}
  where(field: string, op: WhereFilterOp, value: unknown): Query<T> {
    return new Query<T>(this.collectionName, [...this.filters, { path: splitPath(field), op, value }], this.order, this.max);
  }
  orderBy(field: string, dir: OrderByDirection = "asc"): Query<T> {
    return new Query<T>(this.collectionName, this.filters, [...this.order, { path: splitPath(field), dir }], this.max);
  }
  limit(n: number): Query<T> {
    return new Query<T>(this.collectionName, this.filters, this.order, n);
  }
  /** Projeção: o documento volta inteiro (o custo de transferência no Postgres é baixo para o volume do INTEROS). */
  select(...fields: string[]): Query<T> {
    void fields;
    return this;
  }
  async get(): Promise<QuerySnapshot<T>> {
    return runQuery(sql(), this, false);
  }
  /** Partes da consulta para o executor (uso interno). */
  toSql(lock: boolean): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    const p = (value: unknown, cast = "") => {
      params.push(value);
      return `$${params.length}${cast}`;
    };
    const where: string[] = [];
    for (const f of this.filters) where.push(filterSql(f, p));
    for (const o of this.order) where.push(`data #> ${p(o.path, "::text[]")} is not null`);
    let text = `select id, data from ${table(this.collectionName)}`;
    if (where.length > 0) text += ` where ${where.join(" and ")}`;
    // Ordem total e estável: os campos pedidos e, por fim, o id (como o Firestore, que desempata pelo nome do documento).
    const orderBy = this.order.map((o) => `data #> ${p(o.path, "::text[]")} ${o.dir === "desc" ? "desc" : "asc"}`);
    text += ` order by ${[...orderBy, "id asc"].join(", ")}`;
    if (this.max !== undefined) text += ` limit ${p(Math.max(0, Math.floor(this.max)), "::int")}`;
    if (lock) text += " for update";
    return { text, params };
  }
}

export class CollectionReference<T extends DocumentData = DocumentData> extends Query<T> {
  constructor(collectionName: string) {
    super(collectionName);
    table(collectionName);
  }
  get id(): string {
    return this.collectionName;
  }
  doc(id?: string): DocumentReference<T> {
    return new DocumentReference<T>(this.collectionName, id ?? autoId());
  }
  async add(data: T): Promise<DocumentReference<T>> {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

function filterSql(f: Filter, p: (value: unknown, cast?: string) => string): string {
  // Parâmetros só são registrados quando usados: parâmetro órfão não tem tipo e o Postgres recusa a consulta.
  let fieldSql: string | undefined;
  const fieldOf = () => (fieldSql ??= `data #> ${p(f.path, "::text[]")}`);
  const json = (value: unknown) => p(toJson(value), "::text::jsonb");
  // organizationId == x: coluna gerada com índice btree (filtro presente em quase toda consulta).
  if (f.path.length === 1 && f.path[0] === "organizationId" && f.op === "==" && typeof f.value === "string") {
    return `organization_id = ${p(f.value)}`;
  }
  switch (f.op) {
    case "==":
      // Containment em primitivo é igualdade exata e usa o índice GIN; objetos/arrays comparam o valor inteiro.
      return isPrimitive(f.value) ? `data @> ${json(nestAt(f.path, f.value))}` : `${fieldOf()} = ${json(f.value)}`;
    case "!=":
      return `(${fieldOf()} is not null and ${fieldOf()} <> ${json(f.value)})`;
    case "in":
      if (!Array.isArray(f.value) || f.value.length === 0) return "false";
      return `${fieldOf()} in (select jsonb_array_elements(${json(f.value)}))`;
    case "not-in":
      if (!Array.isArray(f.value) || f.value.length === 0) return `${fieldOf()} is not null`;
      return `(${fieldOf()} is not null and ${fieldOf()} not in (select jsonb_array_elements(${json(f.value)})))`;
    case "array-contains":
      return isPrimitive(f.value)
        ? `data @> ${json(nestAt(f.path, [f.value]))}`
        : `(jsonb_typeof(${fieldOf()}) = 'array' and exists (select 1 from jsonb_array_elements(${fieldOf()}) e where e = ${json(f.value)}))`;
    case "array-contains-any": {
      if (!Array.isArray(f.value) || f.value.length === 0) return "false";
      const values = f.value as unknown[];
      return `(${values.map((v) => filterSql({ path: f.path, op: "array-contains", value: v }, p)).join(" or ")})`;
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      // Desigualdade só compara valores do mesmo tipo (como o Firestore); documentos sem o campo ficam de fora.
      const v = json(f.value);
      return `(jsonb_typeof(${fieldOf()}) = jsonb_typeof(${v}) and ${fieldOf()} ${f.op} ${v})`;
    }
    default:
      throw new Error(`Operador de consulta não suportado: ${String(f.op)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------------------------------------------------

type Row = { id: string; data: DocumentData };

async function lockKey(run: Runner, ref: DocumentReference): Promise<void> {
  // Trava também documento ainda inexistente: duas transações que criam o mesmo id se enfileiram (ex.: contadores).
  await run.unsafe("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ref.collectionName}/${ref.id}`]);
}

async function readDoc<T extends DocumentData>(run: Runner, ref: DocumentReference<T>, lock: boolean): Promise<DocumentSnapshot<T>> {
  if (lock) await lockKey(run, ref);
  const rows = await run.unsafe<Row[]>(`select id, data from ${table(ref.collectionName)} where id = $1${lock ? " for update" : ""}`, [ref.id]);
  return new DocumentSnapshot<T>(ref, rows[0]?.data as T | undefined);
}

async function readMany(run: Runner, refs: DocumentReference[], lock: boolean): Promise<DocumentSnapshot[]> {
  const byCollection = new Map<string, string[]>();
  for (const ref of refs) byCollection.set(ref.collectionName, [...(byCollection.get(ref.collectionName) ?? []), ref.id]);
  if (lock) {
    // Ordem determinística evita deadlock entre transações que travam os mesmos documentos.
    const sorted = [...refs].sort((a, b) => a.path.localeCompare(b.path));
    for (const ref of sorted) await lockKey(run, ref);
  }
  const found = new Map<string, DocumentData>();
  await Promise.all(
    [...byCollection].map(async ([name, ids]) => {
      const rows = await run.unsafe<Row[]>(`select id, data from ${table(name)} where id = any($1::text[])${lock ? " for update" : ""}`, [ids]);
      for (const row of rows) found.set(`${name}/${row.id}`, row.data);
    }),
  );
  return refs.map((ref) => new DocumentSnapshot(ref, found.get(ref.path)));
}

async function runQuery<T extends DocumentData>(run: Runner, query: Query<T>, lock: boolean): Promise<QuerySnapshot<T>> {
  const { text, params } = query.toSql(lock);
  const rows = await run.unsafe<Row[]>(text, params as never[]);
  return new QuerySnapshot<T>(rows.map((row) => new QueryDocumentSnapshot<T>(new DocumentReference<T>(query.collectionName, row.id), row.data as T)));
}

async function writeSet(run: Runner, ref: DocumentReference, data: DocumentData, options?: { merge?: boolean }): Promise<void> {
  const t = table(ref.collectionName);
  if (options?.merge) {
    const ops = toJson(mergeOps(data));
    await run.unsafe(
      `insert into ${t} as d (id, data) values ($1, interos.apply_patch('{}'::jsonb, $2::text::jsonb))
       on conflict (id) do update set data = interos.apply_patch(d.data, $2::text::jsonb), updated_at = now()`,
      [ref.id, ops],
    );
    return;
  }
  await run.unsafe(
    `insert into ${t} (id, data) values ($1, $2::text::jsonb)
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [ref.id, toJson(plainDoc(data))],
  );
}

async function writeUpdate(run: Runner, ref: DocumentReference, data: DocumentData): Promise<void> {
  const rows = await run.unsafe(`update ${table(ref.collectionName)} set data = interos.apply_patch(data, $2::text::jsonb), updated_at = now() where id = $1 returning 1`, [
    ref.id,
    toJson(updateOps(data)),
  ]);
  if (rows.length === 0) throw new DocdbError(5, `5 NOT_FOUND: No document to update: ${ref.path}`);
}

async function writeCreate(run: Runner, ref: DocumentReference, data: DocumentData): Promise<void> {
  const rows = await run.unsafe(`insert into ${table(ref.collectionName)} (id, data) values ($1, $2::text::jsonb) on conflict (id) do nothing returning 1`, [
    ref.id,
    toJson(plainDoc(data)),
  ]);
  if (rows.length === 0) throw new DocdbError(6, `6 ALREADY_EXISTS: Document already exists: ${ref.path}`);
}

async function writeDelete(run: Runner, ref: DocumentReference): Promise<void> {
  await run.unsafe(`delete from ${table(ref.collectionName)} where id = $1`, [ref.id]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Transações e lotes
// ---------------------------------------------------------------------------------------------------------------------

type PendingWrite =
  | { kind: "set"; ref: DocumentReference; data: DocumentData; merge: boolean }
  | { kind: "update"; ref: DocumentReference; data: DocumentData }
  | { kind: "create"; ref: DocumentReference; data: DocumentData }
  | { kind: "delete"; ref: DocumentReference };

/** Escritas que podem ir num único comando com outras iguais da mesma coleção (set sem merge e delete). */
type GroupableWrite = Extract<PendingWrite, { kind: "delete" }> | (Extract<PendingWrite, { kind: "set" }> & { merge: false });

function groupKey(w: PendingWrite): string | null {
  if (w.kind === "delete") return `delete:${w.ref.collectionName}`;
  if (w.kind === "set" && !w.merge) return `set:${w.ref.collectionName}`;
  return null;
}

/**
 * Aplica as escritas na ordem. Sequências consecutivas de set (sem merge) ou de delete na mesma coleção viram um
 * comando só: um lote de 450 documentos faz 1 ida ao banco em vez de 450 (diferença grande fora da região do banco).
 */
async function applyWrites(run: Runner, writes: PendingWrite[]): Promise<void> {
  for (let i = 0; i < writes.length; ) {
    const key = groupKey(writes[i]);
    let j = i + 1;
    if (key) while (j < writes.length && groupKey(writes[j]) === key) j++;
    if (j - i > 1) {
      await writeGroup(run, writes.slice(i, j) as GroupableWrite[]);
    } else {
      const w = writes[i];
      if (w.kind === "set") await writeSet(run, w.ref, w.data, { merge: w.merge });
      else if (w.kind === "update") await writeUpdate(run, w.ref, w.data);
      else if (w.kind === "create") await writeCreate(run, w.ref, w.data);
      else await writeDelete(run, w.ref);
    }
    i = j;
  }
}

async function writeGroup(run: Runner, group: GroupableWrite[]): Promise<void> {
  const t = table(group[0].ref.collectionName);
  if (group[0].kind === "delete") {
    await run.unsafe(`delete from ${t} where id = any($1::text[])`, [group.map((w) => w.ref.id)]);
    return;
  }
  // O mesmo id duas vezes no lote: vale o último (como na sequência de sets); o Postgres não aceita repetir a linha.
  const last = new Map<string, DocumentData>();
  for (const w of group as Extract<GroupableWrite, { kind: "set" }>[]) last.set(w.ref.id, plainDoc(w.data));
  const rows = [...last].map(([id, data]) => ({ id, data }));
  await run.unsafe(
    `insert into ${t} (id, data)
     select r->>'id', r->'data' from jsonb_array_elements($1::text::jsonb) r
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [toJson(rows)],
  );
}

class WriteBuffer {
  protected readonly writes: PendingWrite[] = [];
  set(ref: DocumentReference, data: DocumentData, options?: { merge?: boolean }): this {
    this.writes.push({ kind: "set", ref, data, merge: options?.merge === true });
    return this;
  }
  update(ref: DocumentReference, data: DocumentData): this {
    this.writes.push({ kind: "update", ref, data });
    return this;
  }
  create(ref: DocumentReference, data: DocumentData): this {
    this.writes.push({ kind: "create", ref, data });
    return this;
  }
  delete(ref: DocumentReference): this {
    this.writes.push({ kind: "delete", ref });
    return this;
  }
}

/** Transação: leituras travam os documentos; escritas ficam pendentes e são aplicadas ao fim, na mesma transação. */
export class Transaction extends WriteBuffer {
  constructor(private readonly run: TxSql) {
    super();
  }
  get<T extends DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>>;
  get<T extends DocumentData>(query: Query<T>): Promise<QuerySnapshot<T>>;
  async get<T extends DocumentData>(target: DocumentReference<T> | Query<T>): Promise<DocumentSnapshot<T> | QuerySnapshot<T>> {
    if (this.writes.length > 0) throw new Error("Transação: todas as leituras precisam acontecer antes das escritas.");
    if (target instanceof DocumentReference) return readDoc(this.run, target, true);
    return runQuery(this.run, target, true);
  }
  async getAll(...refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
    if (this.writes.length > 0) throw new Error("Transação: todas as leituras precisam acontecer antes das escritas.");
    return readMany(this.run, refs, true);
  }
  /** Uso interno: aplica as escritas pendentes. */
  async commit(): Promise<void> {
    await applyWrites(this.run, this.writes.splice(0));
  }
}

export class WriteBatch extends WriteBuffer {
  async commit(): Promise<WriteResult[]> {
    const writes = this.writes.splice(0);
    if (writes.length === 0) return [];
    await sql().begin((tx) => applyWrites(tx, writes));
    return writes.map(() => new WriteResult());
  }
}

const RETRYABLE = new Set(["40001", "40P01"]);
const MAX_ATTEMPTS = 5;

async function runTransaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return (await sql().begin(async (run) => {
        const tx = new Transaction(run);
        const result = await fn(tx);
        await tx.commit();
        return result;
      })) as R;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }
  throw new DocdbError(10, `10 ABORTED: transação não concluída após ${MAX_ATTEMPTS} tentativas (${String((lastError as Error)?.message ?? lastError)})`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Fachada
// ---------------------------------------------------------------------------------------------------------------------

export const docdb = {
  collection<T extends DocumentData = DocumentData>(name: string): CollectionReference<T> {
    return new CollectionReference<T>(name);
  },
  getAll(...refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
    return readMany(sql(), refs, false);
  },
  runTransaction,
  batch(): WriteBatch {
    return new WriteBatch();
  },
  /** SQL direto (uso restrito: autenticação e scripts). */
  sql(): Sql {
    return sql();
  },
};
