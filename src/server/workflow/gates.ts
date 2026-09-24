/**
 * Validação de gates de workflow. Módulo PURO (sem firebase, sem React): é usado pelo serviço no
 * servidor e pelos componentes para exibir o estado de cada exigência do gate.
 *
 * Um campo obrigatório é satisfeito por um valor que exista no contexto da instância (lead,
 * oportunidade, contrato, projeto, CS...) OU por um valor preenchido manualmente em `step.fields`
 * (chave = path). O valor manual vence.
 */
import type { GateField, WorkflowStage, WorkflowStep } from "@/domain/types";

/** Contexto montado por `buildGateContext`: objetos referenciados pela instância, por raiz do path. */
export type GateContextData = Record<string, unknown>;

export type GateFieldSource = "manual" | "sistema" | "vazio";

export interface GateFieldView extends GateField {
  value: unknown;
  /** Texto pronto para exibição ("—" quando vazio). */
  display: string;
  source: GateFieldSource;
  filled: boolean;
}

export interface GateChecklistView {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
}

export interface GateEvaluation {
  /** Campos, checklist obrigatório e documentos atendidos (aprovação é tratada à parte). */
  ok: boolean;
  missingFields: GateField[];
  missingChecklist: { key: string; label: string }[];
  /** A etapa exige aprovação e ela ainda não foi concedida. */
  needsApproval: boolean;
  /** A etapa exige documentos e nenhum foi anexado. */
  needsDocuments: boolean;
  fields: GateFieldView[];
  checklist: GateChecklistView[];
  documentsCount: number;
}

/** Lê um caminho "a.b.c" em um objeto aninhado. */
export function resolvePath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Um valor conta como preenchido quando não é vazio. `false` NÃO conta: campos booleanos de gate
 * (consentimento LGPD, treinamento realizado) exigem confirmação positiva.
 */
export function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/** Texto de exibição de um valor de gate, conforme o tipo declarado do campo. */
export function displayGateValue(value: unknown, type: GateField["type"]): string {
  if (!isFilled(value)) return "—";
  if (type === "booleano") return value === true || value === "true" ? "Sim" : "Não";
  if (type === "data" && typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) => (v && typeof v === "object" ? ((v as Record<string, unknown>).productName ?? (v as Record<string, unknown>).name ?? JSON.stringify(v)) : String(v))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (type === "numero" && typeof value === "number") return new Intl.NumberFormat("pt-BR").format(value);
  return String(value);
}

/** Converte a entrada manual (sempre texto no formulário) para o tipo do campo. */
export function coerceGateValue(raw: unknown, type: GateField["type"]): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (type === "numero") {
    if (typeof raw === "number") return raw;
    const text = String(raw).trim().replace(/\./g, "").replace(",", ".");
    if (!text) return undefined;
    const n = Number(text);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === "booleano") {
    if (typeof raw === "boolean") return raw;
    const text = String(raw).trim().toLowerCase();
    if (!text) return undefined;
    return text === "true" || text === "sim" || text === "1";
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? text : undefined;
  }
  return raw;
}

export interface EvaluateGateOptions {
  /** Documentos anexados ao cliente/etapa (para `requiresDocuments`). */
  documentsCount?: number;
  /** Sobrescreve `step.fields` (ex.: valores enviados junto com a conclusão). */
  fields?: Record<string, unknown>;
  /** Sobrescreve `step.checklist`. */
  checklist?: WorkflowStep["checklist"];
}

/** Avalia o gate de uma etapa contra o contexto da instância e os dados manuais do step. */
export function evaluateGate(step: Pick<WorkflowStep, "fields" | "checklist" | "approval">, stage: WorkflowStage, contextData: GateContextData, options: EvaluateGateOptions = {}): GateEvaluation {
  const manual = options.fields ?? step.fields ?? {};
  const checklistItems = options.checklist ?? step.checklist ?? [];
  const documentsCount = options.documentsCount ?? 0;

  const fields: GateFieldView[] = stage.gate.requiredFields.map((field) => {
    const manualValue = coerceGateValue(manual[field.path], field.type);
    const systemValue = resolvePath(contextData, field.path);
    const useManual = isFilled(manualValue);
    const value = useManual ? manualValue : systemValue;
    const filled = isFilled(value);
    return {
      ...field,
      value,
      display: displayGateValue(value, field.type),
      source: !filled ? "vazio" : useManual ? "manual" : "sistema",
      filled,
    };
  });

  const checklist: GateChecklistView[] = stage.gate.checklist.map((item) => {
    const done = checklistItems.find((c) => c.id === item.key)?.done ?? false;
    return { key: item.key, label: item.label, required: item.required, done };
  });

  const missingFields = fields.filter((f) => !f.filled).map(({ path, label, type, options }) => ({ path, label, type, options }));
  const missingChecklist = checklist.filter((c) => c.required && !c.done).map(({ key, label }) => ({ key, label }));
  const needsDocuments = Boolean(stage.gate.requiresDocuments) && documentsCount === 0;
  const needsApproval = stage.gate.requiresApproval && !step.approval?.approvedAt;

  return {
    ok: missingFields.length === 0 && missingChecklist.length === 0 && !needsDocuments,
    missingFields,
    missingChecklist,
    needsApproval,
    needsDocuments,
    fields,
    checklist,
    documentsCount,
  };
}

/** Frase única com tudo que falta (usada em mensagens de erro e toasts). */
export function describeMissing(evaluation: GateEvaluation): string {
  const parts: string[] = [];
  if (evaluation.missingFields.length > 0) parts.push(`campos: ${evaluation.missingFields.map((f) => f.label).join(", ")}`);
  if (evaluation.missingChecklist.length > 0) parts.push(`checklist: ${evaluation.missingChecklist.map((c) => c.label).join(", ")}`);
  if (evaluation.needsDocuments) parts.push("documentos anexados");
  return parts.join(" · ");
}
