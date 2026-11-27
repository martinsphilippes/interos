/**
 * Licença do ERP Intercert por empresa (contrato v2): o INTEROS é a fonte do que foi CONTRATADO e envia sempre o
 * retrato completo e versionado (`PUT /api/interos/v2/companies/{id}/license`); o ERP confirma o que aplicou.
 * Módulo puro: monta o retrato a partir do último confirmado + as alterações preparadas, explica o conjunto
 * (dependências incluídas, desligamentos em cascata), decide o que precisa de aprovação e deriva os três estados de
 * cada unidade (comercial, operacional e sincronização) para a tela.
 *
 * Regras do contrato que este módulo respeita:
 * - só UNIDADES comerciais vão no retrato, sempre explícitas: licenciar o módulo inteiro ("07") faria o ERP incluir
 *   sozinho unidades novas do catálogo, sem contrato;
 * - unidade ligada no ERP que o retrato não lista é desligada; unidade listada como ativa sem uma dependência
 *   obrigatória faz o ERP recusar o retrato inteiro — por isso a cascata é explícita;
 * - cada envio usa uma versão nova (a recusada continua recusada para sempre no ERP).
 */
import type { ErpLicenseItemState } from "./types";
import { compareCodes, dependentsClosure, isUnitSellable, requiredClosure, type ErpCatalogIndex } from "./catalog";

export type ErpControlMode = "legacy" | "shadow" | "enforced";
export type ErpDisplayMode = "hidden" | "locked" | "upsell";

/** Item recusado ou aviso do ERP sobre o retrato (motivo do contrato: not_homologated, dependency_missing...). */
export interface ErpItemIssue {
  code: string;
  reason: string;
  message: string;
}

export interface ErpLicenseItem {
  code: string;
  state: ErpLicenseItemState;
  until?: string | null;
  effectiveAt?: string | null;
  reason?: string | null;
}

export interface ErpLicenseSnapshot {
  licenseVersion: number;
  companyId: string;
  product: "erp-intercert";
  commercialStatus: ErpLicenseItemState;
  activationAt?: string | null;
  validUntil?: string | null;
  trial?: { until: string | null } | null;
  branches?: { mode: "all" | "list"; branchIds: string[] } | null;
  limits?: { users?: number | null; devices?: number | null; branches?: number | null; fiscalDocumentsPerMonth?: number | null } | null;
  display?: ErpDisplayMode | null;
  controlMode?: ErpControlMode | null;
  items: ErpLicenseItem[];
  issuedAt: string;
}

export const ERP_ITEM_STATE_LABELS: Record<ErpLicenseItemState, string> = {
  active: "Contratado",
  inactive: "Desligado",
  trial: "Em teste",
  activation_scheduled: "Ativação agendada",
  suspension_scheduled: "Desligamento agendado",
  suspended: "Suspenso",
  expired: "Expirado",
  read_only: "Somente leitura",
};

export const ERP_CONTROL_MODE_LABELS: Record<ErpControlMode, string> = {
  legacy: "Legado (o ERP ainda não aplica o contrato)",
  shadow: "Observação (o ERP registra o que seria bloqueado, sem bloquear)",
  enforced: "Aplicado (o ERP libera só o contratado)",
};

/** Estados em que a unidade fica LIGADA agora (teste e desligamento agendado continuam ligados até a data). */
export function isOnState(state: ErpLicenseItemState | null | undefined): boolean {
  return state === "active" || state === "trial" || state === "suspension_scheduled";
}

/** Estados de desligamento (o histórico fica em consulta conforme a política do ERP). */
export function isOffState(state: ErpLicenseItemState | null | undefined): boolean {
  return state === "inactive" || state === "suspended" || state === "expired" || state === "read_only";
}

/** Uma alteração preparada na tela, por unidade. */
export interface ErpDraftChange {
  code: string;
  /** Estado pedido para a unidade. */
  state: ErpLicenseItemState;
  /** Fim do teste. */
  until?: string | null;
  /** Data da ativação/desligamento agendado. */
  effectiveAt?: string | null;
}

export interface PlannedChange {
  code: string;
  from: ErpLicenseItemState | null;
  to: ErpLicenseItemState;
  until?: string | null;
  effectiveAt?: string | null;
  /** Por que entra no lote: pedido pela pessoa, incluída por dependência ou desligada em cascata. */
  origin: "pedido" | "dependencia" | "cascata";
  /** Unidade que exigiu (dependência) ou que fez cair (cascata). */
  relatedTo?: string;
}

export interface PlanIssue {
  code: string;
  reason: "nao_e_unidade" | "nao_vendavel" | "data_invalida" | "repetida" | "sem_mudanca" | "falta_alternativa";
  message: string;
}

export interface LicensePlan {
  changes: PlannedChange[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
  /** Itens do retrato resultante (unidades, em ordem de código). */
  items: ErpLicenseItem[];
}

const itemOf = (items: readonly ErpLicenseItem[]) => new Map(items.map((i) => [i.code, i]));

/**
 * Planeja o lote: aplica as alterações pedidas sobre os itens do último retrato confirmado, inclui as dependências
 * obrigatórias de quem vai ligar e desliga em cascata quem ficaria sem dependência. Nada é enviado aqui.
 * `now` só valida datas agendadas (precisam estar no futuro).
 */
export function planLicenseChanges(index: ErpCatalogIndex, currentItems: readonly ErpLicenseItem[], draft: readonly ErpDraftChange[], now: Date = new Date()): LicensePlan {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const current = itemOf(currentItems);
  const next = new Map(current);
  const changes = new Map<string, PlannedChange>();
  const seen = new Set<string>();

  for (const change of draft) {
    const item = index.byCode.get(change.code);
    if (seen.has(change.code)) {
      errors.push({ code: change.code, reason: "repetida", message: `${change.code} aparece duas vezes no lote.` });
      continue;
    }
    seen.add(change.code);
    if (!item || !item.unit) {
      errors.push({ code: change.code, reason: "nao_e_unidade", message: `${change.code} não é uma unidade comercial do catálogo (é incluído, da plataforma ou futuro).` });
      continue;
    }
    const before = current.get(change.code) ?? null;
    if (change.state === "activation_scheduled" && isOnState(before?.state)) {
      // No ERP, ativação agendada de unidade ligada a DESLIGA até a data (verificado na homologação local).
      errors.push({ code: change.code, reason: "data_invalida", message: `${item.name} já está ligado: agendar ativação o desligaria até a data.` });
      continue;
    }
    const turningOn = isOnState(change.state) || change.state === "activation_scheduled";
    if (turningOn && !isOnState(before?.state) && !isUnitSellable(item)) {
      errors.push({ code: change.code, reason: "nao_vendavel", message: `${item.name} ainda não pode ser ativado: ${item.devStatus === "EXT" ? "depende da homologação de integração externa" : "não está implementado no ERP"}.` });
      continue;
    }
    const dated = change.state === "activation_scheduled" || change.state === "suspension_scheduled" ? change.effectiveAt : change.state === "trial" ? change.until : null;
    if ((change.state === "activation_scheduled" || change.state === "suspension_scheduled" || change.state === "trial") && (!dated || Number.isNaN(Date.parse(dated)) || Date.parse(dated) <= now.getTime())) {
      errors.push({ code: change.code, reason: "data_invalida", message: `${item.name}: informe uma data futura.` });
      continue;
    }
    if (before && before.state === change.state && (before.until ?? null) === (change.until ?? null) && (before.effectiveAt ?? null) === (change.effectiveAt ?? null)) {
      warnings.push({ code: change.code, reason: "sem_mudanca", message: `${item.name} já está assim.` });
      continue;
    }
    if (!before && isOffState(change.state)) {
      warnings.push({ code: change.code, reason: "sem_mudanca", message: `${item.name} não estava contratado.` });
      continue;
    }
    const target: ErpLicenseItem = { code: change.code, state: change.state, until: change.state === "trial" ? (change.until ?? null) : null, effectiveAt: dated && change.state !== "trial" ? dated : null };
    next.set(change.code, target);
    changes.set(change.code, { code: change.code, from: before?.state ?? null, to: change.state, until: target.until, effectiveAt: target.effectiveAt, origin: "pedido" });
  }

  // Dependências de quem passa a ficar ligado (ou agendado para ligar).
  const onNow = new Set([...next.values()].filter((i) => isOnState(i.state)).map((i) => i.code));
  const turningOnCodes = [...changes.values()].filter((c) => isOnState(c.to) || c.to === "activation_scheduled").map((c) => c.code);
  for (const added of requiredClosure(index, turningOnCodes, onNow).added) {
    const unit = index.byCode.get(added.code);
    if (!unit) continue;
    const before = current.get(added.code) ?? null;
    if (!isOnState(before?.state) && !isUnitSellable(unit)) {
      errors.push({ code: added.code, reason: "nao_vendavel", message: `${index.byCode.get(added.requiredBy)?.name ?? added.requiredBy} exige ${unit.name}, que ainda não pode ser ativado.` });
      continue;
    }
    next.set(added.code, { code: added.code, state: "active" });
    onNow.add(added.code);
    changes.set(added.code, { code: added.code, from: before?.state ?? null, to: "active", origin: "dependencia", relatedTo: added.requiredBy });
  }

  // "Basta um": quem passa a ficar ligado precisa de pelo menos uma alternativa de cada grupo ligada (ou entrando no
  // lote). A escolha é de quem pede (não se adivinha qual): o lote para com a explicação.
  const willBeOn = (code: string) => {
    const state = next.get(code)?.state;
    return isOnState(state) || state === "activation_scheduled";
  };
  const labelOf = (code: string) => `${code} ${index.byCode.get(code)?.name ?? ""}`.trim();
  for (const change of [...changes.values()]) {
    if (!(isOnState(change.to) || change.to === "activation_scheduled")) continue;
    for (const group of index.requiredAnyUnitsOf(change.code)) {
      if (group.some(willBeOn)) continue;
      const names = group.map(labelOf);
      const options = names.length > 1 ? `${names.slice(0, -1).join(", ")} ou ${names[names.length - 1]}` : names[0];
      errors.push({ code: change.code, reason: "falta_alternativa", message: `${index.byCode.get(change.code)?.name ?? change.code} exige um destes: ${options}. Inclua um deles no pedido.` });
    }
  }

  // Cascata de quem desliga (agora ou na data agendada): dependentes ainda ligados perderiam a dependência. O ERP
  // recusaria o retrato com eles listados como ativos, então eles entram explicitamente, no mesmo estado da causa.
  const turningOff = [...changes.values()].filter((c) => isOnState(c.from) && (isOffState(c.to) || c.to === "suspension_scheduled"));
  const offCodes = new Set(turningOff.map((c) => c.code));
  const enabledAfter = new Set([...next.values()].filter((i) => (isOnState(i.state) && !offCodes.has(i.code)) || i.state === "activation_scheduled").map((i) => i.code));
  const cascade = dependentsClosure(index, offCodes, enabledAfter);
  const because = new Map(cascade.map((c) => [c.code, c.because]));
  const rootOf = (code: string): PlannedChange | undefined => {
    let current = code;
    const visited = new Set<string>();
    while (because.has(current) && !visited.has(current)) {
      visited.add(current);
      current = because.get(current) as string;
    }
    return changes.get(current);
  };
  for (const fallen of cascade) {
    const before = next.get(fallen.code) ?? null;
    const root = rootOf(fallen.code);
    const to: ErpLicenseItemState = root?.to === "suspended" || root?.to === "suspension_scheduled" || root?.to === "read_only" ? root.to : "inactive";
    const cascadeItem: ErpLicenseItem = { code: fallen.code, state: to, effectiveAt: to === "suspension_scheduled" ? (root?.effectiveAt ?? null) : null };
    next.set(fallen.code, cascadeItem);
    changes.set(fallen.code, { code: fallen.code, from: before?.state ?? null, to, effectiveAt: cascadeItem.effectiveAt, origin: "cascata", relatedTo: fallen.because });
  }

  const items = [...next.values()].sort((a, b) => compareCodes(a.code, b.code));
  return { changes: [...changes.values()].sort((a, b) => compareCodes(a.code, b.code)), errors, warnings, items };
}

/** Retrato completo da próxima versão (o que vai no PUT). */
export function buildSnapshot(input: {
  companyId: string;
  licenseVersion: number;
  items: readonly ErpLicenseItem[];
  previous: Pick<ErpLicenseSnapshot, "commercialStatus" | "activationAt" | "validUntil" | "trial" | "branches" | "limits" | "display" | "controlMode"> | null;
  controlMode?: ErpControlMode | null;
  issuedAt: string;
}): ErpLicenseSnapshot {
  const prev = input.previous;
  const snapshot: ErpLicenseSnapshot = {
    licenseVersion: input.licenseVersion,
    companyId: input.companyId,
    product: "erp-intercert",
    commercialStatus: prev?.commercialStatus ?? "active",
    activationAt: prev?.activationAt ?? null,
    validUntil: prev?.validUntil ?? null,
    trial: prev?.trial ?? null,
    branches: prev?.branches ?? null,
    limits: prev?.limits ?? null,
    display: prev?.display ?? null,
    controlMode: input.controlMode ?? null,
    items: input.items.map((i) => ({ code: i.code, state: i.state, until: i.until ?? null, effectiveAt: i.effectiveAt ?? null, reason: i.reason ?? null })),
    issuedAt: input.issuedAt,
  };
  return snapshot;
}

/** Desligamento que pode precisar de aprovação (o servidor completa com os bloqueios da simulação do ERP). */
export function deactivations(plan: LicensePlan): PlannedChange[] {
  return plan.changes.filter((c) => isOnState(c.from) && (isOffState(c.to) || c.to === "suspension_scheduled"));
}
