"use client";

/**
 * Busca global (Ctrl/Cmd+K ou botão da top bar). Dialog com cmdk: input com debounce de 250 ms
 * e mínimo de 2 caracteres, resultados agrupados por tipo vindos da Server Action searchGlobal,
 * navegação por teclado e Enter para abrir. Sem termo mostra atalhos; sem resultado oferece
 * criar cliente/tarefa.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Activity, BarChart3, Bell, BookOpen, Building2, Gauge, Sparkles, Zap, CheckSquare, Contact, FileSignature, FileText, GitBranch, Loader2, Route, Megaphone, Plus, Rocket, Search, Sun, Target, Ticket, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { searchGlobal } from "@/server/search/actions";
import type { SearchKind, SearchResponse } from "@/server/search/queries";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

const KIND_ICONS: Record<SearchKind, LucideIcon> = {
  cliente: Building2,
  contato: Contact,
  tarefa: CheckSquare,
  oportunidade: Target,
  proposta: FileText,
  contrato: FileSignature,
  implantacao: Rocket,
  plano: Route,
  chamado: Ticket,
  artigo: BookOpen,
  lead: UserPlus,
  campanha: Megaphone,
  indicador: Activity,
  relatorio: BarChart3,
  desafio: Sparkles,
  automacao: Zap,
  usuario: Users,
};

const SHORTCUTS: { label: string; href: string; icon: LucideIcon; hint?: string }[] = [
  { label: "Meu Dia", href: "/meu-dia", icon: Sun },
  { label: "Tarefas", href: "/tarefas", icon: CheckSquare },
  { label: "Clientes 360º", href: "/clientes", icon: Building2 },
  { label: "Workflow", href: "/workflow", icon: GitBranch },
  { label: "Notificações", href: "/notificacoes", icon: Bell },
  { label: "Meu Desempenho", href: "/performance", icon: Gauge },
  { label: "Nova tarefa", href: "/tarefas?novo=1", icon: Plus, hint: "Criar" },
  { label: "Novo cliente", href: "/clientes/novo", icon: Plus, hint: "Criar" },
];

const itemClass =
  "flex min-h-[44px] cursor-default select-none items-center gap-3 rounded-md px-2.5 py-2 text-sm text-foreground outline-none md:min-h-[40px] " +
  "data-[selected=true]:bg-surface-hover data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";

export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const requestId = React.useRef(0);

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

  // Debounce no handler do input (não em effect): só consulta o servidor 250 ms após a última
  // tecla e com 2+ caracteres. Respostas antigas são descartadas pelo contador de requisições.
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    const id = ++requestId.current;
    if (term.length < MIN_CHARS) {
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const result = await searchGlobal(term);
      if (id !== requestId.current) return; // resposta antiga
      setSearching(false);
      if (result.ok) {
        setResults(result.data);
        setError(null);
      } else {
        setResults(null);
        setError(result.error);
      }
    }, DEBOUNCE_MS);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
      setQuery("");
      setResults(null);
      setError(null);
      setSearching(false);
    }
  };

  const go = (href: string) => {
    handleOpenChange(false);
    router.push(href);
  };

  const term = query.trim();
  const showShortcuts = term.length < MIN_CHARS;
  const noResults = !showShortcuts && !searching && results !== null && results.total === 0;

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

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent size="md" hideClose className="top-[8%] translate-y-0 overflow-hidden p-0 animate-fade-in md:top-[15%]">
          <DialogTitle className="sr-only">Busca global</DialogTitle>
          <DialogDescription className="sr-only">Busque clientes, contatos, tarefas, oportunidades, contratos, implantações, chamados, leads e usuários.</DialogDescription>
          <Command label="Busca global" shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              {searching ? <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden /> : <Search className="size-4 shrink-0 text-muted" aria-hidden />}
              <Command.Input
                autoFocus
                value={query}
                onValueChange={handleQueryChange}
                placeholder="Buscar por nome, CNPJ, telefone, e-mail, número…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-light"
              />
              <Kbd className="hidden md:inline-flex">Esc</Kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin md:max-h-[50vh]">
              {showShortcuts ? (
                <Command.Group heading="Atalhos" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted">
                  {SHORTCUTS.map((s) => (
                    <Command.Item key={s.href} value={`atalho:${s.href}`} onSelect={() => go(s.href)} className={itemClass}>
                      <s.icon />
                      <span className="flex-1 truncate">{s.label}</span>
                      {s.hint ? <span className="text-xs text-muted-light">{s.hint}</span> : null}
                    </Command.Item>
                  ))}
                  {term.length === 1 ? <p className="px-2.5 py-2 text-xs text-muted">Digite pelo menos {MIN_CHARS} caracteres para buscar.</p> : null}
                </Command.Group>
              ) : null}

              {error ? (
                <p role="alert" className="px-3 py-6 text-center text-sm text-danger-fg">
                  {error}
                </p>
              ) : null}

              {!showShortcuts && searching && results === null ? <p className="px-3 py-6 text-center text-sm text-muted">Buscando…</p> : null}

              {results && results.total > 0
                ? results.groups.map((group) => {
                    const Icon = KIND_ICONS[group.kind];
                    return (
                      <Command.Group
                        key={group.kind}
                        heading={`${group.label} (${group.items.length})`}
                        className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted"
                      >
                        {group.items.map((item) => (
                          <Command.Item key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`} onSelect={() => go(item.href)} className={itemClass}>
                            <Icon />
                            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                              <span className="truncate font-medium">{item.title}</span>
                              {item.subtitle ? <span className="truncate text-xs text-muted">{item.subtitle}</span> : null}
                            </span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    );
                  })
                : null}

              {noResults ? (
                <div className="px-2 py-2">
                  <p className="px-1 py-4 text-center text-sm text-muted">
                    Nenhum resultado para <strong className="text-foreground">“{results?.term ?? term}”</strong>
                  </p>
                  <Command.Group heading="Criar" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted">
                    <Command.Item value="criar:cliente" onSelect={() => go("/clientes/novo")} className={itemClass}>
                      <Plus />
                      <span className="flex-1">Criar cliente</span>
                    </Command.Item>
                    <Command.Item value="criar:tarefa" onSelect={() => go("/tarefas?novo=1")} className={itemClass}>
                      <Plus />
                      <span className="flex-1">Criar tarefa</span>
                    </Command.Item>
                  </Command.Group>
                </div>
              ) : null}
            </Command.List>
            <div className="hidden items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted md:flex">
              <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
              <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> abrir</span>
              <span className="inline-flex items-center gap-1"><Kbd>Esc</Kbd> fechar</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default GlobalSearch;
