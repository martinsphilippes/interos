"use client";
/**
 * Seleção pendente da aba Módulos ERP, por cliente, guardada na sessão do navegador: sobrevive a recarregar a aba
 * (falha, conflito, outra pessoa alterou) e some ao fechar a aba do navegador. Sem sessionStorage (modo privado
 * restrito), vale só na memória desta página.
 */
import * as React from "react";
import { ERP_DISPLAY_MODES, type ErpDisplayDraft, type ErpDisplayMode, type ErpDraftChange, type ErpLicenseItem } from "@/domain/erp/license";

const listeners = new Set<() => void>();
const memory = new Map<string, string>();
const keyOf = (clientId: string) => `interos:erp-selecao:${clientId}`;
const displayKeyOf = (clientId: string) => `interos:erp-exibicao:${clientId}`;

function read(clientId: string, key = keyOf(clientId)): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(clientId: string, value: string | null, key = keyOf(clientId)) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    if (value) memory.set(key, value);
    else memory.delete(key);
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function parse(raw: string | null): ErpDraftChange[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((d): d is ErpDraftChange => Boolean(d) && typeof d === "object" && typeof (d as ErpDraftChange).code === "string" && typeof (d as ErpDraftChange).state === "string");
  } catch {
    return [];
  }
}

/** A alteração já é o contratado (aplicada por outra pessoa ou pelo envio): não conta mais como pendente. */
export function isNoopDraft(d: ErpDraftChange, current: ErpLicenseItem | undefined): boolean {
  if (d.state === "inactive") return !current || current.state === "inactive";
  return current?.state === d.state && (current.until ?? null) === (d.until ?? null) && (current.effectiveAt ?? null) === (d.effectiveAt ?? null);
}

export interface ErpDraftState {
  /** Alterações pendentes que ainda diferem do contratado. */
  draft: ReadonlyMap<string, ErpDraftChange>;
  list: ErpDraftChange[];
  set: (code: string, change: ErpDraftChange | null) => void;
  clear: () => void;
}

export function useErpDraft(clientId: string, contracted: ReadonlyMap<string, ErpLicenseItem>): ErpDraftState {
  const raw = React.useSyncExternalStore(
    subscribe,
    () => read(clientId),
    () => null,
  );
  const list = React.useMemo(() => parse(raw).filter((d) => !isNoopDraft(d, contracted.get(d.code))), [raw, contracted]);
  const draft = React.useMemo(() => new Map(list.map((d) => [d.code, d])), [list]);
  // o que já é o contratado (aplicado por outra pessoa, outra aba ou pelo envio) sai da sessão: não volta a aparecer
  // como pendente se o contratado mudar de novo depois
  React.useEffect(() => {
    if (!raw) return;
    const all = parse(raw);
    const kept = all.filter((d) => !isNoopDraft(d, contracted.get(d.code)));
    if (kept.length !== all.length) write(clientId, kept.length ? JSON.stringify(kept) : null);
  }, [raw, contracted, clientId]);
  const set = React.useCallback(
    (code: string, change: ErpDraftChange | null) => {
      const next = new Map(parse(read(clientId)).map((d) => [d.code, d]));
      if (change && !isNoopDraft(change, contracted.get(code))) next.set(code, change);
      else next.delete(code);
      const items = [...next.values()].filter((d) => !isNoopDraft(d, contracted.get(d.code)));
      write(clientId, items.length ? JSON.stringify(items) : null);
    },
    [clientId, contracted],
  );
  const clear = React.useCallback(() => write(clientId, null), [clientId]);
  return { draft, list, set, clear };
}

// ─── Exibição preparada (fase A): o padrão da empresa e a escolha por unidade (null = volta ao padrão) ────────────

interface StoredDisplay {
  companyDefault?: ErpDisplayMode | null;
  units?: Record<string, ErpDisplayMode | null>;
}

const isMode = (v: unknown): v is ErpDisplayMode => typeof v === "string" && (ERP_DISPLAY_MODES as readonly string[]).includes(v);

function parseDisplay(raw: string | null): StoredDisplay {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as StoredDisplay;
    const units: Record<string, ErpDisplayMode | null> = {};
    for (const [code, d] of Object.entries(value?.units ?? {})) if (/^\d{2}\.\d{2}$/.test(code) && (d === null || isMode(d))) units[code] = d;
    return { companyDefault: isMode(value?.companyDefault) ? value.companyDefault : null, units };
  } catch {
    return {};
  }
}

export interface ErpDisplayDraftState {
  /** Padrão da empresa preparado (null = manter). */
  companyDefault: ErpDisplayMode | null;
  /** Escolhas por unidade preparadas que diferem da atual (null = volta ao padrão). */
  units: ReadonlyMap<string, ErpDisplayMode | null>;
  count: number;
  /** O que vai para a revisão e o envio. */
  payload: ErpDisplayDraft | null;
  setCompanyDefault: (display: ErpDisplayMode | null) => void;
  /** `undefined` desfaz a escolha preparada da unidade. */
  setUnit: (code: string, display: ErpDisplayMode | null | undefined) => void;
  clear: () => void;
}

/** Exibição preparada por cliente, na sessão do navegador (como a seleção de módulos). Some quando volta ao que vale. */
export function useErpDisplayDraft(clientId: string, current: { display: ErpDisplayMode | null; displays: ReadonlyMap<string, ErpDisplayMode> }): ErpDisplayDraftState {
  const key = displayKeyOf(clientId);
  const raw = React.useSyncExternalStore(
    subscribe,
    () => read(clientId, key),
    () => null,
  );
  const stored = React.useMemo(() => parseDisplay(raw), [raw]);
  const companyDefault = stored.companyDefault && stored.companyDefault !== current.display ? stored.companyDefault : null;
  const units = React.useMemo(() => {
    const out = new Map<string, ErpDisplayMode | null>();
    for (const [code, d] of Object.entries(stored.units ?? {})) if ((current.displays.get(code) ?? null) !== d) out.set(code, d);
    return out;
  }, [stored, current.displays]);
  // o que já vale (aplicado por outra pessoa, outra aba ou pelo envio) não fica guardado: não "ressuscita" como
  // pendente quando a exibição atual mudar de novo
  const prune = React.useCallback(
    (next: StoredDisplay): StoredDisplay => ({
      companyDefault: next.companyDefault && next.companyDefault !== current.display ? next.companyDefault : null,
      units: Object.fromEntries(Object.entries(next.units ?? {}).filter(([code, d]) => (current.displays.get(code) ?? null) !== d)),
    }),
    [current.display, current.displays],
  );
  const save = React.useCallback(
    (next: StoredDisplay) => {
      const pruned = prune(next);
      const empty = !pruned.companyDefault && !Object.keys(pruned.units ?? {}).length;
      write(clientId, empty ? null : JSON.stringify(pruned), key);
    },
    [clientId, key, prune],
  );
  React.useEffect(() => {
    if (!raw) return;
    const prev = parseDisplay(raw);
    const pruned = prune(prev);
    if ((pruned.companyDefault ?? null) !== (prev.companyDefault ?? null) || Object.keys(pruned.units ?? {}).length !== Object.keys(prev.units ?? {}).length) save(pruned);
  }, [raw, prune, save]);
  const setCompanyDefault = React.useCallback((display: ErpDisplayMode | null) => save({ ...parseDisplay(read(clientId, key)), companyDefault: display }), [save, clientId, key]);
  const setUnit = React.useCallback(
    (code: string, display: ErpDisplayMode | null | undefined) => {
      const prev = parseDisplay(read(clientId, key));
      const nextUnits = { ...(prev.units ?? {}) };
      if (display === undefined || (current.displays.get(code) ?? null) === display) delete nextUnits[code];
      else nextUnits[code] = display;
      save({ ...prev, units: nextUnits });
    },
    [save, clientId, key, current.displays],
  );
  const clear = React.useCallback(() => write(clientId, null, key), [clientId, key]);
  const payload = React.useMemo<ErpDisplayDraft | null>(
    () => (companyDefault || units.size ? { companyDefault, units: [...units].map(([code, display]) => ({ code, display })) } : null),
    [companyDefault, units],
  );
  return { companyDefault, units, count: (companyDefault ? 1 : 0) + units.size, payload, setCompanyDefault, setUnit, clear };
}
