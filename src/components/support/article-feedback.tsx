"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { voteArticleAction } from "@/server/support/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

const storageKey = (id: string) => `interos.kb.voto.${id}`;

function readVote(id: string): "sim" | "nao" | null {
  try {
    const v = window.localStorage.getItem(storageKey(id));
    return v === "sim" || v === "nao" ? v : null;
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

/** "Este artigo foi útil?" com os contadores reais (helpful / notHelpful). O voto é lembrado neste navegador. */
export function ArticleFeedback({ articleId, helpful, notHelpful }: { articleId: string; helpful: number; notHelpful: number }) {
  const router = useRouter();
  const stored = React.useSyncExternalStore(subscribe, () => readVote(articleId), () => null);
  const [voted, setVoted] = React.useState<"sim" | "nao" | null>(null);
  const current = voted ?? stored;
  const [pending, startTransition] = React.useTransition();

  const vote = (useful: boolean) =>
    startTransition(async () => {
      const result = await voteArticleAction({ articleId, helpful: useful });
      if (!result.ok) return void toast.error(result.error);
      const value = useful ? "sim" : "nao";
      setVoted(value);
      try {
        window.localStorage.setItem(storageKey(articleId), value);
      } catch {
        // Sem armazenamento local: o voto vale só nesta visita.
      }
      toast.success(useful ? "Obrigado! Seu voto ajuda a priorizar os melhores artigos." : "Obrigado! Vamos revisar este artigo.");
      router.refresh();
    });

  const total = helpful + notHelpful;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">Este artigo foi útil?</p>
        <p className="text-xs text-muted">
          {total > 0 ? `${helpful} acharam útil · ${notHelpful} não acharam` : "Ainda sem avaliações."}
          {current ? ` · seu voto: ${current === "sim" ? "útil" : "não útil"}` : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant={current === "sim" ? "success" : "outline"} size="sm" loading={pending} disabled={Boolean(current)} onClick={() => vote(true)} className="min-h-[44px] md:min-h-8">
          <ThumbsUp /> Sim
        </Button>
        <Button variant={current === "nao" ? "destructive" : "outline"} size="sm" loading={pending} disabled={Boolean(current)} onClick={() => vote(false)} className="min-h-[44px] md:min-h-8">
          <ThumbsDown /> Não
        </Button>
      </div>
    </div>
  );
}
