/**
 * Estado de cada unidade na tela da empresa, em três grupos independentes (nunca um campo só para situações
 * diferentes):
 * - comercial (INTEROS): o que foi contratado — contratado, em teste, agendado, suspenso, desligado, não contratado;
 * - operacional (ERP): o que o ERP aplicou — ativo, em encerramento, somente leitura, inativo, indisponível — e se há
 *   configuração pendente na empresa;
 * - sincronização: sincronizado, aguardando aprovação, processando, falha ou divergente.
 * Daí sai um rótulo principal (o mais importante para agir agora). Módulo puro.
 */
import type { ErpLicenseItemState } from "./types";
import { isUnitSellable, type ErpCatalogIndex, type ErpCatalogItem } from "./catalog";
import { ERP_ITEM_STATE_LABELS, isOnState, type ErpControlMode, type ErpLicenseItem } from "./license";

/** Entrada do runtime (contrato de módulos v1, `GET /companies/{id}/modules`), por chave v1. */
export interface ErpRuntimeModule {
  module: string;
  name?: string | null;
  state: string;
  since?: string | null;
  drainUntil?: string | null;
  history?: string | null;
  access?: string | null;
  accessIfEnforced?: string | null;
  source?: string | null;
  configuration?: { ready: boolean; missing: string[] } | null;
}

/** Estado efetivo da licença (contrato v2, `GET /companies/{id}/license` → `effective`), por chave v1. */
export interface ErpEffectiveEntry {
  unit: string;
  on: boolean;
  state: string;
  notice?: string | null;
}

export type ErpOperationalState = "ativo" | "em_encerramento" | "somente_leitura" | "inativo" | "indisponivel" | "desconhecido";
export type ErpSyncState = "sincronizado" | "aguardando_aprovacao" | "processando" | "falha" | "divergente";
export type ErpUnitPrimary =
  | "falha"
  | "processando"
  | "aguardando_aprovacao"
  | "divergente"
  | "agendado"
  | "em_encerramento"
  | "aguardando_configuracao"
  | "em_teste"
  | "ativo"
  | "somente_leitura"
  | "suspenso"
  | "desativado"
  | "nao_contratado"
  | "indisponivel";

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral" | "muted";

export const ERP_PRIMARY_LABELS: Record<ErpUnitPrimary, string> = {
  falha: "Falha",
  processando: "Processando",
  aguardando_aprovacao: "Aguardando aprovação",
  divergente: "Divergente",
  agendado: "Alteração agendada",
  em_encerramento: "Em encerramento",
  aguardando_configuracao: "Aguardando configuração",
  em_teste: "Em teste",
  ativo: "Ativo",
  somente_leitura: "Somente leitura",
  suspenso: "Suspenso",
  desativado: "Desativado",
  nao_contratado: "Não contratado",
  indisponivel: "Indisponível",
};

export const ERP_PRIMARY_TONES: Record<ErpUnitPrimary, StatusTone> = {
  falha: "danger",
  processando: "info",
  aguardando_aprovacao: "warning",
  divergente: "warning",
  agendado: "info",
  em_encerramento: "warning",
  aguardando_configuracao: "warning",
  em_teste: "info",
  ativo: "success",
  somente_leitura: "neutral",
  suspenso: "warning",
  desativado: "neutral",
  nao_contratado: "muted",
  indisponivel: "muted",
};

export const ERP_OPERATIONAL_LABELS: Record<ErpOperationalState, string> = {
  ativo: "Ativo no ERP",
  em_encerramento: "Em encerramento (só conclui pendências)",
  somente_leitura: "Consulta histórica",
  inativo: "Inativo no ERP",
  indisponivel: "Indisponível no ERP",
  desconhecido: "Sem leitura do ERP",
};

export const ERP_SYNC_LABELS: Record<ErpSyncState, string> = {
  sincronizado: "Sincronizado",
  aguardando_aprovacao: "Aguardando aprovação",
  processando: "Processando no ERP",
  falha: "Falha na sincronização",
  divergente: "Divergente do contratado",
};

export interface UnitSignals {
  /** A unidade está numa alteração aberta (enviando, aguardando nova tentativa ou aprovação). */
  openChange?: { status: "aguardando_aprovacao" | "enviando" | "falhou" } | null;
  /** O último envio que tocou esta unidade foi recusado (motivo do ERP). */
  rejected?: string | null;
}

export interface ErpUnitStatus {
  code: string;
  sellable: boolean;
  commercial: { state: ErpLicenseItemState | null; label: string };
  operational: { state: ErpOperationalState; label: string; since: string | null; until: string | null };
  configuration: { ready: boolean; missing: string[] } | null;
  sync: { state: ErpSyncState; label: string };
  primary: ErpUnitPrimary;
  label: string;
  tone: StatusTone;
  /** Aviso do ERP (carência de teste, acesso preservado, cascata) ou motivo da recusa. */
  notice: string | null;
}

function operationalOf(runtime: ErpRuntimeModule | null, effective: ErpEffectiveEntry | null, sellable: boolean): ErpUnitStatus["operational"] {
  if (runtime) {
    const since = runtime.since ?? null;
    switch (runtime.state) {
      case "enabled":
      case "scheduled_off":
        return { state: runtime.access === "drain" ? "em_encerramento" : "ativo", label: runtime.access === "drain" ? ERP_OPERATIONAL_LABELS.em_encerramento : ERP_OPERATIONAL_LABELS.ativo, since, until: runtime.state === "scheduled_off" ? (runtime.drainUntil ?? null) : null };
      case "draining":
        return { state: "em_encerramento", label: ERP_OPERATIONAL_LABELS.em_encerramento, since, until: runtime.drainUntil ?? null };
      case "disabled":
        return runtime.access === "read" ? { state: "somente_leitura", label: ERP_OPERATIONAL_LABELS.somente_leitura, since, until: null } : { state: "inativo", label: ERP_OPERATIONAL_LABELS.inativo, since, until: null };
      case "absent":
        return { state: sellable ? "inativo" : "indisponivel", label: sellable ? ERP_OPERATIONAL_LABELS.inativo : ERP_OPERATIONAL_LABELS.indisponivel, since: null, until: null };
      default:
        return { state: "desconhecido", label: ERP_OPERATIONAL_LABELS.desconhecido, since, until: null };
    }
  }
  if (effective) return effective.on ? { state: "ativo", label: ERP_OPERATIONAL_LABELS.ativo, since: null, until: null } : { state: "inativo", label: ERP_OPERATIONAL_LABELS.inativo, since: null, until: null };
  return { state: sellable ? "desconhecido" : "indisponivel", label: sellable ? ERP_OPERATIONAL_LABELS.desconhecido : ERP_OPERATIONAL_LABELS.indisponivel, since: null, until: null };
}

/**
 * Estado de uma unidade. `contracted` = item do último retrato confirmado pelo ERP (o contratado vigente); `runtime` e
 * `effective` vêm da leitura do ERP (null quando não há leitura — ERP fora do ar ou ainda sem licença).
 */
export function unitStatus(input: {
  item: ErpCatalogItem;
  contracted: ErpLicenseItem | null;
  runtime: ErpRuntimeModule | null;
  effective: ErpEffectiveEntry | null;
  mode: ErpControlMode | null;
  signals?: UnitSignals;
}): ErpUnitStatus {
  const { item, contracted, runtime, effective, signals } = input;
  const sellable = isUnitSellable(item);
  const commercialState = contracted?.state ?? null;
  const commercial = { state: commercialState, label: commercialState ? ERP_ITEM_STATE_LABELS[commercialState] : "Não contratado" };
  const operational = operationalOf(runtime, effective, sellable);
  const configuration = runtime?.configuration && (operational.state === "ativo" || operational.state === "em_encerramento") ? { ready: Boolean(runtime.configuration.ready), missing: runtime.configuration.missing ?? [] } : null;

  // O ERP liga quem está contratado como ligado; em modo legado ele não aplica nada, então não há divergência a apontar.
  const wantsOn = isOnState(commercialState);
  const isOn = operational.state === "ativo" || operational.state === "em_encerramento";
  const comparable = input.mode !== "legacy" && operational.state !== "desconhecido" && operational.state !== "indisponivel";
  const divergent = comparable && commercialState !== null && commercialState !== "activation_scheduled" && wantsOn !== isOn;

  let sync: ErpSyncState = "sincronizado";
  if (signals?.openChange?.status === "enviando") sync = "processando";
  else if (signals?.openChange?.status === "aguardando_aprovacao") sync = "aguardando_aprovacao";
  else if (signals?.openChange?.status === "falhou" || signals?.rejected) sync = "falha";
  else if (divergent) sync = "divergente";

  let primary: ErpUnitPrimary;
  if (sync === "falha") primary = "falha";
  else if (sync === "processando") primary = "processando";
  else if (sync === "aguardando_aprovacao") primary = "aguardando_aprovacao";
  else if (sync === "divergente") primary = "divergente";
  else if (commercialState === "activation_scheduled" || commercialState === "suspension_scheduled" || runtime?.state === "scheduled_off") primary = "agendado";
  else if (operational.state === "em_encerramento") primary = "em_encerramento";
  else if (isOn && configuration && !configuration.ready) primary = "aguardando_configuracao";
  else if (commercialState === "trial") primary = "em_teste";
  else if (wantsOn || (commercialState === null && isOn)) primary = "ativo";
  else if (commercialState === "read_only" || commercialState === "expired") primary = commercialState === "expired" ? "desativado" : "somente_leitura";
  else if (commercialState === "suspended") primary = "suspenso";
  else if (commercialState === "inactive") primary = "desativado";
  else primary = sellable ? "nao_contratado" : "indisponivel";

  return {
    code: item.code,
    sellable,
    commercial,
    operational,
    configuration,
    sync: { state: sync, label: ERP_SYNC_LABELS[sync] },
    primary,
    label: ERP_PRIMARY_LABELS[primary],
    tone: ERP_PRIMARY_TONES[primary],
    notice: signals?.rejected ?? effective?.notice ?? null,
  };
}

export interface ModuleSummary {
  code: string;
  /** Submódulos existentes no catálogo (todos os papéis). */
  submodules: number;
  /** Unidades contratáveis do módulo. */
  units: number;
  /** Unidades contratadas (qualquer estado ligado, teste ou agendado). */
  contracted: number;
  /** Unidades ligadas agora no ERP. */
  active: number;
  /** Unidades vendáveis ainda não contratadas. */
  available: number;
  /** Itens da plataforma (sempre ativos). */
  core: number;
  /** Parte das unidades vendáveis está ligada (não confundir com módulo parcialmente implementado). */
  partial: boolean;
  /** O ERP ainda não implementou tudo do módulo (situação técnica). */
  partiallyImplemented: boolean;
  attention: number;
}

/** Resumo de um módulo para o cabeçalho da seção recolhível. */
export function moduleSummary(index: ErpCatalogIndex, moduleCode: string, statusByUnit: ReadonlyMap<string, ErpUnitStatus>): ModuleSummary {
  const children = index.childrenOf(moduleCode);
  const units = children.filter((c) => c.unit);
  const statuses = units.map((u) => statusByUnit.get(u.code)).filter((s): s is ErpUnitStatus => Boolean(s));
  const contracted = statuses.filter((s) => s.commercial.state !== null && s.commercial.state !== "inactive" && s.commercial.state !== "expired").length;
  const active = statuses.filter((s) => s.operational.state === "ativo" || s.operational.state === "em_encerramento").length;
  const sellableUnits = units.filter(isUnitSellable);
  const available = sellableUnits.filter((u) => {
    const s = statusByUnit.get(u.code);
    return !s || s.commercial.state === null || s.commercial.state === "inactive" || s.commercial.state === "expired";
  }).length;
  const attention = statuses.filter((s) => ["falha", "divergente", "aguardando_configuracao", "aguardando_aprovacao"].includes(s.primary)).length;
  return {
    code: moduleCode,
    submodules: children.length,
    units: units.length,
    contracted,
    active,
    available,
    core: children.filter((c) => index.roleOf(c.code) === "core").length,
    partial: active > 0 && active < sellableUnits.length,
    partiallyImplemented: children.some((c) => c.devStatus !== "OP"),
    attention,
  };
}
