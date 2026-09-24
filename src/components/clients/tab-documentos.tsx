import { ExternalLink, FileText } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserCell } from "./client-badges";
import { DocumentForm } from "./document-form";

/** Aba Documentos: registro por link e lista versionada. */
export function TabDocumentos({ data }: { data: Client360 }) {
  const { client, documents, users } = data;
  return (
    <div className="flex flex-col gap-5">
      <DocumentForm clientId={client.id} />
      <section>
        <SectionTitle title="Documentos" count={documents.length} />
        <Card className="overflow-hidden">
          {documents.length === 0 ? (
            <EmptyState size="sm" icon={<FileText />} title="Nenhum documento" description="Contratos, propostas, comprovantes e evidências ficam aqui, versionados." />
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Versão</TableHead>
                  <TableHead>Enviado por</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-24">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate font-medium">{d.name}</p>
                      {d.entityType && d.entityType !== "client" ? <p className="text-xs text-muted">Vinculado a {d.entityType}</p> : null}
                    </TableCell>
                    <TableCell>{d.category ? <Badge variant="muted" size="sm">{d.category}</Badge> : <span className="text-muted-light">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">v{d.version}</TableCell>
                    <TableCell>
                      <UserCell users={users} id={d.uploadedBy} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDate(d.createdAt, "dd/MM/yyyy HH:mm")}</TableCell>
                    <TableCell>
                      <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center gap-1 text-sm text-secondary hover:underline">
                        Abrir <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
