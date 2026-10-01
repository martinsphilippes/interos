/**
 * Capacidades do módulo Financeiro (contratos e cobranças) calculadas no SERVIDOR
 * (src/server/finance/access.ts#financeCapabilities) e entregues aos Client Components pelo FinanceAccessProvider.
 * Servem só para esconder ou desabilitar controles: as Server Actions revalidam a permissão (requirePermission) e o
 * escopo do registro em toda chamada.
 */

export interface FinanceCapabilities {
  /** "Visualizar valores" (financeiro.valores.ver): sem ela os números chegam zerados e aparecem como "Restrito". */
  values: boolean;
  /** Valores do contrato: financeiro.valores.ver ∧ financeiro.contratos.valores.ver. */
  contractValues: boolean;
  contracts: {
    /** Abrir a tela Contratos (links para a página/painel do contrato). */
    view: boolean;
    create: boolean;
    /** Itens, condições e dados de faturamento. */
    edit: boolean;
    /** Seções da página do contrato. */
    signatureView: boolean;
    amendmentsView: boolean;
    pendenciesView: boolean;
    documentsView: boolean;
    historyView: boolean;
    /** Adicionar/remover signatários. */
    signersEdit: boolean;
    /** Gerar o documento para assinatura e enviar lembretes. */
    signatureSend: boolean;
    /** Registrar assinatura manual. */
    sign: boolean;
    amendmentCreate: boolean;
    amendmentSend: boolean;
    amendmentSign: boolean;
    amendmentApply: boolean;
    amendmentCancel: boolean;
    pendencyCreate: boolean;
    pendencyResolve: boolean;
    documentAttach: boolean;
    release: boolean;
    /** Liberar com pendência (exceção ao gate; o setting permiteExcecaoGestor continua valendo). */
    releaseWithPendency: boolean;
    cancel: boolean;
    /** Portal do cliente (D31): ver os links, gerar/enviar e revogar. */
    portalView: boolean;
    portalCreate: boolean;
    portalRevoke: boolean;
  };
  billings: {
    /** Abrir a tela Cobranças (links "ver cobranças"). */
    view: boolean;
    /** Ver boleto/PIX da cobrança. */
    boletoView: boolean;
    generate: boolean;
    boletoCreate: boolean;
    /** Enviar boleto / 2ª via. */
    boletoSend: boolean;
    /** Cobrar por WhatsApp/e-mail e registrar ligação. */
    collect: boolean;
    /** Registrar recebimento (baixa manual) — exige também ver valores (o valor pago é informado no diálogo). */
    pay: boolean;
    reverse: boolean;
    cancel: boolean;
  };
}

/** Sem provedor (ou sem sessão): nada liberado — na dúvida, o controle não aparece. */
export const NO_FINANCE_CAPABILITIES: FinanceCapabilities = {
  values: false,
  contractValues: false,
  contracts: {
    view: false,
    create: false,
    edit: false,
    signatureView: false,
    amendmentsView: false,
    pendenciesView: false,
    documentsView: false,
    historyView: false,
    signersEdit: false,
    signatureSend: false,
    sign: false,
    amendmentCreate: false,
    amendmentSend: false,
    amendmentSign: false,
    amendmentApply: false,
    amendmentCancel: false,
    pendencyCreate: false,
    pendencyResolve: false,
    documentAttach: false,
    release: false,
    releaseWithPendency: false,
    cancel: false,
    portalView: false,
    portalCreate: false,
    portalRevoke: false,
  },
  billings: { view: false, boletoView: false, generate: false, boletoCreate: false, boletoSend: false, collect: false, pay: false, reverse: false, cancel: false },
};

/** Alguma ação sobre cobranças (o menu "…" da cobrança só aparece com ao menos uma). */
export function hasBillingActions(caps: FinanceCapabilities): boolean {
  const b = caps.billings;
  return b.pay || b.collect || b.boletoCreate || b.boletoSend || b.cancel || b.reverse;
}
