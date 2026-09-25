"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Iframe do Google Maps por endereço (URL de incorporação sem chave). Montado pouco depois da página carregar:
 * o mapa pesa ~1 MB e não deve competir com os dados da tela; até lá mostra um marcador.
 */
export function MapEmbed({ src, title, className, delayMs = 1500 }: { src: string; title: string; className?: string; delayMs?: number }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [src, delayMs]);
  const box = cn("w-full rounded-lg border border-border bg-surface-muted", className);
  if (!ready) {
    return (
      <div className={cn(box, "flex items-center justify-center bg-dot-grid")} aria-hidden>
        <MapPin className="size-7 text-brand" />
      </div>
    );
  }
  return <iframe title={title} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className={box} />;
}
