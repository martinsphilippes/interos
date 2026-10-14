"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Eye, History, Info, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { ScopeKind } from "@/domain/permissions";
import type { AccessCatalogView, UserAccessCapabilities, UserAccessView } from "@/server/admin/access";
import type { AccessPreview, DefaultValue } from "@/server/auth/access-admin";
import { previewUserPermissionOverrides, saveUserPermissionOverrides } from "@/server/admin/actions";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AccessHistoryList } from "./access-history";
import { RESTRICTED_EXEMPT_MODULE_KEYS, sameAdjustments } from "./access-model";
import { AccessTree } from "./access-tree";
import { FormError } from "./form-error";

/** Controle das exceções pelo drawer: o "Salvar alterações" do rodapé também salva os acessos alterados. */
export interface AccessEditorHandle {
  /** Abre a revisão (motivo + prévia) e salva; `then` roda depois de salvar com sucesso. */
  save: (then?: () => void) => void;
}

export interface UserAccessPanelProps {
  userName: string;
  view: UserAccessView;
  catalog: AccessCatalogView;
  caps: UserAccessCapabilities;
  /** Nunca negadas (Meu Dia). */
  neverDenied: string[];
  /** Avisado quando o rascunho das exceções passa a ter (ou deixa de ter) alterações não salvas. */
  onDirtyChange?: (dirty: boolean) => void;
  editorRef?: React.Ref<AccessEditorHandle>;
}

/**
 * Seção recolhível do drawer (estado controlado no cliente, sem atributo `open` antes da hidratação). Recolhida, o
 * conteúdo só fica oculto: o rascunho das exceções não se perde ao recolher.
 */
function Section({
  id,
  title,
  icon,
  badge,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  /** Controlado (opcional): o drawer abre a seção para mostrar o motivo ao salvar pelo rodapé. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (fn: (v: boolean) => boolean) => {
    const next = fn(open);
    setOpenState(next);
    onOpenChange?.(next);
  };
  return (
    <section className="rounded-lg border border-border" aria-labelledby={`${id}-title`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${id}-body`} className="flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-hover/60">
        {open ? <ChevronDown className="size-4 shrink-0 text-muted" /> : <ChevronRight className="size-4 shrink-0 text-muted" />}
        <span className="text-muted [&_svg]:size-4">{icon}</span>
        <span id={`${id}-title`} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </span>
        {badge}
      </button>
      <div id={`${id}-body`} hidden={!open} className="border-t border-border p-3">
        {children}
      </div>
    </section>
  );
}

/**
 * Seções de acesso do drawer do usuário (A10): Exceções de acesso (modo «Papel + exceções» ou «Só o que eu marcar»,
 * tri-estado por nó com a origem de cada decisão, resumo do que o papel libera, confirmação com a prévia exata do
 * servidor, motivo obrigatório, bloqueadas para o próprio usuário), Acesso efetivo (somente leitura, com a origem de
 * cada decisão) e Histórico de acesso. Cada bloco só chega do servidor quando o perfil pode vê-lo.
 */
export function UserAccessPanel({ userName, view, catalog, caps, neverDenied, onDirtyChange, editorRef }: UserAccessPanelProps) {
  const [dirty, setDirty] = React.useState(false);
  const [exceptionsOpen, setExceptionsOpen] = React.useState(false);
  const innerEditor = React.useRef<AccessEditorHandle>(null);
  // O rodapé do drawer salva por aqui: abre a seção (o motivo precisa estar visível) e repassa ao editor.
  React.useImperativeHandle(editorRef, () => ({
    save: (then?: () => void) => {
      setExceptionsOpen(true);
      innerEditor.current?.save(then);
    },
  }));
  const handleDirty = React.useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange?.(value);
    },
    [onDirtyChange],
  );
  const exceptionsCount = Object.keys(view.grants).length + Object.keys(view.scopes).length;
  const seenScreens = view.effective ? catalog.tree.filter((n) => n.kind === "tela" && view.effective!.values[n.key]).length : 0;
  const seenModules = view.effective ? catalog.tree.filter((n) => n.kind === "modulo" && view.effective!.values[n.key]).length : 0;

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Acessos</h3>
      {caps.exceptions ? (
        <Section
          id="ua-excecoes"
          title="Exceções de acesso"
          open={exceptionsOpen}
          onOpenChange={setExceptionsOpen}
          icon={<ShieldCheck />}
          badge={
            <span className="flex shrink-0 items-center gap-1">
              {dirty ? (
                <Badge variant="danger" size="sm">
                  Alterações não salvas
                </Badge>
              ) : null}
              {view.restricted ? (
                <Badge variant="warning" size="sm">
                  Só o marcado
                </Badge>
              ) : null}
              <Badge variant={exceptionsCount ? "brand" : "muted"} size="sm">
                {exceptionsCount ? `${exceptionsCount} exceção(ões)` : "Nenhuma"}
              </Badge>
            </span>
          }
        >
          <ExceptionsEditor
            key={`${view.userId}-${view.updatedAt ?? "sem"}`}
            userName={userName}
            view={view}
            catalog={catalog}
            canManage={caps.manage}
            neverDenied={neverDenied}
            onDirtyChange={handleDirty}
            editorRef={innerEditor}
          />
        </Section>
      ) : null}
      {caps.effective && view.effective ? (
        <Section
          id="ua-efetivo"
          title="Acesso efetivo"
          icon={<Eye />}
          badge={
            <Badge variant="muted" size="sm">
              {seenScreens} tela(s) · {seenModules} módulo(s)
            </Badge>
          }
        >
          <p className="mb-3 text-xs text-muted">
            O que {userName} vê e faz hoje, e de onde vem cada decisão: papel {view.roleLabel} (regra padrão ou ajuste do perfil), exceção individual, módulo desativado, nível acima negado
            {view.restricted ? " ou não marcado (modo «Só o que eu marcar»)" : ""}. Somente leitura.
          </p>
          <AccessTree idPrefix={`ue-${view.userId}`} mode="effective" tree={catalog.tree} scopes={catalog.scopes} inactiveModules={catalog.inactiveModules} effective={view.effective} roleLabel={view.roleLabel} readOnly />
        </Section>
      ) : null}
      {caps.history && view.history ? (
        <Section
          id="ua-historico"
          title="Histórico de acesso"
          icon={<History />}
          badge={
            <Badge variant="muted" size="sm">
              {view.history.length}
            </Badge>
          }
        >
          <AccessHistoryList items={view.history} emptyText="Nenhuma alteração de acesso registrada para esta pessoa." />
        </Section>
      ) : null}
    </div>
  );
}

type PreviewData = AccessPreview & { roleLabel: string };

interface ExceptionsEditorProps {
  userName: string;
  view: UserAccessView;
  catalog: AccessCatalogView;
  canManage: boolean;
  neverDenied: string[];
  onDirtyChange: (dirty: boolean) => void;
  editorRef?: React.Ref<AccessEditorHandle>;
}

function ExceptionsEditor({ userName, view, catalog, canManage, neverDenied, onDirtyChange, editorRef }: ExceptionsEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [grants, setGrants] = React.useState<Record<string, boolean>>(view.grants);
  const [scopes, setScopes] = React.useState<Record<string, ScopeKind>>(view.scopes);
  const [restricted, setRestricted] = React.useState(view.restricted);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ data: PreviewData; clear: boolean; then?: () => void } | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = React.useState(false);
  const readOnly = view.isSelf || !canManage;
  const dirty = !sameAdjustments(grants, view.grants) || !sameAdjustments(scopes, view.scopes) || restricted !== view.restricted;
  const count = Object.keys(grants).length + Object.keys(scopes).length;
  const hasSaved = Object.keys(view.grants).length + Object.keys(view.scopes).length > 0 || view.restricted;

  React.useEffect(() => {
    onDirtyChange(dirty && !readOnly);
  }, [dirty, readOnly, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const baseline = React.useMemo(() => {
    const out: Record<string, DefaultValue> = {};
    for (const [k, v] of Object.entries(view.profileValues)) out[k] = v ? "s" : "n";
    return out;
  }, [view.profileValues]);

  // O que o papel libera sem nada marcado (módulos e telas), para deixar a herança visível antes de editar.
  const roleSummary = React.useMemo(() => {
    const modules = catalog.tree.filter((n) => n.kind === "modulo" && view.profileValues[n.key]);
    const screens = catalog.tree.filter((n) => n.kind === "tela" && view.profileValues[n.key]).length;
    return { modules: modules.map((m) => m.label), screens };
  }, [catalog.tree, view.profileValues]);

  const inherit = React.useMemo(() => ({ roleLabel: view.roleLabel, restricted, exemptModules: [...RESTRICTED_EXEMPT_MODULE_KEYS] }), [view.roleLabel, restricted]);

  const onGrantChange = React.useCallback((key: string, value: boolean | undefined) => {
    setGrants((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);
  const onScopeChange = React.useCallback((screen: string, value: ScopeKind | undefined) => {
    setScopes((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[screen];
      else next[screen] = value;
      return next;
    });
  }, []);

  const draftFor = (clear: boolean) => (clear ? { grants: {}, scopes: {}, restricted: false } : { grants, scopes, restricted });

  /** Antes de salvar: pede ao servidor a prévia exata e mostra o que a pessoa passa a abrir e o que vem do papel. */
  const review = (clear = false, then?: () => void) => {
    setError(null);
    if (reason.trim().length < 5) {
      const message = "Informe o motivo da alteração de acesso (mínimo de 5 caracteres).";
      setError(message);
      toast.error(message);
      // O campo fica no fim da lista de acessos (e a seção pode estar abrindo agora): leva a pessoa até ele.
      window.setTimeout(() => {
        reasonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        reasonRef.current?.focus({ preventScroll: true });
      }, 50);
      return;
    }
    startTransition(async () => {
      const result = await previewUserPermissionOverrides({ userId: view.userId, ...draftFor(clear) });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setPreview({ data: result.data, clear, then });
    });
  };

  React.useImperativeHandle(editorRef, () => ({ save: (then?: () => void) => review(false, then) }));

  const confirmSave = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const result = await saveUserPermissionOverrides({ userId: view.userId, ...draftFor(preview.clear), reason });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        setPreview(null);
        return;
      }
      toast.success(result.data.changes ? "Acessos salvos" : "Nada mudou");
      const then = preview.then;
      setPreview(null);
      setReason("");
      then?.();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {view.isSelf ? (
        <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" /> Você não pode alterar as suas próprias exceções. É uma proteção contra perder o acesso por engano ou conceder mais permissões a si mesmo: peça a outro administrador.
        </p>
      ) : !canManage ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">Somente leitura: seu perfil não pode alterar exceções de acesso.</p>
      ) : null}

      <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3">
        <p className="text-xs font-semibold">Como liberar o acesso de {userName}</p>
        <SegmentedControl<"papel" | "restrito">
          size="sm"
          aria-label="Modo de liberação"
          value={restricted ? "restrito" : "papel"}
          onChange={(v) => !readOnly && !pending && setRestricted(v === "restrito")}
          options={[
            { value: "papel", label: "Papel + exceções", disabled: readOnly },
            { value: "restrito", label: "Só o que eu marcar", disabled: readOnly },
          ]}
          className="max-w-full flex-wrap self-start"
        />
        {restricted ? (
          <p className="text-xs text-muted">
            Tudo começa <strong className="text-foreground">bloqueado</strong>. Só vale o que você marcar como Permitir: marcar um módulo libera o que o papel {view.roleLabel} dá dentro dele; marcar uma tela, seção ou ação libera também o caminho até ela. Use Negar para cortar partes. O Início (Meu Dia) segue sempre o papel.
          </p>
        ) : (
          <p className="text-xs text-muted">
            {userName} recebe <strong className="text-foreground">tudo o que o papel {view.roleLabel} libera</strong>; aqui você só ajusta exceções (Permitir ou Negar), que valem só para esta pessoa.
            {roleSummary.modules.length ? (
              <>
                {" "}
                Sem marcar nada, o papel já libera {roleSummary.screens} tela(s) em: <span className="text-foreground">{roleSummary.modules.join(", ")}</span>.
              </>
            ) : null}
          </p>
        )}
      </div>

      {view.updatedAt ? (
        <p className="text-xs text-muted">
          Última alteração em <span className="tabular-nums">{formatDateTime(view.updatedAt)}</span>
          {view.updatedByName ? ` por ${view.updatedByName}` : ""}
          {view.reason ? ` · motivo: ${view.reason}` : ""}
        </p>
      ) : null}
      <AccessTree
        idPrefix={`ux-${view.userId}`}
        mode="edit"
        tree={catalog.tree}
        scopes={catalog.scopes}
        inactiveModules={catalog.inactiveModules}
        baseLabel={restricted ? "Não marcado" : "Seguir papel"}
        baseline={baseline}
        baselineScopes={view.profileScopes}
        grants={grants}
        scopeValues={scopes}
        onGrantChange={onGrantChange}
        onScopeChange={onScopeChange}
        readOnly={readOnly || pending}
        denyLocked={neverDenied}
        inherit={inherit}
      />
      {!readOnly ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <FormField label="Motivo" htmlFor={`ux-reason-${view.userId}`} required hint="Obrigatório: fica registrado no histórico de acesso.">
            <Textarea ref={reasonRef} id={`ux-reason-${view.userId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[64px]" placeholder="Ex.: cobre as férias da coordenação financeira até 30/10" />
          </FormField>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasSaved ? (
              <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => review(true)} disabled={pending}>
                <Trash2 /> Remover todas as exceções
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => review(false)} loading={pending} disabled={!dirty}>
              <Save /> Revisar e salvar{count ? ` (${count})` : ""}
            </Button>
          </div>
        </div>
      ) : null}
      <FormError message={error} />

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && !saving && setPreview(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{preview?.clear ? `Remover as exceções de ${userName}?` : `Confirmar os acessos de ${userName}`}</DialogTitle>
            <DialogDescription>Antes de salvar, veja o que a pessoa passa a abrir e de onde vem cada acesso.</DialogDescription>
          </DialogHeader>
          {preview ? (
            <DialogBody className="flex flex-col gap-3 py-3">
              <AccessPreviewSummary
                preview={preview.data}
                userName={userName}
                clear={preview.clear}
                onSwitchToRestricted={
                  !preview.clear && !preview.data.restricted
                    ? () => {
                        setRestricted(true);
                        setPreview(null);
                      }
                    : undefined
                }
              />
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={saving}>
              Voltar e revisar
            </Button>
            <Button variant={preview?.clear ? "destructive" : "primary"} onClick={confirmSave} loading={saving}>
              {preview?.clear ? "Remover exceções" : "Confirmar e salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Resumo da prévia: total de telas e, quando há, o que o papel libera além do que foi marcado. */
function AccessPreviewSummary({ preview, userName, clear, onSwitchToRestricted }: { preview: PreviewData; userName: string; clear: boolean; onSwitchToRestricted?: () => void }) {
  const inheritedModules = preview.modules.filter((m) => m.inheritedScreens > 0 || m.inheritedItems > 0);
  const { inherited, marked, roleLabel } = preview;
  return (
    <>
      <p className="text-sm">
        {clear ? `Sem exceções, ${userName} segue só o papel ${roleLabel}: ` : `${userName} vai abrir `}
        <strong>{preview.screens} tela(s)</strong> em <strong>{preview.modules.length} módulo(s)</strong>
        {preview.modules.length ? `: ${preview.modules.map((m) => `${m.label} (${m.screens})`).join(", ")}` : ""}.
      </p>
      {!clear && preview.restricted ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
          Modo «Só o que eu marcar»: nada fora do que você marcou é liberado.
          {marked.screens || marked.items ? ` Marcados por você (ou no caminho até eles): ${marked.screens} tela(s) e ${marked.items} seção(ões)/ação(ões).` : ""}
          {inherited.screens || inherited.items ? ` Dentro do que você marcou, e no Início, vale o papel ${roleLabel}: ${inherited.screens} tela(s) e ${inherited.items} seção(ões)/ação(ões).` : ""}
        </p>
      ) : null}
      {!clear && !preview.restricted && (inherited.screens > 0 || inherited.items > 0) ? (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
          <p className="flex items-start gap-1.5 font-medium">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Além do que você marcou, o papel {roleLabel} libera mais {inherited.screens} tela(s) e {inherited.items} seção(ões)/ação(ões).
          </p>
          <ul className="flex flex-col gap-0.5 pl-5">
            {inheritedModules.map((m) => (
              <li key={m.key} className="list-disc">
                {m.label}: {m.inheritedScreens} tela(s){m.inheritedItems ? ` e ${m.inheritedItems} item(ns)` : ""}
              </li>
            ))}
          </ul>
          {onSwitchToRestricted ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Se a ideia é liberar só o que você marcou:</span>
              <Button type="button" size="sm" variant="outline" onClick={onSwitchToRestricted}>
                Usar «Só o que eu marcar»
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
