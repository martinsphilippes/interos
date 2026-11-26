import Link from "next/link";
import type { CurrentUser } from "@/domain/types";
import { ERP_CHANGE_STATUS_LABELS } from "@/domain/erp/types";
import { can } from "@/server/auth/session";
import { getErpAdminSummary } from "@/server/erp/admin-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CHANGE_STATUS_BADGE, fmtDateTime } from "./erp-format";
import { ErpAdminActions } from "./erp-admin-actions";

const API_LABELS = { licencas: "Licenças e módulos", provisionamento: "Criação e vínculo de empresas", torre: "Torre de Controle" } as const;

/** Administração › Integrações: detalhe operacional do ERP Intercert (catálogo e fila de alterações). */
export async function ErpAdminPanel({ user }: { user: CurrentUser }) {
  const s = await getErpAdminSummary();
  const { integration } = s;
  return (
    <Card className="mt-5">
      <CardContent className="flex flex-col gap-4 p-5 text-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="label-caps">ERP Intercert · módulos por empresa</p>
            <h2 className="text-base font-semibold">
              {integration.configured ? `Ligado ao ${s.environmentLabel?.toLowerCase() ?? "ERP"}` : "Integração não configurada"}
              {integration.host ? <span className="ml-2 font-mono text-xs font-normal text-muted">{integration.host}</span> : null}
            </h2>
            {!integration.configured && integration.missing.length ? <p className="mt-1 text-xs text-muted">Faltam: {integration.missing.join(", ")}.</p> : null}
          </div>
          <ErpAdminActions canImport={integration.configured && can(user, "admin.integracoes.erp-catalogo")} canReprocess={integration.configured && can(user, "admin.integracoes.erp-reprocessar")} pending={s.pending.filter((p) => p.status !== "aguardando_aprovacao").length} />
        </div>

        <ul className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(API_LABELS) as (keyof typeof API_LABELS)[]).map((api) => (
            <li key={api} className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-muted">{API_LABELS[api]}</p>
              <p className="font-medium">{integration.apis[api].write ? "Leitura e envio" : integration.apis[api].read ? "Só leitura" : "Não configurada"}</p>
            </li>
          ))}
        </ul>

        {s.catalog ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Catálogo de módulos</h3>
            <p>
              Versão <strong>{s.catalog.version}</strong>
              {s.catalog.status ? ` (${s.catalog.status})` : ""} · {s.catalog.counts.modules} módulos, {s.catalog.counts.submodules} submódulos, {s.catalog.counts.sellableUnits}/{s.catalog.counts.units} unidades vendáveis · importado{" "}
              {fmtDateTime(s.catalog.importedAt)} · conferido {fmtDateTime(s.catalog.checkedAt)}
            </p>
            {s.catalog.lastError ? <p className="mt-1 text-xs text-warning-fg">Última conferência falhou: {s.catalog.lastError}</p> : null}
            {s.catalog.diff.first ? (
              <p className="mt-1 text-xs text-muted">Primeira importação deste ambiente.</p>
            ) : s.catalog.diff.addedTotal || s.catalog.diff.changed || s.catalog.diff.removed ? (
              <p className="mt-1 text-xs text-muted">
                Em relação à versão anterior: {s.catalog.diff.addedTotal} novo(s){s.catalog.diff.added.length ? ` (${s.catalog.diff.added.map((a) => `${a.code} ${a.name}`).join(", ")}${s.catalog.diff.addedTotal > s.catalog.diff.added.length ? "…" : ""})` : ""}, {s.catalog.diff.changed} alterado(s), {s.catalog.diff.removed} removido(s).
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-light">Conferido a cada 6 horas pela rotina de 5 minutos; módulos novos do ERP entram sozinhos e avisam quem administra a integração.</p>
          </section>
        ) : integration.configured ? (
          <p className="text-muted">Catálogo ainda não importado neste ambiente.</p>
        ) : null}

        {integration.configured ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Empresas vinculadas: {s.linked} · alterações em andamento: {s.pending.length}
            </h3>
            {s.pending.length ? (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {s.pending.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Link href={`/clientes/${p.clientId}?aba=erp`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {p.clientName}
                    </Link>
                    <Badge variant={CHANGE_STATUS_BADGE[p.status]} size="sm">
                      {p.kind === "provisionamento" ? "Criação · " : ""}
                      {ERP_CHANGE_STATUS_LABELS[p.status]}
                    </Badge>
                    <span className="w-full text-xs text-muted sm:w-auto">
                      desde {fmtDateTime(p.requestedAt)} · {p.attempts} tentativa(s){p.nextAttemptAt ? ` · próxima ${fmtDateTime(p.nextAttemptAt)}` : ""}
                      {p.lastError ? ` · ${p.lastError}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Nenhuma alteração pendente.</p>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
