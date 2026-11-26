import "server-only";
/**
 * Vínculo cliente do INTEROS ↔ empresa no ERP (`erp_links`, id `<ambiente>__<clientId>`): a tabela segura de
 * correspondência entre os identificadores dos dois sistemas. Nunca se vincula pelo nome: o vínculo nasce do
 * provisionamento (o ERP devolve o id), do código de consentimento do administrador da empresa ou da identificação
 * conferida (id ERP + CNPJ iguais no ERP).
 *
 * Unicidade (em transação, com trava no cliente e na empresa do ERP): um vínculo ativo por cliente e uma empresa do ERP
 * em no máximo um cliente, por ambiente. Desvincular é procedimento assistido (o ERP também não troca a conta na v1).
 */
import { docdb, type Transaction } from "@/server/docdb";
import { COLLECTIONS, type UserRef } from "@/domain/types";
import type { ErpEnvironment, ErpLink, ErpLinkMethod } from "@/domain/erp/types";
import { getById, nowIso, txGetOwn, txList, update, ORG_ID } from "@/server/db";
import { emitEvent } from "@/server/events/emit";

export const linkId = (environment: ErpEnvironment, clientId: string) => `${environment}__${clientId}`;
const companyLockRef = (environment: ErpEnvironment, erpCompanyId: string) => docdb.collection(COLLECTIONS.erpLinks).doc(`__empresa__${environment}__${erpCompanyId}`);

export class ErpLinkError extends Error {
  constructor(
    message: string,
    readonly code: "cliente_ja_vinculado" | "empresa_em_outro_cliente" | "dados_invalidos",
  ) {
    super(message);
    this.name = "ErpLinkError";
  }
}

export async function getErpLink(clientId: string, environment: ErpEnvironment): Promise<ErpLink | null> {
  const link = await getById<ErpLink>(COLLECTIONS.erpLinks, linkId(environment, clientId));
  return link && link.status === "ativo" ? link : null;
}

export interface LinkInput {
  clientId: string;
  environment: ErpEnvironment;
  erpCompanyId: string;
  erpCompanyName: string | null;
  cnpj: string | null;
  erpKind: string | null;
  method: ErpLinkMethod;
  actor: UserRef;
  provisioningChangeId?: string | null;
}

const ERP_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Grava o vínculo. Repetir com a mesma empresa é idempotente (devolve o vínculo existente, sem novo evento). Outro
 * vínculo ativo do cliente, ou a empresa já em outro cliente, é recusado.
 */
export async function linkClientToErp(input: LinkInput): Promise<{ link: ErpLink; created: boolean }> {
  if (!ERP_ID.test(input.erpCompanyId)) throw new ErpLinkError("Identificador da empresa no ERP inválido.", "dados_invalidos");
  const id = linkId(input.environment, input.clientId);
  const ref = docdb.collection(COLLECTIONS.erpLinks).doc(id);
  const result = await docdb.runTransaction(async (tx: Transaction) => {
    const snap = await txGetOwn(tx, ref);
    await tx.get(companyLockRef(input.environment, input.erpCompanyId));
    const current = snap ? ({ ...(snap.data() as unknown as ErpLink), id } as ErpLink) : null;
    if (current?.status === "ativo") {
      if (current.erpCompanyId === input.erpCompanyId) return { link: current, created: false };
      throw new ErpLinkError(`Este cliente já está vinculado à empresa ${current.erpCompanyName ?? current.erpCompanyId} no ERP.`, "cliente_ja_vinculado");
    }
    const others = await txList<ErpLink>(tx, COLLECTIONS.erpLinks, [
      ["erpCompanyId", "==", input.erpCompanyId],
      ["environment", "==", input.environment],
      ["status", "==", "ativo"],
    ]);
    const other = others.find((l) => l.clientId !== input.clientId);
    if (other) throw new ErpLinkError("Esta empresa do ERP já está vinculada a outro cliente do INTEROS.", "empresa_em_outro_cliente");
    const now = nowIso();
    const link: Omit<ErpLink, "id"> = {
      organizationId: ORG_ID,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      clientId: input.clientId,
      environment: input.environment,
      erpCompanyId: input.erpCompanyId,
      erpCompanyName: input.erpCompanyName,
      cnpj: input.cnpj,
      erpKind: input.erpKind,
      status: "ativo",
      method: input.method,
      linkedAt: now,
      linkedBy: input.actor,
      provisioningChangeId: input.provisioningChangeId ?? null,
      lastSyncAt: now,
      lastSyncError: null,
    };
    tx.set(ref, link);
    return { link: { ...link, id } as ErpLink, created: true };
  });
  if (result.created) {
    try {
      await emitEvent({
        type: input.method === "provisionamento" ? "erp.provisioned" : "erp.linked",
        actor: input.actor,
        clientId: input.clientId,
        entity: { type: "erp_link", id },
        title: input.method === "provisionamento" ? "Empresa criada no ERP Intercert" : "Empresa vinculada ao ERP Intercert",
        description: `${result.link.erpCompanyName ?? "Empresa"} · id ERP ${input.erpCompanyId}${input.cnpj ? ` · CNPJ ${input.cnpj}` : ""}`,
        payload: { environment: input.environment, erpCompanyId: input.erpCompanyId, method: input.method, provisioningChangeId: input.provisioningChangeId ?? null },
      });
    } catch (error) {
      console.error("[erp] vínculo gravado, mas o registro no histórico falhou", error);
    }
  }
  return result;
}

/** Registra a última leitura do ERP (sucesso limpa o erro). */
export async function markLinkSync(link: ErpLink, outcome: { ok: true } | { ok: false; code: string; message: string; requestId: string | null }): Promise<void> {
  const at = nowIso();
  await update<ErpLink>(COLLECTIONS.erpLinks, link.id, outcome.ok ? { lastSyncAt: at, lastSyncError: null } : { lastSyncError: { code: outcome.code, message: outcome.message, at, requestId: outcome.requestId } });
}
