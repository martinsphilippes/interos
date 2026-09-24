"use client";

import * as React from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SCORES = Array.from({ length: 11 }, (_, i) => i);

function scoreTone(score: number, selected: boolean): string {
  if (!selected) return "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-hover";
  if (score >= 9) return "border-success bg-success text-white";
  if (score >= 7) return "border-warning bg-warning text-white";
  return "border-danger bg-danger text-white";
}

/** Formulário público de avaliação (0–10 + comentário), enviado para POST /api/csat/<ticketId>. */
export function CsatForm({ ticketId, token }: { ticketId: string; token: string }) {
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (score === null) return;
    setStatus("sending");
    setError(null);
    try {
      const response = await fetch(`/api/csat/${encodeURIComponent(ticketId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, score, comment: comment.trim() || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Não foi possível registrar sua avaliação. Tente novamente.");
        setStatus("idle");
        return;
      }
      setStatus("done");
    } catch {
      setError("Sem conexão. Verifique sua internet e tente novamente.");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <CheckCircle2 className="size-12 text-success" />
        <p className="text-lg font-semibold">Obrigado pela avaliação!</p>
        <p className="text-sm text-muted">Sua opinião ajuda a Intercert a melhorar o atendimento.</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset>
        <legend className="mb-3 text-center text-sm font-medium">De 0 a 10, qual a sua satisfação com o atendimento?</legend>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-11" role="radiogroup" aria-label="Nota de 0 a 10">
          {SCORES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={score === s}
              aria-label={`Nota ${s}`}
              onClick={() => setScore(s)}
              className={cn("flex h-14 items-center justify-center rounded-xl border-2 text-lg font-semibold tabular-nums transition-colors sm:h-12", scoreTone(s, score === s))}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>Muito insatisfeito</span>
          <span>Muito satisfeito</span>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="csat-comment" className="text-sm font-medium">
          Quer contar mais? <span className="font-normal text-muted">(opcional)</span>
        </label>
        <Textarea id="csat-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="O que foi bom ou o que podemos melhorar" />
      </div>
      {error ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={status === "sending"} disabled={score === null} className="w-full">
        <Send /> Enviar avaliação
      </Button>
    </form>
  );
}
