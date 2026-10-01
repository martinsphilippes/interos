/**
 * Catálogo de acessos — módulo Implantação (`implantacao.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const IMPLANTACAO = {
  key: "implantacao",
  label: "Implantação",
  // Hoje: MODULE_ACCESS.implantacao (constants.ts:63) + admin
  rule: { role: ["admin", "diretoria", "gestor", "implantacao", "suporte", "cs"] },
  deactivatable: true,
  screens: [
    {
      key: "implantacao.projetos",
      module: "implantacao",
      label: "Projetos de implantação",
      description: "Indicadores e lista de projetos (/implantacao) e página do projeto (/implantacao/[projectId]) com cabeçalho, dados da venda e abas Plano, Checklist, Treinamentos, Pendências, Documentos, Histórico e Go-live. ?projeto=<id> redireciona ao detalhe.",
      routes: ["/implantacao", "/implantacao/[projectId]"],
      // Hoje: implantacao/page.tsx:26-27 e [projectId]/page.tsx:31-32 (M implantacao) + notFound (l.35); sem
      // escopo no detalhe
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.implantacao (src/domain/constants.ts:151) filtrado por
        // canAccessModule(user,'implantacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "implantacao",
        href: "/implantacao",
        order: 1,
        label: "Projetos",
        icon: "Rocket",
        wave: 3,
      },
      sections: [
        {
          key: "implantacao.projetos.indicadores.ver",
          label: "Indicadores e gráficos",
          // Onde: implantacao/page.tsx:62-88 (getImplementationOverview, queries.ts:256-303) · Hoje: herda
          // page.tsx:26-27
          rule: "all",
        },
        {
          key: "implantacao.projetos.dados-da-venda.ver",
          label: "Dados da venda (resumo do contratado)",
          // Onde: [projectId]/page.tsx:68 (SaleDataCard → ContractSummaryCard; valores sob
          // financeiro.valores.ver; link do documento = canSeeHref(financeiro.contratos.documentos), hoje
          // canAccessModule(financeiro)) · Hoje: herda [projectId]/page.tsx:31-32
          rule: "all",
        },
        {
          key: "implantacao.projetos.plano.ver",
          label: "Aba Plano (fases e tarefas)",
          // Onde: [projectId]/page.tsx:73-78 (PlanTab) · Hoje: herda; edição por canOperateImplementation e
          // status não concluída/cancelada (l.38-40)
          rule: "all",
        },
        {
          key: "implantacao.projetos.checklist.ver",
          label: "Aba Checklist",
          // Onde: [projectId]/page.tsx:79-84 · Hoje: herda; edição por editable (l.40)
          rule: "all",
        },
        {
          key: "implantacao.projetos.treinamentos.ver",
          label: "Aba Treinamentos (ações = implantacao.treinamentos.*)",
          // Onde: [projectId]/page.tsx:85-100 · Hoje: herda; botões por canOperate
          rule: "all",
        },
        {
          key: "implantacao.projetos.pendencias.ver",
          label: "Aba Pendências (aguardando cliente e bloqueio interno)",
          // Onde: [projectId]/page.tsx:101-119 · Hoje: herda; edição por editable
          rule: "all",
        },
        {
          key: "implantacao.projetos.documentos.ver",
          label: "Aba Documentos",
          // Onde: [projectId]/page.tsx:120-125 · Hoje: herda; anexar por canOperate (l.124)
          rule: "all",
        },
        {
          key: "implantacao.projetos.historico.ver",
          label: "Aba Histórico (timeline do cliente + chamados pós-go-live)",
          // Onde: [projectId]/page.tsx:126-130 (queries.ts:374-376, getPostGoLiveTickets l.400-408) · Hoje:
          // herda
          rule: "all",
        },
        {
          key: "implantacao.projetos.go-live.ver",
          label: "Aba Go-live (ações = implantacao.go-live.*)",
          // Onde: [projectId]/page.tsx:131-151 (GoLivePanel; canApprove l.145) · Hoje: herda
          rule: "all",
        },
        {
          key: "implantacao.projetos.sugestoes.ver",
          label: "Sugestões do assistente de implantação",
          // Onde: [projectId]/page.tsx:69 (AgentSuggestions kind=implantacao, só se !readOnly) · Hoje:
          // getAgentSuggestions: canAccessModule(user,'implantacao') (automations/actions.ts:224,236)
          rule: "all",
          viewGuards: [
            {
              // Hoje: automations/actions.ts:236 (módulo implantacao)
              guard: "src/server/automations/actions.ts#getAgentSuggestions?kind=implantacao",
              label: "Gerar sugestões do assistente de implantação",
            },
          ],
        },
      ],
      actions: [
        {
          key: "implantacao.projetos.atribuir",
          label: "Alterar responsável e equipe do projeto",
          verb: "atribuir",
          // Hoje: implementation/actions.ts:158-160 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#updateTeam"],
        },
        {
          key: "implantacao.projetos.plano.criar",
          label: "Adicionar tarefa ao plano",
          verb: "criar",
          // Hoje: implementation/actions.ts:142-144 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#addProjectTask"],
        },
        {
          key: "implantacao.projetos.plano.concluir",
          label: "Concluir tarefa do plano (com evidência)",
          verb: "concluir",
          // Hoje: implementation/actions.ts:105-107 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#completeProjectTask"],
        },
        {
          key: "implantacao.projetos.plano.reabrir",
          label: "Reabrir tarefa concluída",
          verb: "reabrir",
          // Hoje: implementation/actions.ts:118-120 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#reopenProjectTask"],
        },
        {
          key: "implantacao.projetos.plano.atribuir",
          label: "Atribuir responsável da tarefa",
          verb: "atribuir",
          // Hoje: implementation/actions.ts:130-132 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#assignProjectTask"],
        },
        {
          key: "implantacao.projetos.checklist.criar",
          label: "Adicionar item ao checklist do projeto",
          verb: "criar",
          // Hoje: implementation/actions.ts:182-184 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#addProjectChecklistItem"],
        },
        {
          key: "implantacao.projetos.checklist.concluir",
          label: "Marcar/desmarcar item do checklist",
          verb: "concluir",
          // Hoje: implementation/actions.ts:170-172 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#toggleProjectChecklist"],
        },
        {
          key: "implantacao.projetos.pendencias.criar",
          label: "Registrar pendência do cliente ou bloqueio interno",
          verb: "criar",
          // Hoje: implementation/actions.ts:250-252, 274-276 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: [
            "src/server/implementation/actions.ts#registerWaitingClient",
            "src/server/implementation/actions.ts#registerBlock",
          ],
        },
        {
          key: "implantacao.projetos.pendencias.concluir",
          label: "Retomar projeto ou resolver bloqueio",
          verb: "concluir",
          // Hoje: implementation/actions.ts:262-264, 286-288 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49) ·
          // resumeWaitingProject também é chamada pelo kanban.
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: [
            "src/server/implementation/actions.ts#resumeWaitingProject",
            "src/server/implementation/actions.ts#resolveBlock",
          ],
        },
        {
          key: "implantacao.projetos.documentos.anexar",
          label: "Anexar documento ao projeto",
          verb: "anexar",
          // Hoje: implementation/actions.ts:194-196 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#addDocument"],
        },
      ],
      scope: {
        entity: "implementationProjects",
        ownerFields: ["ownerId", "teamIds"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: resolveScope (src/server/implementation/queries.ts:122-132) + inScope (l.134-138: ownerId OU
        // teamIds). Máximo HOJE = empresa para todos ('todos' aceito de qualquer usuário via ?escopo, l.131).
        // Visão inicial: gestor não diretor do departamento implantacao → 'equipe' (ele + liderados diretos, 1
        // nível, l.128); demais → 'todos' (l.124). 'equipe' para diretoria/admin = departamento implantacao
        // inteiro. 'meus' = ownerId ou teamIds.
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
        initialView: { when: { all: [{ role: "gestor" }, { department: "implantacao" }] }, view: "equipe", otherwise: "empresa" },
        variants: {
          equipe: { reportLevels: 1, includeSelf: true, description: "Você e seus liderados diretos" },
          departamento: {
            fixedDepartment: "implantacao",
            departmentBy: "people",
            description: "Todo o departamento de Implantação",
          },
        },
        applyAt: [
          "src/server/implementation/queries.ts#resolveScopeWithLimit (o ?escopo da URL nunca mais amplo que o efetivo)",
          "src/server/implementation/queries.ts#visibleProjects",
          "src/server/implementation/queries.ts#listProjects",
          "src/server/implementation/queries.ts#getImplementationOverview",
          "src/server/implementation/queries.ts#getProject",
          "src/server/implementation/queries.ts#getPostGoLiveTickets",
          "src/server/implementation/queries.ts#listFilterOptions",
          "src/server/implementation/access.ts#assertProjectAccess",
          "src/server/implementation/access.ts#assertTaskAccess",
          "src/server/implementation/access.ts#assertTrainingAccess",
          "src/server/implementation/access.ts#canSeeProject (página do projeto, antes de montar o detalhe)",
          "src/server/implementation/queries.ts#getClientImplementation (Cliente 360)",
          "src/app/(app)/implantacao/page.tsx (redirect ?projeto=)",
        ],
      },
    },
    {
      key: "implantacao.kanban",
      module: "implantacao",
      label: "Kanban de implantação",
      description: "Projetos ativos do escopo por fase; arrastar o card muda a fase (só com tarefas obrigatórias da fase concluídas).",
      routes: ["/implantacao/kanban"],
      // Hoje: implantacao/kanban/page.tsx:19-20 (M implantacao); movimentação por canOperateImplementation
      // (l.27, 49)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.implantacao (src/domain/constants.ts:152) filtrado por
        // canAccessModule(user,'implantacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "implantacao",
        href: "/implantacao/kanban",
        order: 2,
        label: "Kanban",
        icon: "Kanban",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "implantacao.kanban.editar",
          label: "Mudar a fase do projeto (arrastar card)",
          verb: "editar",
          // Hoje: implementation/actions.ts:93-95 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49); regra de
          // negócio em service.ts:519
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#changeProjectPhase"],
        },
      ],
      scope: {
        entity: "implementationProjects (ativos)",
        ownerFields: ["ownerId", "teamIds"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: listKanbanProjects (implementation/queries.ts:306-311) com o mesmo resolveScope/inScope.
        // resolveScope (src/server/implementation/queries.ts:122-132) + inScope (l.134-138: ownerId OU
        // teamIds). Máximo HOJE = empresa para todos ('todos' aceito de qualquer usuário via ?escopo, l.131).
        // Visão inicial: gestor não diretor do departamento implantacao → 'equipe' (ele + liderados diretos, 1
        // nível, l.128); demais → 'todos' (l.124). 'equipe' para diretoria/admin = departamento implantacao
        // inteiro. 'meus' = ownerId ou teamIds.
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
        sameAs: "implantacao.projetos",
        applyAt: [
          "src/server/implementation/queries.ts#listKanbanProjects",
          "src/server/implementation/access.ts#assertProjectAccess",
        ],
      },
    },
    {
      key: "implantacao.checklists",
      module: "implantacao",
      label: "Checklists (templates por produto)",
      description: "Templates de fases, tarefas e checklist por produto, combinados na criação do projeto quando o Financeiro libera o contrato.",
      routes: ["/implantacao/checklists"],
      // Hoje: implantacao/checklists/page.tsx:15-16 (M implantacao); edição por canOperateImplementation
      // (l.34)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.implantacao (src/domain/constants.ts:153) filtrado por
        // canAccessModule(user,'implantacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "implantacao",
        href: "/implantacao/checklists",
        order: 3,
        label: "Checklists",
        icon: "ListChecks",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "implantacao.checklists.criar",
          label: "Criar template de implantação",
          verb: "criar",
          // Hoje: implementation/actions.ts:358-360 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#saveImplementationTemplate?sem id"],
          sensitive: true,
        },
        {
          key: "implantacao.checklists.editar",
          label: "Editar template de implantação",
          verb: "editar",
          // Hoje: implementation/actions.ts:358-360 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49) · Afeta
          // todos os projetos futuros.
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#saveImplementationTemplate?com id"],
          sensitive: true,
        },
        {
          key: "implantacao.checklists.ativar",
          label: "Ativar/desativar template",
          verb: "ativar",
          // Hoje: implementation/actions.ts:371-373 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49) ·
          // setTemplateActive não registra ator (sem auditoria).
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#toggleImplementationTemplate"],
        },
      ],
      scope: null,
    },
    {
      key: "implantacao.treinamentos",
      module: "implantacao",
      label: "Treinamentos",
      description: "Agenda e registro de treinamentos de todos os projetos (go-live exige ao menos um realizado). As mesmas ações aparecem na aba Treinamentos do projeto.",
      routes: ["/implantacao/treinamentos"],
      // Hoje: implantacao/treinamentos/page.tsx:17-18 (M implantacao); ações por canOperateImplementation
      // (l.20, 47)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.implantacao (src/domain/constants.ts:154) filtrado por
        // canAccessModule(user,'implantacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "implantacao",
        href: "/implantacao/treinamentos",
        order: 4,
        label: "Treinamentos",
        icon: "GraduationCap",
        wave: 3,
      },
      sections: [],
      actions: [
        {
          key: "implantacao.treinamentos.criar",
          label: "Agendar treinamento",
          verb: "criar",
          // Hoje: implementation/actions.ts:210-212 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#createTraining"],
        },
        {
          key: "implantacao.treinamentos.concluir",
          label: "Registrar treinamento realizado (presença e evidência)",
          verb: "concluir",
          // Hoje: implementation/actions.ts:222-224 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#markTrainingDone"],
        },
        {
          key: "implantacao.treinamentos.cancelar",
          label: "Cancelar treinamento agendado",
          verb: "cancelar",
          // Hoje: implementation/actions.ts:234-236 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#cancelProjectTraining"],
        },
      ],
      scope: {
        entity: "trainings",
        ownerFields: ["instructorId", "project.ownerId", "project.teamIds"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: Sem escopo hoje: listTrainings() (implementation/queries.ts:467-504) não recebe o usuário =
        // empresa para todos.
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
        sameAs: "implantacao.projetos",
        applyAt: [
          "src/server/implementation/queries.ts#listTrainings",
          "src/server/implementation/actions.ts#createTraining (assertProjectAccess com a tela implantacao.treinamentos)",
          "src/server/implementation/access.ts#assertTrainingAccess (instrutor OU donos do projeto)",
        ],
      },
    },
    {
      key: "implantacao.go-live",
      module: "implantacao",
      label: "Go-live",
      description: "Projetos prontos/quase prontos com o gate avaliado, aprovação (ativa o cliente e faz handoff ao CS), go-lives recentes e a regra 'exige aprovação do gestor'. Validação/aceite/aprovação também na aba Go-live do projeto.",
      routes: ["/implantacao/go-live"],
      // Hoje: implantacao/go-live/page.tsx:23-24 (M implantacao); aprovar por canOperate && gate.ok &&
      // canApprove (go-live-candidates.tsx:51; queries.ts:442)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.implantacao (src/domain/constants.ts:155) filtrado por
        // canAccessModule(user,'implantacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "implantacao",
        href: "/implantacao/go-live",
        order: 5,
        label: "Go-live",
        icon: "Flag",
        wave: 3,
      },
      sections: [
        {
          key: "implantacao.go-live.configuracao.ver",
          label: "Regra de aprovação do go-live (exige gestor)",
          // Onde: go-live/page.tsx:42 (GoLiveSettingsSwitch visível a todos, desabilitado sem canEdit =
          // isManager) · Hoje: herda go-live/page.tsx:23-24
          rule: "all",
        },
      ],
      actions: [
        {
          key: "implantacao.go-live.validar",
          label: "Registrar validação interna do go-live",
          verb: "validar",
          // Hoje: implementation/actions.ts:302-304 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#saveValidation"],
        },
        {
          key: "implantacao.go-live.registrar-aceite",
          label: "Registrar aceite do cliente",
          verb: "registrar-aceite",
          // Hoje: implementation/actions.ts:314-316 requireOperator (implementation/actions.ts:74-79:
          // canAccessModule l.76 + canOperateImplementation l.77 = implementation/schemas.ts:47-49)
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#saveAcceptance"],
        },
        {
          key: "implantacao.go-live.aprovar",
          label: "Aprovar go-live (ativa o cliente e faz handoff ao CS)",
          verb: "aprovar",
          // Hoje: requireOperator (src/server/implementation/actions.ts:326-328 → :74-79:
          // canAccessModule(implantacao) l.76 + canOperateImplementation l.77 =
          // src/server/implementation/schemas.ts:47-49) E canApproveGoLive
          // (src/server/implementation/service.ts:178-181 = isManager || (!settings.exigeAprovacaoGestor &&
          // project.ownerId === actor.id); checado em approveGoLive service.ts:1138-1139). Cópias do
          // predicado: implementation/queries.ts:442 (cards) e implantacao/[projectId]/page.tsx:145. · Padrão
          // = regra do OPERADOR (a mesma de validar e registrar-aceite) porque esta chave é a guarda de borda
          // (requirePermission em approveProjectGoLive, A15); a recordCondition reproduz canApproveGoLive. Com
          // {manager:true} aqui o responsável não-gestor perderia a aprovação que a configuração go_live
          // (exigeAprovacaoGestor=false) lhe dá — regressão. Efetivo = implantacao.acessar ∧ esta regra ∧
          // (aprovar-qualquer ∨ (config permite ∧ dono)) ≡ requireOperator ∧ canApproveGoLive.
          // canApproveGoLive vira helper único com can(user,'implantacao.go-live.aprovar-qualquer') no lugar
          // de actor.isManager, usado em service.ts:1138, queries.ts:442 e [projectId]/page.tsx:145 (a UI deve
          // checar também esta chave). O gate de negócio (service.ts:1142) continua.
          rule: { any: [{ manager: true }, { role: "implantacao" }, { department: "implantacao" }] },
          guards: ["src/server/implementation/actions.ts#approveProjectGoLive"],
          recordCondition: "can('implantacao.go-live.aprovar-qualquer') OU (!settings.go_live.exigeAprovacaoGestor ∧ project.ownerId === user.id)",
          sensitive: true,
        },
        {
          key: "implantacao.go-live.aprovar-qualquer",
          label: "Aprovar go-live de qualquer projeto (sem ser o responsável, ou quando a regra exige gestor)",
          verb: "aprovar",
          // Hoje: actor.isManager em canApproveGoLive (src/server/implementation/service.ts:179); cópias em
          // implementation/queries.ts:442 e implantacao/[projectId]/page.tsx:145 · Sem função própria. Negar
          // esta chave a um gestor faz o go-live dele depender da configuração (só como responsável e com
          // exigeAprovacaoGestor=false).
          rule: { manager: true },
          guards: [],
          checkedIn: [
            "src/server/implementation/actions.ts#approveProjectGoLive?settings.go_live.exigeAprovacaoGestor || project.ownerId !== user.id",
          ],
          sensitive: true,
        },
        {
          key: "implantacao.go-live.configurar",
          label: "Alterar a regra 'go-live exige aprovação do gestor'",
          verb: "configurar",
          // Hoje: implementation/actions.ts:341-344: só requireUser + user.isManager (sem módulo); grava
          // settings.go_live sem auditoria (service.ts:171-175) · A14: passa a exigir implantacao.acessar (sem
          // efeito no padrão: gestor/diretoria/admin têm o módulo). Writer paralelo de go_live (também
          // admin.configuracoes.entrega.editar).
          rule: { manager: true },
          guards: ["src/server/implementation/actions.ts#updateGoLiveSettings"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "implementationProjects (candidatos e concluídos em 30 dias)",
        ownerFields: ["ownerId", "teamIds"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: listGoLiveCandidates (implementation/queries.ts:420-456) com resolveScope/inScope.
        // resolveScope (src/server/implementation/queries.ts:122-132) + inScope (l.134-138: ownerId OU
        // teamIds). Máximo HOJE = empresa para todos ('todos' aceito de qualquer usuário via ?escopo, l.131).
        // Visão inicial: gestor não diretor do departamento implantacao → 'equipe' (ele + liderados diretos, 1
        // nível, l.128); demais → 'todos' (l.124). 'equipe' para diretoria/admin = departamento implantacao
        // inteiro. 'meus' = ownerId ou teamIds.
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
        sameAs: "implantacao.projetos",
        applyAt: [
          "src/server/implementation/queries.ts#listGoLiveCandidates",
          "src/server/implementation/access.ts#assertProjectAccess",
        ],
      },
    },
  ],
} as const satisfies ModuleDef;
