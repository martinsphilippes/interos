"use client";

/**
 * Modo foco: a tela de trabalho ocupa a tela inteira (sem barra lateral, sem a barra superior e sem o título da
 * página), ficando só uma faixa fina com presença, notificações e o botão de sair. Reutilizável: a tela que aceita o
 * modo foco monta <FocusModeScope />; fora dela o layout volta ao normal, e a preferência fica guardada para a próxima
 * vez. Só vale do tablet para cima (no celular a tela já é inteira).
 */
import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const FOCUS_KEY = "interos.focus";

const listeners = new Set<() => void>();
/** Quantas telas com modo foco estão montadas agora. */
let scopes = 0;

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFocusMode(value: boolean) {
  try {
    window.localStorage.setItem(FOCUS_KEY, value ? "1" : "0");
  } catch {
    /* localStorage indisponível: vale só nesta página */
  }
  notify();
}

/** O modo foco está ligado E a tela atual aceita o modo foco. */
export function useFocusMode(): boolean {
  return React.useSyncExternalStore(subscribe, () => scopes > 0 && readPreference(), () => false);
}

/** Preferência guardada (para o botão mostrar o estado mesmo antes de a tela montar o escopo). */
function usePreference(): boolean {
  return React.useSyncExternalStore(subscribe, readPreference, () => false);
}

/** Marca a tela atual como «aceita modo foco» e liga o atalho Esc para sair. */
export function FocusModeScope() {
  React.useEffect(() => {
    scopes += 1;
    notify();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !readPreference()) return;
      // Esc com janela, menu ou lista aberta fecha só ela.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"], [role="listbox"]')) return;
      setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      scopes -= 1;
      window.removeEventListener("keydown", onKey);
      notify();
    };
  }, []);
  return null;
}

/** Botão «Modo foco» (no cabeçalho da tela). */
export function FocusModeButton({ className }: { className?: string }) {
  const on = usePreference();
  return (
    <Tooltip content="Tela inteira para atender (Esc para sair)">
      <Button variant="outline" className={cn("hidden md:inline-flex", className)} onClick={() => setFocusMode(!on)} aria-pressed={on}>
        <Maximize2 /> Modo foco
      </Button>
    </Tooltip>
  );
}

/** Esconde o conteúdo (ex.: o título da página) enquanto o modo foco estiver ligado (do tablet para cima). */
export function HideInFocus({ children }: { children: React.ReactNode }) {
  const focus = useFocusMode();
  return <div className={cn(focus && "md:hidden")}>{children}</div>;
}

/** Faixa fina do modo foco: o que o operador não pode perder de vista + sair. */
export function FocusBar({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("sticky top-0 z-30 hidden h-11 shrink-0 items-center gap-2 border-b border-border bg-canvas/90 px-4 backdrop-blur-md md:flex", className)}>
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted">Modo foco</span>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Button size="sm" variant="ghost" onClick={() => setFocusMode(false)}>
          <Minimize2 /> Sair <kbd className="ml-1 rounded border border-border px-1 text-[10px] text-muted">Esc</kbd>
        </Button>
      </div>
    </div>
  );
}
