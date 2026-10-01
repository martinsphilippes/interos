"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copia um texto (linha digitável, PIX, link) com retorno visual; recurso de seleção quando a API não existe. */
export function CopyButton({ value, label = "Copiar", copiedLabel = "Copiado", className, testId }: { value: string; label?: string; copiedLabel?: string; className?: string; testId?: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Navegador sem a API (ou sem permissão): cópia pela seleção de um campo temporário.
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button type="button" variant="outline" onClick={copy} className={className ?? "h-11 md:h-9"} data-testid={testId} aria-live="polite">
      {copied ? <Check /> : <Copy />} {copied ? copiedLabel : label}
    </Button>
  );
}
