"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { moneyInputStep, moneyInputText } from "@/lib/money-mask";
import { inputClassName } from "./input";

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "inputMode" | "prefix"> {
  /** Valor em reais (número com centavos) ou null quando vazio. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Aceita valor negativo (digite "-"; ex.: saldo inicial de cartão). */
  allowNegative?: boolean;
  invalid?: boolean;
  /** Prefixo visual (padrão "R$"); `null` esconde. */
  prefix?: string | null;
}

/**
 * Campo de dinheiro com máscara em centavos (etapa CP/CR 4): o usuário digita só números e a vírgula entra sozinha
 * ("1250" → "12,50", milhar com ponto). Teclado numérico no celular/iPad (`inputMode="numeric"`), cursor sempre no fim
 * (a máscara cresce da direita), valor real em número via `onValueChange`. Acessível: é um `<input>` de texto com o
 * rótulo do FormField (htmlFor/id) e o prefixo "R$" fora do texto lido.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(({ value, onValueChange, allowNegative, invalid, prefix = "R$", className, onFocus, ...props }, ref) => {
  const inner = React.useRef<HTMLInputElement | null>(null);
  // "-" digitado com o campo vazio (saldo negativo): fica pendente até o primeiro número.
  const [negativeDraft, setNegativeDraft] = React.useState(false);
  const text = moneyInputText(value, allowNegative && negativeDraft);
  const toEnd = (el: HTMLInputElement | null) => {
    if (!el || document.activeElement !== el) return;
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* alguns navegadores não aceitam seleção em todos os tipos */
    }
  };
  // Depois de cada reformatação o cursor volta ao fim (a máscara cresce da direita para a esquerda).
  React.useLayoutEffect(() => toEnd(inner.current), [text]);
  return (
    <div className="relative w-full">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted" aria-hidden>
          {prefix}
        </span>
      ) : null}
      <input
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        type="text"
        // iPhone: o teclado numérico não tem "-"; com valor negativo permitido, o teclado de texto (com números).
        inputMode={allowNegative ? "text" : "numeric"}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        data-money-input=""
        className={cn(inputClassName, "text-right tabular-nums", prefix && "pl-10", className)}
        value={text}
        placeholder={props.placeholder ?? "0,00"}
        onChange={(e) => {
          const next = moneyInputStep(e.target.value, { value, negativeDraft }, { allowNegative });
          setNegativeDraft(next.negativeDraft);
          onValueChange(next.value);
        }}
        onFocus={(e) => {
          onFocus?.(e);
          const el = e.currentTarget;
          // Ao focar, o cursor vai para o fim (o navegador posiciona onde o dedo tocou).
          requestAnimationFrame(() => toEnd(el));
        }}
        {...props}
      />
    </div>
  );
});
MoneyInput.displayName = "MoneyInput";
