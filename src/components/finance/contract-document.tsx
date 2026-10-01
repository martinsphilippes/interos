/**
 * Documento do contrato (versão imprimível) e termo aditivo — Server Components extraídos de
 * `/financeiro/contratos/[id]/documento` para serem reutilizados, somente leitura, no Portal do Cliente (D31).
 *
 * `audience="interno"` (padrão) reproduz a página interna. `audience="cliente"` (portal): sem os avisos internos de
 * prévia/divergência, sem e-mails dos signatários, sem o id do documento de assinatura e sem o motivo interno dos
 * aditivos; o Resumo do contratado usa as linhas do cliente (sem venda, vendedor, observações internas).
 */
import Link from "next/link";
import type { Address, Client, Contract, ContractAmendment } from "@/domain/types";
import { maskMoneyText } from "@/server/finance/redact";
import { RECURRENCE_LABELS } from "@/server/finance/schemas";
import { contractDocumentHash } from "@/server/finance/signature";
import { HEADQUARTERS, formatAddressLine } from "@/server/sales/maps";
import { AMENDMENT_FIELD_LABELS, AMENDMENT_KIND_LABELS, AMENDMENT_STATUS_LABELS, describeReadjustment, describeSnapshotValue } from "@/domain/contract-snapshot";
import { formatDate, formatDateTime, formatDocument } from "@/lib/format";
import { CONTRACT_STATUS_LABELS } from "@/components/clients/labels";
import { netItem } from "@/components/sales/model";
import { ContractSummaryCard } from "@/components/finance/contract-summary-card";
import { redactContractSummary, type ContractSummaryData } from "@/components/finance/contract-summary";
import { money } from "@/components/finance/values";

export type DocumentAudience = "interno" | "cliente";

export interface ContractDocumentBillingData {
  legalName?: string;
  document?: string;
  email?: string;
  address: Address;
}

export interface ContractDocumentProps {
  contract: Contract;
  historical: boolean;
  client: Pick<Client, "legalName" | "tradeName">;
  billingData: ContractDocumentBillingData;
  /** Data da geração do documento para assinatura ("Emitido em"). */
  sentAt?: string;
  /** Aditivos do contrato (só os aplicados até a versão exibida entram na lista). */
  amendments: ContractAmendment[];
  /** Resumo do contratado (versão atual). */
  summary: ContractSummaryData;
  companyName: string;
  /** Sem os valores do contrato (A13): "Restrito"; o hash é calculado com os dados reais. */
  hidden: boolean;
  /** Números dos aditivos levam ao termo (`?aditivo=`). */
  amendmentLinks: boolean;
  audience?: DocumentAudience;
  /** id do <article> (a impressão da página interna usa "contrato-impressao"; o portal lista vários contratos). */
  articleId?: string;
}

/** `hidden`: sem os valores do contrato (A13) — o documento mostra "Restrito"; o hash é calculado com os dados reais. */
export function ContractDocument({ contract, historical, client, billingData, sentAt, amendments, summary, companyName, hidden, amendmentLinks, audience = "interno", articleId = "contrato-impressao" }: ContractDocumentProps) {
  const forClient = audience === "cliente";
  const currentHash = forClient ? (contract.documentHash ?? "") : contractDocumentHash(contract);
  const generated = Boolean(contract.signatureEnvelopeId);
  const hashMatches = historical ? true : contract.documentHash === currentHash;
  const signers = contract.signers;
  const firstYear = contract.setupTotal + contract.hardwareTotal + (contract.recurrence === "unico" ? 0 : contract.monthlyTotal * Math.min(12, contract.termMonths));
  const address = formatAddressLine(billingData.address);
  const appliedAmendments = amendments.filter((a) => a.status === "aplicado" && (a.appliedVersion ?? Infinity) <= contract.version);

  return (
    <>
      {forClient ? null : !historical && !generated ? (
        <p className="no-print mb-4 rounded-lg border border-warning/35 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          Prévia: o documento ainda não foi gerado para assinatura. Gere-o no contrato para fixar o código de integridade.
        </p>
      ) : !historical && !hashMatches && appliedAmendments.length === 0 ? (
        <p className="no-print mb-4 rounded-lg border border-danger/35 bg-danger-soft px-4 py-3 text-sm text-danger-fg">
          O conteúdo atual difere do documento gerado para assinatura. Gere uma nova versão antes de colher assinaturas.
        </p>
      ) : !historical && appliedAmendments.length > 0 ? (
        <p className="no-print mb-4 rounded-lg border border-info/35 bg-info-soft px-4 py-3 text-sm text-info-fg">
          Contrato consolidado com {appliedAmendments.length} aditivo(s) aplicado(s): {appliedAmendments.map((a) => a.number).join(", ")}. O documento assinado original é a versão {contract.previousVersions?.find((v) => v.kind === "aditivo")?.version ?? 1}; cada aditivo tem o próprio termo assinado.
        </p>
      ) : null}

      <article id={articleId} className="rounded-xl border border-border bg-surface p-6 text-[13px] leading-relaxed text-foreground shadow-card md:p-10">
        <header className="flex flex-col gap-4 border-b-2 border-brand pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-2xl font-bold tracking-tight">{companyName}</p>
            <p className="text-muted">{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-lg font-semibold">Contrato de licenciamento e serviços</p>
            <p className="tabular-nums">
              {contract.number} · versão {contract.version}
              {historical ? " (histórico)" : ""}
            </p>
            <p className="text-muted">Emitido em {formatDate(sentAt ?? contract.createdAt)}</p>
            <p className="text-muted">Situação: {CONTRACT_STATUS_LABELS[contract.status]}</p>
          </div>
        </header>

        <section className="grid gap-4 border-b border-border py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contratante</h2>
            <p className="font-semibold">{billingData.legalName ?? client.legalName}</p>
            {client.tradeName !== (billingData.legalName ?? client.legalName) ? <p>{client.tradeName}</p> : null}
            <p>CNPJ/CPF: {formatDocument(billingData.document)}</p>
            <p>{address || "Endereço não informado"}</p>
            {billingData.email ? <p>{billingData.email}</p> : null}
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contratada</h2>
            <p className="font-semibold">{companyName}</p>
            <p>{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
          </div>
        </section>

        <section className="py-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Objeto: produtos e serviços contratados</h2>
          <ContractItemsTable contract={contract} hidden={hidden} />
          <dl className="ml-auto mt-4 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
            <dt className="text-muted">Adesão / setup</dt>
            <dd className="text-right font-semibold">{money(contract.setupTotal, hidden)}</dd>
            <dt className="text-muted">Mensalidade</dt>
            <dd className="text-right font-semibold">{money(contract.monthlyTotal, hidden)}</dd>
            <dt className="text-muted">Hardware</dt>
            <dd className="text-right font-semibold">{money(contract.hardwareTotal, hidden)}</dd>
            <dt className="border-t border-border-strong pt-1 font-semibold">Valor no 1º ano</dt>
            <dd className="border-t border-border-strong pt-1 text-right font-bold">{money(firstYear, hidden)}</dd>
          </dl>
        </section>

        <section className="grid gap-4 border-t border-border py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Condições</h2>
            <p>Recorrência: {RECURRENCE_LABELS[contract.recurrence]}</p>
            <p>Prazo: {contract.termMonths} meses</p>
            <p>Vencimento: todo dia {contract.billingDay}</p>
            {contract.firstDueDate ? <p>Primeiro vencimento: {formatDate(contract.firstDueDate)}</p> : null}
            {contract.startDate ? (
              <p>
                Vigência: {formatDate(contract.startDate)} a {formatDate(contract.endDate)}
              </p>
            ) : null}
            {contract.autoRenew !== undefined || contract.readjustment ? (
              <p>
                Renovação: {contract.autoRenew ? `automática por ${contract.renewalTermMonths ?? contract.termMonths} meses, ${contract.noticeDays ?? 30} dias antes do fim` : "mediante negociação"} · reajuste: {describeReadjustment(contract.readjustment)}
              </p>
            ) : null}
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Condição de pagamento</h2>
            <p className="whitespace-pre-line">{(hidden ? maskMoneyText(contract.paymentCondition) : contract.paymentCondition) || "—"}</p>
          </div>
        </section>

        {!historical ? <ContractSummaryCard summary={hidden ? redactContractSummary(summary) : summary} variant="print" rows={forClient ? "client" : "all"} showDocumentLink={false} /> : null}

        {appliedAmendments.length > 0 ? (
          <section className="border-t border-border py-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Aditivos aplicados</h2>
            <ul className="flex flex-col gap-1">
              {appliedAmendments.map((a) => (
                <li key={a.number}>
                  {amendmentLinks && !forClient ? (
                    <Link href={`/financeiro/contratos/${contract.id}/documento?aditivo=${a.id}`} className="font-medium hover:text-brand">
                      {a.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{a.number}</span>
                  )}{" "}
                  · {AMENDMENT_KIND_LABELS[a.kind]} · vigência {formatDate(`${a.effectiveFrom}T12:00:00.000Z`)} · aplicado em {formatDate(a.appliedAt)} (v{a.appliedVersion}){forClient ? null : <> · {hidden ? maskMoneyText(a.reason) : a.reason}</>}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-border pt-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Assinaturas</h2>
          <div className="grid gap-8 sm:grid-cols-2">
            {signers.map((s, i) => (
              <div key={`${s.email}-${i}`} className="pt-8">
                <div className="border-t border-border-strong pt-1 text-center">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-muted">{forClient ? s.role : `${s.role} · ${s.email}`}</p>
                  {!historical && s.signedAt ? (
                    <p className="text-muted">
                      Assinado em {formatDateTime(s.signedAt)}
                      {s.method === "manual" ? " · registro manual com evidência" : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <div className="pt-8">
              <div className="border-t border-border-strong pt-1 text-center">
                <p className="font-semibold">{companyName}</p>
                <p className="text-muted">Contratada</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-border pt-3 text-[11px] text-muted">
          <p>
            Código de integridade (SHA-256 do conteúdo): <span className="break-all font-mono">{historical ? (contract.documentHash ?? currentHash) : generated ? contract.documentHash : currentHash}</span>
            {forClient ? " · documento assinado" : historical ? ` · versão ${contract.version} (histórico)` : generated ? ` · documento ${contract.signatureEnvelopeId}` : " · prévia (documento ainda não gerado)"}
          </p>
        </footer>
      </article>
    </>
  );
}

export function ContractItemsTable({ contract, hidden }: { contract: Pick<Contract, "items">; hidden: boolean }) {
  if (contract.items.length === 0) return <p className="text-muted">Nenhum item cadastrado.</p>;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[520px] border-collapse tabular-nums">
        <thead>
          <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-2">Produto</th>
            <th className="py-2 pr-2 text-right">Qtd.</th>
            <th className="py-2 pr-2 text-right">Adesão</th>
            <th className="py-2 pr-2 text-right">Mensalidade</th>
            <th className="py-2 pr-2 text-right">Hardware</th>
            <th className="py-2 text-right">Desconto</th>
          </tr>
        </thead>
        <tbody>
          {contract.items.map((i, idx) => {
            const net = netItem(i);
            return (
              <tr key={`${i.productId}-${idx}`} className="border-b border-border">
                <td className="py-2 pr-2">{i.productName}</td>
                <td className="py-2 pr-2 text-right">{i.quantity}</td>
                <td className="py-2 pr-2 text-right">{money(net.setupTotal, hidden)}</td>
                <td className="py-2 pr-2 text-right">{money(net.monthlyTotal, hidden)}</td>
                <td className="py-2 pr-2 text-right">{money(net.hardwareTotal, hidden)}</td>
                <td className="py-2 text-right">{i.discountPct > 0 ? `${i.discountPct}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Termo aditivo (D25): contrato base, quadro "condições anteriores × novas", motivo, vigência, assinaturas e hash. */
export function AmendmentDocument({ amendment, contract, client, billingData, companyName, hidden }: { amendment: ContractAmendment; contract: Contract; client: Pick<Client, "legalName" | "tradeName">; billingData: ContractDocumentBillingData; companyName: string; hidden: boolean }) {
  const changes = Object.entries(amendment.changes ?? {}).filter(([f]) => !["version", "documentHash", "signers"].includes(f));
  const hash = amendment.documentHash;
  return (
    <>
      {amendment.status === "rascunho" ? <p className="no-print mb-4 rounded-lg border border-warning/35 bg-warning-soft px-4 py-3 text-sm text-warning-fg">Prévia do termo aditivo (rascunho): o código de integridade é fixado ao enviar para assinatura.</p> : null}
      <article id="contrato-impressao" className="rounded-xl border border-border bg-surface p-6 text-[13px] leading-relaxed text-foreground shadow-card md:p-10" data-testid="amendment-document">
        <header className="flex flex-col gap-4 border-b-2 border-brand pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-2xl font-bold tracking-tight">{companyName}</p>
            <p className="text-muted">{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-lg font-semibold">Termo aditivo ao contrato {contract.number}</p>
            <p className="tabular-nums">
              {amendment.number} · {AMENDMENT_KIND_LABELS[amendment.kind]}
            </p>
            <p className="text-muted">Contrato base: versão {amendment.before.version} · Situação: {AMENDMENT_STATUS_LABELS[amendment.status]}</p>
            <p className="text-muted">Vigência a partir de {formatDate(`${amendment.effectiveFrom}T12:00:00.000Z`)}</p>
          </div>
        </header>

        <section className="grid gap-4 border-b border-border py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contratante</h2>
            <p className="font-semibold">{billingData.legalName ?? client.legalName}</p>
            <p>CNPJ/CPF: {formatDocument(billingData.document)}</p>
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contratada</h2>
            <p className="font-semibold">{companyName}</p>
            <p>{HEADQUARTERS.label.replace("Sede Intercert — ", "")}</p>
          </div>
        </section>

        <section className="border-b border-border py-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Motivo</h2>
          <p>{amendment.reason}</p>
          {amendment.readjustment ? <p className="mt-1 text-muted">Reajuste: {describeReadjustment(amendment.readjustment)}</p> : null}
        </section>

        <section className="py-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Condições anteriores × novas</h2>
          {changes.length === 0 ? (
            <p className="text-muted">Sem alterações registradas.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-2">Cláusula</th>
                  <th className="py-2 pr-2">Antes</th>
                  <th className="py-2">Depois</th>
                </tr>
              </thead>
              <tbody>
                {changes.map(([field, c]) => (
                  <tr key={field} className="border-b border-border align-top">
                    <td className="py-2 pr-2 font-medium">{AMENDMENT_FIELD_LABELS[field] ?? field}</td>
                    <td className="py-2 pr-2 text-muted">{describeSnapshotValue(field, c.from)}</td>
                    <td className="py-2 font-medium">{describeSnapshotValue(field, c.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="border-t border-border py-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Itens depois do aditivo</h2>
          <ContractItemsTable contract={{ items: amendment.after.items }} hidden={hidden} />
          <p className="mt-2 text-muted">
            Mensalidade {money(amendment.after.monthlyTotal, hidden)} · adesão {money(amendment.after.setupTotal, hidden)} · hardware {money(amendment.after.hardwareTotal, hidden)}. As demais cláusulas do contrato {contract.number} permanecem inalteradas.
          </p>
        </section>

        <section className="border-t border-border pt-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Assinaturas</h2>
          {amendment.requiresSignature ? (
            <div className="grid gap-8 sm:grid-cols-2">
              {(amendment.signers ?? []).map((s) => (
                <div key={s.email} className="pt-8">
                  <div className="border-t border-border-strong pt-1 text-center">
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-muted">
                      {s.role} · {s.email}
                    </p>
                    {s.signedAt ? (
                      <p className="text-muted">
                        Assinado em {formatDateTime(s.signedAt)}
                        {s.method === "manual" ? " · registro manual com evidência" : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
              <div className="pt-8">
                <div className="border-t border-border-strong pt-1 text-center">
                  <p className="font-semibold">{companyName}</p>
                  <p className="text-muted">Contratada</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted">Aditivo interno, sem assinatura do cliente{amendment.appliedAt ? ` · aplicado em ${formatDateTime(amendment.appliedAt)}` : ""}.</p>
          )}
        </section>

        <footer className="mt-8 border-t border-border pt-3 text-[11px] text-muted">
          <p>
            Código de integridade (SHA-256 do termo): <span className="break-all font-mono">{hash ?? "— (fixado ao enviar para assinatura)"}</span>
            {amendment.appliedVersion ? ` · aplicado na versão ${amendment.appliedVersion} do contrato` : ""}
          </p>
        </footer>
      </article>
    </>
  );
}
