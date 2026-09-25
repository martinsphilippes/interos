import Link from "next/link";
import { ChevronRight, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TemplateListItem } from "./workflow-model";

/** Lista de templates de workflow (todas as versões), com a publicada destacada. */
export function TemplatesTable({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) return <EmptyState icon={<Workflow />} title="Nenhum template de workflow" description="O seed cria o template “Jornada do cliente”. Rode npm run seed para restaurá-lo." />;
  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden">
        {templates.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/workflows/${t.id}`} className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 shadow-card hover:border-border-strong">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted">
                  {t.key} · v{t.version} · {t.stagesCount} etapas · {t.instances} jornada(s)
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={t.published ? "success" : "muted"} size="sm">
                  {t.published ? "Publicado" : "Rascunho"}
                </Badge>
                <ChevronRight className="size-4 text-muted-light" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden rounded-lg border border-border bg-surface shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Publicado</TableHead>
              <TableHead>Etapas</TableHead>
              <TableHead>Jornadas nesta versão</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  <Link href={`/admin/workflows/${t.id}`} className="hover:underline">
                    {t.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{t.key}</code>
                </TableCell>
                <TableCell className="tabular-nums">v{t.version}</TableCell>
                <TableCell>
                  <Badge variant={t.published ? "success" : "muted"} size="sm">
                    {t.published ? "Publicado" : "Rascunho"}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{t.stagesCount}</TableCell>
                <TableCell className="tabular-nums">{t.instances}</TableCell>
                <TableCell className="text-xs text-muted">{t.updatedAtLabel}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/admin/workflows/${t.id}`} className="inline-flex min-h-[36px] items-center gap-1 text-sm text-secondary hover:underline">
                    Editar <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
