"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Eye, History, Info, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { ScopeKind } from "@/domain/permissions";
import type { AccessCatalogView, UserAccessCapabilities, UserAccessView } from "@/server/admin/access";
import type { DefaultValue } from "@/server/auth/access-admin";
import { saveUserPermissionOverrides } from "@/server/admin/actions";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AccessHistoryList } from "./access-history";
import { sameAdjustments } from "./access-model";
import { AccessTree } from "./access-tree";
import { FormError } from "./form-error";

export interface UserAccessPanelProps {
  userName: string;
  view: UserAccessView;
  catalog: AccessCatalogView;
  caps: UserAccessCapabilities;
  /** Nunca negadas (Meu Dia). */
  neverDenied: string[];
}

/** Seção recolhível do drawer (estado controlado no cliente, sem atributo `open` antes da hidratação). */
function Section({ id, title, icon, badge, defaultOpen = false, children }: { id: string; title: string; icon: React.ReactNode; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
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
      {open ? (
        <div id={`${id}-body`} className="border-t border-border p-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Seções de acesso do drawer do usuário (A10): Exceções de acesso (tri-estado Padrão do perfil / Permitir / Negar,
 * motivo obrigatório, bloqueadas para o próprio usuário), Acesso efetivo (somente leitura, com a origem de cada
 * decisão) e Histórico de acesso. Cada bloco só chega do servidor quando o perfil pode vê-lo.
 */
export function UserAccessPanel({ userName, view, catalog, caps, neverDenied }: UserAccessPanelProps) {
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
          icon={<ShieldCheck />}
          badge={
            <Badge variant={exceptionsCount ? "brand" : "muted"} size="sm">
              {exceptionsCount ? `${exceptionsCount} exceção(ões)` : "Nenhuma"}
            </Badge>
          }
        >
          <ExceptionsEditor key={`${view.userId}-${view.updatedAt ?? "sem"}`} userName={userName} view={view} catalog={catalog} canManage={caps.manage} neverDenied={neverDenied} />
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
          <p className="mb-3 text-xs text-muted">O que {userName} vê e faz hoje, e de onde vem cada decisão: regra padrão, ajuste do perfil, exceção individual, módulo desativado ou nível acima negado. Somente leitura.</p>
          <AccessTree idPrefix={`ue-${view.userId}`} mode="effective" tree={catalog.tree} scopes={catalog.scopes} inactiveModules={catalog.inactiveModules} effective={view.effective} readOnly />
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

function ExceptionsEditor({ userName, view, catalog, canManage, neverDenied }: { userName: string; view: UserAccessView; catalog: AccessCatalogView; canManage: boolean; neverDenied: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [grants, setGrants] = React.useState<Record<string, boolean>>(view.grants);
  const [scopes, setScopes] = React.useState<Record<string, ScopeKind>>(view.scopes);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const readOnly = view.isSelf || !canManage;
  const dirty = !sameAdjustments(grants, view.grants) || !sameAdjustments(scopes, view.scopes);
  const count = Object.keys(grants).length + Object.keys(scopes).length;

  const baseline = React.useMemo(() => {
    const out: Record<string, DefaultValue> = {};
    for (const [k, v] of Object.entries(view.profileValues)) out[k] = v ? "s" : "n";
    return out;
  }, [view.profileValues]);

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

  const save = (clear = false) => {
    setError(null);
    if (reason.trim().length < 5) {
      setError("Informe o motivo da exceção (mínimo de 5 caracteres).");
      return;
    }
    startTransition(async () => {
      const result = await saveUserPermissionOverrides({ userId: view.userId, grants: clear ? {} : grants, scopes: clear ? {} : scopes, reason });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.changes ? "Exceções de acesso salvas" : "Nada mudou");
      setReason("");
      router.refresh();
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {view.isSelf ? (
        <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" /> Você não pode alterar as suas próprias exceções. É uma proteção contra perder o acesso por engano ou conceder mais permissões a si mesmo: peça a outro administrador.
        </p>
      ) : !canManage ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">Somente leitura: seu perfil não pode alterar exceções de acesso.</p>
      ) : (
        <p className="text-xs text-muted">Exceções valem só para {userName} e vencem o perfil. «Padrão do perfil» mostra o que o perfil dá hoje a esta pessoa.</p>
      )}
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
        baseLabel="Padrão do perfil"
        baseline={baseline}
        baselineScopes={view.profileScopes}
        grants={grants}
        scopeValues={scopes}
        onGrantChange={onGrantChange}
        onScopeChange={onScopeChange}
        readOnly={readOnly || pending}
        denyLocked={neverDenied}
      />
      {!readOnly ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <FormField label="Motivo" htmlFor={`ux-reason-${view.userId}`} required hint="Obrigatório: fica registrado no histórico de acesso.">
            <Textarea id={`ux-reason-${view.userId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[64px]" placeholder="Ex.: cobre as férias da coordenação financeira até 30/10" />
          </FormField>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {Object.keys(view.grants).length + Object.keys(view.scopes).length > 0 ? (
              <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => save(true)} disabled={pending}>
                <Trash2 /> Remover todas as exceções
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => save(false)} loading={pending} disabled={!dirty}>
              <Save /> Salvar exceções{count ? ` (${count})` : ""}
            </Button>
          </div>
        </div>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
