"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowRight, Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getAgentSuggestions } from "@/server/automations/actions";
import { AGENT_LABELS, type AgentKind, type AgentRun, type SuggestionPriority } from "@/server/ai/types";

const PRIORITY_VARIANT: Record<SuggestionPriority, "danger" | "warning" | "muted"> = { alta: "danger", media: "warning", baixa: "muted" };
const PRIORITY_LABEL: Record<SuggestionPriority, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export interface AgentSuggestionsProps {
  kind: AgentKind;
  /** comercial: ID do usuário · implantacao: ID do projeto · suporte: ID do chamado · cs: ID do cliente · executivo: AAAA-MM. */
  subjectId: string;
  title?: string;
  /** Resultado já calculado no servidor (evita a busca inicial). */
  initial?: AgentRun | null;
  /** Quantas sugestões mostrar antes de "ver todas". */
  limit?: number;
  className?: string;
}

/**
 * Card "Sugestões do assistente": regras determinísticas do agente e, quando a IA está configurada
 * (ANTHROPIC_API_KEY), sugestões complementares marcadas como "IA". Pode ser montado em qualquer tela.
 */
export function AgentSuggestions({ kind, subjectId, title = "Sugestões do assistente", initial, limit = 5, className }: AgentSuggestionsProps) {
  const [run, setRun] = useState<AgentRun | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await getAgentSuggestions(kind, subjectId);
      if (result.ok) {
        setRun(result.data);
        setError(null);
      } else setError(result.error);
    });
  }, [kind, subjectId]);

  useEffect(() => {
    if (!initial) load();
  }, [initial, load]);

  const suggestions = run?.suggestions ?? [];
  const visible = expanded ? suggestions : suggestions.slice(0, limit);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="size-4 text-brand" aria-hidden />
            {title}
          </CardTitle>
          <CardDescription>
            {AGENT_LABELS[kind]}
            {run ? ` · ${run.subject.label}` : ""}
            {run?.usedLlm ? " · com IA" : ""}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" className="size-11 shrink-0 md:size-9" onClick={load} disabled={pending} aria-label="Atualizar sugestões" title="Atualizar sugestões">
          <RefreshCw className={cn(pending && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : !run ? (
          <SkeletonRows rows={3} />
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma ação sugerida agora: tudo em dia por aqui.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visible.map((s) => {
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-snug">
                      {s.title}
                      {s.source === "ia" ? (
                        <Badge variant="info" size="sm">
                          <Sparkles /> IA
                        </Badge>
                      ) : null}
                    </p>
                    {s.detail ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.detail}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={PRIORITY_VARIANT[s.priority]} size="sm">
                      {PRIORITY_LABEL[s.priority]}
                    </Badge>
                    {s.href ? <ArrowRight className="size-4 text-muted-light" aria-hidden /> : null}
                  </div>
                </>
              );
              return (
                <li key={`${s.source}-${s.id}`}>
                  {s.href ? (
                    <Link href={s.href} className="-mx-2 flex min-h-[44px] items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-hover" title={s.actionLabel}>
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-[44px] items-start gap-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {suggestions.length > limit ? (
          <Button variant="link" size="sm" className="mt-2" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Ver menos" : `Ver todas (${suggestions.length})`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
