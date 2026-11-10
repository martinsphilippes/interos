import type { ClientDocumentRow } from "@/server/clients/documents";
import { ClientDocumentsPanel } from "./client-documents-panel";

/**
 * Aba Documentos: enviar arquivos (vários de uma vez) ou registrar link, conferir os documentos de cadastro, abrir,
 * baixar e remover com motivo. `rows` e `canAttach` são calculados no servidor (quem vê pode remover o quê); sem a ação
 * de anexar, só a lista aparece.
 */
export function TabDocumentos({
  clientId,
  clientName,
  rows,
  users,
  canAttach = true,
  checkCompanyDocuments = true,
}: {
  clientId: string;
  clientName: string;
  rows: ClientDocumentRow[];
  users: Record<string, { name: string }>;
  canAttach?: boolean;
  /** Pessoa jurídica (ou sem documento informado): a aba confere contrato social e cartão CNPJ. */
  checkCompanyDocuments?: boolean;
}) {
  return <ClientDocumentsPanel clientId={clientId} clientName={clientName} rows={rows} users={users} canAttach={canAttach} checkCompanyDocuments={checkCompanyDocuments} />;
}
