"use client";

import * as React from "react";
import { Activity, ArrowRight, Lock } from "lucide-react";
import { ERP_ITEM_STATE_LABELS, isOnState, type ErpDraftChange, type ErpLicenseItem } from "@/domain/erp/license";
import type { ErpItemRow } from "@/server/erp/company-view";
import type { ErpUsageView } from "@/server/erp/tower-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ROLE_LABELS, TONE_BADGE, fmtDate, fmtDateTime } from "./erp-format";

export interface ErpItemDrawerProps {
  item: ErpItemRow | null;
  byCode: ReadonlyMap<string, ErpItemRow>;
  contracted: ReadonlyMap<string, ErpLicenseItem>;
  draft: ReadonlyMap<string, ErpDraftChange>;
  canChange: boolean;
  usage: { loading: boolean; data: ErpUsageView | null };
  onLoadUsage: () => void;
  onDraft: (code: string, change: ErpDraftChange | null) => void;
  onOpenItem: (code: string) => void;
  onClose: () => void;
}

export function ErpItemDrawer({ item, byCode, contracted, draft, canChange, usage, onLoadUsage, onDraft, onOpenItem, onClose }: ErpItemDrawerProps) {
  return (
    <Drawer open={Boolean(item)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DrawerContent size="md" dismissOnOutsideClick>
        {item ? <ItemDetails key={item.code} item={item} byCode={byCode} contracted={contracted} draft={draft} canChange={canChange} usage={usage} onLoadUsage={onLoadUsage} onDraft={onDraft} onOpenItem={onOpenItem} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function ItemDetails({ item, byCode, contracted, draft, canChange, usage, onLoadUsage, onDraft, onOpenItem }: Omit<ErpItemDrawerProps, "item" | "onClose"> & { item: ErpItemRow }) {
  const status = item.status;
  const isUnit = item.role === "unit";
  const current = contracted.get(item.code)?.state ?? null;
  const drafted = draft.get(item.code) ?? null;
  const wasOn = isOnState(current);
  const owner = item.owner ? byCode.get(item.owner) : null;
  const unitUsage = usage.data?.byUnit[item.owner ?? item.code] ?? null;

  return (
    <>
      <DrawerHeader>
        <p className="font-mono text-xs text-muted">{item.code}</p>
        <DrawerTitle>{item.name}</DrawerTitle>
        <DrawerDescription className="flex flex-wrap items-center gap-1.5">
          <Badge variant={item.role === "core" ? "default" : "muted"} size="sm">
            {item.role === "core" ? <Lock aria-hidden /> : null}
            {ROLE_LABELS[item.role]}
          </Badge>
          {status ? (
            <Badge variant={TONE_BADGE[status.tone]} size="sm">
              {status.label}
            </Badge>
          ) : null}
          <Badge variant="muted" size="sm" title="Situação técnica do item no ERP (não é a contratação)">
            ERP: {item.devStatusLabel.toLowerCase()}
          </Badge>
          {drafted ? (
            <Badge variant="brand" size="sm">
              Preparado: {ERP_ITEM_STATE_LABELS[drafted.state].toLowerCase()}
            </Badge>
          ) : null}
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-5 text-sm">
        {item.description ? <p className="text-foreground">{item.description}</p> : null}
        {item.notes ? <p className="text-muted">{item.notes}</p> : null}

        {status ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Situação</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted">Contrato (INTEROS)</dt>
              <dd>
                {status.commercial.label}
                {contracted.get(item.code)?.until ? ` até ${fmtDate(contracted.get(item.code)?.until)}` : ""}
                {contracted.get(item.code)?.effectiveAt ? ` a partir de ${fmtDate(contracted.get(item.code)?.effectiveAt)}` : ""}
              </dd>
              <dt className="text-muted">No ERP agora</dt>
              <dd>
                {status.operational.label}
                {status.operational.since ? ` desde ${fmtDate(status.operational.since)}` : ""}
                {status.operational.until ? ` até ${fmtDate(status.operational.until)}` : ""}
              </dd>
              <dt className="text-muted">Sincronização</dt>
              <dd>{status.sync.label}</dd>
            </dl>
            {status.notice ? <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-fg">{status.notice}</p> : null}
            {status.configuration && !status.configuration.ready ? (
              <div className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
                <p className="font-medium">Ligado, aguardando configuração no ERP:</p>
                <ul className="mt-1 list-disc pl-4">
                  {status.configuration.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {item.role === "included" && owner ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Contratação</h3>
            <p>
              Faz parte de{" "}
              <button type="button" className="font-medium text-brand hover:underline" onClick={() => onOpenItem(owner.code)}>
                {owner.code} {owner.name}
              </button>
              : liga e desliga junto com ele.
            </p>
          </section>
        ) : null}
        {item.role === "core" ? <p className="text-muted">Recurso obrigatório da plataforma: sempre ativo para todas as empresas, não entra na contratação.</p> : null}

        <CodeList title="Precisa de (liga junto)" codes={item.requires} byCode={byCode} contracted={contracted} onOpenItem={onOpenItem} empty={isUnit && !item.requiresAny.length ? "Não depende de outra unidade." : null} />
        {item.requiresAny.map((group) => (
          <CodeList key={group.join()} title="Precisa de um destes (basta um)" codes={group} byCode={byCode} contracted={contracted} onOpenItem={onOpenItem} empty={null} />
        ))}
        {isUnit ? <CodeList title="Usado por (desliga junto)" codes={item.dependents} byCode={byCode} contracted={contracted} onOpenItem={onOpenItem} empty="Nenhuma outra unidade depende desta." /> : null}
        <CodeList title="Opcionais que combinam" codes={item.optional} byCode={byCode} contracted={contracted} onOpenItem={onOpenItem} empty={null} />

        {isUnit || item.role === "included" ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Uso (últimos 30 dias)</h3>
            {usage.data ? (
              usage.data.error ? (
                <p className="text-muted">{usage.data.error}</p>
              ) : unitUsage ? (
                <p className="flex items-center gap-2">
                  <Activity className="size-4 text-muted" aria-hidden />
                  {unitUsage.operations.toLocaleString("pt-BR")} operações{unitUsage.lastUseAt ? ` · último uso em ${fmtDateTime(unitUsage.lastUseAt)}` : ""}
                </p>
              ) : (
                <p className="text-muted">Sem uso registrado no período (ou o ERP não mede o uso deste item).</p>
              )
            ) : (
              <Button variant="outline" size="sm" onClick={onLoadUsage} loading={usage.loading}>
                Ver uso no ERP
              </Button>
            )}
          </section>
        ) : null}

        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Detalhes técnicos</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted">Classe</dt>
            <dd>{item.classLabel}</dd>
            {item.v1Key ? (
              <>
                <dt className="text-muted">Chave no ERP</dt>
                <dd className="font-mono">{item.v1Key}</dd>
              </>
            ) : null}
            {item.aliasOf ? (
              <>
                <dt className="text-muted">Mesmo recurso que</dt>
                <dd className="font-mono">{item.aliasOf}</dd>
              </>
            ) : null}
            {item.reuses ? (
              <>
                <dt className="text-muted">Reaproveita</dt>
                <dd>{item.reuses}</dd>
              </>
            ) : null}
            {item.permissions.length ? (
              <>
                <dt className="text-muted">Permissões no ERP</dt>
                <dd className="font-mono">{item.permissions.join(", ")}</dd>
              </>
            ) : null}
            {item.routes.length ? (
              <>
                <dt className="text-muted">Telas no ERP</dt>
                <dd className="font-mono">{item.routes.join(", ")}</dd>
              </>
            ) : null}
          </dl>
          <p className="mt-2 text-xs text-muted-light">As permissões dos funcionários do cliente continuam sendo geridas no próprio ERP.</p>
        </details>
      </DrawerBody>

      {isUnit && canChange ? (
        <DrawerFooter>
          {drafted ? (
            <Button variant="ghost" size="sm" onClick={() => onDraft(item.code, null)}>
              Desfazer
            </Button>
          ) : null}
          {wasOn ? (
            <Button variant="outline" size="sm" onClick={() => onDraft(item.code, { code: item.code, state: "inactive" })} disabled={drafted?.state === "inactive"}>
              Preparar desligamento
            </Button>
          ) : item.sellable ? (
            <Button size="sm" onClick={() => onDraft(item.code, { code: item.code, state: "active" })} disabled={drafted?.state === "active"}>
              Preparar ativação
            </Button>
          ) : (
            <p className="text-xs text-muted">Ainda não pode ser contratado (o ERP marca como {item.devStatusLabel.toLowerCase()}).</p>
          )}
        </DrawerFooter>
      ) : null}
    </>
  );
}

function CodeList({
  title,
  codes,
  byCode,
  contracted,
  onOpenItem,
  empty,
}: {
  title: string;
  codes: string[];
  byCode: ReadonlyMap<string, ErpItemRow>;
  contracted: ReadonlyMap<string, ErpLicenseItem>;
  onOpenItem: (code: string) => void;
  empty: string | null;
}) {
  if (!codes.length && !empty) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {codes.length ? (
        <ul className="flex flex-col gap-1">
          {codes.map((code) => {
            const row = byCode.get(code);
            const on = isOnState(contracted.get(code)?.state ?? null);
            return (
              <li key={code} className="flex items-center gap-2">
                <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
                <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => onOpenItem(code)}>
                  <span className="font-mono text-xs text-muted">{code}</span> {row?.name ?? code}
                </button>
                {row?.role === "unit" ? (
                  <Badge variant={on ? "success" : "muted"} size="sm" className="ml-auto shrink-0">
                    {on ? "contratado" : "não contratado"}
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">{empty}</p>
      )}
    </section>
  );
}
