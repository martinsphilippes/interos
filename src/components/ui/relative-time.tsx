import { formatDateTime, formatRelative } from "@/lib/format";

/**
 * Tempo relativo ("há 5 minutos") seguro para hidratação: o texto calculado no servidor pode virar de minuto
 * até o navegador hidratar, então a diferença de texto é aceita (suppressHydrationWarning) e o título mostra
 * a data exata. Use em Client Components no lugar de `formatRelative` dentro do JSX.
 */
export function RelativeTime({ value, className }: { value: string | Date | undefined | null; className?: string }) {
  if (!value) return <>—</>;
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className} suppressHydrationWarning>
      {formatRelative(iso)}
    </time>
  );
}
