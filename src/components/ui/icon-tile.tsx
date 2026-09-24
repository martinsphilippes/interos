import * as React from "react";
import { cn } from "@/lib/utils";
import { toneSoft, type Tone } from "./tone";

const sizeClass = {
  xs: "size-7 rounded-md [&_svg]:size-3.5",
  sm: "size-9 rounded-lg [&_svg]:size-4",
  md: "size-11 rounded-xl [&_svg]:size-5",
  lg: "size-12 rounded-xl [&_svg]:size-6",
} as const;

export interface IconTileProps {
  icon: React.ReactNode;
  /** Cor semântica do quadrado (fundo tingido + ícone na cor clara). */
  tone?: Tone;
  size?: keyof typeof sizeClass;
  /** "square" (padrão, cantos arredondados) ou "circle" (linha do tempo, avatares de evento). */
  shape?: "square" | "circle";
  className?: string;
}

/** Ícone dentro de um quadrado arredondado tingido pela cor semântica (padrão dos cards das referências). */
export function IconTile({ icon, tone = "neutral", size = "md", shape = "square", className }: IconTileProps) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", sizeClass[size], shape === "circle" && "rounded-full", toneSoft[tone], className)}
    >
      {icon}
    </span>
  );
}
