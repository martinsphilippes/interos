import { cn } from "@/lib/utils";

/** Marca do INTEROS: hexágono laranja vazado com hexágono sólido ao centro. */
export function InterosMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-8 shrink-0", className)} aria-hidden>
      <path d="M24 4.5 40.9 14.25v19.5L24 43.5 7.1 33.75v-19.5Z" fill="none" stroke="#F26A21" strokeWidth="5" strokeLinejoin="round" />
      <path d="M24 16.5 30.5 20.25v7.5L24 31.5l-6.5-3.75v-7.5Z" fill="#FF8A4C" />
    </svg>
  );
}

export interface InterosLogoProps {
  /** Só o símbolo (sidebar recolhida, top bar mobile). */
  collapsed?: boolean;
  /** Mostra "by Intercert" sob o nome. */
  tagline?: boolean;
  className?: string;
}

export function InterosLogo({ collapsed = false, tagline = false, className }: InterosLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="INTEROS">
      <InterosMark />
      {!collapsed ? (
        <span className="flex flex-col leading-none">
          <span className="text-[19px] font-bold tracking-[0.08em] text-white">INTEROS</span>
          {tagline ? (
            <span className="mt-1 text-[11px] font-medium tracking-normal text-sidebar-muted">
              by <span className="font-semibold text-white">Inter</span>
              <span className="font-semibold text-brand">cert</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
