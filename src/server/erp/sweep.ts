import "server-only";
/**
 * Rotina do ERP Intercert no agendador de 5 minutos (/api/cron/central): reenvia as alterações que aguardam
 * sincronização (mesma chave, o ERP não duplica), conclui as que o ERP já aplicou e confere o catálogo de módulos a
 * cada 6 horas. Catálogo com itens novos (ex.: módulo 51) avisa quem administra a integração.
 */
import { COLLECTIONS, type User } from "@/domain/types";
import { list } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { resolvePermissionsForUser } from "@/server/auth/permission-store";
import { getErpConfig } from "./config";
import { ErpError, erpErrorSummary } from "./errors";
import { catalogNeedsRefresh, getCurrentCatalog, importErpCatalog } from "./catalog-store";
import { processPendingErpChanges } from "./changes";

const SYSTEM = { id: "system", name: "INTEROS (rotina do ERP)" };
const CATALOG_KEY = "admin.integracoes.erp-catalogo";

async function catalogAdmins(): Promise<string[]> {
  const users = await list<User>(COLLECTIONS.users);
  const out: string[] = [];
  for (const u of users) {
    if (u.active === false) continue;
    const perms = await resolvePermissionsForUser(u);
    if (perms?.has(CATALOG_KEY)) out.push(u.id);
  }
  return out;
}

export async function runErpSweep(now = new Date()): Promise<string> {
  const config = getErpConfig();
  if (!config?.licenseToken) return "integração desligada";
  const parts: string[] = [];

  const loaded = await getCurrentCatalog(config.environment).catch(() => null);
  if (!loaded || catalogNeedsRefresh(loaded.pointer, now.getTime())) {
    try {
      const res = await importErpCatalog(null);
      const diff = res.record.diff;
      parts.push(res.status === "nova_versao" ? `catálogo ${res.record.catalogVersion} importado` : "catálogo sem mudança");
      if (res.status === "nova_versao" && loaded && (diff.added.length || diff.removed.length || diff.changed.length)) {
        const summary = `${diff.added.length} novo(s), ${diff.changed.length} alterado(s), ${diff.removed.length} removido(s)`;
        await emitEvent({
          type: "erp.catalog_imported",
          actor: SYSTEM,
          entity: { type: "erp_catalog", id: res.record.id },
          title: `Catálogo do ERP mudou: versão ${res.record.catalogVersion}`,
          description: summary,
          payload: { catalogId: res.record.id, version: res.record.catalogVersion, added: diff.added.slice(0, 50), removed: diff.removed.slice(0, 50), changed: diff.changed.slice(0, 50) },
          timeline: false,
        });
        const ids = await catalogAdmins();
        if (ids.length) {
          await notify({
            userIds: ids,
            kind: "informativa",
            title: `Catálogo de módulos do ERP mudou (${res.record.catalogVersion})`,
            body: `${summary}. Itens novos já aparecem na aba Módulos ERP; confira preço e pacotes.`,
            href: "/admin/integracoes",
            entity: { type: "erp_catalog", id: res.record.id },
            key: `erp_catalogo_${res.record.id}`,
          });
        }
      }
    } catch (error) {
      parts.push(`catálogo não conferido: ${error instanceof ErpError ? erpErrorSummary(error) : error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sent = await processPendingErpChanges(now);
  parts.push(`${sent.attempted} reenvio(s), ${sent.applied} aplicado(s), ${sent.failed} ainda pendente(s)`);
  return parts.join("; ");
}
