/**
 * Guardas do trilho B — módulo Marketing (Visão Geral, Leads, Campanhas, Caixa de Entrada e Prospecção): cobertura
 * real das páginas e actions (verificador A15), despacho de chave do saveCampaign pelo argumento, permissões padrão ≡
 * comportamento anterior (com a correção deliberada A14 listada nominalmente), predicados puros de escopo e escopo por
 * registro nas actions com banco em memória.
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_BY_KEY, type PermissionKey } from "@/domain/permissions";
import { defaultScopeKind } from "@/server/auth/scope";
import { PermissionError } from "@/server/auth/errors";
import { asCurrentUser, ALL_USERS, SEED_DEPARTMENTS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de guards-inicio-operacao.test.ts)
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>[]>() }));

vi.mock("@/server/db", () => {
  type Row = Record<string, unknown>;
  const rows = (name: string): Row[] => store.data.get(name) ?? [];
  const match = (row: Row, [field, op, value]: [string, string, unknown]) => {
    const v = row[field];
    if (op === "==") return v === value;
    if (op === "!=") return v !== value;
    if (op === "in") return (value as unknown[]).includes(v);
    return false;
  };
  const list = async (name: string, options: { where?: [string, string, unknown][] } = {}) => rows(name).filter((r) => (options.where ?? []).every((w) => match(r, w)));
  const getById = async (name: string, id: string) => rows(name).find((r) => r.id === id) ?? null;
  const getManyByIds = async (name: string, ids: string[]) => new Map(rows(name).filter((r) => ids.includes(r.id as string)).map((r) => [r.id as string, r]));
  const fail = async () => {
    throw new Error("escrita não esperada no teste de guardas");
  };
  return {
    ORG_ID: "intercert",
    nowIso: () => "2026-09-30T12:00:00.000Z",
    list,
    getById,
    getManyByIds,
    create: fail,
    update: fail,
    remove: fail,
    batchSet: fail,
    col: () => {
      throw new Error("col() não disponível no teste");
    },
    newId: () => "novo",
    stripUndefined: <T>(v: T) => v,
    counterId: () => "c",
    clearCollection: fail,
  };
});

const { analyzeAccess } = await import("../../scripts/check-access/analyze");
const { campaignSaveKey } = await import("@/server/marketing/permission-keys");
const {
  MARKETING_SCREENS,
  assertCampaignInScope,
  assertInboxMessageInScope,
  assertLeadInScope,
  assertProspectInScope,
  assertProspectListInScope,
  assertProspectsInScope,
  canSeeProspectListId,
  inboxItemInScope,
  leadInScope,
  marketingCapabilities,
  prospectInScope,
  prospectListInScope,
} = await import("@/server/marketing/access");
const { maskDuplicates, HIDDEN_LEAD_NAME } = await import("@/server/marketing/duplicates");
const { getInbox, getProspectListDetail, listCampaigns, listLeads, listProspectLists } = await import("@/server/marketing/queries");

const SCOPE_PATHS = /^src\/app\/\(app\)\/marketing\/|^src\/server\/marketing\/|^src\/components\/marketing\//;
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;
const inModule = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "marketing");

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Marketing", () => {
  it("nenhuma pendência em páginas, actions e guards de Marketing", () => {
    const report = analyzeAccess(path.resolve(__dirname, "../.."));
    const mine = report.findings.filter((f) => SCOPE_PATHS.test(f.target));
    expect(mine).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Despacho de chave por argumento
// ---------------------------------------------------------------------------
describe("saveCampaign: criar sem id, editar com id", () => {
  it("usa a mesma regra do esquema (id vazio/espaços = nova)", () => {
    expect(campaignSaveKey({ name: "x" })).toBe("marketing.campanhas.criar");
    expect(campaignSaveKey({ id: "" })).toBe("marketing.campanhas.criar");
    expect(campaignSaveKey({ id: "   " })).toBe("marketing.campanhas.criar");
    expect(campaignSaveKey({ id: null })).toBe("marketing.campanhas.criar");
    expect(campaignSaveKey(null)).toBe("marketing.campanhas.criar");
    expect(campaignSaveKey("texto")).toBe("marketing.campanhas.criar");
    expect(campaignSaveKey({ id: "camp_1" })).toBe("marketing.campanhas.editar");
  });

  it("as duas chaves existem no catálogo", () => {
    for (const key of ["marketing.campanhas.criar", "marketing.campanhas.editar"] as PermissionKey[]) expect(NODE_BY_KEY.has(key), key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior (+ A14)
// ---------------------------------------------------------------------------
describe("permissões padrão ≡ comportamento anterior", () => {
  it("campanhas: criar/editar ≡ isManager ∨ papel marketing (as 3 cópias de canEditCampaigns)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const expected = cu.isManager || u.role === "marketing";
      const caps = marketingCapabilities(cu);
      expect(caps.campaigns.create, label(u)).toBe(expected);
      expect(caps.campaigns.edit, label(u)).toBe(expected);
    }
  });

  it("demais ações e telas: antes todo usuário logado; agora quem tem o módulo (A14)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      const { campaigns: _campaigns, createTask: _task, ...rest } = marketingCapabilities(cu);
      void _campaigns;
      void _task;
      const flags = Object.values(rest).flatMap((group) => Object.values(group));
      expect(flags.every((f) => f === inModule(u)), label(u)).toBe(true);
      for (const screen of Object.values(MARKETING_SCREENS)) expect(NODE_BY_KEY.has(`${screen}.ver`) && cu.permissions.has(`${screen}.ver` as PermissionKey), `${label(u)} ${screen}`).toBe(inModule(u));
    }
  });

  it("A14 nominal: seis usuários do seed perdem Marketing por URL", () => {
    const losing = SEED_USERS.filter((u) => !inModule(u)).map((u) => u.id).sort();
    expect(losing).toEqual(["user_anapaula", "user_bruno", "user_camila", "user_larissa", "user_marcos", "user_rafael"]);
  });

  it("seção de automações para todos que veem a Visão Geral; interruptor só com admin.automacoes.ativar (antes: admin)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      expect(cu.permissions.has("marketing.visao-geral.automacoes.ver"), label(u)).toBe(inModule(u));
      expect(cu.permissions.has("admin.automacoes.ativar"), label(u)).toBe(u.role === "admin");
    }
  });

  it("escopos padrão de todas as telas de Marketing = empresa", () => {
    for (const u of SUBJECTS) for (const screen of Object.values(MARKETING_SCREENS)) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe("empresa");
  });
});

// ---------------------------------------------------------------------------
// Predicados puros de escopo
// ---------------------------------------------------------------------------
describe("predicados de escopo (puros)", () => {
  const mine = { userIds: new Set(["u1"]), poolUnassigned: false };
  const full = { poolUnassigned: false };

  it("lead: dono no escopo; sem dono só para quem distribui a fila", () => {
    expect(leadInScope({ scope: full, pool: false }, { ownerId: "u9" })).toBe(true);
    expect(leadInScope({ scope: mine, pool: false }, { ownerId: "u1" })).toBe(true);
    expect(leadInScope({ scope: mine, pool: false }, { ownerId: "u9" })).toBe(false);
    expect(leadInScope({ scope: mine, pool: false }, { ownerId: undefined })).toBe(false);
    expect(leadInScope({ scope: mine, pool: true }, { ownerId: undefined })).toBe(true);
    expect(leadInScope({ scope: mine, pool: true }, { ownerId: "u9" })).toBe(false);
  });

  it("prospecção: lista pelo dono ou por contato visível; contato pelo dono dele ou da lista", () => {
    expect(prospectListInScope(mine, { ownerId: "u1" }, [])).toBe(true);
    expect(prospectListInScope(mine, { ownerId: "u9" }, [{ ownerId: "u9" }])).toBe(false);
    expect(prospectListInScope(mine, { ownerId: "u9" }, [{ ownerId: "u9" }, { ownerId: "u1" }])).toBe(true);
    expect(prospectInScope(mine, { ownerId: "u9" }, { ownerId: "u1" })).toBe(true);
    expect(prospectInScope(mine, { ownerId: "u9" }, { ownerId: "u9" })).toBe(false);
    expect(prospectInScope(mine, { ownerId: "u1" }, { ownerId: "u9" })).toBe(true);
  });

  it("caixa de entrada: algum dono no escopo; sem dono = fila de quem assume", () => {
    expect(inboxItemInScope({ scope: mine, pool: false }, [undefined, "u9", "u1"])).toBe(true);
    expect(inboxItemInScope({ scope: mine, pool: true }, ["u9"])).toBe(false);
    expect(inboxItemInScope({ scope: mine, pool: true }, [undefined, null])).toBe(true);
    expect(inboxItemInScope({ scope: mine, pool: false }, [undefined])).toBe(false);
  });

  it("duplicidade: fora do escopo volta só com motivos e status", () => {
    const dups = [
      { id: "l1", name: "Meu", company: "A", phone: "1", email: "a@a", status: "novo" as const, createdAt: "2026-01-01", reasons: ["mesmo telefone"] },
      { id: "l2", name: "Alheio", company: "B", phone: "2", email: "b@b", status: "em_contato" as const, createdAt: "2026-01-02", reasons: ["mesmo e-mail"] },
    ];
    const owners = new Map([
      ["l1", { ownerId: "u1" }],
      ["l2", { ownerId: "u9" }],
    ]);
    const masked = maskDuplicates(dups, owners, { scope: mine, pool: false });
    expect(masked[0]).toEqual(dups[0]);
    expect(masked[1]).toEqual({ id: "oculto-2", name: HIDDEN_LEAD_NAME, status: "em_contato", createdAt: "2026-01-02", reasons: ["mesmo e-mail"], restricted: true });
    expect(maskDuplicates(dups, owners, { scope: full, pool: false })).toEqual(dups);
  });
});

// ---------------------------------------------------------------------------
// Escopo por registro (listas, detalhes e actions) com banco em memória
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const recent = new Date(Date.now() - 3_600_000).toISOString();
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };

function seedStore() {
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", SUBJECTS.map((u) => ({ ...base, id: u.id, name: u.name, email: `${u.id}@t`, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: true }))],
    ["departments", SEED_DEPARTMENTS.map((d) => ({ ...base, id: `dept_${d.key}`, key: d.key, managerId: d.managerId, name: d.key, order: 1 }))],
    [
      "leads",
      [
        { ...base, id: "lead_luciano", name: "Lead do Luciano", ownerId: "user_luciano", status: "novo", temperature: "morno", score: 50, origin: "site", consent: true },
        { ...base, id: "lead_vinicius", name: "Lead do Vinícius", ownerId: "user_vinicius", status: "em_contato", temperature: "quente", score: 80, origin: "site", consent: true },
        { ...base, id: "lead_semdono", name: "Lead sem dono", status: "novo", temperature: "frio", score: 10, origin: "site", consent: false, createdAt: recent },
      ],
    ],
    ["lead_sources", []],
    [
      "campaigns",
      [
        { ...base, id: "camp_luciano", name: "Campanha do Luciano", ownerId: "user_luciano", status: "ativa", channel: "google", startDate: iso, budget: 100, spent: 10 },
        { ...base, id: "camp_mateus", name: "Campanha do Mateus", ownerId: "user_mateus", status: "ativa", channel: "meta", startDate: iso, budget: 100, spent: 10 },
      ],
    ],
    [
      "prospect_lists",
      [
        { ...base, id: "pl_luciano", name: "Lista do Luciano", ownerId: "user_luciano", status: "ativa" },
        { ...base, id: "pl_mateus", name: "Lista do Mateus", ownerId: "user_mateus", status: "ativa" },
        { ...base, id: "pl_mista", name: "Lista mista", ownerId: "user_mateus", status: "ativa" },
      ],
    ],
    [
      "prospects",
      [
        { ...base, id: "pr_1", listId: "pl_luciano", name: "Contato 1", status: "novo", attempts: 0 },
        { ...base, id: "pr_2", listId: "pl_mateus", name: "Contato 2", ownerId: "user_mateus", status: "novo", attempts: 0 },
        { ...base, id: "pr_3", listId: "pl_mista", name: "Contato 3", ownerId: "user_luciano", status: "novo", attempts: 0 },
        { ...base, id: "pr_4", listId: "pl_mista", name: "Contato 4", ownerId: "user_mateus", status: "novo", attempts: 0 },
      ],
    ],
    ["clients", [{ ...base, id: "cli_x", tradeName: "Cliente X", ownerSalesId: "user_vinicius" }]],
    [
      "communications",
      [
        { ...base, id: "msg_lead_luciano", direction: "entrada", channel: "whatsapp", entityType: "lead", entityId: "lead_luciano", body: "oi", createdAt: recent },
        { ...base, id: "msg_cliente", direction: "entrada", channel: "email", clientId: "cli_x", body: "olá", createdAt: recent },
        { ...base, id: "msg_fila", direction: "entrada", channel: "whatsapp", body: "?", createdAt: recent },
      ],
    ],
  ]);
}

/** Usuário com escopo ajustado por exceção individual (como o CEO/CTO configuraria). */
const withScopes = (u: FixtureUser, scopes: Record<string, string>, grants: Record<string, boolean> = {}) =>
  asCurrentUser(u, { userOverride: { scopes: scopes as never, grants } });

const ALL_MARKETING_MEUS = Object.fromEntries(Object.values(MARKETING_SCREENS).map((s) => [s, "meus"]));

describe("escopo por registro (Marketing)", () => {
  beforeEach(seedStore);
  const luciano = byId("user_luciano");

  it("padrão empresa: nenhuma action de registro é negada", async () => {
    const cu = asCurrentUser(luciano);
    await expect(assertLeadInScope(cu, "lead_vinicius")).resolves.toBeUndefined();
    await expect(assertCampaignInScope(cu, "camp_mateus")).resolves.toBeUndefined();
    await expect(assertProspectListInScope(cu, "pl_mateus")).resolves.toBeUndefined();
    await expect(assertProspectInScope(cu, "pr_2")).resolves.toBeUndefined();
    await expect(assertInboxMessageInScope(cu, "msg_cliente")).resolves.toBeUndefined();
  });

  it("'meus': lead, campanha, lista e contato de outra pessoa → PermissionError; os próprios passam", async () => {
    const cu = withScopes(luciano, ALL_MARKETING_MEUS);
    await expect(assertLeadInScope(cu, "lead_vinicius")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertLeadInScope(cu, "lead_luciano")).resolves.toBeUndefined();
    // Sem dono: quem distribui (atribuir/assumir — padrão para quem tem o módulo) continua vendo.
    await expect(assertLeadInScope(cu, "lead_semdono")).resolves.toBeUndefined();
    await expect(assertLeadInScope(withScopes(luciano, ALL_MARKETING_MEUS, { "marketing.leads.atribuir": false, "marketing.caixa-de-entrada.assumir": false }), "lead_semdono")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertCampaignInScope(cu, "camp_mateus")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertCampaignInScope(cu, "camp_luciano")).resolves.toBeUndefined();
    await expect(assertProspectListInScope(cu, "pl_mateus")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertProspectListInScope(cu, "pl_mista")).resolves.toBeUndefined();
    await expect(assertProspectInScope(cu, "pr_4")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertProspectInScope(cu, "pr_3")).resolves.toBeUndefined();
    await expect(assertProspectInScope(cu, "pr_1")).resolves.toBeUndefined();
    await expect(assertProspectsInScope(cu, "pl_mista", ["pr_3", "pr_4"])).rejects.toBeInstanceOf(PermissionError);
    await expect(assertProspectsInScope(cu, "pl_mista", ["pr_3"])).resolves.toBeUndefined();
    await expect(assertInboxMessageInScope(cu, "msg_cliente")).rejects.toBeInstanceOf(PermissionError);
    await expect(assertInboxMessageInScope(cu, "msg_lead_luciano")).resolves.toBeUndefined();
    await expect(assertInboxMessageInScope(cu, "msg_fila")).resolves.toBeUndefined();
    // Registro inexistente: o serviço responde "não encontrado" como antes.
    await expect(assertLeadInScope(cu, "nao_existe")).resolves.toBeUndefined();
  });

  it("listas e detalhes filtram pelo escopo; tela negada nega a lista por id (inclusive no título)", async () => {
    const cu = withScopes(luciano, ALL_MARKETING_MEUS);
    expect(cu.permissions.scopes["marketing.leads"]).toBe("meus");
    const mineOnly = { userIds: new Set(["user_luciano"]), poolUnassigned: false };
    expect((await listLeads({}, { scope: mineOnly, pool: true })).items.map((l) => l.id).sort()).toEqual(["lead_luciano", "lead_semdono"]);
    expect((await listLeads({}, { scope: mineOnly, pool: false })).items.map((l) => l.id)).toEqual(["lead_luciano"]);
    expect((await listCampaigns(mineOnly)).map((c) => c.id)).toEqual(["camp_luciano"]);
    const lists = await listProspectLists(mineOnly);
    expect(lists.map((l) => l.id).sort()).toEqual(["pl_luciano", "pl_mista"]);
    expect(lists.find((l) => l.id === "pl_mista")?.computed.contacts).toBe(1);
    expect(await getProspectListDetail("pl_mateus", mineOnly)).toBeNull();
    expect((await getProspectListDetail("pl_mista", mineOnly))?.prospects.map((p) => p.id)).toEqual(["pr_3"]);
    expect(await canSeeProspectListId(cu, "pl_mateus")).toBe(false);
    expect(await canSeeProspectListId(cu, "pl_mista")).toBe(true);
    expect(await canSeeProspectListId(withScopes(luciano, {}, { "marketing.prospeccao.ver": false }), "pl_luciano")).toBe(false);
    const inbox = await getInbox({ scope: mineOnly, pool: true });
    expect(inbox.messages.map((m) => m.id).sort()).toEqual(["msg_fila", "msg_lead_luciano"]);
    expect(inbox.newLeads.map((l) => l.id)).toEqual(["lead_semdono"]);
    const everything = await getInbox();
    expect(everything.messages).toHaveLength(3);
  });
});
