/**
 * Catálogo de acessos — módulo Financeiro (`financeiro.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const FINANCEIRO = {
  key: "financeiro",
  label: "Financeiro",
  // Hoje: MODULE_ACCESS.financeiro (constants.ts:62) + admin (session.ts:79-80)
  rule: { role: ["admin", "diretoria", "gestor", "financeiro", "vendas"] },
  deactivatable: true,
  screens: [
    {
      key: "financeiro.dashboard",
      module: "financeiro",
      label: "Visão Geral do Financeiro",
      description: "Indicadores do Financeiro com drill-down, vendas ganhas sem contrato, fila de contratos em aberto e atalhos para as telas do módulo (atalhos filtrados por canSeeHref).",
      routes: ["/financeiro"],
      // Hoje: src/app/(app)/financeiro/page.tsx:24-25 (requireUser + canAccessModule(financeiro) →
      // /meu-dia?erro=sem-permissao)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:137) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "financeiro",
        href: "/financeiro",
        order: 1,
        label: "Visão Geral",
        icon: "LayoutDashboard",
        wave: 2,
      },
      sections: [
        {
          key: "financeiro.dashboard.indicadores.ver",
          label: "Indicadores do Financeiro",
          // Onde: financeiro/page.tsx:41-43 + textos dos atalhos com valores :29-35 (valores sob
          // financeiro.valores.ver) · Hoje: page.tsx:24-25 (só módulo)
          rule: "all",
        },
        {
          key: "financeiro.dashboard.vendas-sem-contrato.ver",
          label: "Vendas ganhas sem contrato",
          // Onde: financeiro/page.tsx:45-56 (WonWithoutContractList; botão de gerar contrato =
          // financeiro.contratos.criar) · Hoje: page.tsx:24-25; botão: page.tsx:27 canOperateFinance
          rule: "all",
        },
        {
          key: "financeiro.dashboard.fila.ver",
          label: "Fila do Financeiro (contratos em aberto)",
          // Onde: financeiro/page.tsx:57-73 (ContractsTable, listContracts status 'abertos' :26) · Hoje:
          // page.tsx:24-25
          rule: "all",
        },
      ],
      actions: [],
      scope: {
        entity: "contract + billing (agregados)",
        ownerFields: ["contract.sellerId", "contract.ownerId", "billing → contract"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos com o módulo: getFinanceOverview (src/server/finance/queries.ts:258-298) e
        // listContracts (:175-229) sem filtro por dono.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        sameAs: "financeiro.contratos",
        applyAt: ["src/server/finance/queries.ts#getFinanceOverview", "src/server/finance/queries.ts#listContracts"],
      },
    },
    {
      key: "financeiro.valores",
      module: "financeiro",
      label: "Valores financeiros",
      // R11 'ver valores'. Aplicação no servidor (getProject queries.ts:356-372, getClientFinancialSummary
      // finance/queries.ts:835, getTicket support/queries.ts:497/514, getFinanceOverview, listContracts,
      // listBillings, getReceivablesAging, getRecurrenceMetrics, getContract, reports financeiros). Padrão =
      // todos que veem hoje.
      description: "Capacidade 'Visualizar valores': sem ela, o servidor troca números por 'Restrito' em todas as telas que exibem valores de contrato/cobrança/receita (Financeiro, Cliente 360 aba Financeiro e card de contrato, Resumo do contratado da implantação, contexto do chamado, telas de CS, Meu Dia, cockpit). Não é página: é uma chave de tela virtual que NÃO exige financeiro.acessar (moduleGate 'ativo'), porque hoje papéis sem o módulo veem valores no Cliente 360/implantação/suporte/CS.",
      routes: [],
      virtual: true,
      moduleGate: "ativo",
      sensitive: true,
      // Hoje: Não existe hoje: todo usuário que vê essas telas vê os valores (financeiro/page.tsx:24-25,
      // cobrancas/page.tsx:23-24, contas-a-receber/page.tsx:26-27, recorrencia/page.tsx:30-31,
      // contratos/page.tsx:55-56; clientes/[id]/page.tsx:68 TabFinanceiro; implantacao/[projectId]/page.tsx:68
      // SaleDataCard; support/queries.ts:497,514).
      rule: "all",
      sections: [],
      actions: [],
      scope: null,
    },
    {
      key: "financeiro.contratos",
      module: "financeiro",
      label: "Contratos",
      description: "Gestão de contratos (lista com painel ?contrato=) e página do contrato: itens, condições, assinatura, aditivos/renovação, cobrança, pendências, documentos, liberação, cancelamento e histórico.",
      routes: ["/financeiro/contratos", "/financeiro/contratos/[id]"],
      // Hoje: contratos/page.tsx:55-56 e contratos/[id]/page.tsx:45-46 (M financeiro); [id] notFound em
      // :48-49. R12 'ver contratos'.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:138) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "financeiro",
        href: "/financeiro/contratos",
        order: 2,
        label: "Contratos",
        icon: "FileSignature",
        wave: 2,
      },
      sections: [
        {
          key: "financeiro.contratos.valores.ver",
          label: "Valores do contrato",
          // Onde: contratos/page.tsx:73-97 (KpiStrip), contract-side-panel.tsx:87-88, [id]/page.tsx:126-139,
          // :164-177; [id]/documento/page.tsx:181-187, :215. Exibir número só com
          // financeiro.contratos.valores.ver ∧ financeiro.valores.ver · Hoje: sem regra hoje (só o módulo)
          rule: "all",
        },
        {
          key: "financeiro.contratos.historico.ver",
          label: "Histórico do contrato",
          // Onde: [id]/page.tsx:178-188 (Timeline), :82-89 (versões anteriores → documento?versao=N),
          // contratos/page.tsx:124 (ContractMilestonesCard), documento?versao=N
          // ([id]/documento/page.tsx:79-95) · Hoje: sem regra hoje (só o módulo)
          rule: "all",
        },
        {
          key: "financeiro.contratos.documentos.ver",
          label: "Documentos do contrato",
          // Onde: Página imprimível do contrato/termo aditivo/versão; botão 'Ver contrato'
          // ([id]/page.tsx:96-100); DocumentsCard (:220); link no projeto de implantação
          // (implantacao/[projectId]/page.tsx:68, hoje canAccessModule(financeiro)) · Hoje:
          // src/app/(app)/financeiro/contratos/[id]/documento/page.tsx:59-60 (M financeiro) + notFound :63
          rule: "all",
          routes: ["/financeiro/contratos/[id]/documento"],
        },
        {
          key: "financeiro.contratos.assinatura.ver",
          label: "Signatários e assinatura",
          // Onde: [id]/page.tsx:202-210 (SignatureCard); contract-side-panel.tsx:132,152;
          // /financeiro/assinaturas · Hoje: só módulo; botões com canOperate ([id]/page.tsx:52,206)
          rule: "all",
        },
        {
          key: "financeiro.contratos.aditivos.ver",
          label: "Aditivos e renovação",
          // Onde: [id]/page.tsx:167 (ContractAmendmentsCard); termo aditivo em [id]/documento?aditivo=<id>.
          // Renovação no Financeiro = aditivo tipo 'renovacao' (domain/contract-snapshot.ts:11-17) · Hoje: só
          // módulo; ações por requireFinanceOperator
          rule: "all",
        },
        {
          key: "financeiro.contratos.pendencias.ver",
          label: "Pendências do contrato",
          // Onde: [id]/page.tsx:211 (PendencyCard) · Hoje: só módulo; botões com canOperate
          rule: "all",
        },
        {
          key: "financeiro.contratos.portal.ver",
          label: "Portal do cliente (links de acesso)",
          // Etapa 6B (D31): card "Portal do cliente" na página do contrato e na aba Financeiro do Cliente 360 (links
          // ativos com origem, criado por/em, validade, último acesso e nº de acessos). Seção NOVA, sem tela antiga:
          // padrão = quem opera o Financeiro hoje (mesma regra de financeiro.contratos.editar). A página pública
          // /portal/[token] não usa o catálogo (isenção por token, somente leitura).
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
        },
      ],
      actions: [
        {
          key: "financeiro.contratos.criar",
          label: "Criar contrato (da venda ganha ou manual)",
          verb: "criar",
          // Hoje: finance/actions.ts:117-140 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47). UI:
          // contratos/page.tsx:70, financeiro/page.tsx:52
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [
            "src/server/finance/actions.ts#createContractFromOpportunityAction",
            "src/server/finance/actions.ts#createManualContractAction",
          ],
        },
        {
          key: "financeiro.contratos.editar",
          label: "Editar contrato (itens, condições, dados de faturamento)",
          verb: "editar",
          // Hoje: finance/actions.ts:142-176 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [
            "src/server/finance/actions.ts#updateContractItemsAction",
            "src/server/finance/actions.ts#updateContractConditionsAction",
            "src/server/finance/actions.ts#completeBillingDataAction",
          ],
        },
        {
          key: "financeiro.contratos.assinatura.editar",
          label: "Adicionar/remover signatários",
          verb: "editar",
          // Hoje: finance/actions.ts:178-200 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#addSignerAction", "src/server/finance/actions.ts#removeSignerAction"],
        },
        {
          key: "financeiro.contratos.assinatura.enviar",
          label: "Enviar para assinatura e lembretes",
          verb: "enviar",
          // Hoje: finance/actions.ts:202-212, 226-236 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [
            "src/server/finance/actions.ts#sendForSignatureAction",
            "src/server/finance/actions.ts#sendSignatureReminderAction",
          ],
          sensitive: true,
        },
        {
          key: "financeiro.contratos.assinatura.assinar",
          label: "Registrar assinatura manual (com evidência)",
          verb: "assinar",
          // Hoje: finance/actions.ts:214-224 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#registerManualSignatureAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contratos.aditivos.criar",
          label: "Gerar aditivo (inclui renovação/reajuste)",
          verb: "criar",
          // Hoje: finance/actions.ts:242-252 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#createAmendmentAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contratos.aditivos.enviar",
          label: "Gerar termo aditivo para assinatura",
          verb: "enviar",
          // Hoje: finance/actions.ts:254-264 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#sendAmendmentForSignatureAction"],
        },
        {
          key: "financeiro.contratos.aditivos.assinar",
          label: "Registrar assinatura do aditivo",
          verb: "assinar",
          // Hoje: finance/actions.ts:266-276 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#registerAmendmentSignatureAction"],
        },
        {
          key: "financeiro.contratos.aditivos.aplicar",
          label: "Aprovar alteração (aplicar aditivo: nova versão e refaz cobranças)",
          verb: "aplicar",
          // Hoje: finance/actions.ts:278-290 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47). Mesmo efeito por
          // cs.renovacoes.renovar (cs/service.ts:990-1009) sem esta chave.
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#applyAmendmentAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contratos.aditivos.cancelar",
          label: "Cancelar aditivo",
          verb: "cancelar",
          // Hoje: finance/actions.ts:292-302 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#cancelAmendmentAction"],
        },
        {
          key: "financeiro.contratos.pendencias.criar",
          label: "Registrar pendência",
          verb: "criar",
          // Hoje: finance/actions.ts:442-452 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#registerPendencyAction"],
        },
        {
          key: "financeiro.contratos.pendencias.concluir",
          label: "Resolver pendência",
          verb: "concluir",
          // Hoje: finance/actions.ts:454-464 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#resolvePendencyAction"],
        },
        {
          key: "financeiro.contratos.documentos.anexar",
          label: "Anexar documento ao contrato",
          verb: "anexar",
          // Hoje: finance/actions.ts:466-476 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#addContractDocumentAction"],
        },
        {
          key: "financeiro.contratos.liberar",
          label: "Liberar contrato para a implantação",
          verb: "liberar",
          // Hoje: finance/actions.ts:478-490 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#releaseContractAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contratos.liberar-com-pendencia",
          label: "Liberar com pendência (exceção ao gate)",
          verb: "liberar",
          // Hoje: src/server/finance/service.ts:1792-1797 (gate não ok → exige motivo l.1794,
          // settings.permiteExcecaoGestor l.1795 e actor.isManager l.1796); UI release-card.tsx:36;
          // [id]/page.tsx:199
          rule: { manager: true },
          guards: [],
          checkedIn: ["src/server/finance/actions.ts#releaseContractAction?exceptionReason preenchido"],
          recordCondition: "gate.ok OU (exceptionReason ∧ settings.gate_financeiro.permiteExcecaoGestor ∧ can(financeiro.contratos.liberar-com-pendencia)) — src/server/finance/service.ts:1792-1797: o setting permiteExcecaoGestor (l.1795) continua no serviço como regra de negócio; só o teste actor.isManager (l.1796) vira a chave",
          sensitive: true,
        },
        {
          key: "financeiro.contratos.cancelar",
          label: "Cancelar contrato",
          verb: "cancelar",
          // Hoje: finance/actions.ts:496-507 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47). Outro caminho:
          // cs.churn.registrar (cs/service.ts:1083,1119).
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#cancelContractAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contratos.portal.gerar",
          label: "Gerar e enviar link do portal do cliente",
          verb: "gerar",
          // Etapa 6B (D31): gerar link (mostrado uma vez) e enviá-lo por WhatsApp/e-mail (templateKey portal_link).
          // Também decide se `{linkPortal}` numa cobrança manual gera link (sem a chave, o marcador some).
          // Padrão = quem opera o Financeiro (regra de financeiro.contratos.editar).
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/portal/actions.ts#createPortalLinkAction", "src/server/portal/actions.ts#sendPortalLinkAction"],
          checkedIn: ["src/server/finance/actions.ts#sendBillingMessageAction?texto com {linkPortal}"],
          recordCondition: "cliente com ao menos um contrato no escopo de Contratos (contrato informado: assertContractAccess)",
          sensitive: true,
        },
        {
          key: "financeiro.contratos.portal.revogar",
          label: "Revogar link do portal do cliente",
          verb: "revogar",
          // Etapa 6B (D31): revogação imediata (motivo opcional, evento portal.link_revoked). Padrão = quem opera o
          // Financeiro.
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/portal/actions.ts#revokePortalLinkAction"],
          recordCondition: "cliente do link com ao menos um contrato no escopo de Contratos",
          sensitive: true,
        },
      ],
      scope: {
        entity: "contract",
        ownerFields: ["sellerId (fallback opportunity.ownerId → client.ownerSalesId)", "ownerId (responsável financeiro)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos com o módulo (admin, diretoria, gestor, financeiro, vendas): listContracts
        // (finance/queries.ts:175-229) sem filtro (?responsavel= é só UI); getContractsWorkspace
        // (finance/workspace.ts:187-266) idem; getContract (queries.ts:343-440) sem viewer; actions por
        // contractId/amendmentId sem conferir dono (actions.ts:104-111).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        // 'meus' casa QUALQUER dos dois campos (vendedor vê o que vendeu; analista vê aquilo de que é
        // responsável).
        applyAt: [
          "src/server/finance/queries.ts#listContracts",
          "src/server/finance/workspace.ts#getContractsWorkspace",
          "src/server/finance/queries.ts#getContract (detalhe, documento e generateMetadata)",
          "src/server/finance/access.ts#filterContractsByScope",
          "src/server/finance/access.ts#contractAccessById (página, documento e generateMetadata, antes de carregar o detalhe)",
          "src/server/finance/access.ts#assertContractAccess",
          "src/server/finance/access.ts#assertAmendmentAccess",
          "src/server/finance/access.ts#assertOpportunityContractAccess",
          "src/server/clients/queries.ts#getClient360 (Cliente 360)",
        ],
      },
    },
    {
      key: "financeiro.assinaturas",
      module: "financeiro",
      label: "Assinaturas",
      description: "Fila de contratos aguardando assinatura e prontos para gerar o documento. As operações usam as chaves financeiro.contratos.assinatura.*.",
      routes: ["/financeiro/assinaturas"],
      // Hoje: src/app/(app)/financeiro/assinaturas/page.tsx:24-25 (M financeiro); botões com canOperateFinance
      // :27,52,63
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:139) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "financeiro",
        href: "/financeiro/assinaturas",
        order: 3,
        label: "Assinaturas",
        icon: "PenLine",
        wave: 2,
      },
      sections: [
        {
          key: "financeiro.assinaturas.aguardando.ver",
          label: "Aguardando assinatura",
          // Onde: assinaturas/page.tsx:45-54 · Hoje: page.tsx:24-25
          rule: "all",
        },
        {
          key: "financeiro.assinaturas.prontos.ver",
          label: "Prontos para gerar o documento",
          // Onde: assinaturas/page.tsx:56-65 · Hoje: page.tsx:24-25
          rule: "all",
        },
      ],
      actions: [],
      scope: {
        entity: "contract",
        ownerFields: ["sellerId", "ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa: listSignatureQueue (finance/queries.ts:476-515) lista todos.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        sameAs: "financeiro.contratos",
        applyAt: ["src/server/finance/queries.ts#listSignatureQueue"],
      },
    },
    {
      key: "financeiro.cobrancas",
      module: "financeiro",
      label: "Cobranças",
      description: "Cobranças com filtros e totais; operações de cobrança (gerar, boleto, cobrar, baixar, estornar, cancelar), usadas também na página do contrato e em Contas a Receber.",
      routes: ["/financeiro/cobrancas"],
      // Hoje: src/app/(app)/financeiro/cobrancas/page.tsx:23-24 (M financeiro); ações com canOperateFinance
      // :53
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:140) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "financeiro",
        href: "/financeiro/cobrancas",
        order: 4,
        label: "Cobranças",
        icon: "Receipt",
        wave: 2,
      },
      sections: [
        {
          key: "financeiro.cobrancas.boleto.ver",
          label: "Boleto / PIX da cobrança",
          // Onde: billing-actions.tsx:96-175 (BoletoDialog), :34-42 (BoletoBadge); filtro boleto
          // cobrancas/page.tsx:46 · Hoje: só módulo
          rule: "all",
        },
      ],
      actions: [
        {
          key: "financeiro.cobrancas.gerar",
          label: "Gerar cobranças do contrato (inclusive próximas mensalidades)",
          verb: "gerar",
          // Hoje: finance/actions.ts:308-331 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [
            "src/server/finance/actions.ts#generateBillingsAction",
            "src/server/finance/actions.ts#generateNextBillingsAction",
          ],
          sensitive: true,
        },
        {
          key: "financeiro.cobrancas.boleto.criar",
          label: "Registrar boleto (linha digitável, nosso número, PDF, PIX)",
          verb: "criar",
          // Hoje: finance/actions.ts:348-358 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#registerBoletoAction"],
          sensitive: true,
        },
        {
          key: "financeiro.cobrancas.boleto.enviar",
          label: "Enviar boleto / 2ª via ao cliente",
          verb: "enviar",
          // Hoje: hoje é a mesma sendBillingMessageAction (finance/actions.ts:361-373) sob
          // requireFinanceOperator
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [],
          checkedIn: ["src/server/finance/actions.ts#sendBillingMessageAction?includeBoleto || secondCopy"],
          sensitive: true,
        },
        {
          key: "financeiro.cobrancas.cobrar",
          label: "Cobrar cliente (WhatsApp/e-mail, registrar ligação)",
          verb: "cobrar",
          // Hoje: finance/actions.ts:361-373, 402-436 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47).
          // getBillingContactAction é leitura do diálogo (billing-actions.tsx:218); sendBillingWhatsappAction
          // sem chamador na UI.
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: [
            "src/server/finance/actions.ts#sendBillingMessageAction",
            "src/server/finance/actions.ts#sendBillingWhatsappAction",
            "src/server/finance/actions.ts#registerBillingCallAction",
            "src/server/finance/actions.ts#getBillingContactAction",
          ],
          sensitive: true,
        },
        {
          key: "financeiro.cobrancas.baixar",
          label: "Registrar recebimento (baixa manual)",
          verb: "baixar",
          // Hoje: finance/actions.ts:333-345 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47); baixas por
          // webhook/conciliação são ator de sistema (finance/webhook.ts:24-44, finance/alerts.ts:82)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          // Etapa CP/CR 2: a baixa manual exige a conta financeira; listPaymentAccountsAction é a leitura das contas
          // ativas do diálogo "Registrar pagamento" (billing-actions.tsx).
          guards: ["src/server/finance/actions.ts#registerPaymentAction", "src/server/finance/actions.ts#listPaymentAccountsAction"],
          sensitive: true,
        },
        {
          key: "financeiro.cobrancas.estornar",
          label: "Estornar pagamento recebido",
          verb: "estornar",
          // Hoje: finance/actions.ts:376-387 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#reversePaymentAction"],
          sensitive: true,
        },
        {
          key: "financeiro.cobrancas.cancelar",
          label: "Cancelar cobrança",
          verb: "cancelar",
          // Hoje: finance/actions.ts:389-400 → finance/actions.ts:86-93 requireFinanceOperator =
          // canAccessModule(financeiro) && canOperateFinance (finance/schemas.ts:45-47)
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/finance/actions.ts#cancelBillingAction"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "billing (dono herdado do contrato)",
        ownerFields: ["contract.sellerId (via billing.contractId)", "contract.ownerId (via billing.contractId)"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa para todos com o módulo: listBillings (finance/queries.ts:561-597) sem dono; actions
        // por billingId sem conferir (billingRef finance/actions.ts:109-111).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        sameAs: "financeiro.contratos",
        applyAt: [
          "src/server/finance/queries.ts#listBillings",
          "src/server/finance/access.ts#assertBillingAccess",
          "src/server/finance/queries.ts#getReceivablesAging (visibleContractIds)",
          "src/server/finance/queries.ts#getContract (cobranças do contrato)",
        ],
      },
    },
    {
      key: "financeiro.contas-a-receber",
      module: "financeiro",
      label: "Contas a Receber",
      description: "Aging por faixa, faturado × recebido, inadimplentes e valores em aberto por cliente.",
      routes: ["/financeiro/contas-a-receber"],
      // Hoje: src/app/(app)/financeiro/contas-a-receber/page.tsx:26-27 (M financeiro); BillingActions com
      // canOperateFinance :30,105
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:141) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "financeiro",
        href: "/financeiro/contas-a-receber",
        order: 5,
        label: "Contas a Receber",
        icon: "Wallet",
        wave: 2,
      },
      sections: [
        {
          key: "financeiro.contas-a-receber.aging.ver",
          label: "Aging e totais",
          // Onde: contas-a-receber/page.tsx:37-67 · Hoje: page.tsx:26-27
          rule: "all",
        },
        {
          key: "financeiro.contas-a-receber.faturado-recebido.ver",
          label: "Faturado × recebido",
          // Onde: contas-a-receber/page.tsx:68-76 · Hoje: page.tsx:26-27
          rule: "all",
        },
        {
          key: "financeiro.contas-a-receber.inadimplentes.ver",
          label: "Inadimplentes",
          // Onde: contas-a-receber/page.tsx:79-112 (ações usam financeiro.cobrancas.*) · Hoje: page.tsx:26-27
          rule: "all",
        },
        {
          key: "financeiro.contas-a-receber.por-cliente.ver",
          label: "Por cliente",
          // Onde: contas-a-receber/page.tsx:114-166 · Hoje: page.tsx:26-27
          rule: "all",
        },
        {
          key: "financeiro.contas-a-receber.avulsos.ver",
          label: "Títulos avulsos (receitas fora de contrato)",
          // Seção NOVA (etapa CP/CR 3): aba ?aba=avulsos de /financeiro/contas-a-receber. Padrão = quem opera as cobranças
          // hoje (financeiro.cobrancas.baixar: gestores, papel ou departamento Financeiro). Os títulos avulsos não têm
          // dono: só aparecem com o escopo "empresa" da tela (src/server/receivables/access.ts).
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          tab: "avulsos",
        },
      ],
      actions: [
        {
          key: "financeiro.contas-a-receber.avulsos.criar",
          label: "Criar título a receber avulso",
          verb: "criar",
          // Ação NOVA (etapa CP/CR 3). Padrão = quem opera as cobranças hoje.
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/receivables/actions.ts#createReceivableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-receber.avulsos.editar",
          label: "Editar título a receber avulso (e anexar documento)",
          verb: "editar",
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/receivables/actions.ts#updateReceivableAction", "src/server/receivables/actions.ts#addReceivableAttachmentAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-receber.avulsos.receber",
          label: "Registrar recebimento (total, parcial, com resíduo, quitar pelo já recebido)",
          verb: "receber",
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/receivables/actions.ts#receiveReceivableAction", "src/server/receivables/actions.ts#partialReceiveReceivableAction", "src/server/receivables/actions.ts#receiveWithResidualAction", "src/server/receivables/actions.ts#settleReceivableByPaidAction"],
          recordCondition: "título aberto; conta financeira obrigatória",
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-receber.avulsos.desfazer-recebimento",
          label: "Desfazer recebimento (apaga o lançamento de caixa)",
          verb: "desfazer-recebimento",
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/receivables/actions.ts#undoReceivablePaymentAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-receber.avulsos.cancelar",
          label: "Cancelar título a receber avulso",
          verb: "cancelar",
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
          guards: ["src/server/receivables/actions.ts#cancelReceivableAction"],
          recordCondition: "título aberto sem recebimento",
          sensitive: true,
        },
      ],
      scope: {
        entity: "billing (agregado por cliente)",
        ownerFields: ["contract.sellerId", "contract.ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa: getReceivablesAging (finance/queries.ts:646-689) agrega todas.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        sameAs: "financeiro.contratos",
        applyAt: ["src/server/finance/queries.ts#getReceivablesAging", "src/server/receivables/access.ts#receivablesVisible (títulos avulsos: só escopo empresa)"],
      },
    },
    {
      key: "financeiro.recorrencia",
      module: "financeiro",
      label: "Recorrência",
      description: "MRR atual, histórico e por produto, novos/perdidos e contratos por vencimento (planejamento de renovação).",
      routes: ["/financeiro/recorrencia"],
      // Hoje: src/app/(app)/financeiro/recorrencia/page.tsx:30-31 (M financeiro)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:142) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "financeiro",
        href: "/financeiro/recorrencia",
        order: 6,
        label: "Recorrência",
        icon: "Repeat",
        wave: 2,
      },
      sections: [
        {
          key: "financeiro.recorrencia.mrr.ver",
          label: "Indicadores e histórico de MRR",
          // Onde: recorrencia/page.tsx:41-65 · Hoje: page.tsx:30-31
          rule: "all",
        },
        {
          key: "financeiro.recorrencia.por-produto.ver",
          label: "MRR por produto",
          // Onde: recorrencia/page.tsx:66-92 · Hoje: page.tsx:30-31
          rule: "all",
        },
        {
          key: "financeiro.recorrencia.vencimentos.ver",
          label: "Contratos por vencimento (renovação)",
          // Onde: recorrencia/page.tsx:95-136 · Hoje: page.tsx:30-31
          rule: "all",
        },
      ],
      actions: [],
      scope: {
        entity: "contract (agregado)",
        ownerFields: ["sellerId", "ownerId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Empresa: getRecurrenceMetrics (finance/queries.ts:728-801).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "empresa",
          vendas: "empresa",
          financeiro: "empresa",
          implantacao: "empresa",
          cs: "empresa",
          suporte: "empresa",
          colaborador: "empresa",
        },
        sameAs: "financeiro.contratos",
        applyAt: ["src/server/finance/queries.ts#getRecurrenceMetrics"],
      },
    },
    {
      key: "financeiro.comissoes",
      module: "financeiro",
      label: "Comissões",
      // Exportação do relatório de comissões = gestao.relatorios.comissoes.exportar (dona única da rota
      // /api/relatorios).
      description: "Comissões item a item (previstas, carência, elegíveis, a pagar, pagas, bloqueadas, estornadas) com memória de cálculo. Seções Minhas / Todas / Regras.",
      routes: ["/financeiro/comissoes"],
      modules: ["financeiro", "vendas"],
      // Hoje: src/app/(app)/financeiro/comissoes/page.tsx:34-35: requireUser + (canAccessModule(financeiro) ||
      // canAccessModule(vendas)) → /meu-dia?erro=sem-permissao. Entram admin, diretoria, gestor, financeiro,
      // vendas, marketing, cs, suporte. R11 'ver comissões'.
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:143) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16 ·
        // Por que a regra: A rota aceita financeiro OU vendas (src/app/(app)/financeiro/comissoes/page.tsx:35;
        // campo modules), mas o item 'Comissões' fica só na seção Financeiro (src/domain/constants.ts:143),
        // filtrada por canAccessModule(user,'financeiro') (layout.tsx:11). Hoje marketing, cs e suporte abrem
        // a rota, mas não veem o item. nav.rule = {can: financeiro.acessar} reproduz isso: item visível =
        // can(financeiro.comissoes.ver) ∧ can(financeiro.acessar). A rota continua com o OR de módulos.
        menu: "financeiro",
        href: "/financeiro/comissoes",
        order: 7,
        label: "Comissões",
        icon: "BadgePercent",
        wave: 5,
        rule: { can: "financeiro.acessar" },
      },
      sections: [
        {
          key: "financeiro.comissoes.minhas.ver",
          label: "Minhas comissões",
          // Onde: comissoes/page.tsx:57-64,113,118 (ws.scope own); commissions/queries.ts:66-68 · Hoje:
          // commissions/permissions.ts:66 (commissionScopeFor 'own'); todos que entram veem as próprias
          rule: "all",
        },
        {
          key: "financeiro.comissoes.todas.ver",
          label: "Todas as comissões / de terceiros",
          // Onde: comissoes/page.tsx:61-63, 102, 118; commissions/queries.ts:231-269 (lista, KPIs, facetas,
          // detalhe ?comissao=); :313-315 (digest de /performance) · Hoje: permissions.ts:63-66:
          // canViewAllCommissions (isFinanceTeam → empresa) || isManager (→ equipe). Sem esta seção o escopo
          // cai para 'meus'; a amplitude (equipe/empresa) vem do escopo da tela.
          rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
        },
        {
          key: "financeiro.comissoes.regras.ver",
          label: "Regras de comissão",
          // Onde: /financeiro/comissoes/regras (RulesWorkspaceView); botão Regras (comissoes/page.tsx:69-75);
          // links de trace commissions/queries.ts:381,831 · Hoje:
          // src/app/(app)/financeiro/comissoes/regras/page.tsx:20-21: canAccessModule(financeiro) &&
          // canViewCommissionRules (permissions.ts:35-37 = isFinanceTeam || isManager) →
          // /financeiro/comissoes?erro=sem-permissao. Gestor fora do Financeiro vê em modo leitura (canManage,
          // commissions/queries.ts:580).
          rule: {
            all: [
              { can: "financeiro.acessar" },
              { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
            ],
          },
          routes: ["/financeiro/comissoes/regras"],
          redirectTo: "/financeiro/comissoes?erro=sem-permissao",
        },
      ],
      actions: [
        {
          key: "financeiro.comissoes.estornar",
          label: "Estornar comissão",
          verb: "estornar",
          // Hoje: commissions/actions.ts:109 requireWith(canReverseCommission) → permissions.ts:56-58 →
          // isFinanceManager (l.23-25)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#reverseCommissionAction"],
          recordCondition: "canSeeRecord('financeiro.comissoes', commission.userId) quando concedida a quem tem escopo < empresa",
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.bloquear",
          label: "Bloquear comissão",
          verb: "bloquear",
          // Hoje: commissions/actions.ts:121 requireWith(canReverseCommission)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#blockCommissionAction"],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.desbloquear",
          label: "Desbloquear comissão",
          verb: "desbloquear",
          // Hoje: commissions/actions.ts:133 requireWith(canReverseCommission)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#unblockCommissionAction"],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.gerar-titulo",
          label: "Gerar novo título a pagar da comissão",
          verb: "gerar",
          // Hoje: commissions/actions.ts:145 requireWith(canReverseCommission)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#regenerateCommissionPayableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.aprovar",
          label: "Aprovar comissão (título de comissão)",
          verb: "aprovar",
          // Hoje: Sem action própria: aprovar comissão = aprovar o título dela em Contas a Pagar
          // (commissions/actions.ts:161 requireWith(canApprovePayables) = isFinanceManager)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: [],
          checkedIn: ["src/server/commissions/actions.ts#approvePayableAction?payable.origin ∈ {comissao_automatica, estorno}"],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.regras.editar",
          label: "Alterar regras de comissão",
          verb: "editar",
          // Hoje: commissions/actions.ts:67 requireWith(canManageCommissionRules) (permissions.ts:31-33); UI
          // canManage (queries.ts:580)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#saveCommissionRuleAction"],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.regras.ativar",
          label: "Ativar/desativar regra de comissão",
          verb: "ativar",
          // Hoje: commissions/actions.ts:79 requireWith(canManageCommissionRules)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#setCommissionRuleActiveAction"],
          checkedIn: ["src/server/commissions/actions.ts#saveCommissionRuleAction?regra existente com active alterado"],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.regras.criar-excecao",
          label: "Criar exceção de comissão por contrato",
          verb: "criar-excecao",
          // Hoje: mesma guarda de saveCommissionRuleAction (commissions/actions.ts:67); exceção = regra com
          // scope 'contrato' (schemas.ts:19,41-42; service.ts:85-89)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: [],
          checkedIn: [
            "src/server/commissions/actions.ts#saveCommissionRuleAction?scope=contrato",
            "src/server/commissions/actions.ts#setCommissionRuleActiveAction?regra existente com ruleScope=contrato (rules.ts:48-50)",
          ],
          sensitive: true,
        },
        {
          key: "financeiro.comissoes.regras.configurar",
          label: "Definir o dia de pagamento das comissões",
          verb: "configurar",
          // Hoje: commissions/actions.ts:91 requireWith(canManageCommissionRules); grava
          // settings.comissoes_pagamento (commissions/service.ts:168-186) · Mesmo dado de
          // financeiro.configuracoes.comissoes-pagamento.editar (upsertSetting, só admin). Dois writers com
          // padrões diferentes, como hoje; recomendação: unificar.
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#saveCommissionPaymentDayAction"],
        },
      ],
      scope: {
        entity: "commission",
        ownerFields: ["userId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: commissionScopeFor (permissions.ts:63-67) + resolveCommissionScope
        // (commissions/queries.ts:59-64): (1) empresa para admin, diretoria, papel financeiro e QUALQUER papel
        // do departamento financeiro (isFinanceTeam); (2) equipe para gestor de outra área = semântica nº2 de
        // §4.1 (departamento próprio ∪ departments.managerId=ele ∪ liderados diretos, getGoalPermissions
        // kpis/queries.ts:387-395 via performance/queries.ts:63-75); (3) meus para os demais. Detalhe
        // ?comissao= só dentro do escopo (queries.ts:267-268); digest de /performance null fora (l.313-315);
        // relatório usa o mesmo (reports/build.ts:795-800).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "equipe",
          marketing: "meus",
          vendas: "meus",
          financeiro: "empresa",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        overrides: [
          { when: { department: "financeiro" }, scope: "empresa" },
        ],
        variants: {
          equipe: {
            ownDepartment: true,
            managedDepartments: true,
            departmentBy: "people",
            reportLevels: 1,
            includeSelf: true,
            description: "Seu departamento, os departamentos que você lidera e seus liderados diretos",
          },
        },
        applyAt: [
          "src/server/commissions/access.ts#commissionVisibility (seções Minhas/Todas + resolveDataScope; resolveCommissionScope é a fachada usada por reports/build.ts)",
          "src/server/commissions/queries.ts#getCommissionsWorkspace",
          "src/server/commissions/queries.ts#getUserCommissionsDigest",
          "src/server/reports/build.ts#buildReport (comissoes) + forcedFilters",
          "src/server/commissions/access.ts#assertCommissionAccess",
          "src/server/sales/commissions.ts#getCommissionSummary (escopo pelo chamador)",
        ],
      },
    },
    {
      key: "financeiro.contas-a-pagar",
      module: "financeiro",
      label: "Contas a Pagar",
      // Exportação = gestao.relatorios.contas-a-pagar.exportar. R11 'estornar' em CaP: não existe estorno de
      // título pago; o estorno de comissão gera título 'estorno' (financeiro.comissoes.estornar).
      description: "Títulos a pagar (comissões, bônus, estornos, fornecedor e colaborador, parcelados e recorrentes): aprovação, programação, pagamento, cancelamento, anexos e fluxo de caixa. Seção Fornecedores.",
      routes: ["/financeiro/contas-a-pagar"],
      redirectTo: "/financeiro/comissoes?erro=sem-permissao",
      // Hoje: src/app/(app)/financeiro/contas-a-pagar/page.tsx:42-43: canAccessModule(financeiro) &&
      // canViewPayables (permissions.ts:51-53 = isFinanceTeam || isManager) →
      // /financeiro/comissoes?erro=sem-permissao. Menu: constants.ts:144 roles [diretoria,gestor,financeiro]
      // (+admin) — diverge da rota para papel vendas no departamento financeiro (A14: menu deriva da chave).
      rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
      nav: {
        // Hoje: NAVIGATION.financeiro (src/domain/constants.ts:144) filtrado por
        // canAccessModule(user,'financeiro') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16 +
        // roles ['diretoria', 'gestor', 'financeiro'] (admin sempre vê) em layout.tsx:13 / menu/page.tsx:18
        menu: "financeiro",
        href: "/financeiro/contas-a-pagar",
        order: 8,
        label: "Contas a Pagar",
        icon: "HandCoins",
        wave: 5,
      },
      sections: [
        {
          key: "financeiro.contas-a-pagar.fluxo-caixa.ver",
          label: "Fluxo de caixa (a receber × a pagar)",
          // Onde: contas-a-pagar/page.tsx:79 (CashFlowCard só quando !ws.can.readOnly);
          // commissions/queries.ts:764 (buildCashFlow só com full) · Hoje: commissions/queries.ts:691 full =
          // canViewAllCommissions (isFinanceTeam) e l.760,775 readOnly = !canOperatePayables
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
        },
        {
          key: "financeiro.contas-a-pagar.fornecedores.ver",
          label: "Fornecedores",
          // Onde: /financeiro/contas-a-pagar/fornecedores (SuppliersWorkspace; ?fornecedor=); link no
          // cabeçalho de CaP (page.tsx:60-63) e no painel do título (payable-panel.tsx:57) · Hoje:
          // src/app/(app)/financeiro/contas-a-pagar/fornecedores/page.tsx:18-19: canAccessModule(financeiro)
          // && canViewPayables → /financeiro/comissoes?erro=sem-permissao; edição por canOperatePayables
          // (l.31)
          rule: "all",
          routes: ["/financeiro/contas-a-pagar/fornecedores"],
          redirectTo: "/financeiro/comissoes?erro=sem-permissao",
        },
      ],
      actions: [
        {
          key: "financeiro.contas-a-pagar.criar",
          label: "Criar título (lançamento manual)",
          verb: "criar",
          // Hoje: commissions/actions.ts:221 requireWith(canOperatePayables) = isFinanceTeam
          // (permissions.ts:47-49)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#createManualPayableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.editar",
          label: "Editar título",
          verb: "editar",
          // Hoje: commissions/actions.ts:209 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#updatePayableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.anexar",
          label: "Anexar documento ao título",
          verb: "anexar",
          // Hoje: commissions/actions.ts:233 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#addPayableAttachmentAction"],
        },
        {
          key: "financeiro.contas-a-pagar.aprovar",
          label: "Aprovar pagamento",
          verb: "aprovar",
          // Hoje: commissions/actions.ts:161 requireWith(canApprovePayables) = isFinanceManager
          // (permissions.ts:39-41) · Em título de comissão exige também financeiro.comissoes.aprovar.
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#approvePayableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.programar",
          label: "Programar pagamento",
          verb: "programar",
          // Hoje: commissions/actions.ts:173 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#schedulePayableAction"],
        },
        {
          key: "financeiro.contas-a-pagar.pagar",
          label: "Registrar pagamento",
          verb: "pagar",
          // Hoje: commissions/actions.ts:185 requireWith(canPayPayables) = isFinanceManager
          // (permissions.ts:43-45)
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#payPayableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.desfazer-pagamento",
          label: "Desfazer pagamento (volta a \"A pagar\" e apaga o lançamento de caixa)",
          verb: "desfazer-pagamento",
          // Ação NOVA (etapa CP/CR 2). Padrão = o mesmo de "Registrar pagamento" (pagar: diretoria ou gestor do
          // Financeiro), porque desfaz exatamente o que ela grava. Título de comissão/bônus/estorno é recusado no serviço
          // (estorno de comissão é o caminho).
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#undoPayablePaymentAction"],
          recordCondition: "título pago (ou aberto com baixa parcial, etapa CP/CR 3) que não seja de comissão/bônus/estorno (payablePaymentUndoBlock)",
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.pagar-parcial",
          label: "Pagar parcialmente (baixa parcial)",
          verb: "pagar-parcial",
          // Ação NOVA (etapa CP/CR 3). Padrão = o de "Registrar pagamento" (diretoria ou gestor do Financeiro). Título de
          // comissão/bônus é recusado no serviço (só pagamento integral).
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#partialPayPayableAction"],
          recordCondition: "título aprovado/a pagar que não seja de comissão/bônus/estorno (isCommissionLinkedPayable)",
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.pagar-com-residuo",
          label: "Pagar com resíduo (quita o original e cria o título \"— Resíduo\")",
          verb: "pagar-com-residuo",
          // Ação NOVA (etapa CP/CR 3). Padrão = o de "Registrar pagamento".
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#payPayableWithResidualAction"],
          recordCondition: "título aprovado/a pagar que não seja de comissão/bônus/estorno (isCommissionLinkedPayable)",
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.quitar-pelo-pago",
          label: "Quitar pelo já pago (ajusta o valor, sem nova baixa)",
          verb: "quitar-pelo-pago",
          // Ação NOVA (etapa CP/CR 3). Padrão = o de "Registrar pagamento".
          rule: { any: [{ director: true }, { managerOf: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#settlePayableByPaidAction"],
          recordCondition: "título com baixa parcial que não seja de comissão/bônus/estorno",
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.cancelar",
          label: "Cancelar título",
          verb: "cancelar",
          // Hoje: commissions/actions.ts:197 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#cancelPayableAction"],
          sensitive: true,
        },
        {
          key: "financeiro.contas-a-pagar.fornecedores.criar",
          label: "Cadastrar fornecedor",
          verb: "criar",
          // Hoje: commissions/actions.ts:249 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#saveSupplierAction?sem id"],
        },
        {
          key: "financeiro.contas-a-pagar.fornecedores.editar",
          label: "Editar fornecedor",
          verb: "editar",
          // Hoje: commissions/actions.ts:249 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#saveSupplierAction?com id"],
        },
        {
          key: "financeiro.contas-a-pagar.fornecedores.ativar",
          label: "Ativar/desativar fornecedor",
          verb: "ativar",
          // Hoje: commissions/actions.ts:261 requireWith(canOperatePayables)
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/commissions/actions.ts#setSupplierActiveAction"],
          checkedIn: ["src/server/commissions/actions.ts#saveSupplierAction?com id e active alterado"],
        },
      ],
      scope: {
        entity: "payable",
        ownerFields: ["creditorId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: getPayablesWorkspace (commissions/queries.ts:690-693): full (isFinanceTeam) = empresa,
        // inclusive títulos de fornecedor sem creditorId; gestor de outra área = equipe (creditorId ∈
        // resolveCommissionScope; títulos sem creditorId somem, §4.5). Detalhe ?titulo= só no escopo
        // (l.758-759); fluxo de caixa só em empresa (l.764). Sem escopo hoje: fornecedores/page.tsx:22-27
        // (totais) e reports/build.ts:635-640.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "equipe",
          marketing: "meus",
          vendas: "meus",
          financeiro: "empresa",
          implantacao: "meus",
          cs: "meus",
          suporte: "meus",
          colaborador: "meus",
        },
        overrides: [
          { when: { department: "financeiro" }, scope: "empresa" },
        ],
        variants: {
          equipe: {
            ownDepartment: true,
            managedDepartments: true,
            departmentBy: "people",
            reportLevels: 1,
            includeSelf: true,
            description: "Seu departamento, os departamentos que você lidera e seus liderados diretos",
          },
        },
        applyAt: [
          "src/server/commissions/queries.ts#getPayablesWorkspace",
          "src/app/(app)/financeiro/contas-a-pagar/fornecedores/page.tsx:22-27",
          "src/server/reports/build.ts#buildPayables",
          "src/server/commissions/access.ts#payableVisibility",
          "src/server/commissions/access.ts#assertPayableAccess (título sem creditorId exige empresa)",
          "src/server/commissions/access.ts#assertCreditorInScope (lançamento manual com escopo < empresa: só colaborador do escopo; fornecedor exige empresa)",
        ],
      },
    },
    {
      key: "financeiro.cadastros",
      module: "financeiro",
      label: "Cadastros financeiros",
      description: "Contas financeiras (onde o dinheiro entra e sai), centros de custo e categorias de receita/despesa com subcategoria: cadastro, arquivamento/reativação, manutenção em massa (aplicar centro, mover subcategorias, mesclar) e importação manual da configuração de Contas a Pagar.",
      routes: ["/financeiro/cadastros"],
      redirectTo: "/financeiro/comissoes?erro=sem-permissao",
      // Tela NOVA (etapa CP/CR 1), sem predicado anterior. Padrão = o mesmo público da tela Contas a Pagar
      // (financeiro.contas-a-pagar.ver: equipe financeira e gestores — gestor fora do Financeiro só consulta), porque os
      // cadastros classificam os títulos dessa tela. Sem item de menu (o T0 de navegação continua idêntico): entra pelo
      // cabeçalho de Contas a Pagar e por Configurações › Contas a pagar.
      rule: { any: [{ manager: true }, { role: "financeiro" }, { department: "financeiro" }] },
      nav: {
        // Só lookup para canSeeHref/ScreenLink (links do cabeçalho de Contas a Pagar e de Configurações); NÃO gera
        // item de menu.
        menu: null,
        href: "/financeiro/cadastros",
      },
      sections: [
        {
          key: "financeiro.cadastros.contas.ver",
          tab: "contas",
          label: "Contas financeiras",
          // Onde: /financeiro/cadastros?aba=contas (saldo inicial sob financeiro.valores.ver: "Restrito" sem a chave)
          rule: "all",
        },
        {
          key: "financeiro.cadastros.centros.ver",
          tab: "centros",
          label: "Centros de custo",
          // Onde: /financeiro/cadastros?aba=centros
          rule: "all",
        },
        {
          key: "financeiro.cadastros.categorias.ver",
          tab: "categorias",
          label: "Categorias e subcategorias",
          // Onde: /financeiro/cadastros?aba=categorias (uso por categoria, categorias sem centro)
          rule: "all",
        },
      ],
      actions: [
        // Padrão das ações = quem opera Contas a Pagar e Fornecedores hoje (canOperatePayables: administrador,
        // diretoria, papel ou departamento Financeiro) — a regra existente mais próxima (cadastro de apoio aos títulos).
        {
          key: "financeiro.cadastros.contas.criar",
          label: "Cadastrar conta financeira",
          verb: "criar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#saveFinancialAccountAction?sem id"],
        },
        {
          key: "financeiro.cadastros.contas.editar",
          label: "Editar conta financeira",
          verb: "editar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#saveFinancialAccountAction?com id"],
          sensitive: true,
        },
        {
          key: "financeiro.cadastros.contas.arquivar",
          label: "Arquivar/reativar conta financeira",
          verb: "arquivar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#setFinancialAccountArchivedAction"],
        },
        {
          key: "financeiro.cadastros.contas.extrato",
          label: "Ver extrato da conta (lançamentos de caixa, somente leitura)",
          verb: "extrato",
          // Ação NOVA (etapa CP/CR 2): leitura do extrato na aba Contas (?conta=<id>, getRegistryWorkspace). Padrão =
          // a mesma regra das ações vizinhas da aba Contas; quantias sob "Visualizar valores" (Restrito).
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: [],
        },
        {
          key: "financeiro.cadastros.centros.criar",
          label: "Cadastrar centro de custo",
          verb: "criar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#saveCostCenterAction?sem id"],
        },
        {
          key: "financeiro.cadastros.centros.editar",
          label: "Editar centro de custo",
          verb: "editar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#saveCostCenterAction?com id"],
        },
        {
          key: "financeiro.cadastros.centros.arquivar",
          label: "Arquivar/reativar centro de custo",
          verb: "arquivar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#setCostCenterArchivedAction"],
        },
        {
          key: "financeiro.cadastros.categorias.criar",
          label: "Cadastrar categoria ou subcategoria",
          verb: "criar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#saveFinanceCategoryAction?sem id"],
        },
        {
          key: "financeiro.cadastros.categorias.editar",
          label: "Editar categoria ou subcategoria",
          verb: "editar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#saveFinanceCategoryAction?com id"],
        },
        {
          key: "financeiro.cadastros.categorias.arquivar",
          label: "Arquivar/reativar categoria (com as subcategorias)",
          verb: "arquivar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#setFinanceCategoryArchivedAction"],
        },
        {
          key: "financeiro.cadastros.categorias.reorganizar",
          label: "Manutenção em massa: aplicar centro e mover subcategorias",
          verb: "reorganizar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#applyCostCenterToCategoriesAction", "src/server/finance-registry/actions.ts#moveSubcategoriesAction"],
        },
        {
          key: "financeiro.cadastros.categorias.mesclar",
          label: "Mesclar categorias (reatribui subcategorias e títulos)",
          verb: "mesclar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#mergeFinanceCategoriesAction"],
          sensitive: true,
        },
        {
          key: "financeiro.cadastros.importar",
          label: "Importar da configuração atual (centros e categorias)",
          verb: "importar",
          rule: { any: [{ role: ["admin", "diretoria", "financeiro"] }, { department: "financeiro" }] },
          guards: ["src/server/finance-registry/actions.ts#importFinanceRegistryAction"],
        },
      ],
      scope: null,
    },
    {
      key: "financeiro.configuracoes",
      module: "financeiro",
      label: "Configurações Financeiras",
      description: "Abas financeiras de /admin/configuracoes: gate financeiro, alertas, régua, canais de cobrança, integração bancária/baixa automática, contas a pagar e pagamento de comissões. A página /admin/configuracoes aceita quem tem ao menos uma aba autorizada e mostra só as abas permitidas.",
      routes: [],
      virtual: true,
      hostRoutes: ["/admin/configuracoes"],
      // Hoje: src/app/(app)/admin/configuracoes/page.tsx:25 requireRole('admin') (todas as abas,
      // admin-model.ts:70; settings-tabs.tsx:30-44).
      rule: { role: "admin" },
      nav: {
        // Não é item de NAVIGATION (a página é o item 'Configurações' de admin.configuracoes). navHref serve
        // só de lookup para canSeeHref (links/atalhos para as abas financeiras); NÃO gera item novo no menu,
        // para manter o menu idêntico no T0.
        menu: null,
        href: "/admin/configuracoes?aba=gate-financeiro",
      },
      sections: [
        {
          key: "financeiro.configuracoes.gate.ver",
          tab: "gate-financeiro",
          label: "Gate financeiro",
          // Onde: ?aba=gate-financeiro — SettingsFinanceGate (settings-tabs.tsx:101-103; SettingKey
          // gate_financeiro) · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "financeiro.configuracoes.alertas.ver",
          tab: "gate-financeiro",
          label: "Alertas do Financeiro",
          // Onde: ?aba=gate-financeiro — SettingsFinanceAlerts (settings-tabs.tsx:104; financeiro_alertas) ·
          // Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "financeiro.configuracoes.regua.ver",
          tab: "cobranca",
          label: "Régua de cobrança",
          // Onde: ?aba=cobranca — SettingsRegua (settings-tabs.tsx:109; regua_cobranca; prévia
          // previewBillingReminders page.tsx:28) · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "financeiro.configuracoes.canais.ver",
          tab: "cobranca",
          label: "Canais de cobrança",
          // Onde: ?aba=cobranca — SettingsCobrancaCanais (settings-tabs.tsx:110; cobranca_canais) · Hoje:
          // admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "financeiro.configuracoes.integracao-bancaria.ver",
          tab: "cobranca",
          label: "Integração bancária e baixa automática",
          // Onde: ?aba=cobranca — SettingsFinanceiroBaixa (settings-tabs.tsx:111; financeiro_baixa) + status
          // honesto do provedor (integrations/status.ts:205-228; billing-provider.ts: só manual) + conciliação
          // (automations/schemas.ts:105-110; finance/alerts.ts:48-90) · Hoje: admin/configuracoes/page.tsx:25;
          // status hoje só em /admin/integracoes (page.tsx:21 requireRole admin)
          rule: { role: "admin" },
        },
        {
          key: "financeiro.configuracoes.contas-a-pagar.ver",
          tab: "contas-a-pagar",
          label: "Contas a pagar (parâmetros)",
          // Onde: ?aba=contas-a-pagar — SettingsContasAPagar (settings-tabs.tsx:114-116; contas_a_pagar) ·
          // Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "financeiro.configuracoes.comissoes-pagamento.ver",
          label: "Pagamento de comissões",
          // Onde: SettingKey comissoes_pagamento: sem aba hoje em /admin/configuracoes; exibido/editado em
          // /financeiro/comissoes/regras (rules-workspace.tsx:225) pela chave
          // financeiro.comissoes.regras.configurar · Hoje: upsertSetting (admin/actions.ts:487-489
          // requireAdmin)
          rule: { role: "admin" },
        },
      ],
      actions: [
        {
          key: "financeiro.configuracoes.gate.editar",
          label: "Editar gate financeiro",
          verb: "editar",
          // Hoje: src/server/admin/actions.ts:487-489 upsertSetting → requireAdmin (:45-49)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=gate_financeiro"],
          sensitive: true,
        },
        {
          key: "financeiro.configuracoes.alertas.editar",
          label: "Editar alertas do Financeiro",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 → requireAdmin
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=financeiro_alertas"],
        },
        {
          key: "financeiro.configuracoes.regua.editar",
          label: "Editar régua de cobrança",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 → requireAdmin
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=regua_cobranca"],
        },
        {
          key: "financeiro.configuracoes.canais.editar",
          label: "Editar canais de cobrança",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 → requireAdmin
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=cobranca_canais"],
        },
        {
          key: "financeiro.configuracoes.integracao-bancaria.editar",
          label: "Alterar configurações bancárias / baixa automática",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 → requireAdmin · Sem provedor conectado não há credenciais
          // editáveis (variáveis de ambiente). Conciliação sob demanda hoje só por
          // admin.automacoes.executar-varredura.
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=financeiro_baixa"],
          sensitive: true,
        },
        {
          key: "financeiro.configuracoes.contas-a-pagar.editar",
          label: "Editar parâmetros de contas a pagar",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 → requireAdmin
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=contas_a_pagar"],
        },
        {
          key: "financeiro.configuracoes.comissoes-pagamento.editar",
          label: "Editar pagamento de comissões (via configurações)",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 → requireAdmin. Divergência: saveCommissionPaymentDayAction grava o
          // mesmo com isFinanceManager (financeiro.comissoes.regras.configurar).
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=comissoes_pagamento"],
        },
      ],
      scope: null,
    },
  ],
} as const satisfies ModuleDef;
