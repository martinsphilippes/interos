"use client";
/**
 * Seleção pendente da aba Módulos ERP, por cliente, guardada na sessão do navegador: sobrevive a recarregar a aba
 * (falha, conflito, outra pessoa alterou) e some ao fechar a aba do navegador. Sem sessionStorage (modo privado
 * restrito), vale só na memória desta página.
 */
import * as React from "react";
import type { ErpDraftChange, ErpLicenseItem } from "@/domain/erp/license";

const listeners = new Set<() => void>();
const memory = new Map<string, string>();
const keyOf = (clientId: string) => `interos:erp-selecao:${clientId}`;

function read(clientId: string): string | null {
  try {
    return window.sessionStorage.getItem(keyOf(clientId));
  } catch {
    return memory.get(keyOf(clientId)) ?? null;
  }
}

function write(clientId: string, value: string | null) {
  const key = keyOf(clientId);
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
