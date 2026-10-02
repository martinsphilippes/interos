/**
 * docdb (Postgres) reproduz a semântica do Firestore Admin usada pelo INTEROS. Exige DATABASE_URL com as migrations
 * aplicadas (scripts/db-local.sh) e DATABASE_ADMIN_URL (superusuário) para inspecionar auth.users, que o papel do
 * servidor não lê. As coleções usadas aqui são reais; os ids têm prefixo próprio e são apagados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { closeDocdb, docdb, FieldValue } from "@/server/docdb";
import { create, createIfAbsent, getById, getManyByIds, isAlreadyExists, list, nextNumber, ORG_ID, update } from "@/server/db";
import { authAdmin } from "@/server/auth/auth-admin";
import type { BaseEntity } from "@/domain/types";

/** Documento de teste na coleção comments (campos livres). */
type Doc = BaseEntity & { parentId?: string; body?: string; authorId?: string; n?: number; tags?: string[]; flag?: boolean };

const RUN = `t${Date.now().toString(36)}`;
const C = "comments"; // coleção qualquer do domínio
const id = (s: string) => `${RUN}_${s}`;

let admin: postgres.Sql;

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL) throw new Error("Defina DATABASE_URL e DATABASE_ADMIN_URL (veja scripts/db-local.sh)");
  admin = postgres(process.env.DATABASE_ADMIN_URL, { onnotice: () => undefined });
});

afterAll(async () => {
  await docdb.sql()`delete from interos.comments where id like ${RUN + "%"}`;
  await docdb.sql()`delete from interos.counters where data->>'prefix' like ${"T" + RUN.slice(-4).toUpperCase() + "%"}`;
  await docdb.sql()`delete from interos.users where id like ${RUN + "%"}`;
  await closeDocdb();
  await admin?.end();
});

describe("escritas", () => {
  it("set substitui; set merge mescla mapas aninhados; update usa caminhos 'a.b' e substitui o campo", async () => {
    const ref = docdb.collection(C).doc(id("w1"));
    await ref.set({ a: { x: 1, y: 2 }, keep: true, gone: "x" });
    await ref.set({ a: { y: 3, z: 4 }, other: "o" }, { merge: true });
    expect((await ref.get()).data()).toEqual({ a: { x: 1, y: 3, z: 4 }, keep: true, gone: "x", other: "o" });

    await ref.update({ "a.x": 10, "deep.new.path": "ok", gone: FieldValue.delete() });
    expect((await ref.get()).data()).toEqual({ a: { x: 10, y: 3, z: 4 }, keep: true, other: "o", deep: { new: { path: "ok" } } });

    // update com mapa (sem ponto) substitui o mapa inteiro.
    await ref.update({ a: { only: 1 } });
    expect((await ref.get()).get("a")).toEqual({ only: 1 });
    expect((await ref.get()).get("deep.new.path")).toBe("ok");

    await ref.set({ fresh: 1 });
    expect((await ref.get()).data()).toEqual({ fresh: 1 });
  });

  it("FieldValue.increment soma atomicamente e cria o campo ausente", async () => {
    const ref = docdb.collection(C).doc(id("inc"));
    await ref.set({ views: 1 });
    await Promise.all(Array.from({ length: 20 }, () => ref.update({ views: FieldValue.increment(1), "stats.n": FieldValue.increment(2) })));
    const snap = await ref.get();
    expect(snap.get("views")).toBe(21);
    expect(snap.get("stats.n")).toBe(40);
  });

  it("undefined some (ignoreUndefinedProperties) e arrays/objetos aninhados são preservados", async () => {
    const ref = docdb.collection(C).doc(id("undef"));
    await ref.set({ a: undefined, b: [1, { c: "d" }], e: { f: undefined, g: null } });
    expect((await ref.get()).data()).toEqual({ b: [1, { c: "d" }], e: { g: null } });
  });

  it("update de documento inexistente falha com code 5; create de existente falha com code 6", async () => {
    const missing = docdb.collection(C).doc(id("missing"));
    await expect(missing.update({ a: 1 })).rejects.toMatchObject({ code: 5 });
    const ref = docdb.collection(C).doc(id("dup"));
    await ref.create({ v: 1 });
    const error = await ref.create({ v: 2 }).catch((e: unknown) => e);
    expect(isAlreadyExists(error)).toBe(true);
    expect((await ref.get()).get("v")).toBe(1);
  });

  it("delete remove; get de inexistente tem exists false", async () => {
    const ref = docdb.collection(C).doc(id("del"));
    await ref.set({ a: 1 });
    await ref.delete();
    const snap = await ref.get();
    expect(snap.exists).toBe(false);
    expect(snap.data()).toBeUndefined();
  });

  it("batch aplica tudo numa transação", async () => {
    const batch = docdb.batch();
    batch.set(docdb.collection(C).doc(id("b1")), { n: 1 });
    batch.set(docdb.collection(C).doc(id("b2")), { n: 2 });
    batch.update(docdb.collection(C).doc(id("b1")), { n: 3 });
    await batch.commit();
    const [b1, b2, b3] = await docdb.getAll(docdb.collection(C).doc(id("b1")), docdb.collection(C).doc(id("b2")), docdb.collection(C).doc(id("b3")));
    expect([b1.get("n"), b2.get("n"), b3.exists]).toEqual([3, 2, false]);
  });

  it("batch agrupa sets/deletes consecutivos sem mudar o resultado (último set do mesmo id vence, ordem preservada)", async () => {
    const col = docdb.collection(C);
    const batch = docdb.batch();
    for (let i = 0; i < 300; i++) batch.set(col.doc(id(`g${i}`)), { i });
    batch.set(col.doc(id("g0")), { i: "último" });
    batch.update(col.doc(id("g1")), { extra: true });
    batch.delete(col.doc(id("g2")));
    batch.delete(col.doc(id("g3")));
    batch.set(col.doc(id("g3")), { i: "recriado" });
    await batch.commit();
    const [g0, g1, g2, g3, g299] = await docdb.getAll(...["g0", "g1", "g2", "g3", "g299"].map((k) => col.doc(id(k))));
    expect(g0.data()).toEqual({ i: "último" });
    expect(g1.data()).toEqual({ i: 1, extra: true });
    expect(g2.exists).toBe(false);
    expect(g3.data()).toEqual({ i: "recriado" });
    expect(g299.get("i")).toBe(299);
  });

  it("batch com erro não grava nada", async () => {
    const batch = docdb.batch();
    batch.set(docdb.collection(C).doc(id("rb1")), { n: 1 });
    batch.update(docdb.collection(C).doc(id("rb-missing")), { n: 2 });
    await expect(batch.commit()).rejects.toMatchObject({ code: 5 });
    expect((await docdb.collection(C).doc(id("rb1")).get()).exists).toBe(false);
  });
});

describe("db.ts sobre o docdb", () => {
  it("create/getById/update/list com organização, igualdade, in (> 30 valores), array-contains e orderBy", async () => {
    const base = { parentId: id("p"), body: "x", authorId: "u" };
    for (let i = 0; i < 35; i++) {
      await create<Doc>(C, { ...base, n: i, tags: i % 2 === 0 ? ["par"] : ["impar"], flag: i < 5 }, id(`l${String(i).padStart(2, "0")}`));
    }
    // Documento de outra organização com o mesmo parentId: nunca aparece.
    await docdb.collection(C).doc(id("other-org")).set({ ...base, organizationId: "outra", n: 99 });

    const all = await list<Doc>(C, { where: [["parentId", "==", id("p")]] });
    expect(all).toHaveLength(35);
    expect(await getById(C, id("other-org"))).toBeNull();

    const ids = Array.from({ length: 33 }, (_, i) => id(`l${String(i).padStart(2, "0")}`));
    const byIn = await list(C, { where: [["parentId", "==", id("p")], ["n", "in", Array.from({ length: 33 }, (_, i) => i)]] });
    expect(byIn).toHaveLength(33);
    expect((await getManyByIds(C, [...ids, id("other-org"), id("nope")])).size).toBe(33);

    expect(await list(C, { where: [["parentId", "==", id("p")], ["tags", "array-contains", "par"]] })).toHaveLength(18);
    expect(await list(C, { where: [["parentId", "==", id("p")], ["tags", "array-contains-any", ["par", "impar"]]] })).toHaveLength(35);
    expect(await list(C, { where: [["parentId", "==", id("p")], ["flag", "==", true]] })).toHaveLength(5);
    expect(await list(C, { where: [["parentId", "==", id("p")], ["n", "!=", 0]] })).toHaveLength(34);
    // "==" em campo array não casa com o elemento (igualdade exata, como no Firestore).
    expect(await list(C, { where: [["parentId", "==", id("p")], ["tags", "==", "par"]] })).toHaveLength(0);
    expect(await list(C, { where: [["parentId", "==", id("p")], ["tags", "==", ["par"]]] })).toHaveLength(18);

    const top = await list<Doc>(C, { where: [["parentId", "==", id("p")]], orderBy: ["n", "desc"], limit: 3 });
    expect(top.map((d) => d.n)).toEqual([34, 33, 32]);

    await update<Doc>(C, id("l00"), { body: "y" });
    const l00 = await getById<Doc>(C, id("l00"));
    expect(l00?.body).toBe("y");
    expect(l00?.organizationId).toBe(ORG_ID);
    expect(l00!.updatedAt >= l00!.createdAt).toBe(true);
  });

  it("orderBy e desigualdade ignoram documentos sem o campo", async () => {
    const col = docdb.collection(C);
    await col.doc(id("o1")).set({ grp: id("o"), rank: 2 });
    await col.doc(id("o2")).set({ grp: id("o"), rank: 1 });
    await col.doc(id("o3")).set({ grp: id("o") });
    const ordered = await col.where("grp", "==", id("o")).orderBy("rank").get();
    expect(ordered.docs.map((d) => d.id)).toEqual([id("o2"), id("o1")]);
    const gt = await col.where("grp", "==", id("o")).where("rank", ">", 1).get();
    expect(gt.docs.map((d) => d.id)).toEqual([id("o1")]);
  });

  it("createIfAbsent é atômico sob concorrência: um cria, os outros recebem o documento gravado", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createIfAbsent<Doc>(C, id("once"), { parentId: "x", body: `v${i}`, authorId: "u" })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const winner = results.find((r) => r.created)!.doc;
    for (const r of results) expect(r.doc.body).toBe(winner.body);
  });
});

describe("transações", () => {
  it("nextNumber sob concorrência nunca repete número (inclusive na criação do contador)", async () => {
    const prefix = `T${RUN.slice(-4).toUpperCase()}`;
    const numbers = await Promise.all(Array.from({ length: 25 }, () => nextNumber(prefix, { year: "2026" })));
    expect(new Set(numbers).size).toBe(25);
    expect([...numbers].sort().at(-1)).toBe(`${prefix}-2026-0025`);
  });

  it("read-modify-write concorrente não perde atualização", async () => {
    const ref = docdb.collection(C).doc(id("rmw"));
    await ref.set({ list: [] as number[] });
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        docdb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          tx.update(ref, { list: [...((snap.get("list") as number[]) ?? []), i] });
        }),
      ),
    );
    expect(((await ref.get()).get("list") as number[]).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it("erro dentro da transação desfaz as escritas; ler depois de escrever é recusado", async () => {
    const ref = docdb.collection(C).doc(id("rollback"));
    await ref.set({ v: 1 });
    await expect(
      docdb.runTransaction(async (tx) => {
        await tx.get(ref);
        tx.update(ref, { v: 2 });
        throw new Error("falha de negócio");
      }),
    ).rejects.toThrow("falha de negócio");
    expect((await ref.get()).get("v")).toBe(1);

    await expect(
      docdb.runTransaction(async (tx) => {
        tx.set(ref, { v: 3 });
        await tx.get(ref);
      }),
    ).rejects.toThrow(/leituras/);
  });

  it("tx.getAll devolve na ordem pedida, com inexistentes", async () => {
    const a = docdb.collection(C).doc(id("ga"));
    const b = docdb.collection("users").doc(id("gb"));
    await a.set({ k: "a" });
    await b.set({ k: "b" });
    const snaps = await docdb.runTransaction((tx) => tx.getAll(b, docdb.collection(C).doc(id("gz")), a));
    expect(snaps.map((s) => (s.exists ? s.get("k") : null))).toEqual(["b", null, "a"]);
  });
});

describe("authAdmin (funções SQL sobre auth.users)", () => {
  it("cria, atualiza, revoga e exclui login pelo interos_uid, com os códigos de erro do Firebase", async () => {
    const uid = id("login");
    const email = `${uid}@teste.interos`;
    await docdb.collection("users").doc(uid).set({ organizationId: ORG_ID, name: "Teste", email, active: true });
    await authAdmin.createUser({ uid, email, password: "senha-forte-1", displayName: "Teste" });
    await expect(authAdmin.createUser({ email: email.toUpperCase(), password: "outra-senha" })).rejects.toMatchObject({ code: "auth/email-already-exists" });
    await expect(authAdmin.updateUser(uid, { password: "123" })).rejects.toMatchObject({ code: "auth/invalid-password" });

    await authAdmin.updateUser(uid, { disabled: true, displayName: "Teste 2" });
    const [row] = await admin<{ banned: boolean; name: string; meta: string }[]>`
      select banned_until > now() as banned, raw_user_meta_data->>'name' as name, raw_app_meta_data->>'interos_uid' as meta
      from auth.users where lower(email) = ${email}`;
    expect(row).toEqual({ banned: true, name: "Teste 2", meta: uid });
    // Desativar encerra as sessões do INTEROS (cookies anteriores são recusados).
    expect((await docdb.collection("users").doc(uid).get()).get("sessionsRevokedAt")).toEqual(expect.any(String));

    const [pw] = await admin<{ ok: boolean }[]>`select encrypted_password = extensions.crypt('senha-forte-1', encrypted_password) as ok from auth.users where lower(email) = ${email}`;
    expect(pw.ok).toBe(true);
    // O papel do servidor não lê o schema auth diretamente: só pelas funções restritas.
    await expect(docdb.sql()`select count(*) from auth.users`).rejects.toThrow(/permission denied/);

    expect((await authAdmin.listUsers()).some((u) => u.uid === uid && u.email === email)).toBe(true);
    await authAdmin.deleteUser(uid);
    await expect(authAdmin.deleteUser(uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    await expect(authAdmin.revokeRefreshTokens(uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
  });
});
