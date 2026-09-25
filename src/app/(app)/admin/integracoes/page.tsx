import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, PlugZap, TriangleAlert } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getIntegrationStatus } from "@/server/integrations/status";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { IntegrationCard } from "@/components/integrations/integration-card";

export const metadata: Metadata = { title: "Integrações" };

/**
 * Integrações externas: estado REAL de cada provedor (derivado das variáveis de ambiente do servidor e dos
 * adaptadores implementados), o que cada uma habilita, variáveis necessárias (só nomes), fallback em uso e
 * onde configurar. Nenhuma integração aparece como conectada sem credencial e adaptador.
 */
export default async function IntegrationsPage() {
  await requireRole("admin");
  const integrations = getIntegrationStatus();
  const count = (state: string) => integrations.filter((i) => i.state === state).length;

  return (
    <PageContainer>
      <PageHeader
        title="Integrações"
        description="Provedores externos do INTEROS e o que acontece quando cada um não está conectado."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Integrações" }]}
      />

      <KpiStrip columns={4} mobileColumns={2}>
        <StatCard label="Integrações" value={formatNumber(integrations.length)} icon={<PlugZap />} tone="info" compact />
        <StatCard label="Conectadas" value={formatNumber(count("conectado"))} icon={<CheckCircle2 />} tone="success" compact />
        <StatCard label="Verificar" value={formatNumber(count("verificar"))} icon={<TriangleAlert />} tone="warning" hint="Não detectável ou adaptador pendente" compact />
        <StatCard label="Não conectadas" value={formatNumber(count("nao_conectado"))} icon={<CircleDashed />} tone="neutral" hint="Operando com fallback manual" compact />
      </KpiStrip>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-1 p-4 text-sm text-muted">
          <p>
            <strong className="text-foreground">Como configurar:</strong> cadastre as variáveis na Vercel (projeto INTEROS → Settings → Environment Variables, para Production e Preview) e faça um novo deploy. Em
            desenvolvimento, use o arquivo <code className="font-mono text-foreground">.env.local</code> (modelo em <code className="font-mono text-foreground">.env.example</code>). Os valores nunca são exibidos aqui.
          </p>
          <p>
            <strong className="text-foreground">Conectado</strong> = credenciais presentes e adaptador implementado no INTEROS. Sem isso, as telas usam o fallback (wa.me, tel:, mailto:, mapa sem chave, assinatura e pagamentos
            registrados manualmente) e registram a interação como &quot;registro manual&quot;.
          </p>
        </CardContent>
      </Card>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((i) => (
          <li key={i.key}>
            <IntegrationCard integration={i} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
