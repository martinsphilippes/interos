"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, History, LayoutGrid, RefreshCw, TowerControl } from "lucide-react";
import { ERP_CONTROL_MODE_LABELS, ERP_ITEM_STATE_LABELS, isOnState, type ErpControlMode } from "@/domain/erp/license";
import type { ErpCompanyView } from "@/server/erp/company-view";
import type { ErpUsageView } from "@/server/erp/tower-view";
import { importErpCatalogAction, loadErpUsageAction, refreshErpStateAction, type ChangeOutcome } from "@/server/erp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useErpDraft } from "./erp-draft-store";
import { endOfDayIso, fmtDate, fmtDateTime, startOfDayIso } from "./erp-format";
import { ErpModuleTree, type DateActionKind } from "./erp-module-tree";
import { ErpReviewDialog } from "./erp-review-dialog";
import { ErpItemDrawer } from "./erp-item-drawer";
import { ErpHistoryList, ErpOpenChangeCard, ErpProvisioningCard, type ErpChangeCaps } from "./erp-changes";
import { ErpTowerPanel } from "./erp-tower-panel";
import { ErpLinkPanel } from "./erp-link-panel";
import type { ProvisionDefaults } from "./erp-provision-dialog";

export interface ErpWorkspaceCaps extends ErpChangeCaps {
  history: boolean;
  tower: boolean;
  importCatalog: boolean;
}

export type ErpSubView = "modulos" | "torre" | "historico";

export interface ErpWorkspaceProps {
  clientId: string;
  clientName: string;
  view: ErpCompanyView;
  caps: ErpWorkspaceCaps;
  defaults: ProvisionDefaults;
  initialView?: ErpSubView;
}

const MODE_SHORT: Record<ErpControlMode, string> = { legacy: "Legado", shadow: "Observação", enforced: "Contrato aplicado" };

export function ErpWorkspace(props: ErpWorkspaceProps) {
  const { view, caps } = props;
  if (view.state === "nao_configurado") {
    return (
      <EmptyState
        title="Integração com o ERP Intercert não configurada"
        description={
          caps.importCatalog && view.integration.missing.length
            ? `Neste ambiente faltam as variáveis: ${view.integration.missing.join(", ")}. Veja Administração › Integrações.`
            : "Este ambiente ainda não está ligado ao ERP. Quando a integração for ativada, os módulos da empresa aparecem aqui."
        }
      />
    );
  }
  if (view.state === "sem_catalogo") return <MissingCatalog view={view} canImport={caps.importCatalog} />;
  if (view.state === "sem_vinculo") {
    return (
      <div className="flex flex-col gap-4">
        {view.provisioning ? <ErpProvisioningCard change={view.provisioning} caps={caps} /> : null}
        <ErpLinkPanel clientId={props.clientId} view={view} canProvision={caps.provision} defaults={props.defaults} />
      </div>
    );
  }
  return <Workspace {...props} />;
}

function MissingCatalog({ view, canImport }: { view: ErpCompanyView; canImport: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <EmptyState
      title="Catálogo de módulos do ERP ainda não importado"
      description={`${view.catalogError ?? "O INTEROS ainda não leu o catálogo do ERP."} Sem o catálogo não dá para mostrar nem alterar os módulos.`}
      action={
        canImport ? (
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await importErpCatalogAction().catch(() => ({ ok: false as const, error: "A conexão caiu." }));
              setBusy(false);
              if (res.ok) toast.success(`Catálogo ${res.data.version} importado.`);
              else toast.error(res.error);
              router.refresh();
            }}
          >
            Importar catálogo agora
          </Button>
        ) : undefined
      }
    />
  );
}

function Workspace({ clientId, clientName, view, caps, initialView }: ErpWorkspaceProps) {
  const router = useRouter();
  const [sub, setSub] = React.useState<ErpSubView>(initialView && (initialView !== "torre" || caps.tower) && (initialView !== "historico" || caps.history) ? initialView : "modulos");
  const contracted = React.useMemo(() => new Map(view.license.items.map((i) => [i.code, i])), [view.license.items]);
  const byCode = React.useMemo(() => new Map(view.items.map((i) => [i.code, i])), [view.items]);
  const { draft, list, set, clear } = useErpDraft(clientId, contracted);
  const currentMode = (view.erp?.mode ?? null) as ErpControlMode | null;
  const [modeDraft, setModeDraft] = React.useState<ErpControlMode | null>(null);
  const pendingMode = modeDraft && modeDraft !== currentMode ? modeDraft : null;
  const pending = list.length + (pendingMode ? 1 : 0);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [openItem, setOpenItem] = React.useState<string | null>(null);
  const [dateAction, setDateAction] = React.useState<{ code: string; kind: DateActionKind } | null>(null);
  const [usage, setUsage] = React.useState<{ loading: boolean; data: ErpUsageView | null }>({ loading: false, data: null });
  const [refreshing, setRefreshing] = React.useState(false);

  const erpDown = Boolean(view.erp && !view.erp.ok);
  const locked = Boolean(view.openChange) || erpDown;
  const sendBlockedReason = view.openChange
    ? "Há uma alteração em andamento nesta empresa (acima). Você pode preparar a próxima; o envio fica liberado quando ela terminar."
    : erpDown
      ? "O ERP não respondeu agora: a edição fica travada até ele responder (o estado abaixo é o último confirmado)."
      : null;
  // Com alteração aberta, a pessoa ainda pode preparar (a seleção fica guardada); só o envio espera.
  const canEdit = caps.change && !erpDown;
  const nameOf = React.useCallback((code: string) => byCode.get(code)?.name ?? code, [byCode]);

  const counts = React.useMemo(() => {
    const units = view.items.filter((i) => i.role === "unit");
    const on = units.filter((u) => isOnState(contracted.get(u.code)?.state ?? null));
    const activeNow = units.filter((u) => u.status?.operational.state === "ativo" || u.status?.operational.state === "em_encerramento");
    const configured = on.filter((u) => u.status?.operational.state === "ativo" && (!u.status.configuration || u.status.configuration.ready));
    return { units: units.length, contracted: on.length, configured: configured.length, active: activeNow.length };
  }, [view.items, contracted]);

  async function refresh() {
    setRefreshing(true);
    await refreshErpStateAction({ clientId }).catch(() => null);
    router.refresh();
    setRefreshing(false);
  }

  async function loadUsage() {
    setUsage({ loading: true, data: null });
    const res = await loadErpUsageAction({ clientId }).catch(() => ({ ok: false as const, error: "A conexão caiu." }));
    if (res.ok) setUsage({ loading: false, data: res.data });
    else setUsage({ loading: false, data: { from: "", to: "", totals: null, limits: null, byUnit: {}, error: res.error } });
  }

  function onDone(outcome: ChangeOutcome) {
    clear();
    setModeDraft(null);
    setConflict(null);
    if (outcome.status === "aplicada") toast.success(`Aplicada pelo ERP (versão ${outcome.licenseVersion ?? "—"}).`);
    else if (outcome.status === "aguardando_aprovacao") toast.info("Enviada para aprovação.");
    else if (outcome.status === "falhou") toast.warning("Registrada. O ERP ainda não confirmou: a sincronização continua sozinha.");
    else toast.error("O ERP recusou a alteração. Veja o histórico.");
    router.refresh();
  }

  const companyName = view.erp?.companyName ?? view.link?.erpCompanyName ?? clientName;
  const erpId = view.link?.erpCompanyId ?? "";

  return (
    <div className="flex flex-col gap-4">
      <header className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-canvas/95 px-4 py-3 shadow-card backdrop-blur md:top-topbar">
        <div className="min-w-0 flex-1">
          <p className="hidden text-xs text-muted sm:block">
            ERP Intercert{view.environmentLabel ? ` · ${view.environmentLabel}` : ""}
            {view.host ? ` · ${view.host}` : ""}
          </p>
          <p className="truncate text-base font-semibold">{companyName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              ID ERP <span className="font-mono text-foreground">{erpId}</span>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-surface-hover"
                aria-label="Copiar ID ERP"
                onClick={() => navigator.clipboard.writeText(erpId).then(() => toast.success("ID ERP copiado."), () => undefined)}
              >
                <Copy className="size-3.5" aria-hidden />
              </button>
            </span>
            {currentMode ? <span className="hidden sm:inline">Controle: {MODE_SHORT[currentMode]}</span> : null}
            <span className="hidden sm:inline" title="Versão da licença emitida pelo INTEROS e confirmada pelo ERP">
              {view.license.appliedVersion ? `Licença v${view.license.appliedVersion}` : "Licença ainda não registrada pelo INTEROS"}
              {view.license.issuedVersion > view.license.appliedVersion ? ` (emitida v${view.license.issuedVersion})` : ""}
              {view.erp?.appliedVersion && view.erp.appliedVersion !== view.license.appliedVersion ? ` · ERP na v${view.erp.appliedVersion}` : ""}
            </span>
            {view.erp?.readAt ? <span className="hidden sm:inline">lido {fmtDateTime(view.erp.readAt)}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pending > 0 ? (
            <>
              <Badge variant="brand">
                {pending} alteraç{pending === 1 ? "ão preparada" : "ões preparadas"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clear();
                  setModeDraft(null);
                }}
              >
                Descartar
              </Button>
              <Button size="sm" onClick={() => setReviewOpen(true)} disabled={!caps.change || locked} title={sendBlockedReason ?? undefined}>
                Revisar e enviar
              </Button>
            </>
          ) : null}
          <Button variant="outline" size="sm" onClick={refresh} loading={refreshing} aria-label="Atualizar estado do ERP">
            <RefreshCw aria-hidden /> <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </header>

      {conflict ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-fg" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {conflict} {pending ? "Sua seleção pendente foi mantida: revise e envie de novo." : "Nada ficou pendente."}
          </span>
        </p>
      ) : null}
      {erpDown ? (
        <p className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Não foi possível ler esta empresa no ERP agora: {view.erp?.error?.message} Mostrando o último estado confirmado pelo INTEROS; alterações ficam travadas até a leitura voltar.
            {view.erp?.error?.requestId ? <span className="ml-1 font-mono text-xs">ref. {view.erp.error.requestId}</span> : null}
          </span>
        </p>
      ) : null}
      {view.license.initial && !erpDown ? (
        <p className="rounded-lg border border-info/35 bg-info-soft px-3 py-2 text-sm text-info-fg">
          O INTEROS ainda não registrou a licença desta empresa: o contratado abaixo é o que ela usa hoje no ERP. O primeiro envio registra esse retrato, sem desligar nada que não esteja na revisão.
        </p>
      ) : null}
      {view.erp?.companyStatus && view.erp.companyStatus !== "active" && view.erp.companyStatus !== "ativa" ? (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-fg">Situação da empresa no ERP: {view.erp.companyStatus}.</p>
      ) : null}
      {view.erp?.nextTransitionAt ? <p className="text-xs text-muted">Próxima mudança automática no ERP (teste, agendamento ou encerramento): {fmtDate(view.erp.nextTransitionAt)}.</p> : null}
      {view.catalog?.lastError ? <p className="text-xs text-warning-fg">Última conferência do catálogo falhou ({view.catalog.lastError}); usando a versão {view.catalog.version}.</p> : null}

      {view.openChange ? <ErpOpenChangeCard key={`${view.openChange.id}-${view.openChange.updatedAt}`} change={view.openChange} caps={caps} nameOf={nameOf} /> : null}
      {view.provisioning ? <ErpProvisioningCard change={view.provisioning} caps={caps} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<ErpSubView>
          aria-label="Visão"
          value={sub}
          onChange={setSub}
          options={[
            { value: "modulos", label: "Módulos", icon: <LayoutGrid className="size-4" aria-hidden /> },
            ...(caps.tower ? [{ value: "torre" as const, label: "Torre de Controle", icon: <TowerControl className="size-4" aria-hidden /> }] : []),
            ...(caps.history ? [{ value: "historico" as const, label: "Histórico", icon: <History className="size-4" aria-hidden /> }] : []),
          ]}
        />
        {sub === "modulos" && caps.change ? (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Controle no ERP
            <Select
              value={modeDraft ?? ""}
              onChange={(e) => setModeDraft((e.target.value || null) as ErpControlMode | null)}
              disabled={!canEdit}
              size="sm"
              className="w-56"
              aria-label="Modo de controle da licença no ERP"
              options={[
                { value: "", label: `Manter (${currentMode ? MODE_SHORT[currentMode] : "—"})` },
                ...(["legacy", "shadow", "enforced"] as const).filter((m) => m !== currentMode).map((m) => ({ value: m, label: MODE_SHORT[m] })),
              ]}
            />
          </label>
        ) : null}
      </div>
      {pendingMode ? <p className="-mt-2 text-xs text-muted">Preparado: {ERP_CONTROL_MODE_LABELS[pendingMode]}.</p> : null}

      {sub === "modulos" ? (
        <>
          <p className="text-xs text-muted">
            {counts.contracted} contratadas · {counts.active} ativas no ERP · {counts.configured} configuradas · catálogo {view.catalog?.version ?? "—"} ({view.catalog?.counts.modules ?? 0} módulos, {view.catalog?.counts.sellableUnits ?? 0} unidades vendáveis)
          </p>
          <ErpModuleTree
            view={view}
            canChange={caps.change}
            locked={erpDown}
            lockedReason={erpDown ? sendBlockedReason : null}
            draft={draft}
            onDraft={set}
            onRequestDate={(code, kind) => setDateAction({ code, kind })}
            onOpenItem={setOpenItem}
          />
        </>
      ) : null}
      {sub === "torre" ? <ErpTowerPanel clientId={clientId} counts={counts} usage={usage} onLoadUsage={loadUsage} /> : null}
      {sub === "historico" ? <ErpHistoryList changes={view.history ?? []} nameOf={nameOf} /> : null}

      <ErpReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        clientId={clientId}
        draft={list}
        controlMode={pendingMode}
        onDone={onDone}
        onConflict={(message) => {
          setConflict(message);
          router.refresh();
        }}
      />
      <ErpItemDrawer
        item={openItem ? (byCode.get(openItem) ?? null) : null}
        byCode={byCode}
        contracted={contracted}
        draft={draft}
        canChange={canEdit}
        usage={usage}
        onLoadUsage={loadUsage}
        onDraft={set}
        onOpenItem={setOpenItem}
        onClose={() => setOpenItem(null)}
      />
      {dateAction ? (
        <DateActionDialog
          code={dateAction.code}
          name={nameOf(dateAction.code)}
          kind={dateAction.kind}
          onClose={() => setDateAction(null)}
          onConfirm={(date) => {
            const { code, kind } = dateAction;
            set(code, kind === "trial" ? { code, state: "trial", until: endOfDayIso(date) } : { code, state: kind, effectiveAt: startOfDayIso(date) });
            setDateAction(null);
          }}
        />
      ) : null}
    </div>
  );
}

const DATE_COPY: Record<DateActionKind, { title: string; label: string; hint: string }> = {
  trial: { title: "Liberar teste", label: "Teste até", hint: "Fica ligado até o fim do dia escolhido; depois o ERP desliga sozinho (rotina diária, até 24 h depois)." },
  activation_scheduled: { title: "Agendar ativação", label: "Ativar em", hint: "Continua desligado até a data; o ERP liga na rotina diária." },
  suspension_scheduled: { title: "Agendar desligamento", label: "Desligar em", hint: "Continua ligado até a data. Pendências em andamento seguem a regra do ERP (mostrada na revisão)." },
};

function DateActionDialog({ code, name, kind, onClose, onConfirm }: { code: string; name: string; kind: DateActionKind; onClose: () => void; onConfirm: (date: string) => void }) {
  const [date, setDate] = React.useState("");
  // Amanhã (data local do navegador): datas precisam ser futuras.
  const [min] = React.useState(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const copy = DATE_COPY[kind];
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{code}</span> {name} → {ERP_ITEM_STATE_LABELS[kind].toLowerCase()}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label={copy.label} htmlFor="erp-date" hint={copy.hint} required>
            <DateInput id="erp-date" value={date} min={min} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(date)} disabled={!date || date < min}>
            Preparar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
