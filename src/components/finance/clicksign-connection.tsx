import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLine } from "@/components/conversations/channel-connect";

export interface ClicksignConnectionInfo {
  /** Token da API configurado. */
  connected: boolean;
  env: "sandbox" | "producao";
  /** Segredo dos avisos configurado. */
  webhookReady: boolean;
  webhookUrl: string;
}

const EVENTS: { key: string; label: string }[] = [
  { key: "upload", label: "Upload (documento criado)" },
  { key: "sign", label: "Assinatura" },
  { key: "refusal", label: "Recusa" },
  { key: "auto_close", label: "Finalização automática" },
  { key: "close", label: "Finalização" },
  { key: "document_closed", label: "Documento finalizado (PDF pronto)" },
  { key: "cancel", label: "Cancelamento" },
  { key: "deadline", label: "Prazo vencido" },
];

/** Situação da integração com a Clicksign e o que configurar do lado dela (aba Configuração das Assinaturas). */
export function ClicksignConnection({ info }: { info: ClicksignConnectionInfo }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Conexão com a Clicksign
          {info.connected ? <Badge variant="success">Conectada</Badge> : <Badge variant="muted">Não conectada</Badge>}
          {info.connected ? <Badge variant={info.env === "sandbox" ? "warning" : "info"}>{info.env === "sandbox" ? "Ambiente de testes" : "Produção"}</Badge> : null}
          {info.connected ? info.webhookReady ? <Badge variant="success">Avisos ligados</Badge> : <Badge variant="warning">Avisos sem segredo</Badge> : null}
        </CardTitle>
        <CardDescription>
          {info.connected
            ? "«Enviar para assinatura» cria o envelope na Clicksign, com o código de verificação escolhido. Assinaturas, recusas e o PDF assinado voltam sozinhos pelos avisos."
            : "Sem o token da API, o documento é gerado no INTEROS e a assinatura é registrada manualmente com evidência."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {info.connected && info.env === "sandbox" ? (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-warning-fg">
            Ambiente de testes da Clicksign: os documentos assinados aqui não têm validade jurídica. Para valer, troque para o token de produção e CLICKSIGN_ENV=producao.
          </p>
        ) : null}
        {!info.connected ? (
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Na Clicksign, em Configurações › API, crie um token só para o INTEROS (comece pelo ambiente de testes).</li>
            <li>Na Vercel, cadastre CLICKSIGN_API_TOKEN e CLICKSIGN_ENV (sandbox ou producao) e publique de novo.</li>
            <li>Cadastre o webhook abaixo na Clicksign e guarde o segredo em CLICKSIGN_WEBHOOK_SECRET.</li>
          </ol>
        ) : null}
        <CopyLine label="Endereço do webhook (Configurações › API › Webhooks, na Clicksign)" value={info.webhookUrl} />
        <div className="flex flex-col gap-1.5">
          <span className="text-muted">Eventos para marcar no webhook</span>
          <div className="flex flex-wrap gap-1.5">
            {EVENTS.map((e) => (
              <Badge key={e.key} variant="outline" title={e.key}>
                {e.label}
              </Badge>
            ))}
          </div>
        </div>
        {!info.webhookReady ? (
          <p className="text-muted">Sem o segredo do webhook (CLICKSIGN_WEBHOOK_SECRET) o INTEROS recusa os avisos: as assinaturas não voltam sozinhas.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
