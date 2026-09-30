"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, Save, ShieldCheck } from "lucide-react";
import type { RoleKey } from "@/domain/constants";
import type { ScopeKind } from "@/domain/permissions";
import type { AccessCatalogView, AccessHistoryItem, RoleProfileView } from "@/server/admin/access";
import { savePermissionProfile } from "@/server/admin/actions";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { AccessHistoryList } from "./access-history";
import { sameAdjustments } from "./access-model";
import { AccessTree } from "./access-tree";
import { FormError } from "./form-error";
import { useAdminUrl } from "./use-admin-url";

export interface ProfilesPanelProps {
  catalog: AccessCatalogView;
  profiles: RoleProfileView[];
  recent: AccessHistoryItem[];
  /** admin.acessos.gerir (calculado no servidor; a action revalida). */
  canManage: boolean;
  /** Chaves protegidas: o perfil Administrador não aceita negá-las. */
  protectedKeys: string[];
  /** Nunca negadas em perfil nenhum (Meu Dia). */
  neverDenied: string[];
  initialRole: RoleKey;
}

/**
 * Aba "Perfis e acessos" de /admin/usuarios (A10): escolhe o perfil (papel) e ajusta a árvore Módulo › Tela › Seção
 * › Ação (Padrão / Permitir / Negar) e o escopo de dados por tela. Salvar grava `permission_profiles/role_<papel>`
 * com auditoria de → para; o menu de todos com o papel muda na hora.
 */
export function ProfilesPanel({ catalog, profiles, recent, canManage, protectedKeys, neverDenied, initialRole }: ProfilesPanelProps) {
  const { setLocal } = useAdminUrl();
  const [role, setRole] = React.useState<RoleKey>(initialRole);
  const profile = profiles.find((p) => p.role === role) ?? profiles[0];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between">
          <FormField label="Perfil" htmlFor="pf-role" hint="Cada papel é um perfil. Ajustes valem para todas as pessoas com o papel, salvo exceções individuais." className="md:max-w-md md:flex-1">
            <Select
              id="pf-role"
              value={role}
              onChange={(e) => {
                const next = e.target.value as RoleKey;
                setRole(next);
                setLocal({ perfil: next });
              }}
            >
              {profiles.map((p) => (
                <option key={p.role} value={p.role}>
                  {p.label} · {p.users} usuário(s) ativo(s){Object.keys(p.grants).length + Object.keys(p.scopes).length ? " · ajustado" : ""}
                </option>
              ))}
            </Select>
          </FormField>
          {profile.updatedAt ? (
            <p className="text-xs text-muted md:text-right">
              Última alteração em <span className="tabular-nums">{formatDateTime(profile.updatedAt)}</span>
              {profile.updatedByName ? ` por ${profile.updatedByName}` : ""}
              {profile.reason ? <span className="block">Motivo: {profile.reason}</span> : null}
            </p>
          ) : (
            <p className="text-xs text-muted md:text-right">Sem ajustes: este perfil segue as regras padrão.</p>
          )}
        </CardContent>
      </Card>

      <ProfileEditor key={`${profile.role}-${profile.updatedAt ?? "padrao"}`} profile={profile} catalog={catalog} canManage={canManage} denyLocked={profile.role === "admin" ? [...new Set([...protectedKeys, ...neverDenied])] : neverDenied} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" /> Últimas alterações de acesso
          </CardTitle>
          <CardDescription>Perfis, exceções individuais, módulos da empresa e tentativas bloqueadas pelas regras de segurança.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccessHistoryList items={recent} emptyText="Nenhuma alteração de acesso registrada ainda." />
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileEditor({ profile, catalog, canManage, denyLocked }: { profile: RoleProfileView; catalog: AccessCatalogView; canManage: boolean; denyLocked: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [grants, setGrants] = React.useState<Record<string, boolean>>(profile.grants);
  const [scopes, setScopes] = React.useState<Record<string, ScopeKind>>(profile.scopes);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const readOnly = !canManage;

  const adjustments = Object.keys(grants).length + Object.keys(scopes).length;
  const dirty = !sameAdjustments(grants, profile.grants) || !sameAdjustments(scopes, profile.scopes);

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

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await savePermissionProfile({ role: profile.role, grants, scopes, reason: reason || undefined });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.changes ? `Perfil ${profile.label} salvo (${result.data.changes} alteração(ões))` : "Nada mudou");
      setReason("");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4" /> Acessos do perfil {profile.label}
            <Badge variant={adjustments ? "brand" : "muted"} size="sm">
              {adjustments ? `${adjustments} ajuste(s)` : "Padrão"}
            </Badge>
            {dirty ? (
              <Badge variant="warning" size="sm">
                Alterações não salvas
              </Badge>
            ) : null}
            {readOnly ? (
              <Badge variant="outline" size="sm">
                Somente leitura
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            «Padrão» segue a regra do sistema para o papel. «Permitir» e «Negar» valem para todos com este papel. Negar uma tela esconde as seções e ações dela; permitir uma ação não abre a tela.
          </CardDescription>
        </div>
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmReset(true)} disabled={pending || adjustments === 0} className="shrink-0">
            <RotateCcw /> Restaurar padrão
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AccessTree
          idPrefix={`pf-${profile.role}`}
          mode="edit"
          tree={catalog.tree}
          scopes={catalog.scopes}
          inactiveModules={catalog.inactiveModules}
          baseLabel="Padrão"
          baseline={profile.defaults}
          baselineScopes={profile.defaultScopes}
          showRuleText
          grants={grants}
          scopeValues={scopes}
          onGrantChange={onGrantChange}
          onScopeChange={onScopeChange}
          readOnly={readOnly || pending}
          denyLocked={denyLocked}
        />
        {!readOnly ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-end">
            <FormField label="Motivo (opcional)" htmlFor={`pf-reason-${profile.role}`} hint="Fica registrado no histórico de acesso." className="md:flex-1">
              <Input id={`pf-reason-${profile.role}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex.: financeiro passa a aprovar títulos" />
            </FormField>
            <Button type="button" onClick={save} loading={pending} disabled={!dirty}>
              <Save /> Salvar perfil
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
      </CardContent>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Restaurar o padrão do perfil ${profile.label}?`}
        description="Todos os ajustes deste perfil (acessos e escopos) voltam para a regra padrão. A mudança só vale depois de salvar."
        confirmLabel="Restaurar"
        onConfirm={() => {
          setGrants({});
          setScopes({});
        }}
      />
    </Card>
  );
}
