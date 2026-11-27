/**
 * ERP Intercert simulado para os testes de banco: responde às rotas que o INTEROS usa (catálogo v2, licença v2 com
 * simulação/envio assinado/histórico e módulos v1) com as regras verificadas no ERP real: versão final por empresa
 * (`duplicate`, `stale`), mesmo evento devolve a resposta original, `licenseVersion` ≤ aplicada = `stale`, envelope
 * `{ data, meta }`. Também simula queda (rede), resposta perdida (aplica e falha a conexão) e pendências operacionais.
 */
import { readFileSync } from "node:fs";
import type { ErpFetch } from "@/server/erp/http";
import type { ErpLicenseSnapshot } from "@/domain/erp/license";

const CATALOG = JSON.parse(readFileSync(new URL("./fixtures/catalogo-v2-recorte.json", import.meta.url), "utf8")) as { v1Compatibility?: { unitsByV1Key?: Record<string, string> } };
const UNIT_BY_KEY: Record<string, string> = CATALOG.v1Compatibility?.unitsByV1Key ?? {};
const KEY_BY_UNIT: Record<string, string> = Object.fromEntries(Object.entries(UNIT_BY_KEY).map(([k, u]) => [u, k]));

export interface FakeCompany {
  id: string;
  name: string;
  kind: string;
  mode: string;
  runtimeVersion: number;
  appliedVersion: number;
  /** Estado por chave v1 (enabled, disabled, draining...). */
  modules: Map<string, string>;
  /** Pendências que o ERP aponta ao desligar (chave v1 → bloqueios). */
  blockers: Map<string, { key: string; label: string; count: number }[]>;
  history: { licenseVersion: number; status: string; eventId: string; at: string; rejectedItems: unknown[] }[];
  current: ErpLicenseSnapshot | null;
}

type Next = "network" | "lost_response" | "busy" | null;

export interface FakeErp {
  fetch: ErpFetch;
  companies: Map<string, FakeCompany>;
  calls: { method: string; path: string; eventId: string | null; body: unknown }[];
  /** Próximos PUTs: queda antes de chegar, aplicado mas a resposta se perde, ou empresa ocupada. */
  failNextPut: (...modes: Next[]) => void;
  /** Próximas leituras falham (ERP fora do ar). */
  downReads: (n: number) => void;
  addCompany: (id: string, name: string, enabledUnits: string[]) => FakeCompany;
}

const ok = (status: number, data: unknown) => new Response(JSON.stringify({ data, meta: { apiVersion: "2", requestId: `req-${Math.random().toString(36).slice(2, 10)}` } }), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message }, meta: { apiVersion: "2", requestId: "req-err" } }), { status, headers: { "content-type": "application/json" } });

/** Cópia do catálogo do recorte, para um teste ajustar sem afetar os outros (ex.: incluir um "basta um"). */
export function fixtureCatalog(): { items: Record<string, unknown>[] } & Record<string, unknown> {
  return structuredClone(CATALOG) as { items: Record<string, unknown>[] } & Record<string, unknown>;
}

export function createFakeErp(options: { catalog?: unknown } = {}): FakeErp {
  const catalog = options.catalog ?? CATALOG;
  const companies = new Map<string, FakeCompany>();
  const calls: FakeErp["calls"] = [];
  const eventResults = new Map<string, { bodyHash: string; status: number; data: unknown }>();
  const putQueue: Next[] = [];
  let downReads = 0;

  const runtimeOf = (c: FakeCompany) => ({
    companyId: c.id,
    companyName: c.name,
    companyKind: c.kind,
    companyStatus: "active",
    operational: true,
    mode: c.mode,
    version: c.runtimeVersion,
    catalogVersion: "2026.11",
    baseline: null,
    modules: [...c.modules.entries()].map(([module, state]) => ({ module, state, since: "2026-11-01T12:00:00.000Z", access: state === "draining" ? "drain" : null })),
  });
  const effectiveOf = (c: FakeCompany) => Object.fromEntries([...c.modules.entries()].filter(([k]) => UNIT_BY_KEY[k]).map(([k, s]) => [k, { unit: UNIT_BY_KEY[k], on: s === "enabled" || s === "scheduled_off" || s === "draining", state: s }]));
  const statusOf = (c: FakeCompany) => ({
    companyId: c.id,
    companyName: c.name,
    appliedVersion: c.appliedVersion,
    commercialStatus: c.current?.commercialStatus ?? null,
    display: "hidden",
    limits: null,
    effective: effectiveOf(c),
    rejectedItems: [],
    warnings: [],
    appliedAt: null,
    nextTransitionAt: null,
    runtime: { mode: c.mode, version: c.runtimeVersion },
    sync: { lastSnapshotAt: null, lastSyncAt: null, lastSyncResult: null },
  });

  /** Unidades que o retrato deixa ligadas agora. */
  const onUnits = (snap: ErpLicenseSnapshot) => new Set(snap.items.filter((i) => ["active", "trial", "suspension_scheduled"].includes(i.state)).map((i) => i.code));

  function apply(c: FakeCompany, snap: ErpLicenseSnapshot) {
    const on = onUnits(snap);
    for (const [unit, key] of Object.entries(KEY_BY_UNIT)) {
      const was = c.modules.get(key);
      if (on.has(unit)) c.modules.set(key, "enabled");
      else if (was === "enabled") c.modules.set(key, c.blockers.get(key)?.length ? "draining" : "disabled");
    }
    if (snap.controlMode) c.mode = snap.controlMode;
    c.runtimeVersion += 1;
    c.appliedVersion = snap.licenseVersion;
    c.current = snap;
  }

  const fetch: ErpFetch = async (url, init) => {
    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const eventId = headers["X-Interos-Event-Id"] ?? headers["x-interos-event-id"] ?? null;
    const raw = typeof init?.body === "string" ? init.body : null;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method, path: u.pathname, eventId, body });
    const m = u.pathname.match(/^\/api\/interos\/(v1|v2)\/(.*)$/);
    if (!m) return fail(404, "not_found", "rota");
    const [, version, rest] = m;

    if (method === "GET" && downReads > 0 && rest !== "catalog") {
      downReads -= 1;
      throw new TypeError("fetch failed");
    }
    if (version === "v2" && rest === "catalog" && method === "GET") return ok(200, catalog);

    const cm = rest.match(/^companies\/([^/]+)(\/.*)?$/);
    if (!cm) return fail(404, "not_found", "rota");
    const company = companies.get(decodeURIComponent(cm[1]));
    const tail = cm[2] ?? "";
    if (!company) return fail(404, "company_not_found", "Empresa não encontrada.");

    if (version === "v1" && tail === "/modules" && method === "GET") return ok(200, runtimeOf(company));
    if (version === "v2" && tail === "/license" && method === "GET") return ok(200, statusOf(company));
    if (version === "v2" && tail === "/license/history" && method === "GET") return ok(200, [...company.history].sort((a, b) => b.licenseVersion - a.licenseVersion));
    if (version === "v2" && tail === "/license/simulate" && method === "POST") {
      const snap = body as ErpLicenseSnapshot;
      const on = onUnits(snap);
      const impacts = [...company.modules.entries()]
        .filter(([key, state]) => state === "enabled" && UNIT_BY_KEY[key] && !on.has(UNIT_BY_KEY[key]))
        .map(([key]) => ({ module: key, name: key, action: "disable", from: "enabled", to: company.blockers.get(key)?.length ? "draining" : "disabled", policy: company.blockers.get(key)?.length ? "drain" : "immediate", blockers: company.blockers.get(key) ?? [], obligations: [], integrationsAffected: [] }));
      return ok(200, { companyId: company.id, licenseVersion: snap.licenseVersion, appliedVersion: company.appliedVersion, stale: snap.licenseVersion <= company.appliedVersion, changes: [], rejectedItems: [], warnings: [], effective: {}, companyState: "active", nextTransitionAt: null, simulation: { impacts, errors: [], warnings: [] }, valid: true });
    }
    if (version === "v2" && tail === "/license" && method === "PUT") {
      const snap = body as ErpLicenseSnapshot;
      const mode = putQueue.shift() ?? null;
      if (mode === "network") throw new TypeError("fetch failed");
      if (mode === "busy") return fail(409, "license_busy", "Outro retrato desta empresa está sendo aplicado.");
      if (eventId && eventResults.has(eventId)) {
        const prev = eventResults.get(eventId)!;
        if (prev.bodyHash !== raw) return fail(409, "event_replay_mismatch", "Evento já usado com outro corpo.");
        return ok(prev.status, prev.data);
      }
      const stored = company.history.find((h) => h.licenseVersion === snap.licenseVersion);
      let result: { status: number; data: Record<string, unknown> };
      if (stored) result = { status: 200, data: { status: stored.status === "applied" ? "duplicate" : stored.status, appliedVersion: company.appliedVersion, runtimeVersion: company.runtimeVersion, rejectedItems: [], warnings: [], effective: null, nextTransitionAt: null } };
      else if (snap.licenseVersion <= company.appliedVersion) {
        company.history.push({ licenseVersion: snap.licenseVersion, status: "stale", eventId: eventId ?? "", at: new Date().toISOString(), rejectedItems: [] });
        result = { status: 200, data: { status: "stale", appliedVersion: company.appliedVersion, runtimeVersion: company.runtimeVersion, rejectedItems: [], warnings: [], effective: null, nextTransitionAt: null } };
      } else {
        apply(company, snap);
        company.history.push({ licenseVersion: snap.licenseVersion, status: "applied", eventId: eventId ?? "", at: new Date().toISOString(), rejectedItems: [] });
        result = { status: 201, data: { status: "applied", appliedVersion: company.appliedVersion, runtimeVersion: company.runtimeVersion, rejectedItems: [], warnings: [], effective: effectiveOf(company), nextTransitionAt: null } };
      }
      if (eventId) eventResults.set(eventId, { bodyHash: raw ?? "", status: result.status, data: result.data });
      if (mode === "lost_response") throw new TypeError("socket hang up");
      return ok(result.status, result.data);
    }
    return fail(404, "not_found", "rota");
  };

  return {
    fetch,
    companies,
    calls,
    failNextPut: (...modes) => putQueue.push(...modes),
    downReads: (n) => {
      downReads = n;
    },
    addCompany: (id, name, enabledUnits) => {
      const modules = new Map<string, string>();
      for (const unit of enabledUnits) if (KEY_BY_UNIT[unit]) modules.set(KEY_BY_UNIT[unit], "enabled");
      const c: FakeCompany = { id, name, kind: "varejo", mode: "legacy", runtimeVersion: 1, appliedVersion: 0, modules, blockers: new Map(), history: [], current: null };
      companies.set(id, c);
      return c;
    },
  };
}
