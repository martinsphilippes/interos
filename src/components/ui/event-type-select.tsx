"use client";

import { eventTypeGroups } from "@/domain/event-labels";
import type { EventType } from "@/domain/constants";
import { Select } from "@/components/ui/select";

/**
 * Seletor de tipo de evento (gatilho) com rótulos em português agrupados por área e a chave técnica
 * entre parênteses. Usado pelo construtor de processos e pelo editor de automações.
 */
export function EventTypeSelect({ value, onChange, id, types, className }: { value?: string; onChange: (value: EventType) => void; id?: string; types?: readonly EventType[]; className?: string }) {
  return (
    <Select id={id} className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value as EventType)} placeholder="Escolha o evento">
      {eventTypeGroups(types).map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label} ({t.value})
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
