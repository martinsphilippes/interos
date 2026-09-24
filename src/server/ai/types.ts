/**
 * Pontos de extensão de IA do INTEROS. O sistema funciona sem IA: cada agente tem uma versão
 * determinística por regras (agents.ts); quando há ANTHROPIC_API_KEY, `runWithLlm` complementa as
 * sugestões com a API Messages (provider.ts). Tipos sem dependências de servidor.
 */

export const AGENT_KINDS = ["comercial", "implantacao", "suporte", "cs", "executivo"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_LABELS: Record<AgentKind, string> = {
  comercial: "Assistente comercial",
  implantacao: "Assistente de implantação",
  suporte: "Assistente de suporte",
  cs: "Assistente de Customer Success",
  executivo: "Assistente executivo",
};

/** O que o subjectId de cada agente representa. */
export const AGENT_SUBJECTS: Record<AgentKind, string> = {
  comercial: "ID do usuário (vendedor)",
  implantacao: "ID do projeto de implantação",
  suporte: "ID do chamado",
  cs: "ID do cliente",
  executivo: "Competência AAAA-MM",
};

export type SuggestionPriority = "alta" | "media" | "baixa";

export interface AgentSuggestion {
  id: string;
  title: string;
  detail?: string;
  priority: SuggestionPriority;
  href?: string;
  actionLabel?: string;
  source: "regras" | "ia";
}

/** Contexto montado a partir das queries dos módulos: resumo em texto + fatos estruturados. */
export interface AgentContext {
  summary: string;
  facts: Record<string, unknown>;
}

export interface AgentRun {
  kind: AgentKind;
  subject: { id: string; label: string; href?: string };
  context: AgentContext;
  suggestions: AgentSuggestion[];
  generatedAt: string;
  /** true quando a IA foi consultada com sucesso. */
  usedLlm: boolean;
  model?: string;
}
