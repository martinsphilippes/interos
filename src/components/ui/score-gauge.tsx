"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { toneForPercent, toneText, type Tone } from "./tone";

export interface ScoreGaugeProps {
  /** Valor atual (null = sem dado: mostra "—"). */
  value: number | null;
  /** Máximo da escala (padrão 100). */
  max?: number;
  /** Rótulo qualitativo abaixo do número (ex.: "Muito boa"). */
  label?: React.ReactNode;
  /** Cor do rótulo; padrão pelo percentual (>= 80 verde, >= 60 âmbar, abaixo vermelho). */
  tone?: Tone;
  /** Mostra "/max" ao lado do número. */
  showMax?: boolean;
  className?: string;
}

const CX = 100;
const CY = 100;
const R = 80;

/**
 * Semicírculo com gradiente vermelho → âmbar → verde, marcador na posição do valor e número central
 * (padrão "Saúde da operação" do Cockpit). A parte preenchida vai até o valor; o restante fica apagado.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export function ScoreGauge({ value, max = 100, label, tone, showMax = true, className }: ScoreGaugeProps) {
  const gradientId = React.useId().replace(/:/g, "");
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const resolvedTone = tone ?? toneForPercent(value === null ? null : pct, 80, 60);
  const angle = Math.PI * (1 - pct / 100);
  const marker = {
    // Arredondado: servidor e navegador divergem nas últimas casas de Math.sin/cos (erro de hidratação).
    x1: round2(CX + (R - 14) * Math.cos(angle)),
    y1: round2(CY - (R - 14) * Math.sin(angle)),
    x2: round2(CX + (R + 12) * Math.cos(angle)),
    y2: round2(CY - (R + 12) * Math.sin(angle)),
  };
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const display = value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

  return (
    <div className={cn("relative mx-auto w-full max-w-[260px]", className)} role="img" aria-label={value === null ? "Sem dados" : `${display} de ${max}`}>
      <svg viewBox="0 0 200 118" className="w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-danger)" />
            <stop offset="50%" stopColor="var(--color-warning)" />
            <stop offset="100%" stopColor="var(--color-success)" />
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke={`url(#${gradientId})`} strokeOpacity={0.18} strokeWidth={14} strokeLinecap="round" />
        {value !== null && pct > 0 ? (
          <path d={arc} fill="none" stroke={`url(#${gradientId})`} strokeWidth={14} strokeLinecap="round" pathLength={100} strokeDasharray={`${pct} 100`} />
        ) : null}
        {value !== null ? <line {...marker} stroke="var(--color-foreground)" strokeWidth={3.5} strokeLinecap="round" /> : null}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <p className="flex items-baseline gap-1 font-semibold tabular-nums leading-none text-foreground">
          <span className="text-[40px] tracking-tight">{display}</span>
          {showMax && value !== null ? <span className="text-base font-medium text-muted">/{max}</span> : null}
        </p>
        {label ? <p className={cn("mt-1 text-sm font-medium", toneText[resolvedTone])}>{label}</p> : null}
      </div>
    </div>
  );
}
