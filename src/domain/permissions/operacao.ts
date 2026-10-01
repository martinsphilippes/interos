/**
 * Catálogo de acessos — módulo Operação (`operacao.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const OPERACAO = {
  key: "operacao",
  label: "Operação",
  // Hoje: MODULE_ACCESS.operacao = "all" (constants.ts:59)
  rule: "all",
  deactivatable: true,
  screens: [
    {
      key: "operacao.tarefas",
      module: "operacao",
      label: "Tarefas",
      description: "Central de Tarefas: views minha/equipe/kanban/calendário/atrasadas/concluídas, drawer de detalhe (?tarefa=<id>) e criação (?novo=1).",
      routes: ["/tarefas"],
      // Hoje: requireUser() (src/app/(app)/tarefas/page.tsx:31); módulo operacao = "all" (constants.ts:59)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.operacao (src/domain/constants.ts:104) filtrado por
        // canAccessModule(user,'operacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "operacao",
        href: "/tarefas",
        order: 1,
        label: "Tarefas",
        icon: "CheckSquare",
        wave: 1,
        // Hoje: MOBILE_NAV (src/domain/constants.ts:223) sem filtro hoje (mobile-nav.tsx:42-44); derivado de
        // can(tela.ver), equivalente porque a regra efetiva é 'todos'
        mobile: 2,
        mobileLabel: "Tarefas",
        mobileIcon: "CheckSquare",
        quickAction: {
          key: "tarefa",
          label: "Nova tarefa",
          description: "Crie e atribua uma tarefa",
          href: "/tarefas?novo=1",
          icon: "CheckSquare",
          order: 1,
          via: "operacao.tarefas.criar",
          rule: "all",
        },
      },
      sections: [
        {
          key: "operacao.tarefas.detalhe.ver",
          label: "Detalhe da tarefa (drawer)",
          // Onde: ?tarefa=<id> → getTaskDetail (tarefas/page.tsx:42) + TaskDrawer (l.62) · Hoje: requireUser;
          // getTaskDetail(id) sem escopo (src/server/tasks/queries.ts:188-206); link do processo só isAdmin
          // (queries.ts:205)
          rule: "all",
        },
      ],
      actions: [
        {
          key: "operacao.tarefas.criar",
          label: "Criar tarefa",
          verb: "criar",
          // Hoje: requireUser (src/server/tasks/actions.ts:72, fora do try) · Também a ação rápida 'Nova
          // tarefa' (constants.ts:244) e o atalho da busca (global-search.tsx:49).
          rule: "all",
          guards: ["src/server/tasks/actions.ts#createTask"],
        },
        {
          key: "operacao.tarefas.editar",
          label: "Editar tarefa, status intermediário, checklist e ordem do kanban",
          verb: "editar",
          // Hoje: requireUser (tasks/actions.ts:93, 185, 296, 313, 328, 366); sem checagem de dono (loadTask
          // l.63-67) · changeTaskStatus é despacho por argumento: concluida→concluir, cancelada→cancelar,
          // reabertura→reabrir (tasks/service.ts:247-253), senão vira bypass. reorderTask não usa o ator.
          rule: "all",
          guards: [
            "src/server/tasks/actions.ts#updateTask",
            "src/server/tasks/actions.ts#toggleChecklistItem",
            "src/server/tasks/actions.ts#addChecklistItem",
            "src/server/tasks/actions.ts#removeChecklistItem",
            "src/server/tasks/actions.ts#reorderTask",
            "src/server/tasks/actions.ts#changeTaskStatus?status=aberta|em_andamento|aguardando",
          ],
        },
        {
          key: "operacao.tarefas.concluir",
          label: "Concluir tarefa (inclusive pelo Meu Dia)",
          verb: "concluir",
          // Hoje: requireUser (tasks/actions.ts:198; meu-dia/actions.ts:24); completeTaskQuick conclui
          // qualquer tarefa por id (meu-dia/actions.ts:27-33)
          rule: "all",
          guards: [
            "src/server/tasks/actions.ts#completeTask",
            "src/server/meu-dia/actions.ts#completeTaskQuick",
            "src/server/tasks/actions.ts#changeTaskStatus?status=concluida",
          ],
        },
        {
          key: "operacao.tarefas.reabrir",
          label: "Reabrir tarefa",
          verb: "reabrir",
          // Hoje: requireUser (tasks/actions.ts:211)
          rule: "all",
          guards: [
            "src/server/tasks/actions.ts#reopenTask",
            "src/server/tasks/actions.ts#changeTaskStatus?reabertura (de concluida/cancelada)",
          ],
        },
        {
          key: "operacao.tarefas.cancelar",
          label: "Cancelar tarefa",
          verb: "cancelar",
          // Hoje: requireUser (tasks/actions.ts:225)
          rule: "all",
          guards: [
            "src/server/tasks/actions.ts#cancelTask",
            "src/server/tasks/actions.ts#changeTaskStatus?status=cancelada",
          ],
        },
        {
          key: "operacao.tarefas.excluir",
          label: "Excluir tarefa que eu criei",
          verb: "excluir",
          // Hoje: requireUser + (!isManager && creatorId !== user.id) → erro
          // (src/server/tasks/actions.ts:244); botão canDelete = isManager || criador (tarefas/page.tsx:45)
          rule: "all",
          guards: ["src/server/tasks/actions.ts#deleteTask"],
          recordCondition: "task.creatorId === user.id OU can('operacao.tarefas.excluir-qualquer')",
          sensitive: true,
        },
        {
          key: "operacao.tarefas.excluir-qualquer",
          label: "Excluir tarefas criadas por outras pessoas",
          verb: "excluir",
          // Hoje: user.isManager em src/server/tasks/actions.ts:244 e tarefas/page.tsx:45
          rule: { manager: true },
          guards: [],
          checkedIn: ["src/server/tasks/actions.ts#deleteTask?task.creatorId!==user.id"],
          sensitive: true,
        },
        {
          key: "operacao.tarefas.atribuir",
          label: "Atribuir / trocar responsável",
          verb: "atribuir",
          // Hoje: requireUser (tasks/actions.ts:263)
          rule: "all",
          guards: ["src/server/tasks/actions.ts#assignTask"],
          checkedIn: ["src/server/tasks/actions.ts#updateTask?patch.assigneeId mudou (assignTaskInternal, actions.ts:156-163)"],
        },
        {
          key: "operacao.tarefas.comentar",
          label: "Comentar na tarefa",
          verb: "comentar",
          // Hoje: requireUser (tasks/actions.ts:352)
          rule: "all",
          guards: ["src/server/tasks/actions.ts#addComment"],
        },
        {
          key: "operacao.tarefas.responder-processo",
          label: "Concluir/responder etapa de processo",
          verb: "responder",
          // Hoje: requireUser + (isManager || task.assigneeId === user.id)
          // (process-engine/actions.ts:205-211); canActOnRun = isManager || pending[nodeId].assigneeId ===
          // user.id (l.192-198, usado em 221-223 e 235-237) · Fica em Tarefas (e não em admin.workflows)
          // porque o responsável não-admin conclui a etapa pelo drawer de /tarefas
          // (task-drawer.tsx:381,407,414); sob admin.* a cadeia E negaria.
          rule: "all",
          guards: [
            "src/server/process-engine/actions.ts#completeProcessTask",
            "src/server/process-engine/actions.ts#answerProcessOutcomeAction",
            "src/server/process-engine/actions.ts#completeProcessNodeAction",
          ],
          recordCondition: "user.isManager OU responsável pela etapa (permanece no código após requirePermission)",
        },
      ],
      scope: {
        entity: "tasks",
        ownerFields: ["assigneeId", "departmentId", "creatorId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: View 'minha': assigneeId === self para todos (src/server/tasks/queries.ts:125). Demais views:
        // isManager (gestor/diretoria/admin) = organização inteira (queries.ts:126); demais papéis =
        // departmentId === user.departmentId ∪ assigneeId === self (queries.ts:127-133). countTaskSummary só
        // próprias (l.236). Detalhe por id (getTaskDetail l.188), listTasksByClient (l.269),
        // listTasksByProcess (l.263) e todas as mutações NÃO aplicam escopo (= empresa).
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "departamento",
          vendas: "departamento",
          financeiro: "departamento",
          implantacao: "departamento",
          cs: "departamento",
          suporte: "departamento",
          colaborador: "departamento",
        },
        variants: {
          departamento: {
            ownDepartment: true,
            departmentBy: "record",
            includeSelf: true,
            description: "Seu departamento e o que está com você",
          },
        },
        // 'departamento' aqui inclui as próprias (assigneeId). Para detalhe/ações sugerido: visível = escopo
        // da lista ∪ vínculo (assignee/creator) ∪ tarefa ligada a cliente/etapa visível; padrão equivalente =
        // empresa no detalhe até decisão (links vindos do Cliente 360 e do Workflow).
        applyAt: [
          "src/server/tasks/queries.ts#listTasksForUser",
          "src/server/tasks/queries.ts#getTaskDetail",
          "src/server/tasks/queries.ts#listTasksByClient",
          "src/server/tasks/queries.ts#listTasksByProcess",
          "src/server/tasks/actions.ts#loadTask",
          "src/server/meu-dia/actions.ts#completeTaskQuick",
          "src/server/search/queries.ts#searchGlobalQuery (tipo tarefa)",
        ],
      },
    },
    {
      key: "operacao.clientes",
      module: "operacao",
      label: "Clientes 360º",
      description: "Base de clientes (lista com indicadores), cadastro de novo cliente e Ficha 360º com abas por área (?aba=).",
      routes: ["/clientes", "/clientes/[id]", "/clientes/novo"],
      // Hoje: requireUser() em clientes/page.tsx:21, clientes/[id]/page.tsx:39 (+ notFound l.42),
      // clientes/novo/page.tsx:11. /clientes/novo passa a exigir também operacao.clientes.criar.
      rule: "all",
      viewGuards: [
        {
          // Hoje: requireUser dentro do try (src/server/clients/actions.ts:96) Leitura chamada pelo cliente
          // (client-form.tsx). Devolve dados de clientes fora do escopo → com escopo < empresa devolver só o
          // mínimo.
          guard: "src/server/clients/actions.ts#findDuplicates",
          label: "Consultar clientes (checagem de duplicidade no formulário)",
        },
      ],
      nav: {
        // Hoje: NAVIGATION.operacao (src/domain/constants.ts:106) filtrado por
        // canAccessModule(user,'operacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "operacao",
        href: "/clientes",
        order: 3,
        label: "Clientes 360º",
        icon: "Building2",
        wave: 1,
        // Hoje: MOBILE_NAV (src/domain/constants.ts:224) sem filtro hoje (mobile-nav.tsx:42-44); derivado de
        // can(tela.ver), equivalente porque a regra efetiva é 'todos'
        mobile: 3,
        mobileLabel: "Clientes",
        mobileIcon: "Users",
        quickAction: {
          key: "cliente",
          label: "Novo cliente",
          description: "Cadastre uma empresa",
          href: "/clientes/novo",
          icon: "Building2",
          order: 6,
          via: "operacao.clientes.criar",
          rule: "all",
        },
      },
      sections: [
        {
          key: "operacao.clientes.visao.ver",
          label: "Visão geral",
          // Onde: Aba padrão — TabVisao (clientes/[id]/page.tsx:64) · Hoje: nenhuma: CLIENT_TABS fixas
          // (components/clients/client-tabs.tsx:8-19)
          rule: "all",
        },
        {
          key: "operacao.clientes.contatos.ver",
          label: "Contatos do cliente",
          // Onde: ContactsCard na Visão geral (tab-visao.tsx → contacts-card.tsx) · Hoje: nenhuma além de
          // requireUser
          rule: "all",
        },
        {
          key: "operacao.clientes.produtos.ver",
          tab: "produtos",
          label: "Produtos contratados",
          // Onde: ?aba=produtos — TabProdutos (page.tsx:67) · Hoje: nenhuma
          rule: "all",
        },
        {
          key: "operacao.clientes.financeiro.ver",
          tab: "financeiro",
          label: "Financeiro do cliente (contratos e cobranças)",
          // Onde: ?aba=financeiro — TabFinanceiro (page.tsx:68); valores sob financeiro.valores.ver (A13);
          // links para /financeiro/contratos/[id] por canSeeHref · Hoje: nenhuma: a aba renderiza até para
          // quem não acessa o módulo financeiro (auditoria §1.5)
          rule: "all",
        },
        {
          key: "operacao.clientes.suporte.ver",
          tab: "suporte",
          label: "Atendimentos",
          // Onde: ?aba=suporte — TabSuporte (page.tsx:83) · Hoje: aba sem guarda; botão 'Novo atendimento' só
          // se canAccessModule(user,'suporte') (clientes/[id]/page.tsx:47-49, 83, 90) → passa a
          // can('suporte.chamados.criar')
          rule: "all",
        },
        {
          key: "operacao.clientes.tarefas.ver",
          tab: "tarefas",
          label: "Tarefas do cliente",
          // Onde: ?aba=tarefas — TabTarefas (page.tsx:85); listTasksByClient · Hoje: nenhuma
          rule: "all",
        },
        {
          key: "operacao.clientes.timeline.ver",
          tab: "timeline",
          label: "Histórico",
          // Onde: ?aba=timeline — TabTimeline (page.tsx:65) · Hoje: nenhuma
          rule: "all",
        },
        {
          key: "operacao.clientes.documentos.ver",
          tab: "documentos",
          label: "Documentos",
          // Onde: ?aba=documentos — TabDocumentos (page.tsx:84) · Hoje: nenhuma
          rule: "all",
        },
        {
          key: "operacao.clientes.comercial.ver",
          tab: "comercial",
          label: "Comercial (oportunidades e propostas do cliente)",
          // Onde: ?aba=comercial — TabComercial (page.tsx:66) · Hoje: nenhuma; mostra todas as oportunidades
          // do cliente sem canSeeOpportunity (decidir se aplica o escopo de vendas.oportunidades)
          rule: "all",
        },
        {
          key: "operacao.clientes.implantacao.ver",
          tab: "implantacao",
          label: "Implantação",
          // Onde: ?aba=implantacao — TabImplantacao (page.tsx:69); getClientImplementation · Hoje: nenhuma
          rule: "all",
        },
        {
          key: "operacao.clientes.cs.ver",
          tab: "cs",
          label: "CS (saúde, planos, painel de CS)",
          // Onde: ?aba=cs — TabCs + ClientCsPanel (page.tsx:70-82); sugestões de CS só com
          // cs.carteira.sugestoes.ver (hoje canAccessModule cs, page.tsx:76) · Hoje: aba sem guarda; ações do
          // painel negadas pelas actions de CS (requireCsUser)
          rule: "all",
        },
      ],
      actions: [
        {
          key: "operacao.clientes.criar",
          label: "Cadastrar cliente",
          verb: "criar",
          // Hoje: requireUser (clients/actions.ts:126); inicia a jornada de workflow (l.161-167) · Protege
          // /clientes/novo, a ação rápida 'Novo cliente' (constants.ts:257) e o atalho da busca
          // (global-search.tsx:50).
          rule: "all",
          guards: ["src/server/clients/actions.ts#createClient"],
        },
        {
          key: "operacao.clientes.editar",
          label: "Editar dados do cliente (inclui responsáveis)",
          verb: "editar",
          // Hoje: requireUser (clients/actions.ts:193)
          rule: "all",
          guards: ["src/server/clients/actions.ts#updateClient"],
        },
        {
          key: "operacao.clientes.alterar-status",
          label: "Alterar status do cliente (ativar, inativar, cancelar)",
          verb: "alterar-status",
          // Hoje: requireUser (clients/actions.ts:244)
          rule: "all",
          guards: ["src/server/clients/actions.ts#changeClientStatus"],
          sensitive: true,
        },
        {
          key: "operacao.clientes.contatos.editar",
          label: "Adicionar e editar contatos",
          verb: "editar",
          // Hoje: requireUser (clients/actions.ts:282, 316)
          rule: "all",
          guards: ["src/server/clients/actions.ts#addContact", "src/server/clients/actions.ts#updateContact"],
        },
        {
          key: "operacao.clientes.contatos.excluir",
          label: "Remover contato",
          verb: "excluir",
          // Hoje: requireUser (clients/actions.ts:348)
          rule: "all",
          guards: ["src/server/clients/actions.ts#removeContact"],
        },
        {
          key: "operacao.clientes.registrar",
          label: "Registrar nota, ligação ou WhatsApp com o cliente",
          verb: "registrar",
          // Hoje: requireUser (clients/actions.ts:375, 434) · registerContactEvent também é usada pela
          // carteira de CS (components/cs/portfolio-view.tsx).
          rule: "all",
          guards: ["src/server/clients/actions.ts#addNote", "src/server/clients/actions.ts#registerContactEvent"],
        },
        {
          key: "operacao.clientes.documentos.anexar",
          label: "Anexar documento",
          verb: "anexar",
          // Hoje: requireUser (clients/actions.ts:396)
          rule: "all",
          guards: ["src/server/clients/actions.ts#addDocument"],
        },
        {
          key: "operacao.clientes.criar-oportunidade",
          label: "Abrir oportunidade de upsell/cross-sell a partir da ficha",
          verb: "criar-oportunidade",
          // Hoje: requireUser (clients/actions.ts:481) — cria Opportunity (l.498) sem exigir o módulo vendas ·
          // Recomendação (não padrão): AND com vendas.oportunidades.criar.
          rule: "all",
          guards: ["src/server/clients/actions.ts#createUpsellOpportunity"],
          sensitive: true,
        },
      ],
      scope: {
        entity: "clients",
        ownerFields: ["ownerSalesId", "ownerCsId", "ownerImplementationId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: EMPRESA para todos os papéis: listClients carrega a coleção inteira
        // (src/server/clients/queries.ts:194-204); getClient360(id) sem viewer (l.471); getClient(id) (l.103);
        // listClientsForSelect (tasks/queries.ts:219-221) e busca global sem recorte.
        // listClientsNeedingAttention (clients/queries.ts:334-346) tem regra por dono mas não tem chamadores.
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
        applyAt: [
          "src/server/clients/queries.ts#listClients",
          "src/server/clients/queries.ts#getClient360",
          "src/server/clients/queries.ts#getClient",
          "src/server/clients/queries.ts#searchClients",
          "src/server/clients/actions.ts#loadClient",
          "src/server/clients/actions.ts#findDuplicates",
          "src/server/tasks/queries.ts#listClientsForSelect",
          "src/server/workflow/queries.ts#getInstanceView",
          "src/server/search/queries.ts#searchGlobalQuery (tipos cliente/contato)",
        ],
      },
    },
    {
      key: "operacao.workflow",
      module: "operacao",
      label: "Workflow",
      description: "Quadro das jornadas ativas, drawer da etapa (?etapa=) com Gate/Tarefas/Histórico/Ações e página da jornada completa.",
      routes: ["/workflow", "/workflow/[instanceId]"],
      // Hoje: requireUser() em workflow/page.tsx:24 e workflow/[instanceId]/page.tsx:38 (+ notFound l.41)
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.operacao (src/domain/constants.ts:105) filtrado por
        // canAccessModule(user,'operacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "operacao",
        href: "/workflow",
        order: 2,
        label: "Workflow",
        icon: "GitBranch",
        wave: 1,
      },
      sections: [
        {
          key: "operacao.workflow.quadro.ver",
          label: "Quadro de jornadas",
          // Onde: WorkflowBoard + StatCards (workflow/page.tsx:35-43); getWorkflowBoard
          // (workflow/queries.ts:110-125) · Hoje: requireUser; board inteiro
          rule: "all",
        },
        {
          key: "operacao.workflow.etapa.ver",
          label: "Detalhe da etapa (gate, tarefas, histórico, ações)",
          // Onde: StepDrawer (?etapa=) e InstanceStepPanel; abas em
          // components/workflow/step-detail.tsx:116-125 · Hoje: requireUser; getStepDetail sem escopo
          // (workflow/queries.ts:139-183)
          rule: "all",
        },
      ],
      actions: [
        {
          key: "operacao.workflow.concluir",
          label: "Concluir etapa pelo gate",
          verb: "concluir",
          // Hoje: requireUser (workflow/actions.ts:104, fora do try); regras do gate em
          // workflow/service.ts:559-567 · Se a etapa exige aprovação e o ator não pode aprovar, vira pedido de
          // aprovação (service.ts:571-590).
          rule: "all",
          guards: ["src/server/workflow/actions.ts#completeGateAction"],
        },
        {
          key: "operacao.workflow.concluir-com-excecao",
          label: "Concluir etapa com pendências (exceção)",
          verb: "liberar",
          // Hoje: isManagerRole(role) em workflow/service.ts:564-567 (MANAGER_ROLES l.65-69 ≡ isManager); UI
          // canException (workflow/queries.ts:135-137, 180) · Atores de sistema (input.system) continuam
          // isentos (service.ts:564).
          rule: { manager: true },
          guards: [],
          checkedIn: ["src/server/workflow/actions.ts#completeGateAction?exceptionReason preenchido"],
          sensitive: true,
        },
        {
          key: "operacao.workflow.aprovar",
          label: "Aprovar ou rejeitar gate (papel aprovador da etapa ou gestor)",
          verb: "aprovar",
          // Hoje: requireUser (src/server/workflow/actions.ts:128, 142) + canApproveStage(stage, role) =
          // isManagerRole(role) || role === stage.gate.approverRole (src/server/workflow/service.ts:161-164;
          // checado em approveGate :756 e rejectGate :780). approverRole é obrigatório em gate com aprovação
          // (src/server/workflow/schemas.ts:104). UI canApprove com a mesma fórmula
          // (src/server/workflow/queries.ts:162). · Padrão "all" porque esta chave é a GUARDA DE BORDA
          // (requirePermission em approveGateAction/rejectGateAction, A15): quem pode aprovar é decidido pela
          // recordCondition, no padrão de operacao.tarefas.excluir/excluir-qualquer. Com {manager:true} aqui,
          // o papel aprovador que não é gestor (ex.: financeiro na etapa financeira) seria negado na borda —
          // regressão. Negar esta chave a um perfil remove toda aprovação/rejeição de gate desse perfil,
          // inclusive como aprovador configurado. canApproveStage passa a ser o helper único =
          // can(user,'operacao.workflow.aprovar-qualquer') || role === approverRole, usado também em
          // completeGate (service.ts:573, decide entre concluir direto ou pedir aprovação) e na UI
          // (workflow/queries.ts:162); remover as cópias de isManager (workflow/queries.ts:135-137,
          // service.ts:65-69).
          rule: "all",
          guards: ["src/server/workflow/actions.ts#approveGateAction", "src/server/workflow/actions.ts#rejectGateAction"],
          recordCondition: "can('operacao.workflow.aprovar-qualquer') OU user.role === stage.gate.approverRole (papel aprovador configurado na etapa do template)",
          sensitive: true,
        },
        {
          key: "operacao.workflow.aprovar-qualquer",
          label: "Aprovar ou rejeitar gate de qualquer etapa (sem ser o papel aprovador)",
          verb: "aprovar",
          // Hoje: isManagerRole(role) em canApproveStage (src/server/workflow/service.ts:161-162;
          // MANAGER_ROLES service.ts:65-69 = admin|diretoria|gestor ≡ isManager); UI canApprove
          // (src/server/workflow/queries.ts:162) · Sem função própria. Em completeGateAction não nega: quem
          // não passa (nem é o papel aprovador) tem a conclusão convertida em pedido de aprovação, como hoje.
          rule: { manager: true },
          guards: [],
          checkedIn: [
            "src/server/workflow/actions.ts#approveGateAction?user.role !== stage.gate.approverRole",
            "src/server/workflow/actions.ts#rejectGateAction?user.role !== stage.gate.approverRole",
            "src/server/workflow/actions.ts#completeGateAction?stage.gate.requiresApproval (define se conclui direto ou vira pedido de aprovação, service.ts:572-590)",
          ],
          sensitive: true,
        },
        {
          key: "operacao.workflow.editar",
          label: "Preencher campos, checklist e notas da etapa",
          verb: "editar",
          // Hoje: requireUser (workflow/actions.ts:210, 198, 222)
          rule: "all",
          guards: [
            "src/server/workflow/actions.ts#updateStepFieldsAction",
            "src/server/workflow/actions.ts#toggleStepChecklistAction",
            "src/server/workflow/actions.ts#addStepNoteAction",
          ],
        },
        {
          key: "operacao.workflow.pausar",
          label: "Marcar 'aguardando cliente' e retomar etapa",
          verb: "pausar",
          // Hoje: requireUser (workflow/actions.ts:158, 170)
          rule: "all",
          guards: [
            "src/server/workflow/actions.ts#setWaitingClientAction",
            "src/server/workflow/actions.ts#resumeStepAction",
          ],
        },
        {
          key: "operacao.workflow.atribuir",
          label: "Reatribuir responsável da etapa",
          verb: "atribuir",
          // Hoje: requireUser (workflow/actions.ts:182)
          rule: "all",
          guards: ["src/server/workflow/actions.ts#reassignStepAction"],
        },
      ],
      scope: {
        entity: "workflowSteps / workflowInstances",
        ownerFields: ["workflowSteps.assigneeId", "workflowSteps.department"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: EMPRESA para todos: getWorkflowBoard lista todas as etapas abertas
        // (workflow/queries.ts:110-125); getStepDetail e getInstanceView sem viewer (l.139, 189); actions por
        // stepId sem escopo.
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
        applyAt: [
          "src/server/workflow/queries.ts#getWorkflowBoard",
          "src/server/workflow/queries.ts#getStepDetail",
          "src/server/workflow/queries.ts#getInstanceView",
          "src/server/workflow/service.ts#loadStep",
        ],
      },
    },
    {
      key: "operacao.sla",
      module: "operacao",
      label: "SLA",
      description: "Painel de SLA: cumprimento por departamento, críticos e vencendo; ?tipo=chamado inclui a qualidade do Suporte. A rota legada /suporte/sla só redireciona para /sla?tipo=chamado.",
      routes: ["/sla", "/suporte/sla"],
      // Hoje: requireUser() (src/app/(app)/sla/page.tsx:53); /suporte/sla
      // (src/app/(app)/suporte/sla/page.tsx:6-11) só faz redirect, sem guarda
      rule: "all",
      nav: {
        // Hoje: NAVIGATION.operacao (src/domain/constants.ts:107) filtrado por
        // canAccessModule(user,'operacao') em src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "operacao",
        href: "/sla",
        order: 4,
        label: "SLA",
        icon: "Timer",
        wave: 5,
      },
      sections: [
        {
          key: "operacao.sla.painel.ver",
          label: "Painel de SLA",
          // Onde: Indicadores, filtros e listas (sla/page.tsx:52-350); getSlaOverview
          // (src/server/sla-report/queries.ts:331) · Hoje: requireUser; recorte de departamento para não
          // gestores (sla/page.tsx:57)
          rule: "all",
        },
        {
          key: "operacao.sla.qualidade-chamados.ver",
          label: "Qualidade do atendimento (chamados)",
          // Onde: SupportSlaSection com ?tipo=chamado (sla/page.tsx:351); botão 'Editar' da matriz por
          // canSeeHref('/admin/configuracoes?aba=sla') (hoje isAdmin, support-sla-section.tsx:108-114) · Hoje:
          // filters.tipo === 'chamado' && canAccessModule(user,'suporte') (sla/page.tsx:351)
          rule: { can: "suporte.acessar" },
        },
      ],
      actions: [],
      scope: {
        entity: "slaInstances (sla-report)",
        ownerFields: ["ownerId", "department"],
        allowed: ["departamento", "empresa"],
        // Hoje: isManager = empresa (pode escolher departamento); demais forçados a departamento ===
        // user.departmentId (sla/page.tsx:57; filtro em sla-report/queries.ts:219; seletor desabilitado
        // page.tsx:130). Recorte feito NA PÁGINA — mover para getSlaOverview.
        defaultByRole: {
          admin: "empresa",
          diretoria: "empresa",
          gestor: "empresa",
          marketing: "departamento",
          vendas: "departamento",
          financeiro: "departamento",
          implantacao: "departamento",
          cs: "departamento",
          suporte: "departamento",
          colaborador: "departamento",
        },
        applyAt: ["src/app/(app)/sla/page.tsx#SlaPage (l.57)", "src/server/sla-report/queries.ts#getSlaOverview"],
      },
    },
  ],
} as const satisfies ModuleDef;
