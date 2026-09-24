"use client";

/**
 * STUB da busca global. Outro agente substituirá este arquivo mantendo o mesmo export
 * (default e nomeado `GlobalSearch`). Só o atalho Ctrl/Cmd+K e o diálogo existem por enquanto.
 */
import * as React from "react";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export function GlobalSearch({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar (Ctrl+K)"
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground",
          "md:h-9 md:w-full md:max-w-md md:justify-start md:gap-2 md:border md:border-border md:bg-surface-muted md:px-3 md:hover:border-border-strong md:hover:bg-surface",
          className,
        )}
      >
        <Search className="size-5 md:size-4" />
        <span className="hidden flex-1 text-left text-sm text-muted md:inline">Buscar clientes, tarefas, chamados…</span>
        <span className="hidden items-center gap-0.5 md:inline-flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" hideClose className="top-[15%] translate-y-0 overflow-hidden p-0 animate-fade-in">
          <DialogTitle className="sr-only">Busca global</DialogTitle>
          <DialogDescription className="sr-only">Busque clientes, tarefas e chamados.</DialogDescription>
          <Command label="Busca global" shouldFilter={false} className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted" aria-hidden />
              <Command.Input
                autoFocus
                placeholder="Buscar…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-light"
              />
              <Kbd className="hidden md:inline-flex">Esc</Kbd>
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-10 text-center text-sm text-muted">Busca chega no próximo bloco</Command.Empty>
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default GlobalSearch;
