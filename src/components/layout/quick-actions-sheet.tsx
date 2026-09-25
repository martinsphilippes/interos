"use client";

import Link from "next/link";
import type { QuickAction } from "@/domain/constants";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tone";
import { NavIcon } from "./nav-icon";

const ACTION_TONE: Record<string, Tone> = {
  tarefa: "brand",
  lead: "purple",
  oportunidade: "success",
  chamado: "danger",
  visita: "info",
  cliente: "secondary",
};

export interface QuickActionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ações já filtradas pelo papel do usuário (servidor). */
  actions: QuickAction[];
}

/** Folha inferior de ações rápidas aberta pelo "+" da barra mobile. */
export function QuickActionsSheet({ open, onOpenChange, actions }: QuickActionsSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="sm">
        <DrawerHeader className="border-b-0 pb-1">
          <DrawerTitle>Ações rápidas</DrawerTitle>
          <DrawerDescription>O que você quer registrar agora?</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="pb-6 safe-bottom">
          <ul className="grid grid-cols-2 gap-2.5 min-[360px]:grid-cols-3">
            {actions.map((action) => (
              <li key={action.key}>
                <Link
                  href={action.href}
                  onClick={() => onOpenChange(false)}
                  title={action.description}
                  className="flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface p-3 text-center transition-colors hover:border-brand/60 hover:bg-surface-hover"
                >
                  <IconTile icon={<NavIcon name={action.icon} />} tone={ACTION_TONE[action.key] ?? "brand"} size="md" />
                  <span className="text-[13px] font-semibold leading-tight text-foreground">{action.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
