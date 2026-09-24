"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/* Paleta de fundos por hash do nome: tons sóbrios, legíveis com texto branco. */
const AVATAR_COLORS = ["#0E7C9B", "#365A8A", "#7C3AED", "#0F766E", "#B45309", "#BE185D", "#4338CA", "#15803D", "#9F1239", "#1D4ED8"];

export function avatarColor(name: string | undefined | null): string {
  const text = name ?? "";
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const sizeClass = {
  xs: "size-6 text-[10px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
  xl: "size-16 text-lg",
} as const;

export type AvatarSize = keyof typeof sizeClass;

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  name: string;
  src?: string | null;
  size?: AvatarSize;
}

export const Avatar = React.forwardRef<React.ComponentRef<typeof AvatarPrimitive.Root>, AvatarProps>(({ className, name, src, size = "md", ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative inline-flex shrink-0 select-none overflow-hidden rounded-full", sizeClass[size], className)}
    title={name}
    {...props}
  >
    {src ? <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" /> : null}
    <AvatarPrimitive.Fallback
      delayMs={src ? 300 : 0}
      className="flex size-full items-center justify-center font-semibold uppercase text-white"
      style={{ backgroundColor: avatarColor(name) }}
    >
      {initials(name)}
    </AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
));
Avatar.displayName = "Avatar";
