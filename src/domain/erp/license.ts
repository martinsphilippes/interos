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
export const ERP_DISPLAY_MODES = ["hidden", "locked", "upsell"] as const;
export type ErpDisplayMode = (typeof ERP_DISPLAY_MODES)[number];

/** Como o que está desligado aparece para a empresa no ERP (menu, telas e pedido de contratação). */
export const ERP_DISPLAY_LABELS: Record<ErpDisplayMode, string> = {
  hidden: "Esconder",
  locked: "Mostrar com cadeado",
  upsell: "Mostrar com “contratar”",
};

/** Versão curta, para etiquetas na lista. */
export const ERP_DISPLAY_SHORT: Record<ErpDisplayMode, string> = { hidden: "esconder", locked: "cadeado", upsell: "contratar" };

/** Exibição escolhida para uma unidade quando ela está desligada (vence o padrão da empresa só para ela). */
export interface ErpUnitDisplay {
  code: string;
  display: ErpDisplayMode;
}

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
  /** Padrão da empresa para o que está desligado. */
  display?: ErpDisplayMode | null;
  /**
   * Exibição por unidade (fase A, 27/11/2026): fica fora de `items` para valer também em unidade nunca contratada
   * (ex.: mostrar com "contratar") sem criar item desligado. ERP sem a fase A ignora o campo.
   */
  displays?: ErpUnitDisplay[] | null;
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
  reason: "nao_e_unidade" | "nao_vendavel" | "data_invalida" | "repetida" | "sem_mudanca" | "falta_alternativa" | "exibicao_sem_suporte";
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

/** Exibição preparada na tela: o padrão da empresa e a escolha de cada unidade (`null` = volta ao padrão). */
export interface ErpDisplayDraft {
  companyDefault?: ErpDisplayMode | null;
  units?: { code: string; display: ErpDisplayMode | null }[] | null;
}

/** Uma mudança de exibição: `code` null é o padrão da empresa; `null` em `from`/`to` é "segue o padrão". */
export interface DisplayChange {
  code: string | null;
  from: ErpDisplayMode | null;
  to: ErpDisplayMode | null;
  /**
   * Escolha de um código que deixou de ser unidade no catálogo: sai do retrato junto com o próximo envio. Sozinha não
   * é motivo de envio (não muda nada que a empresa vê).
   */
  stale?: boolean;
}

export interface DisplayPlan {
  /** Padrão da empresa que vai no retrato (null = o INTEROS ainda não fixou; o ERP usa o dele). */
  display: ErpDisplayMode | null;
  /** Padrão que vale depois do lote (o fixado ou, sem ele, o do ERP): para a tela e para explicar "segue o padrão". */
  effective: ErpDisplayMode | null;
  /** Escolhas por unidade depois do lote, em ordem de código. */
  displays: ErpUnitDisplay[];
  changes: DisplayChange[];
  errors: PlanIssue[];
}

/** Exibição que vale hoje: o padrão que a empresa vê, o fixado pelo INTEROS e as escolhas por unidade. */
export interface CurrentDisplay {
  /** Padrão que vale hoje (o fixado pelo INTEROS ou o do ERP; null = desconhecido). */
  display: ErpDisplayMode | null;
  /** Padrão fixado pelo INTEROS (o que vai no retrato). Ausente = igual a `display`. */
  fixed?: ErpDisplayMode | null;
  displays: readonly ErpUnitDisplay[];
}

/** O lote muda algo que a empresa vê (a limpeza de código que deixou de ser unidade não conta sozinha). */
export function hasDisplayWork(plan: Pick<DisplayPlan, "changes">): boolean {
  return plan.changes.some((c) => !c.stale);
}

/**
 * Planeja as mudanças de exibição sobre o que vale hoje. Só mexe em como o desligado aparece: não liga nem desliga
 * nada e, por isso, nunca pede aprovação (decisão de 27/11). Escolha igual à atual não conta como mudança.
 * O padrão que o ERP calcula sozinho (antes de o INTEROS fixar um) nunca vira escolha fixa por tabela: só vai no
 * retrato o padrão que a pessoa escolheu.
 */
export function planDisplayChanges(index: ErpCatalogIndex, current: CurrentDisplay, draft: ErpDisplayDraft | null | undefined): DisplayPlan {
  const errors: PlanIssue[] = [];
  const changes: DisplayChange[] = [];
  const byCode = new Map(current.displays.map((d) => [d.code, d.display]));
  // escolha de código que deixou de ser unidade (o catálogo mudou): o ERP recusaria para sempre; sai do retrato
  for (const [code, d] of [...byCode]) {
    if (index.byCode.get(code)?.unit) continue;
    changes.push({ code, from: d, to: null, stale: true });
    byCode.delete(code);
  }
  let display = current.fixed === undefined ? current.display : current.fixed;
  let effective = current.display;
  if (draft?.companyDefault && draft.companyDefault !== current.display) {
    changes.push({ code: null, from: current.display, to: draft.companyDefault });
    display = draft.companyDefault;
    effective = draft.companyDefault;
  }
  const seen = new Set<string>();
  for (const unit of draft?.units ?? []) {
    if (seen.has(unit.code)) {
      errors.push({ code: unit.code, reason: "repetida", message: `${unit.code} aparece duas vezes na exibição.` });
      continue;
    }
    seen.add(unit.code);
    if (!index.byCode.get(unit.code)?.unit) {
      // voltar ao padrão um código que já está saindo da lista não é erro (é o mesmo pedido)
      if (unit.display === null && changes.some((c) => c.stale && c.code === unit.code)) continue;
      errors.push({ code: unit.code, reason: "nao_e_unidade", message: `${unit.code} não é uma unidade comercial do catálogo: a exibição é escolhida por unidade.` });
      continue;
    }
    const before = byCode.get(unit.code) ?? null;
    if (before === unit.display) continue;
    changes.push({ code: unit.code, from: before, to: unit.display });
    if (unit.display) byCode.set(unit.code, unit.display);
    else byCode.delete(unit.code);
  }
  const displays = [...byCode].map(([code, d]) => ({ code, display: d })).sort((a, b) => compareCodes(a.code, b.code));
  return { display, effective, displays, changes: changes.sort((a, b) => (a.code === null ? -1 : b.code === null ? 1 : compareCodes(a.code, b.code))), errors };
}

/** Partes de uma mudança de exibição: o que muda, de e para (textos da tela). */
export function displayChangeParts(change: Pick<DisplayChange, "code" | "from" | "to" | "stale">, name: string | null): { what: string; from: string; to: string } {
  const what = change.code === null ? "Padrão da empresa" : `${change.code}${name ? ` ${name}` : ""}`;
  const fmt = (d: ErpDisplayMode | null) => (d ? ERP_DISPLAY_LABELS[d].toLowerCase() : change.code === null ? "—" : "seguir o padrão da empresa");
  return { what, from: fmt(change.from), to: change.stale ? "sai da lista (deixou de ser unidade no catálogo)" : fmt(change.to) };
}

/** Texto de uma mudança de exibição, para a revisão e o histórico ("05.02 Cotações: seguir o padrão → mostrar com “contratar”"). */
export function describeDisplayChange(change: Pick<DisplayChange, "code" | "from" | "to" | "stale">, name: string | null): string {
  const p = displayChangeParts(change, name);
  return `${p.what}: ${p.from} → ${p.to}`;
}

const isDisplayMode = (v: unknown): v is ErpDisplayMode => typeof v === "string" && (ERP_DISPLAY_MODES as readonly string[]).includes(v);

/**
 * Confere a exibição registrada no INTEROS (último retrato aplicado) com a que o ERP devolve. `supported` false = o
 * ERP ainda não tem a exibição por unidade (não devolve `displays`): as escolhas por unidade não valem lá. Só compara
 * o que o ERP consegue representar (unidade com chave no runtime).
 */
export function displayDivergences(
  index: ErpCatalogIndex,
  current: Pick<ErpLicenseSnapshot, "display" | "displays"> | null,
  status: { display?: string | null; displays?: readonly { code: string; display: string }[] | null } | null,
): { supported: boolean | null; divergences: string[] } {
  if (!status) return { supported: null, divergences: [] };
  if (!Array.isArray(status.displays)) return { supported: false, divergences: [] };
  if (!current) return { supported: true, divergences: [] };
  const out: string[] = [];
  const name = (code: string) => `${code} ${index.byCode.get(code)?.name ?? ""}`.trim();
  const fmt = (d: string | null) => (isDisplayMode(d) ? ERP_DISPLAY_SHORT[d] : "o padrão");
  if (current.display && isDisplayMode(status.display) && status.display !== current.display) out.push(`Padrão da empresa: INTEROS ${fmt(current.display)}, ERP ${fmt(status.display)}`);
  const representable = (code: string) => Boolean(index.byCode.get(code)?.unit && index.byCode.get(code)?.v1Key);
  const mine = new Map((current.displays ?? []).filter((d) => representable(d.code)).map((d) => [d.code, d.display as string]));
  const theirs = new Map(status.displays.map((d) => [d.code, d.display]));
  for (const code of [...new Set([...mine.keys(), ...theirs.keys()])].sort(compareCodes)) {
    const a = mine.get(code) ?? null;
    const b = theirs.get(code) ?? null;
    if (a !== b) out.push(`${name(code)}: INTEROS ${fmt(a)}, ERP ${fmt(b)}`);
  }
  return { supported: true, divergences: out };
}

/** Retrato completo da próxima versão (o que vai no PUT). */
export function buildSnapshot(input: {
  companyId: string;
  licenseVersion: number;
  items: readonly ErpLicenseItem[];
  previous: Pick<ErpLicenseSnapshot, "commercialStatus" | "activationAt" | "validUntil" | "trial" | "branches" | "limits" | "display" | "displays" | "controlMode"> | null;
  controlMode?: ErpControlMode | null;
  /** Exibição do lote (`planDisplayChanges`); sem ela, vale a do retrato anterior. */
  display?: Pick<DisplayPlan, "display" | "displays"> | null;
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
    display: input.display ? input.display.display : (prev?.display ?? null),
    // o retrato é completo: as escolhas por unidade seguem em toda versão até alguém mudar
    displays: (input.display ? input.display.displays : (prev?.displays ?? [])).map((d) => ({ code: d.code, display: d.display })),
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
