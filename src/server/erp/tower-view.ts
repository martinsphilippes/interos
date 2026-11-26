import "server-only";
/**
 * Torre de Controle da empresa no INTEROS: indicadores do ERP (resumo + adoção) cruzados com a licença e o estado
 * operacional das unidades, para separar módulo desativado, sem movimento e dado indisponível.
 */
import type { TowerAdoption, TowerMeta } from "./api-torre";
import { getTowerAdoption, getTowerSummary } from "./api-torre";
import { towerBlocks, type TowerBlockView, type TowerUnitState, TOWER_BLOCKS } from "@/domain/erp/tower";
import { isOnState } from "@/domain/erp/license";
import { getUsage } from "./api-licencas";
import { getErpConfig } from "./config";
import { ErpError, erpErrorSummary } from "./errors";
import { getCurrentCatalog } from "./catalog-store";
import { getErpLink } from "./links";
import { getLicenseRecord, listClientChanges, readErpState } from "./changes";

const READ_TIMEOUT_MS = 10_000;

export interface ErpTowerView {
  configured: boolean;
  linked: boolean;
  period: { de: string; ate: string };
  meta: TowerMeta | null;
  blocks: TowerBlockView[];
  adoption: TowerAdoption | null;
  error: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

/** Período padrão: do dia 1º do mês corrente até hoje (fuso do ERP, São Paulo). */
export function defaultTowerPeriod(now = new Date()): { de: string; ate: string } {
  const local = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const ate = local.toISOString().slice(0, 10);
  return { de: `${ate.slice(0, 8)}01`, ate };
}

/** Período válido para a Torre (AAAA-MM-DD, de ≤ até, no máximo 400 dias); senão o padrão. */
export function normalizeTowerPeriod(input: { de?: string | null; ate?: string | null } | null | undefined, now = new Date()): { de: string; ate: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const de = input?.de && re.test(input.de) ? input.de : null;
  const ate = input?.ate && re.test(input.ate) ? input.ate : null;
  if (!de || !ate) return defaultTowerPeriod(now);
  const span = (Date.parse(ate) - Date.parse(de)) / DAY;
  if (!(span >= 0) || span > 399) return defaultTowerPeriod(now);
  return { de, ate };
}

export async function getErpTowerView(clientId: string, periodInput?: { de?: string | null; ate?: string | null }): Promise<ErpTowerView> {
  const period = normalizeTowerPeriod(periodInput);
  const config = getErpConfig();
  const empty: ErpTowerView = { configured: Boolean(config?.towerCredential), linked: false, period, meta: null, blocks: [], adoption: null, error: null };
  if (!config?.towerCredential) return empty;
  const link = await getErpLink(clientId, config.environment);
  if (!link) return empty;

  const [summary, adoption, reading, record, loaded, history] = await Promise.all([
    getTowerSummary(link.erpCompanyId, period).then((r) => r.data, (e: unknown) => e),
    getTowerAdoption(link.erpCompanyId).then((r) => r.data, () => null),
    config.licenseToken ? readErpState(link.erpCompanyId, READ_TIMEOUT_MS) : Promise.resolve(null),
    getLicenseRecord(link.id),
    getCurrentCatalog(config.environment),
    listClientChanges(clientId, 100),
  ]);

  // Estado das unidades que alimentam cada bloco: ligada agora, já contratada, desde quando está desligada.
  const unitCodes = new Set(TOWER_BLOCKS.flatMap((b) => b.units));
  const units = new Map<string, TowerUnitState>();
  const runtimeByKey = new Map((reading?.runtime?.modules ?? []).map((m) => [m.module, m]));
  const contracted = new Map((record?.current?.items ?? []).map((i) => [i.code, i]));
  for (const code of unitCodes) {
    const item = loaded?.index.byCode.get(code);
    const runtime = item?.v1Key ? runtimeByKey.get(item.v1Key) : undefined;
    const lic = contracted.get(code);
    const runtimeOn = runtime ? runtime.state === "enabled" || runtime.state === "scheduled_off" || runtime.state === "draining" : null;
    const on = runtimeOn ?? isOnState(lic?.state ?? null);
    const lastOff = history.find((c) => c.status === "aplicada" && c.plan.some((p) => p.code === code && !isOnState(p.to)));
    const offSince = !on ? (runtime?.state === "disabled" ? (runtime.since ?? null) : null) ?? lastOff?.result?.at ?? null : null;
    units.set(code, {
      code,
      on,
      contracted: Boolean(lic) || runtime?.state === "disabled" || runtime?.state === "draining",
      offSince,
      history: runtime?.history === "none" ? "none" : runtime ? "read" : null,
    });
  }

  if (summary instanceof Error || (summary && typeof summary === "object" && "kind" in (summary as object) && summary instanceof ErpError)) {
    const message = summary instanceof ErpError ? erpErrorSummary(summary) : "Não foi possível ler a Torre de Controle agora.";
    return { ...empty, linked: true, blocks: towerBlocks(null, units), adoption, error: message };
  }
  const data = summary as Record<string, unknown> & { meta: TowerMeta };
  return { configured: true, linked: true, period, meta: data.meta ?? null, blocks: towerBlocks(data, units), adoption, error: null };
}

export interface ErpUsageView {
  from: string;
  to: string;
  totals: Record<string, unknown> | null;
  limits: { contracted: Record<string, number> | null; used: Record<string, number> | null } | null;
  /** Uso por unidade do catálogo (só as que o ERP mede). */
  byUnit: Record<string, { name: string; operations: number; lastUseAt: string | null }>;
  error: string | null;
}

/** Uso da empresa no ERP (padrão: últimos 30 dias). Sob demanda: a ficha não lê isso a cada abertura. */
export async function getErpUsageView(clientId: string, now = new Date()): Promise<ErpUsageView> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - 30 * DAY).toISOString();
  const empty: ErpUsageView = { from, to, totals: null, limits: null, byUnit: {}, error: null };
  const config = getErpConfig();
  if (!config?.licenseToken) return { ...empty, error: "A integração com o ERP não está configurada neste ambiente." };
  const link = await getErpLink(clientId, config.environment);
  if (!link) return { ...empty, error: "Cliente ainda não vinculado a uma empresa do ERP." };
  try {
    const res = await getUsage(link.erpCompanyId, from, to);
    const data = res.data as { from?: string; to?: string; totals?: Record<string, unknown>; limits?: ErpUsageView["limits"]; modules?: Record<string, { unit?: string; name?: string; operations?: number; lastUseAt?: string | null }> };
    const byUnit: ErpUsageView["byUnit"] = {};
    for (const [key, m] of Object.entries(data.modules ?? {})) {
      const unit = m.unit ?? key;
      const prev = byUnit[unit];
      const operations = (prev?.operations ?? 0) + (Number(m.operations) || 0);
      const lastUseAt = [prev?.lastUseAt ?? null, m.lastUseAt ?? null].filter(Boolean).sort().at(-1) ?? null;
      byUnit[unit] = { name: m.name ?? prev?.name ?? unit, operations, lastUseAt };
    }
    return { from: data.from ?? from, to: data.to ?? to, totals: data.totals ?? null, limits: data.limits ?? null, byUnit, error: null };
  } catch (error) {
    return { ...empty, error: error instanceof ErpError ? erpErrorSummary(error) : "Não foi possível ler o uso no ERP agora." };
  }
}
