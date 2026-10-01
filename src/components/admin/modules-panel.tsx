"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Puzzle } from "lucide-react";
import type { ModuleImpact } from "@/server/admin/access";
import { saveActiveModules } from "@/server/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface ModulesPanelProps {
  modules: ModuleImpact[];
  /** admin.acessos.gerir (calculado no servidor; a action revalida). */
  canManage: boolean;
}

/**
 * Aba "Módulos da empresa" (A8): liga/desliga módulos para a empresa inteira. Desligar esconde o módulo da navegação
 * e nega telas e ações a todos (administradores inclusive) sem apagar dados; Início e Administração ficam sempre
 * ativos. Cada mudança mostra antes o impacto (quem perde ou ganha acesso).
 */
export function ModulesPanel({ modules, canManage }: ModulesPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [target, setTarget] = React.useState<ModuleImpact | null>(null);
  const [reason, setReason] = React.useState("");
  const inactive = modules.filter((m) => !m.active).map((m) => m.key);

  const apply = (m: ModuleImpact) =>
    new Promise<void>((resolve) => {
      const next = m.active ? [...inactive, m.key] : inactive.filter((k) => k !== m.key);
      startTransition(async () => {
        const result = await saveActiveModules({ inactive: next, reason: reason || undefined });
        if (!result.ok) toast.error(result.error);
        else {
          toast.success(m.active ? `Módulo ${m.label} desativado` : `Módulo ${m.label} ativado`);
          setReason("");
          router.refresh();
        }
        resolve();
      });
    });

  const affected = target?.affectedUsers ?? [];
  const names = affected.slice(0, 8).map((u) => u.name);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="size-4" /> Módulos da empresa
          {inactive.length ? (
            <Badge variant="warning" size="sm">
              {inactive.length} desativado(s)
            </Badge>
          ) : (
            <Badge variant="success" size="sm">
              Todos ativos
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Desativar um módulo o esconde do menu, dos atalhos e dos links e bloqueia as telas e ações dele para todos. Os dados continuam guardados: ao religar, tudo volta como estava.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {modules.map((m) => (
            <li key={m.key} className={cn("flex min-w-0 items-start gap-3 px-4 py-3", !m.active && "bg-surface-muted/60")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.label}</span>
                  {!m.deactivatable ? (
                    <Badge variant="outline" size="sm">
                      <Lock /> Sempre ativo
                    </Badge>
                  ) : !m.active ? (
                    <Badge variant="danger" size="sm">
                      Desativado
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {m.screens} tela(s)
                  {m.deactivatable
                    ? m.active
                      ? ` · ${m.affectedUsers.length} usuário(s) ativo(s) usam este módulo`
                      : ` · ao religar, ${m.affectedUsers.length} usuário(s) voltam a ter acesso`
                    : " · necessário para o acesso ao sistema e à administração"}
                </p>
              </div>
              <Switch
                checked={m.active}
                disabled={!m.deactivatable || !canManage || pending}
                onCheckedChange={() => setTarget(m)}
                aria-label={m.active ? `Desativar o módulo ${m.label}` : `Ativar o módulo ${m.label}`}
              />
            </li>
          ))}
        </ul>
        {!canManage ? <p className="px-4 py-3 text-xs text-muted">Somente leitura: seu perfil não pode alterar os módulos da empresa.</p> : null}
      </CardContent>

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target?.active ? `Desativar o módulo ${target.label}?` : `Ativar o módulo ${target?.label ?? ""}?`}
        destructive={Boolean(target?.active)}
        confirmLabel={target?.active ? "Desativar módulo" : "Ativar módulo"}
        description={
          target?.active
            ? `${affected.length} usuário(s) perdem acesso a ${target.label}${affected.length ? ` (${names.join(", ")}${affected.length > names.length ? ` e mais ${affected.length - names.length}` : ""})` : ""}. As ${target.screens} tela(s) somem do menu e as ações passam a ser negadas. Nenhum dado é apagado.`
            : target
              ? `${affected.length} usuário(s) voltam a ter acesso a ${target.label}, conforme o perfil de cada um.`
              : undefined
        }
        onConfirm={() => (target ? apply(target) : undefined)}
      >
        <FormField label="Motivo (opcional)" htmlFor="mod-reason" hint="Fica registrado no histórico de acesso.">
          <Input id="mod-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex.: módulo ainda não contratado" />
        </FormField>
      </ConfirmDialog>
    </Card>
  );
}
