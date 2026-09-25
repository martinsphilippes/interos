import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneText, type Tone } from "./tone";

export interface MetricDeltaProps {
  /** Variação já formatada (ex.: "12,4%", "+3", "1,4 p.p."). */
  value: string;
  direction: "up" | "down" | "flat";
  /** Cor semântica: define se subir é bom ou ruim (ex.: inadimplência subindo = danger). Padrão: up=success, down=danger. */
  tone?: Tone;
  /** Complemento (ex.: "vs. mês anterior"). */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Variação vs. período anterior: "↑ 12,4% vs. mês anterior". */
export function MetricDelta({ value, direction, tone, label, size = "sm", className }: MetricDeltaProps) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  const resolved: Tone = tone ?? (direction === "up" ? "success" : direction === "down" ? "danger" : "neutral");
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", size === "sm" ? "text-xs" : "text-sm", className)}>
      <span className={cn("inline-flex shrink-0 items-center gap-0.5 font-semibold tabular-nums", toneText[resolved])}>
        <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
        {value}
      </span>
      {label ? <span className="truncate text-muted">{label}</span> : null}
    </span>
  );
}
