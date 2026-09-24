"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Só ícones (rótulo vira aria-label/title). */
  iconOnly?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Alternador de visões (lista / kanban / calendário). */
export function SegmentedControl<T extends string>({ options, value, onChange, size = "md", iconOnly, className, ...aria }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={aria["aria-label"]} className={cn("inline-flex items-center gap-0.5 rounded-lg bg-surface-hover p-0.5", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        const labelText = typeof opt.label === "string" ? opt.label : undefined;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? labelText : undefined}
            title={iconOnly ? labelText : undefined}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 [&_svg]:size-4",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              iconOnly && (size === "sm" ? "w-7 px-0" : "w-8 px-0"),
              active ? "bg-surface text-foreground shadow-card" : "text-muted hover:text-foreground",
            )}
          >
            {opt.icon}
            {!iconOnly ? opt.label : null}
          </button>
        );
      })}
    </div>
  );
}
