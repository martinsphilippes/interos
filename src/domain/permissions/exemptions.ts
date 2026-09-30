/**
 * Isenções justificadas da guarda de tela/ação (A15) e correções deliberadas de comportamento (A14).
 * Gerado uma vez a partir do catálogo consolidado; mantido à mão daqui em diante.
 */
import type { Exemption } from "./types";

/** Páginas públicas, funções "use server" e rotas de API que não passam por requireScreen/requirePermission. */
export const EXEMPTIONS = [
  {
    target: "src/app/page.tsx",
    kind: "page",
    // Hoje: getCurrentUser
    reason: "Raiz pública: só getCurrentUser → redirect /meu-dia ou /login (src/app/page.tsx:4-7). Sem dados.",
  },
  {
    target: "src/app/(auth)/login/page.tsx",
    kind: "page",
    // Hoje: logado → /meu-dia (l.20-21)
    reason: "Login (pública por natureza). Riscos: safeNext (l.13-17) aceita '/\\\\host' (verificar redirecionamento aberto); listDemoUsers (l.22; auth/demo.ts:26-33) expõe usuários ativos quando NEXT_PUBLIC_DEMO_MODE=true.",
  },
  {
    target: "src/app/(auth)/ativar-conta/page.tsx",
    kind: "page",
    // Hoje: P
    reason: "Pública: só dispara e-mail de definição de senha pelo Firebase Auth no cliente. Sem leitura de dados.",
  },
  {
    target: "src/app/(auth)/termos/page.tsx",
    kind: "page",
    // Hoje: P
    reason: "Estática pública.",
  },
  {
    target: "src/app/(auth)/privacidade/page.tsx",
    kind: "page",
    // Hoje: P
    reason: "Estática pública.",
  },
  {
    target: "src/app/offline/page.tsx",
    kind: "page",
    // Hoje: P
    reason: "Fallback do service worker (PWA), estática.",
  },
  {
    target: "src/app/csat/[ticketId]/page.tsx",
    kind: "page",
    // Hoje: token:csat
    reason: "Pesquisa CSAT do cliente, protegida por token HMAC ?t= (csat/[ticketId]/page.tsx:39-59; support/service.ts:194-204). Recomendação: segredo dedicado obrigatório em produção (hoje cai em 'dev-only-secret' sem SESSION_COOKIE_SECRET, service.ts:195) e token mais longo.",
  },
  {
    target: "src/server/search/actions.ts#searchGlobal",
    kind: "action",
    // Hoje: requireUser (search/actions.ts:13); 'automacao' só role admin (l.16)
    reason: "Busca global: sempre permitida a quem está logado; a autorização é POR RESULTADO (canSeeHref da tela de destino + canSeeRecord do escopo) depois do cache compartilhado (search/queries.ts:221-246, 264-266). Visibilidade do controle = inicio.barra-superior.busca.ver. Filtrar por tela é A14.",
  },
  {
    target: "src/server/users/presence.ts#setPresence",
    kind: "action",
    // Hoje: requireUser + unstable_rethrow (presence.ts:18, 34)
    reason: "Atua só sobre o próprio documento users/{user.id} (presence.ts:22). Visibilidade do seletor = inicio.barra-superior.presenca.ver; a action continua aberta a todos (hoje qualquer papel chama).",
  },
  {
    target: "src/server/auth/demo-actions.ts#demoSignInAction",
    kind: "action",
    // Hoje: flag NEXT_PUBLIC_DEMO_MODE
    reason: "Pré-login (sem sessão), chamado por login-form.tsx:137. Guarda real = isDemoMode()/NEXT_PUBLIC_DEMO_MODE (auth/demo.ts:12-14, 37); emite custom token para qualquer usuário ativo, inclusive admin. /api/health deve informar demoMode (A0).",
  },
  {
    target: "src/app/api/auth/session/route.ts#POST",
    kind: "api",
    // Hoje: verifyIdToken (l.47) + rejectionFor (l.17-36: doc existe e active !== false) → 403/401 JSON
    reason: "Login (troca idToken por cookie). A0: exigir active === true e organizationId correto.",
  },
  {
    target: "src/app/api/auth/session/route.ts#DELETE",
    kind: "api",
    // Hoje: nenhuma (route.ts:58-61)
    reason: "Logout idempotente (só apaga o cookie).",
  },
  {
    target: "src/app/api/cron/sweep/route.ts#GET",
    kind: "api",
    // Hoje: Bearer CRON_SECRET → 401 (route.ts:17-27); comparação com '===' (l.19) → trocar por
    // timingSafeEqual
    reason: "Cron (ator de sistema). Guarda por token.",
  },
  {
    target: "src/app/api/cron/sweep/route.ts#POST",
    kind: "api",
    // Hoje: Bearer CRON_SECRET (route.ts:17-27)
    reason: "Idem GET (mesmo handler).",
  },
  {
    target: "src/app/api/csat/[ticketId]/route.ts#POST",
    kind: "api",
    // Hoje: isValidCsatToken → 403 (route.ts:22-24)
    reason: "Resposta CSAT do cliente. Guarda por token.",
  },
  {
    target: "src/app/api/health/route.ts#GET",
    kind: "api",
    // Hoje: nenhuma (route.ts:10-26)
    reason: "Monitoramento público. A0: informar demoMode; omitir 'missing' em produção.",
  },
  {
    target: "src/app/api/webhooks/cobranca/route.ts#POST",
    kind: "api",
    // Hoje: BILLING_WEBHOOK_TOKEN timingSafeEqual → 401; sem env/provedor → 503 (route.ts:33-41)
    reason: "Webhook do provedor de cobrança (SYSTEM_ACTOR). Guarda por token.",
  },
  {
    target: "src/app/api/webhooks/leads/route.ts#POST",
    kind: "api",
    // Hoje: LEADS_WEBHOOK_TOKEN timingSafeEqual → 401 (route.ts:25-32); sem env ACEITA fora de produção
    // (l.27-29) — exigir token sempre
    reason: "Captura de leads por webhook. Guarda por token.",
  },
  {
    target: "src/app/api/webhooks/whatsapp/route.ts#GET",
    kind: "api",
    // Hoje: hub.verify_token timingSafe → 403 (route.ts:39-46)
    reason: "Verificação da Meta.",
  },
  {
    target: "src/app/api/webhooks/whatsapp/route.ts#POST",
    kind: "api",
    // Hoje: HMAC x-hub-signature-256 ou x-interos-token → 401 (route.ts:88-103); sem env ACEITA fora de
    // produção (l.99-101)
    reason: "Mensagens e status do WhatsApp. Guarda por assinatura/token.",
  },
] as const satisfies readonly Exemption[];

/** Mudanças de comportamento autorizadas pelo requisito (A14), exceções nominais da equivalência T0. */
export const DELIBERATE_CORRECTIONS: readonly { title: string; detail: string }[] = [
  {
    title: "Marketing exige o módulo",
    detail: "As 6 páginas e 23 actions de Marketing hoje só exigem requireUser; passam a exigir marketing.acessar (E lógico). Afeta financeiro, implantacao, cs, suporte e colaborador que abriam por URL. Link do Meu Dia para a Caixa de Entrada some via canSeeHref.",
  },
  {
    title: "Actions só com requireUser ganham a chave da tela",
    detail: "suporte.chamados.criar/reabrir, suporte.base-de-conhecimento.avaliar (hoje sem módulo) e requireOperator/canEditArticles do Suporte (hoje sem módulo): efetivo = quem vê a entrada hoje; papéis fora de MODULE_ACCESS.suporte lotados no depto suporte perdem a operação (ninguém no seed).",
  },
  {
    title: "Comissões/CaP exigem o módulo nas actions",
    detail: "commissions/actions.ts hoje não checa o módulo; usuário do depto financeiro com papel cs/suporte/marketing/implantacao/colaborador perde criar/editar/programar/cancelar/fornecedores (a página já era negada). Nenhum no seed.",
  },
  {
    title: "Cockpit: menu × rota",
    detail: "Item 'Cockpit Diretoria' deixa de aparecer para gestor (rota exige diretoria, cockpit/page.tsx:46). Assistente executivo passa a exigir gestao.cockpit.ver (hoje gestor chama a action diretamente).",
  },
  {
    title: "Contas a Pagar: menu × rota",
    detail: "Item de menu deriva de financeiro.contas-a-pagar.ver: papel vendas no depto financeiro passa a ver o item (hoje abre a rota mas não vê o menu, constants.ts:144).",
  },
  {
    title: "Administração: menu × rota",
    detail: "admin.acessar = {manager:true}: gestor/diretoria passam a ver no menu 'Usuários' e 'Departamentos' (rotas que já abrem hoje).",
  },
  {
    title: "Links internos seguem a tela de destino (A11)",
    detail: "Barra do celular, atalhos da busca/ajuda/menu do usuário, hubs (Financeiro, Administração, Gestão) e atalhos do Meu Dia só mostram links para telas visíveis (ScreenLink/useCanSee, mapa calculado no servidor). No padrão só muda o atalho 'Caixa de entrada' do Meu Dia para quem não tem Marketing (ver 'Marketing exige o módulo'); os demais apontavam para rotas que já negavam o acesso.",
  },
  {
    title: "Catch-all considera a tela",
    detail: "[...slug] passa a exigir a tela do href (hoje só o módulo, l.39). Inalcançável hoje.",
  },
  { title: "/api/relatorios 401/403", detail: "Sem sessão: 401 JSON (hoje redirect 307); sem permissão: 403." },
  {
    title: "renewContract / registerChurn com chaves próprias",
    detail: "cs.renovacoes.renovar e cs.churn.registrar (padrão = hoje).",
  },
  {
    title: "Busca global respeita telas e escopo",
    detail: "Resultados filtrados por canSeeHref + escopo; hoje usuários (com e-mail/telefone), relatórios, contratos etc. aparecem para todos (search/queries.ts:318-338).",
  },
  {
    title: "updateGoLiveSettings exige o módulo",
    detail: "Hoje só isManager (implementation/actions.ts:341-344); passa a implantacao.acessar ∧ implantacao.go-live.configurar (sem efeito no padrão).",
  },
  {
    title: "/suporte/sla",
    detail: "Rota de redirect passa por requireScreen('operacao.sla') (all) — sem mudança efetiva.",
  },
  {
    title: "Comissões: botões 'Regras' e 'Contas a Pagar' seguem a página de destino",
    detail: "Em /financeiro/comissoes (aberta também pelo módulo Vendas), ws.can.viewRules/viewPayables (commissions/queries.ts) passam a incluir o módulo Financeiro, como as páginas de destino já exigiam (regras/page.tsx e contas-a-pagar/page.tsx). Papéis cs, marketing e suporte lotados no departamento financeiro deixam de ver botões que levavam a 'acesso negado'. Nenhum no seed.",
  },
  {
    title: "Fachadas de operação incluem o módulo",
    detail: "canOperateFinance (financeiro.contratos.editar) e canOperateImplementation (implantacao.projetos.atribuir) passam a incluir o módulo: papéis sem o módulo lotados no departamento (financeiro: cs, marketing, suporte, implantacao, colaborador; implantação: vendas, marketing, financeiro, colaborador) passam a false. Sem efeito observável: todo chamador exige o módulo antes (requireFinanceOperator/requireOperator e as páginas dos módulos) — conferido em tests/permissions/equivalence.test.ts.",
  },
];
