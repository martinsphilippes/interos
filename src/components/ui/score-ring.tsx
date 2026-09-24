import * as React from "react";
import { cn } from "@/lib/utils";
import { toneColor, toneForPercent, toneText, type Tone } from "./tone";

export interface ScoreRingProps {
  /** Percentual preenchido do anel, 0–100 (null = sem dado). */
  value: number | null;
  /** Texto central; padrão: o valor arredondado (sem "%"). */
  display?: React.ReactNode;
  /** Rótulo abaixo do número, na cor do tom (ex.: "Excelente"). */
  label?: React.ReactNode;
  /** Cor do anel; padrão pelo valor (>= 90 verde, >= 70 âmbar, abaixo vermelho). */
  tone?: Tone;
  /** Diâmetro em px (padrão 144). */
  size?: number;
  /** Espessura do anel em px (padrão 10). */
  thickness?: number;
  className?: string;
}

/** Anel circular com valor central e rótulo ("Índice de desempenho 91 Excelente", "Cumprimento geral 92%"). */
export function ScoreRing({ value, display, label, tone, size = 144, thickness = 10, className }: ScoreRingProps) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const resolvedTone = tone ?? toneForPercent(value);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const center = display ?? (value === null ? "—" : Math.round(value));
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} role="img" aria-label={value === null ? "Sem dados" : `${Math.round(pct)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-track)" strokeWidth={thickness} />
        {value !== null ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={toneColor[resolvedTone]}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={cn("font-semibold tabular-nums leading-none tracking-tight text-foreground", size >= 120 ? "text-[34px]" : "text-xl")}>{center}</span>
        {label ? <span className={cn("mt-1 text-xs font-medium", toneText[resolvedTone])}>{label}</span> : null}
      </div>
    </div>
  );
}
