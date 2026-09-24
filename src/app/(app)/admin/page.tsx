import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Network, Package, Settings, Users, Workflow } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getAdminOverview } from "@/server/admin/queries";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Administração" };

interface AreaCard {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  stats: { label: string; value: string }[];
  warning?: string;
}

/** Índice da administração: um card por área com contagens reais do banco. */
export default async function AdminPage() {
  await requireRole("admin");
  const o = await getAdminOverview();

  const areas: AreaCard[] = [
    {
      href: "/admin/usuarios",
      title: "Usuários",
      description: "Contas, papéis, departamentos, gestores e metas mensais.",
      icon: <Users />,
      stats: [
        { label: "ativos", value: formatNumber(o.users.active) },
        { label: "inativos", value: formatNumber(o.users.inactive) },
        { label: "administradores", value: formatNumber(o.users.admins) },
      ],
      warning: o.users.admins === 0 ? "Nenhum administrador ativo" : undefined,
    },
    {
      href: "/admin/departamentos",
      title: "Departamentos",
      description: "Gestor, cor e ordem de cada área. O conjunto de chaves é fixo.",
      icon: <Network />,
      stats: [
        { label: "departamentos", value: formatNumber(o.departments.total) },
        { label: "com gestor", value: formatNumber(o.departments.withManager) },
      ],
      warning: o.departments.withManager < o.departments.total ? `${o.departments.total - o.departments.withManager} sem gestor` : undefined,
    },
    {
      href: "/admin/produtos",
      title: "Produtos",
      description: "Catálogo com preços, comissão padrão e template de implantação.",
      icon: <Package />,
      stats: [
        { label: "ativos", value: formatNumber(o.products.active) },
        { label: "no catálogo", value: formatNumber(o.products.total) },
      ],
    },
    {
      href: "/admin/configuracoes",
      title: "Configurações",
      description: "Horário comercial, feriados, metas, lead scoring, health score e regras de SLA.",
      icon: <Settings />,
      stats: [
        { label: "configurações gravadas", value: `${formatNumber(o.settings.stored)}/${formatNumber(o.settings.expected)}` },
        { label: "regras de SLA ativas", value: `${formatNumber(o.slaRules.active)}/${formatNumber(o.slaRules.total)}` },
      ],
      warning: o.settings.stored < o.settings.expected ? `${o.settings.expected - o.settings.stored} usando valores padrão` : undefined,
    },
    {
      href: "/admin/workflows",
      title: "Workflows",
      description: "Templates de jornada com etapas, gates e SLA por etapa.",
      icon: <Workflow />,
      stats: [
        { label: "templates", value: formatNumber(o.workflows.templates) },
        { label: "publicados", value: formatNumber(o.workflows.published) },
      ],
    },
  ];

  return (
    <PageContainer>
      <PageHeader title="Administração" description="Cadastros e parâmetros que sustentam a operação do INTEROS. Só administradores alteram estes dados." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((area) => (
          <li key={area.href}>
            <Link href={area.href} className="block h-full">
              <Card className="flex h-full flex-col transition-colors hover:border-border-strong hover:bg-surface-muted">
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-fg [&_svg]:size-5">{area.icon}</span>
                    <div className="min-w-0 flex-1">
                      <h2 className="flex items-center gap-1 text-base font-semibold leading-tight">
                        {area.title}
                        <ChevronRight className="size-4 text-muted-light" aria-hidden />
                      </h2>
                      <p className="mt-1 text-sm text-muted">{area.description}</p>
                    </div>
                  </div>
                  <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {area.stats.map((s) => (
                      <div key={s.label} className="flex items-baseline gap-1">
                        <dd className="font-semibold tabular-nums text-foreground">{s.value}</dd>
                        <dt className="text-muted">{s.label}</dt>
                      </div>
                    ))}
                  </dl>
                  {area.warning ? (
                    <Badge variant="warning" size="sm" className="self-start">
                      {area.warning}
                    </Badge>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
