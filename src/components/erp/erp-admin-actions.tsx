"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCw } from "lucide-react";
import { importErpCatalogAction, reprocessErpChangesAction } from "@/server/erp/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function ErpAdminActions({ canImport, canReprocess, pending }: { canImport: boolean; canReprocess: boolean; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"import" | "reprocess" | null>(null);
  if (!canImport && !canReprocess) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canImport ? (
        <Button
          variant="outline"
          size="sm"
          loading={busy === "import"}
          disabled={Boolean(busy)}
          onClick={async () => {
            setBusy("import");
            const res = await importErpCatalogAction().catch(() => ({ ok: false as const, error: "A conexão caiu." }));
            setBusy(null);
            if (res.ok) toast.success(res.data.status === "nova_versao" ? `Catálogo ${res.data.version} importado: ${res.data.added} novo(s), ${res.data.changed} alterado(s), ${res.data.removed} removido(s).` : `Catálogo ${res.data.version} conferido: sem mudança.`);
            else toast.error(res.error);
            router.refresh();
          }}
        >
          <RefreshCw aria-hidden /> Conferir catálogo agora
        </Button>
      ) : null}
      {canReprocess ? (
        <Button
          variant="outline"
          size="sm"
          loading={busy === "reprocess"}
          disabled={Boolean(busy) || pending === 0}
          onClick={async () => {
            setBusy("reprocess");
            const res = await reprocessErpChangesAction().catch(() => ({ ok: false as const, error: "A conexão caiu." }));
            setBusy(null);
            if (res.ok) toast.success(`${res.data.attempted} reenviada(s): ${res.data.applied} aplicada(s), ${res.data.failed} ainda pendente(s).`);
            else toast.error(res.error);
            router.refresh();
          }}
        >
          <RotateCw aria-hidden /> Reenviar pendentes agora
        </Button>
      ) : null}
    </div>
  );
}
