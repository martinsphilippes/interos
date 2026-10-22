"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { connectionCheckLines, type CheckTone, type ClicksignConnectionCheck } from "@/domain/clicksign-connection";
import { checkClicksignConnectionAction } from "@/server/finance/signature-actions";
import { Button } from "@/components/ui/button";
import { isNewVersionError } from "@/lib/version";

const ICONS: Record<CheckTone, React.ReactNode> = {
  ok: <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success-fg" />,
  warn: <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-fg" />,
  error: <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-fg" />,
};

const TONE_LABEL: Record<CheckTone, string> = { ok: "Certo", warn: "Atenção", error: "Problema" };

/** Botão «Testar conexão»: confere na hora a chave da API e os webhooks da conta Clicksign (só leitura). */
export function ClicksignConnectionTest() {
  const [pending, startTransition] = React.useTransition();
  const [check, setCheck] = React.useState<ClicksignConnectionCheck | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const test = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await checkClicksignConnectionAction();
        if (result.ok) setCheck(result.data);
        else {
          setCheck(null);
          setError(result.error);
        }
      } catch (err) {
        setCheck(null);
        setError(isNewVersionError(err) ? "Saiu uma nova versão do INTEROS: recarregue a página e teste de novo." : "Não foi possível testar agora; tente de novo.");
      }
    });

  const lines = check ? connectionCheckLines(check) : error ? [{ tone: "error" as const, text: error }] : [];
  const time = check ? new Date(check.checkedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={test} loading={pending} disabled={pending}>
          <PlugZap aria-hidden />
          {pending ? "Testando…" : "Testar conexão"}
        </Button>
        {time && !pending ? <span className="text-muted">Testado às {time}</span> : null}
      </div>
      <ul aria-live="polite" className="flex flex-col gap-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2">
            {ICONS[line.tone]}
            <span>
              <span className="sr-only">{TONE_LABEL[line.tone]}: </span>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
