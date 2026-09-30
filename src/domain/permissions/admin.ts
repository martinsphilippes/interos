/**
 * Catálogo de acessos — módulo Administração (`admin.acessar`).
 *
 * Gerado UMA vez a partir do catálogo consolidado da etapa 6A (A24); daqui em diante este arquivo é a fonte de
 * verdade. Cada regra (`rule`) é a regra PADRÃO e reproduz o comportamento anterior ao catálogo; o comentário
 * "Hoje:" registra o predicado de origem. Ajustes por perfil/usuário não entram aqui (ficam em permission_profiles).
 */
import type { ModuleDef } from "./types";

export const ADMIN = {
  key: "admin",
  label: "Administração",
  // Hoje: MODULE_ACCESS.admin = [admin] (constants.ts:68), mas /admin/usuarios e /admin/departamentos aceitam
  // gestor/diretoria (usuarios/page.tsx:25, departamentos/page.tsx:13). Padrão {manager:true} preserva as
  // rotas; o menu passa a mostrar Usuários/Departamentos a gestor/diretoria (A14 menu × rota).
  rule: { manager: true },
  deactivatable: false,
  protected: true,
  screens: [
    {
      key: "admin.painel",
      module: "admin",
      label: "Administração (índice)",
      description: "Hub da administração com um card por área e contagens (cards filtrados por canSeeHref).",
      routes: ["/admin"],
      // Hoje: src/app/(app)/admin/page.tsx:26 requireRole('admin'); cards fixos admin/page.tsx:32-105
      rule: { role: "admin" },
      nav: {
        // Não é item de NAVIGATION: /admin é o hub (breadcrumb 'Administração' e cards). navHref serve só de
        // lookup para canSeeHref/<ScreenLink>.
        menu: null,
        href: "/admin",
      },
      sections: [],
      actions: [],
      scope: null,
    },
    {
      key: "admin.usuarios",
      module: "admin",
      label: "Usuários",
      description: "Contas, papel, departamento, gestor, metas mensais e salário base. Admin edita; gestor/diretoria em modo leitura. Hospeda as abas de Perfis e acessos / Módulos da empresa (tela admin.acessos, A10).",
      routes: ["/admin/usuarios"],
      protected: true,
      // Hoje: src/app/(app)/admin/usuarios/page.tsx:25 requireRole('admin','gestor','diretoria') ≡ isManager;
      // canEdit = user.isAdmin (l.30). CHAVE PROTEGIDA (I1/I3).
      rule: { manager: true },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:205) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/usuarios",
        order: 1,
        label: "Usuários",
        icon: "Users",
      },
      sections: [
        {
          key: "admin.usuarios.remuneracao.ver",
          label: "Salário base",
          // Onde: Campo baseSalary no UserDrawer (user-drawer.tsx:57,82,110,125); vem em listUsersForAdmin
          // (admin/queries.ts:80-93). Sem a chave, o servidor omite baseSalary · Hoje: sem predicado próprio:
          // quem entra na página recebe baseSalary (usuarios/page.tsx:25,28)
          rule: { manager: true },
        },
      ],
      actions: [
        {
          key: "admin.usuarios.criar",
          label: "Criar usuário",
          verb: "criar",
          // Hoje: admin/actions.ts:120-122 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin) ·
          // Papel diferente do padrão exige admin.usuarios.alterar-papel; papel admin exige
          // admin.acessos.gerir (I6).
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#createUser"],
          sensitive: true,
        },
        {
          key: "admin.usuarios.editar",
          label: "Editar usuário (nome, departamento, gestor, cargo, telefone, metas)",
          verb: "editar",
          // Hoje: admin/actions.ts:184-192 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // proteções contra si (l.190-192) · CHAVE PROTEGIDA (I1). Troca de managerId altera a 'equipe' de
          // terceiros → auditar (user.updated com changes) e revokeRefreshTokens ao mudar papel/desativar
          // (A0).
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#updateUser"],
          sensitive: true,
          protected: true,
        },
        {
          key: "admin.usuarios.alterar-papel",
          label: "Alterar papel (perfil) do usuário",
          verb: "alterar-papel",
          // Hoje: implícito em createUser/updateUser (requireAdmin); não muda o próprio (admin/actions.ts:191;
          // user-drawer.tsx:166-167) · Atribuir/retirar o papel admin exige admin.acessos.gerir; ninguém muda
          // o próprio papel (I2).
          rule: { role: "admin" },
          guards: [],
          checkedIn: [
            "src/server/admin/actions.ts#updateUser?role mudou",
            "src/server/admin/actions.ts#createUser?role informado",
          ],
          sensitive: true,
        },
        {
          key: "admin.usuarios.ativar",
          label: "Ativar/desativar usuário",
          verb: "ativar",
          // Hoje: admin/actions.ts:235-239 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // nega a si (l.239)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#setUserActive"],
          checkedIn: ["src/server/admin/actions.ts#updateUser?active mudou"],
          sensitive: true,
        },
        {
          key: "admin.usuarios.redefinir-senha",
          label: "Redefinir senha de outro usuário",
          verb: "redefinir-senha",
          // Hoje: admin/actions.ts:262-264 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // sem restrição de alvo
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#resetUserPassword"],
          recordCondition: "alvo com chaves que o ator não tem → exige admin.acessos.gerir (anti-escalada I6)",
          sensitive: true,
        },
        {
          key: "admin.usuarios.excluir",
          label: "Excluir usuário",
          verb: "excluir",
          // Hoje: admin/actions.ts:293-307 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // nega a si, tarefas abertas, liderados; não checa departments.managerId · Acrescentar I5 e evento
          // user.deleted (hoje user.updated, l.314-322).
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#deleteUser"],
          sensitive: true,
        },
        {
          key: "admin.usuarios.remuneracao.editar",
          label: "Editar salário base",
          verb: "editar",
          // Hoje: implícito em createUser/updateUser (requireAdmin)
          rule: { role: "admin" },
          guards: [],
          checkedIn: [
            "src/server/admin/actions.ts#updateUser?baseSalary mudou",
            "src/server/admin/actions.ts#createUser?baseSalary informado",
          ],
          sensitive: true,
        },
      ],
      scope: {
        entity: "users",
        ownerFields: ["id", "managerId", "departmentId"],
        allowed: ["meus", "equipe", "departamento", "empresa"],
        // Hoje: admin, gestor e diretoria veem TODOS os usuários com e-mail, telefone e baseSalary
        // (listUsersForAdmin admin/queries.ts:80-93 sem filtro; usuarios/page.tsx:28-29 abre ?usuario=<id>
        // sobre a lista inteira).
        defaultByRole: { admin: "empresa", diretoria: "empresa", gestor: "empresa" },
        applyAt: [
          "src/server/admin/queries.ts#listUsersForAdmin",
          "src/app/(app)/admin/usuarios/page.tsx (?usuario=)",
          "src/server/admin/actions.ts#updateUser/setUserActive/resetUserPassword/deleteUser",
          "src/server/search/queries.ts:330-338 (usuários na busca)",
        ],
      },
    },
    {
      key: "admin.acessos",
      module: "admin",
      label: "Perfis e acessos",
      description: "Tela nova renderizada DENTRO de /admin/usuarios (?aba=perfis|modulos) e no UserDrawer (Exceções de acesso, Acesso efetivo, Histórico). Sem page.tsx própria.",
      routes: [],
      virtual: true,
      hostRoutes: ["/admin/usuarios"],
      protected: true,
      // Hoje: Não existe hoje. Padrão = somente admin (poder equivalente: requireAdmin,
      // admin/actions.ts:45-49). CHAVE PROTEGIDA (I1/I3).
      rule: { role: "admin" },
      sections: [
        {
          key: "admin.acessos.perfis.ver",
          label: "Perfis (ajustes por papel)",
          // Onde: /admin/usuarios?aba=perfis — árvore Módulo › Tela › Seção › Ação + escopo por tela · Hoje:
          // inexistente (nova)
          rule: { role: "admin" },
        },
        {
          key: "admin.acessos.modulos.ver",
          label: "Módulos da empresa",
          // Onde: /admin/usuarios?aba=modulos — organizations/{ORG}.activeModules (A8) · Hoje: inexistente
          // (nova)
          rule: { role: "admin" },
        },
        {
          key: "admin.acessos.excecoes.ver",
          label: "Exceções de acesso do usuário",
          // Onde: UserDrawer, após 'Metas mensais' · Hoje: inexistente (nova)
          rule: { role: "admin" },
        },
        {
          key: "admin.acessos.efetivo.ver",
          label: "Acesso efetivo (somente leitura)",
          // Onde: UserDrawer — o que o usuário vê/faz e a origem (padrão/perfil/exceção/módulo inativo) ·
          // Hoje: inexistente (nova)
          rule: { role: "admin" },
        },
        {
          key: "admin.acessos.historico.ver",
          label: "Histórico de acesso",
          // Onde: UserDrawer e aba Perfis — eventos permissions.updated/blocked, user.updated/deleted,
          // department.updated (A16) · Hoje: inexistente (nova)
          rule: { role: "admin" },
        },
      ],
      actions: [
        {
          key: "admin.acessos.gerir",
          label: "Gerir perfis, exceções individuais e módulos da empresa",
          verb: "gerir",
          // Hoje: inexistente; poder equivalente hoje = requireAdmin (admin/actions.ts:45-49) · CHAVE
          // PROTEGIDA (I1/I3). Anti-escalada I6: só concede chaves que tem efetivas; ninguém edita as próprias
          // exceções (I2).
          rule: { role: "admin" },
          guards: [],
          futureGuards: [
            "src/server/admin/actions.ts#savePermissionProfile",
            "src/server/admin/actions.ts#saveUserPermissionOverrides",
            "src/server/admin/actions.ts#saveActiveModules",
          ],
          sensitive: true,
          protected: true,
        },
      ],
      scope: null,
    },
    {
      key: "admin.departamentos",
      module: "admin",
      label: "Departamentos",
      description: "Gestor, cor, descrição e ordem de cada área (conjunto de chaves fixo). Admin edita; gestor/diretoria leem.",
      routes: ["/admin/departamentos"],
      // Hoje: src/app/(app)/admin/departamentos/page.tsx:13 requireRole('admin','gestor','diretoria') ≡
      // isManager; canEdit = isAdmin (l.15)
      rule: { manager: true },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:206) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/departamentos",
        order: 2,
        label: "Departamentos",
        icon: "Network",
      },
      sections: [],
      actions: [
        {
          key: "admin.departamentos.editar",
          label: "Editar departamento (nome, gestor, cor, ordem)",
          verb: "editar",
          // Hoje: admin/actions.ts:335-337 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // sem evento · departments.managerId define 'equipe' (getGoalPermissions kpis/queries.ts:387-395),
          // comissões e gestão → auditar department.updated (A16) e aplicar I6.
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#updateDepartment"],
          sensitive: true,
        },
      ],
      scope: null,
    },
    {
      key: "admin.produtos",
      module: "admin",
      label: "Produtos",
      description: "Catálogo com preços, comissão padrão e template de implantação.",
      routes: ["/admin/produtos"],
      // Hoje: src/app/(app)/admin/produtos/page.tsx:15 requireRole('admin')
      rule: { role: "admin" },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:207) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/produtos",
        order: 3,
        label: "Produtos",
        icon: "Package",
      },
      sections: [],
      actions: [
        {
          key: "admin.produtos.criar",
          label: "Criar produto",
          verb: "criar",
          // Hoje: admin/actions.ts:377-379 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#createProduct"],
        },
        {
          key: "admin.produtos.editar",
          label: "Editar produto (preço, comissão padrão) e ordem no catálogo",
          verb: "editar",
          // Hoje: admin/actions.ts:408-410, 439-441 requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#updateProduct", "src/server/admin/actions.ts#moveProduct"],
          sensitive: true,
        },
        {
          key: "admin.produtos.ativar",
          label: "Ativar/desativar produto",
          verb: "ativar",
          // Hoje: admin/actions.ts:462-464 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#setProductActive"],
        },
      ],
      scope: null,
    },
    {
      key: "admin.configuracoes",
      module: "admin",
      label: "Configurações (gerais)",
      // upsertSetting é despachada por SettingKey (SETTING_PERMISSION): cada chave de setting aparece como
      // guard qualificado (?key=) exatamente em uma ação editar, aqui ou em financeiro.configuracoes.*.editar.
      description: "Parâmetros lidos pelos módulos (?aba=). Abas não financeiras; as financeiras são a tela financeiro.configuracoes renderizada na mesma página. A página aceita quem tem admin.configuracoes.ver OU qualquer financeiro.configuracoes.<secao>.ver e mostra só as abas permitidas.",
      routes: ["/admin/configuracoes"],
      requireScreenAny: ["admin.configuracoes", "financeiro.configuracoes"],
      // Hoje: src/app/(app)/admin/configuracoes/page.tsx:25 requireRole('admin'); abas fixas
      // (admin-model.ts:70; settings-tabs.tsx:30-44)
      rule: { role: "admin" },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:208) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/configuracoes",
        order: 4,
        label: "Configurações",
        icon: "Settings",
      },
      sections: [
        {
          key: "admin.configuracoes.horario.ver",
          label: "Horário comercial",
          // Onde: ?aba=horario (padrão) — horario_comercial · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.feriados.ver",
          label: "Feriados",
          // Onde: ?aba=feriados — feriados · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.metas.ver",
          label: "Metas de referência",
          // Onde: ?aba=metas — metas_referencia · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.lead-scoring.ver",
          label: "Lead scoring",
          // Onde: ?aba=lead-scoring — lead_scoring · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.health-score.ver",
          label: "Health score",
          // Onde: ?aba=health-score — health_score · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.oportunidades.ver",
          label: "Oportunidades",
          // Onde: ?aba=oportunidades — oportunidade · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.entrega.ver",
          label: "Go-live e ativação",
          // Onde: ?aba=entrega — go_live e cs_ativacao (writer paralelo de go_live:
          // implantacao.go-live.configurar) · Hoje: admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.performance.ver",
          label: "Gamificação e prêmios",
          // Onde: ?aba=performance — gamificacao, premios_vendas, gamificacao.sequencia · Hoje:
          // admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.saude-indice.ver",
          label: "Saúde da operação e índice de desempenho",
          // Onde: ?aba=saude-indice — formulários que chamam kpis/actions.ts (salvar exige
          // gestao.cockpit.configurar / performance.meu-desempenho.configurar) · Hoje:
          // admin/configuracoes/page.tsx:25 (página); actions isDirector (kpis/actions.ts:285,298)
          rule: { role: "admin" },
        },
        {
          key: "admin.configuracoes.sla.ver",
          label: "Regras de SLA",
          // Onde: ?aba=sla — settings-sla-rules.tsx (coleção sla_rules) · Hoje:
          // admin/configuracoes/page.tsx:25
          rule: { role: "admin" },
        },
      ],
      actions: [
        {
          key: "admin.configuracoes.horario.editar",
          label: "Editar horário comercial",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=horario_comercial"],
        },
        {
          key: "admin.configuracoes.feriados.editar",
          label: "Editar feriados",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=feriados"],
        },
        {
          key: "admin.configuracoes.metas.editar",
          label: "Editar metas de referência",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=metas_referencia"],
        },
        {
          key: "admin.configuracoes.lead-scoring.editar",
          label: "Editar lead scoring",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=lead_scoring"],
        },
        {
          key: "admin.configuracoes.health-score.editar",
          label: "Editar health score",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=health_score"],
        },
        {
          key: "admin.configuracoes.oportunidades.editar",
          label: "Editar oportunidades",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSetting?key=oportunidade"],
        },
        {
          key: "admin.configuracoes.entrega.editar",
          label: "Editar go-live e ativação",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: [
            "src/server/admin/actions.ts#upsertSetting?key=go_live",
            "src/server/admin/actions.ts#upsertSetting?key=cs_ativacao",
          ],
        },
        {
          key: "admin.configuracoes.performance.editar",
          label: "Editar gamificação e prêmios",
          verb: "editar",
          // Hoje: admin/actions.ts:487-489 upsertSetting → requireAdmin() (src/server/admin/actions.ts:45-49:
          // user.isAdmin); validação SETTING_SCHEMAS + auditoria de→para (l.502-515)
          rule: { role: "admin" },
          guards: [
            "src/server/admin/actions.ts#upsertSetting?key=gamificacao",
            "src/server/admin/actions.ts#upsertSetting?key=premios_vendas",
            "src/server/admin/actions.ts#upsertSetting?key=gamificacao.sequencia",
          ],
        },
        {
          key: "admin.configuracoes.sla.editar",
          label: "Criar/editar regra de SLA",
          verb: "editar",
          // Hoje: admin/actions.ts:525-527 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // sem evento
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#upsertSlaRule"],
        },
        {
          key: "admin.configuracoes.sla.excluir",
          label: "Excluir regra de SLA",
          verb: "excluir",
          // Hoje: admin/actions.ts:565-567 requireAdmin() (src/server/admin/actions.ts:45-49: user.isAdmin);
          // sem evento
          rule: { role: "admin" },
          guards: ["src/server/admin/actions.ts#deleteSlaRule"],
        },
      ],
      scope: null,
    },
    {
      key: "admin.indicadores",
      module: "admin",
      label: "Indicadores (definições de KPI)",
      description: "Definições dos KPIs do motor: fórmula, meta, faixa, peso, ativação e snapshots.",
      routes: ["/admin/indicadores"],
      // Hoje: src/app/(app)/admin/indicadores/page.tsx:16 requireRole('admin')
      rule: { role: "admin" },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:210) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/indicadores",
        order: 6,
        label: "Indicadores",
        icon: "Activity",
      },
      sections: [],
      actions: [
        {
          key: "admin.indicadores.editar",
          label: "Criar/editar indicador",
          verb: "editar",
          // Hoje: kpis/actions.ts:46-104 isAdmin inline (l.49)
          rule: { role: "admin" },
          guards: ["src/server/kpis/actions.ts#upsertKpi"],
        },
        {
          key: "admin.indicadores.ativar",
          label: "Ativar/desativar indicador",
          verb: "ativar",
          // Hoje: kpis/actions.ts:106-127 isAdmin inline (l.109)
          rule: { role: "admin" },
          guards: ["src/server/kpis/actions.ts#toggleKpi"],
        },
        {
          key: "admin.indicadores.registrar-snapshot",
          label: "Registrar snapshots mensais",
          verb: "registrar-snapshot",
          // Hoje: kpis/actions.ts:130-150 isAdmin inline (l.133)
          rule: { role: "admin" },
          guards: ["src/server/kpis/actions.ts#recordKpiSnapshots"],
        },
      ],
      scope: null,
    },
    {
      key: "admin.workflows",
      module: "admin",
      label: "Workflows e processos",
      description: "Jornada do cliente (templates lineares com gates) e Processos com ramificações (construtor visual) + execuções.",
      routes: ["/admin/workflows"],
      // Hoje: src/app/(app)/admin/workflows/page.tsx:18 requireRole('admin')
      rule: { role: "admin" },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:209) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/workflows",
        order: 5,
        label: "Workflows",
        icon: "Workflow",
      },
      sections: [
        {
          key: "admin.workflows.jornada.ver",
          label: "Jornada do cliente (templates)",
          // Onde: Lista 'Jornada do cliente' (workflows/page.tsx:43-53) e editor de versão · Hoje:
          // workflows/[id]/page.tsx:19 requireRole('admin')
          rule: { role: "admin" },
          routes: ["/admin/workflows/[id]"],
        },
        {
          key: "admin.workflows.processos.ver",
          label: "Processos (construtor visual)",
          // Onde: Lista 'Processos' (workflows/page.tsx:29-42) e construtor · Hoje:
          // workflows/processos/[id]/page.tsx:18 requireRole('admin')
          rule: { role: "admin" },
          routes: ["/admin/workflows/processos/[id]"],
        },
        {
          key: "admin.workflows.execucoes.ver",
          label: "Execuções de processos",
          // Onde: Execuções com o caminho no grafo + link curto de execução (tarefas/notificações) · Hoje:
          // processos/[id]/execucoes/page.tsx:19 e execucoes/[runId]/page.tsx:9 requireRole('admin')
          rule: { role: "admin" },
          routes: ["/admin/workflows/processos/[id]/execucoes", "/admin/workflows/execucoes/[runId]"],
        },
      ],
      actions: [
        {
          key: "admin.workflows.jornada.editar",
          label: "Salvar template da jornada (nova versão em rascunho)",
          verb: "editar",
          // Hoje: src/server/workflow/actions.ts:244 requireRole('admin') FORA do try
          rule: { role: "admin" },
          guards: ["src/server/workflow/actions.ts#saveWorkflowTemplateAction"],
        },
        {
          key: "admin.workflows.jornada.publicar",
          label: "Publicar template da jornada",
          verb: "publicar",
          // Hoje: src/server/workflow/actions.ts:308 requireRole('admin') FORA do try
          rule: { role: "admin" },
          guards: ["src/server/workflow/actions.ts#publishWorkflowTemplateAction"],
          sensitive: true,
        },
        {
          key: "admin.workflows.processos.criar",
          label: "Criar processo",
          verb: "criar",
          // Hoje: process-engine/actions.ts:65-66 requireRole('admin') FORA do try (redirect)
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#createProcessDefinitionAction"],
        },
        {
          key: "admin.workflows.processos.editar",
          label: "Salvar versão do processo",
          verb: "editar",
          // Hoje: process-engine/actions.ts:107-108 requireRole('admin') FORA do try (redirect) · Nós de
          // webhook podem enviar dados para fora.
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#saveProcessDefinitionAction"],
          sensitive: true,
        },
        {
          key: "admin.workflows.processos.publicar",
          label: "Publicar processo",
          verb: "publicar",
          // Hoje: process-engine/actions.ts:146-147 requireRole('admin') FORA do try (redirect)
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#publishProcessDefinitionAction"],
          sensitive: true,
        },
        {
          key: "admin.workflows.processos.testar",
          label: "Simular processo",
          verb: "testar",
          // Hoje: process-engine/actions.ts:177-178 requireRole('admin') FORA do try (redirect)
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#simulateProcessAction"],
        },
        {
          key: "admin.workflows.execucoes.iniciar",
          label: "Iniciar execução manual",
          verb: "iniciar",
          // Hoje: process-engine/actions.ts:261-262 requireRole('admin') FORA do try (redirect)
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#startManualRunAction"],
        },
        {
          key: "admin.workflows.execucoes.cancelar",
          label: "Cancelar execução",
          verb: "cancelar",
          // Hoje: process-engine/actions.ts:248-249 requireRole('admin') FORA do try (redirect)
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#cancelProcessRunAction"],
        },
        {
          key: "admin.workflows.execucoes.executar-varredura",
          label: "Rodar varredura de processos (esperas/prazos)",
          verb: "executar-varredura",
          // Hoje: process-engine/actions.ts:278-279 requireRole('admin') FORA do try (redirect)
          rule: { role: "admin" },
          guards: ["src/server/process-engine/actions.ts#runProcessSweepAction"],
        },
      ],
      scope: null,
    },
    {
      key: "admin.automacoes",
      module: "admin",
      label: "Automações",
      description: "Regras gatilho → condições → ações, varreduras agendadas, histórico de execuções e demonstração do assistente.",
      routes: ["/admin/automacoes", "/admin/automacoes/[id]"],
      // Hoje: admin/automacoes/page.tsx:20 e automacoes/[id]/page.tsx:25 requireRole('admin') ([id]='nova'
      // cria)
      rule: { role: "admin" },
      viewGuards: [
        {
          // Hoje: automations/actions.ts:214-216 requireAdmin() (src/server/automations/actions.ts:34-38)
          guard: "src/server/automations/actions.ts#getPathSuggestionsAction",
          label: "Ver automações (inclui sugestões de caminhos do editor)",
        },
      ],
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:211) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/automacoes",
        order: 7,
        label: "Automações",
        icon: "Zap",
      },
      sections: [
        {
          key: "admin.automacoes.varreduras.ver",
          label: "Varreduras agendadas",
          // Onde: automacoes/page.tsx:55-61 (SweepsPanel) + RunSweepsButton (l.33) · Hoje:
          // automacoes/page.tsx:20
          rule: { role: "admin" },
        },
        {
          key: "admin.automacoes.historico.ver",
          label: "Histórico de execuções da regra",
          // Onde: automacoes/[id]/page.tsx:41-50 (RunsHistory) · Hoje: automacoes/[id]/page.tsx:25
          rule: { role: "admin" },
        },
      ],
      actions: [
        {
          key: "admin.automacoes.criar",
          label: "Criar regra de automação",
          verb: "criar",
          // Hoje: automations/actions.ts:89-91 requireAdmin() (src/server/automations/actions.ts:34-38)
          rule: { role: "admin" },
          guards: ["src/server/automations/actions.ts#saveAutomationRule?sem id"],
          sensitive: true,
        },
        {
          key: "admin.automacoes.editar",
          label: "Editar regra de automação",
          verb: "editar",
          // Hoje: automations/actions.ts:89-91 requireAdmin() (src/server/automations/actions.ts:34-38) · O
          // motor executa como sistema (criar_tarefa, notificar, mudar_status, webhook…): quem edita regras
          // escreve em qualquer módulo.
          rule: { role: "admin" },
          guards: ["src/server/automations/actions.ts#saveAutomationRule?com id"],
          sensitive: true,
        },
        {
          key: "admin.automacoes.ativar",
          label: "Ativar/desativar regra",
          verb: "ativar",
          // Hoje: automations/actions.ts:131-133 requireAdmin() (src/server/automations/actions.ts:34-38) ·
          // marketing/workspace.ts:215 canToggleAutomations passa a ler esta chave.
          rule: { role: "admin" },
          guards: ["src/server/automations/actions.ts#setAutomationRuleActive"],
        },
        {
          key: "admin.automacoes.excluir",
          label: "Excluir regra",
          verb: "excluir",
          // Hoje: automations/actions.ts:153-155 requireAdmin() (src/server/automations/actions.ts:34-38)
          rule: { role: "admin" },
          guards: ["src/server/automations/actions.ts#deleteAutomationRule"],
        },
        {
          key: "admin.automacoes.testar",
          label: "Testar regra (simulação)",
          verb: "testar",
          // Hoje: automations/actions.ts:176-178 requireAdmin() (src/server/automations/actions.ts:34-38)
          rule: { role: "admin" },
          guards: ["src/server/automations/actions.ts#testAutomationRule"],
        },
        {
          key: "admin.automacoes.executar-varredura",
          label: "Rodar todas as varreduras agora",
          verb: "executar-varredura",
          // Hoje: automations/actions.ts:200-202 requireAdmin() (src/server/automations/actions.ts:34-38) ·
          // Inclui varreduras financeiras (conciliação → registerPayment 'conciliacao', régua). Com A8,
          // varreduras de módulo inativo são puladas.
          rule: { role: "admin" },
          guards: ["src/server/automations/actions.ts#runSweepsNow"],
          sensitive: true,
        },
      ],
      scope: null,
    },
    {
      key: "admin.integracoes",
      module: "admin",
      label: "Integrações",
      description: "Estado real de cada provedor (env + adaptador), variáveis necessárias (só nomes) e fallback. Somente leitura.",
      routes: ["/admin/integracoes"],
      // Hoje: src/app/(app)/admin/integracoes/page.tsx:21 requireRole('admin')
      rule: { role: "admin" },
      nav: {
        // Hoje: NAVIGATION.admin (src/domain/constants.ts:212) filtrado por canAccessModule(user,'admin') em
        // src/app/(app)/layout.tsx:11 e src/app/(app)/menu/page.tsx:16
        menu: "admin",
        href: "/admin/integracoes",
        order: 8,
        label: "Integrações",
        icon: "Plug",
      },
      sections: [],
      actions: [],
      scope: null,
    },
  ],
} as const satisfies ModuleDef;
