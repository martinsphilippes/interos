# INTEROS — Arquitetura e convenções (leitura obrigatória antes de codar)

## Stack (decidida, não rediscutir)
- Next.js 16 App Router + React 19 + TypeScript estrito. Tailwind v4. Deploy na Vercel com as funções em `gru1`
  (São Paulo, `regions` no vercel.json), perto do banco (Supabase `sa-east-1`): cada tela faz várias leituras e a ida
  e volta até os EUA multiplicava a latência.
- Banco: Postgres do Supabase (projeto `interos` (`vqkpyjpwxsmsqfgpdjao`), região `sa-east-1`, migrado do Firestore em 10/2026). Acesso
  **somente pelo servidor** (Server Components, Server Actions, Route Handlers) com o papel `interos_app` pela
  `DATABASE_URL` (pooler em modo transação). Modelo de documentos: uma tabela por coleção no schema `interos`
  (`id text`, `data jsonb`), que **não** é exposto pela Data API; RLS ligado com política só para `interos_app`.
  `src/server/docdb.ts` reproduz a API do Firestore Admin (doc/set/update/where/runTransaction/FieldValue), então os
  serviços não mudaram. Schema em `supabase/migrations/`.
- Login: Supabase Auth (e-mail/senha; Microsoft via provedor `azure`). O cliente do Supabase no navegador
  (`src/lib/supabase/client.ts`) é usado **só** para autenticar; nenhum dado é lido do navegador.
- Datas: sempre strings ISO 8601 (`new Date().toISOString()`), nunca `Timestamp`. Ordenação lexicográfica funciona.
- Dinheiro: números em reais com centavos (ex.: `1234.5`). Formatação com `formatCurrency` de `@/lib/format`.
- Sessão: cookie `interos_session` emitido pelo servidor (HMAC com `SESSION_COOKIE_SECRET`, 14 dias) depois que o
  Supabase Auth confirma a identidade em `/api/auth/session`. `requireUser()` em toda página/ação. Revogação:
  `users.sessionsRevokedAt`. Logins são vinculados ao usuário por `auth.users.raw_app_meta_data.interos_uid` e
  geridos por `authAdmin` (`src/server/auth/auth-admin.ts`, funções SQL restritas). Ver `src/server/auth/session.ts`.
- Multiempresa: todo documento tem `organizationId`. Onda 1 usa a organização única `intercert`
  (`ORG_ID` em `src/server/db.ts`). Toda consulta filtra por `organizationId`.

## Dependências já instaladas (não rode `npm install`; se faltar algo, registre no relatório)
postgres (postgres.js), @supabase/supabase-js (só Auth no navegador), zod, date-fns, lucide-react, recharts, @dnd-kit/{core,sortable,utilities}, clsx,
tailwind-merge, class-variance-authority, @radix-ui/react-{dialog,dropdown-menu,tabs,popover,select,tooltip,checkbox,
switch,avatar,scroll-area,separator,label,progress,slot}, cmdk, sonner, server-only. Dev: tsx, dotenv, playwright,
vitest (`npm test` puros; `npm run test:db` integração com Postgres).

## Estrutura de pastas
```
src/domain/types.ts        tipos de TODAS as entidades (fonte da verdade do modelo de dados)
src/domain/constants.ts    departamentos, papéis, navegação, rótulos, tipos de evento
src/lib/utils.ts           cn()
src/lib/format.ts          formatCurrency, formatDate, formatRelative, initials
src/server/db.ts           acesso a dados: col, getById, list, create, update, remove, batch, nextNumber
src/server/docdb.ts        documentos no Postgres com a API do Firestore Admin (transações, FieldValue)
src/server/auth/auth-admin.ts logins no Supabase Auth (criar, senha, desativar, encerrar sessões, excluir)
supabase/migrations/       schema do banco (uma tabela por coleção; funções de patch e de gestão de logins)
src/server/auth/session.ts requireUser, getCurrentUser, requireScreen/requirePermission (fachada de autorização)
src/server/auth/permissions.ts resolução das permissões efetivas, can, canSeeHref (sem dependências de servidor)
src/server/auth/scope.ts   escopo de dados por tela (resolveDataScope)
src/domain/permissions/    catálogo de acessos (módulo → tela → seção → ação → escopo) e DSL de regras
src/server/events/         motor de eventos: emitEvent, registerHandler, handlers/
src/server/notifications.ts
src/server/<modulo>/queries.ts   leituras (server-only)
src/server/<modulo>/actions.ts   Server Actions ('use server') com validação zod
src/components/ui/         kit de UI (Button, Card, Badge, Drawer, Modal, Tabs, Table, Input, Select...)
src/components/layout/     AppShell, Sidebar, TopBar, MobileNav, PageHeader, GlobalSearch
src/components/<modulo>/   componentes do módulo (client components quando precisam de estado)
src/app/(auth)/login       login
src/app/(app)/...          rotas autenticadas (layout aplica requireUser e o AppShell)
scripts/seed.ts            dados demonstrativos (idempotente, IDs determinísticos)
```

## Regras de acesso a dados
- Use `where` de igualdade (`==`, `in`, `array-contains`) via `list()` e ordene/filtre em memória. (A regra nasceu
  dos índices compostos do Firestore; no Postgres não quebra, mas mantê-la deixa as consultas simples e cobertas pelos
  índices `organization_id` e GIN de `data`.)
- Coleção nova: entra em `COLLECTIONS` e numa migration nova com `select interos.create_doc_table('<nome>');`
  (o teste `tests/docdb/schema.test.ts` falha se faltar). Aplique a migration no Supabase antes do deploy.
- Volume de uma organização é pequeno (milhares de docs). Ler a coleção filtrada por `organizationId` (+ 1 ou 2
  igualdades) e agregar em memória é a abordagem padrão.
- IDs: automáticos (20 caracteres, `autoId` do docdb) em runtime; no seed use IDs determinísticos (`client_001`).
- Nunca use `Timestamp` ou `FieldValue.serverTimestamp()`; use `nowIso()`.
- Documentos lidos do banco são objetos simples (JSON) e podem ser passados a Client Components.

## Convenções de Server Actions
```ts
'use server'
import { z } from 'zod'
import { failAction, requirePermission } from '@/server/auth/session'
export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('operacao.tarefas.criar') // chave do catálogo; nega com PermissionError
    const data = schema.parse(input)                               // ZodError -> { ok: false, error }
    ...
    await emitEvent({ ... })
    revalidatePath('/tarefas')
    return { ok: true, data: { id } }
  } catch (error) {
    return failAction(error, 'Não foi possível criar a tarefa')
  }
}
```
- `ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }` (em `src/domain/types.ts`).
- Ações recebem objetos simples (não FormData) e são chamadas de Client Components com `useTransition`.
- Toda mutação relevante emite um evento (`emitEvent`) — o evento alimenta timeline, notificações, SLA e KPIs.
  Não coloque regra de negócio dentro de componentes.

## Motor de eventos
- `emitEvent({ type, actor, clientId?, entity?, title, description?, payload?, timeline? })` grava em `events`,
  grava em `timeline_events` quando há `clientId` (timeline = true por padrão) e executa os handlers registrados
  para o tipo (e para `'*'`). Handlers ficam em `src/server/events/handlers/` e são registrados em `handlers/index.ts`.
- Tipos de evento em `EventType` (`src/domain/constants.ts`). Adicione novos ali, nunca strings soltas.

## Workflow e gates
- `workflow_templates` define etapas (`stages`) com gate: campos obrigatórios, checklist, aprovação, SLA em horas,
  papel/departamento responsável e tarefas automáticas.
- `workflow_instances` = jornada de um cliente (1 por processo comercial). `workflow_steps` = uma etapa da instância.
- `completeGate(stepId, payload)` valida o gate e, via evento `workflow.stage.completed`, conclui a etapa, cria a
  próxima, atribui responsável, cria tarefas, inicia SLA e notifica.

## SLA (motor reutilizável)
- `sla_rules` configuráveis por chave (`suporte.critico`, `workflow.financeiro`...). `sla_instances` vinculadas a
  entidades (tarefa, etapa de workflow, chamado). Estado calculado na leitura por `computeSlaState()`:
  `dentro_do_prazo | em_atencao | em_risco | violado | pausado | concluido`.
- Horário comercial: seg–sex 08:00–18:00 (America/Sao_Paulo), feriados em `settings`.
- A regra vale pela CHAVE (quem inicia o SLA a referencia); o campo `department` da regra só identifica a regra nos
  relatórios. Chaves usadas: `suporte.<prioridade>` (chamados), `implantacao.projeto`, a regra da etapa ou
  `workflow.<etapa>` (jornada), `tarefa.padrao` (passo de fluxo com horas).
- **SLA padrão por departamento** (`tarefa.<departamento>`, `src/domain/sla-defaults.ts`): toda tarefa criada aberta e
  sem SLA próprio (`createTaskInternal`: manual, recorrente, automática, passo de fluxo sem horas) inicia o SLA da
  regra do seu departamento, se ativa e de tarefas; sem data de entrega, a tarefa recebe o vencimento do SLA. Quem
  inicia SLA próprio passa `departmentSla: false`. Configurado em Administração › Configurações › Regras de SLA.

## UI
- Identidade: fundo claro na área de conteúdo, sidebar escura (navy `#0B1F3A`), acento laranja Intercert
  `#F26A21`, secundário azul-petróleo `#0E7C9B`. Cores semânticas: verde = concluído/positivo, âmbar = atenção,
  vermelho = crítico/atrasado, azul = informação/processo. Tokens em `src/app/globals.css`.
- Mobile first para uso operacional: navegação inferior no celular, drawers em vez de páginas para detalhes,
  alvos de toque ≥ 44px, tabelas viram cards em telas pequenas.
- Textos da interface em português do Brasil. Identificadores em inglês.
- Estados obrigatórios em toda lista/tela: vazio, carregando (loading.tsx), erro.
- Sem números fixos "de enfeite": todo indicador vem do banco.
- Troca de versão com a aba aberta (a Vercel Hobby não tem Skew Protection): uma Server Action da versão anterior
  recebe 404 e o Next lança `UnrecognizedActionError`; `AppErrorView` (`src/components/layout/app-error-view.tsx`,
  usada por `src/app/(app)/error.tsx` para as páginas e por `src/app/error.tsx` para o próprio shell: presença,
  softphone, notificações, e as páginas públicas, sem o atalho "Ir para Meu Dia") reconhece (`isNewVersionError`, `src/lib/version.ts`), explica que o envio não foi salvo e
  recarrega depois de 2,5 s (trava de 30 s no `sessionStorage` contra laço; dentro dela o texto pede para recarregar à
  mão); após a recarga o `VersionWatcher` mostra um toast "repita a ação" (marca `NEW_VERSION_NOTICE_KEY`). A busca
  global, que chama a action fora de transição, trata a rejeição com mensagem própria. Antes disso, `VersionWatcher` (shell) compara `NEXT_PUBLIC_BUILD_ID` (id do deploy embutido em
  `next.config.ts`) com `GET /api/versao` ao voltar para a aba e a cada 10 min, e avisa com um toast fixo "Recarregar"
  (não recarrega sozinho: pode haver formulário aberto).

## Circuito de receita (venda → contrato → financeiro → comissões → contas a pagar → implantação)
- **Venda** = `Opportunity` com stage `ganho` (não existe entidade Venda). No ganho a oportunidade recebe
  `saleNumber` (VEN-AAAA-NNNN) e o bloco `closing` (forma de pagamento, dia de vencimento, 1º vencimento, prazo,
  recorrência, parcelas da adesão, contato responsável, implantação contratada, observações). Campos opcionais:
  vendas antigas continuam válidas.
- **Contrato** nasce por um único caminho (`ensureContractForOpportunity`, idempotente por oportunidade) e herda o
  `closing`; `contract.items` (líquidos de desconto, `contractEffectiveItems`) é a fonte única para `client_products`
  e comissões. Status não mudaram (`aguardando_contrato → … → liberado | cancelado`); `cancelContract` (com motivo,
  evento `contract.cancelled`) é o único caminho de cancelamento, inclusive via churn.
- **Financeiro**: cobranças (`buildBillingPlan`: forma de pagamento e adesão parcelada), `registerPayment` é o único
  caminho de recebimento, vencidas detectadas na leitura (`listBillingsSwept`) e pela varredura diária
  `cobrancas_vencidas`; `contratos_alertas` cobra contratos parados (setting `financeiro_alertas`).
  Uma tarefa financeira por etapa do contrato: "Emitir contrato e cobrança" (no ganho) é concluída na assinatura,
  quando nasce "Gerar cobrança e liberar"; a liberação conclui o que restar.
- **Liberação** (`releaseContract`) emite `financial.released` e cria o projeto de implantação com `saleSnapshot`
  (handoff: card "Dados da venda"; `implementationRequired=false` vira aviso no projeto e badge na lista/kanban).
- **Resumo do contratado** (`src/components/finance/contract-summary*`): mesmo componente na página do contrato,
  painel lateral, documento, implantação e Cliente 360º (Visão geral em modo `rows="essential"` e aba Financeiro).
- **Meu Dia é um só, parametrizado pelo perfil** (`src/server/meu-dia/queries.ts`): equipe financeira/gestor
  financeiro/admin/diretoria recebem cobranças vencidas, vencimentos em 3 dias, fila de contratos, títulos a
  aprovar/pagar/vencidos e comissões elegíveis sem título; vendedor recebe contratos das próprias vendas aguardando
  assinatura e cobrança vencida de cliente seu. Tudo entra nas prioridades (com link real) e no bloco "Financeiro
  do dia"; o card "Pendências" soma exatamente o que entrou.

## Motor de comissões (v2, `src/server/commissions/*`)
- Regras (`commission_rules`) com precedência **contrato > vendedor > produto/categoria > padrão > Product.commission**;
  gatilhos (`venda`, `contrato_assinado`, `primeiro_pagamento`, `pagamento`, `permanencia`,
  `pagamento_e_permanencia`, `mensalidade_n`), base contratado/recebido, carência, competências recorrentes, vigência,
  `overridesDefault` e motivo obrigatório em exceção por contrato. Regras antigas valem como "padrão".
- Comissão = documento por `sourceKey` (`contractId|revenueType|productId[#n]|slot|ruleId`), id determinístico
  `com_<sha1>` criado com `createIfAbsent` (nunca duplica), código COM-AAAA-NNNNN, `ruleSnapshot` congelado e
  `calc.steps` (memória de cálculo). Ciclo: `prevista → em_carencia | aguardando_recebimento → liberada ("Elegível")
  → titulo_gerado → paga`, mais `cancelada`, `bloqueada`, `estornada`.
- Reconciliação idempotente (`reconcileContractCommissions`) disparada por `opportunity.won`, `contract.signed`,
  `payment.approved`, `payment.overdue`, `contract.cancelled`, `financial.released`, alteração de regra/itens e pela
  varredura diária `comissoes` (carência vencida). `src/server/sales/commissions.ts` é só compatibilidade (delega).
- Visibilidade no servidor (`permissions.ts`): financeiro/admin/diretoria veem tudo; gestor, a equipe
  (`getPerformanceAccess`); vendedor, só as próprias — vale para /financeiro/comissoes, relatório e o bloco
  "Minhas comissões" do Meu Desempenho (`getUserCommissionsDigest`).

## Boleto, baixa bancária, estorno e régua (etapa 4, `src/server/finance/*`)
- **Boleto (D20)**: `Billing` ganhou campos opcionais `provider`, `externalId`, `chargeStatus`, `paymentUrl`, `boleto`
  (linha digitável, nosso número, código de barras, PDF → documento "Boleto", emitido em, banco) e `pix`. Sem provedor
  conectado (situação atual) o boleto é emitido no banco/ERP e **registrado** na cobrança (`registerBoleto`, evento
  `billing.updated` com `changes`); `generateBillings` deixa `chargeStatus: "aguardando_emissao_manual"`. Ações no
  painel da cobrança: Registrar boleto · Enviar boleto · 2ª via (mesmo helper) · Cobrar por WhatsApp/e-mail; badge e
  filtro "Boleto" (sem boleto · emitido · pago) em Cobranças e Contas a Receber.
- **Contrato do adaptador de cobrança** (`src/server/integrations/billing-provider.ts`, a implementar quando o
  provedor for definido — Asaas, Iugu, banco): `createCharge` (chamado em `generateBillings` só quando
  `billingProviderConnected()`), `getChargeStatus`/`getChargeDetail?` (conciliação), `cancelCharge` (em
  `cancelBilling`/`cancelContract`; falha não impede o cancelamento local, fica em nota), `handleWebhook` (valida a
  assinatura/token PRÓPRIOS do provedor e devolve `payments[] { externalId, eventId, status, paidAmount, paidAt }`).
  A rota `/api/webhooks/cobranca` responde 503 sem provedor e, com ele, chama `applyWebhookPayments` →
  `registerPayment(source: "provedor")`. Depois marque `implemented: true` no catálogo (`status.ts`).
- **Baixa (D21)**: `registerPayment` é o caminho ÚNICO e é transacional (status conferido dentro da transação:
  duas baixas concorrentes → só uma). Entrada ganha `source` (manual | provedor | conciliacao), `externalPaymentId`,
  `providerEventId`, `provider`. Deduplicação de evento externo na coleção `payment_events` (id `<provedor>_<eventId>`,
  `createIfAbsent` ANTES da baixa; reenvio → `alreadyProcessed: true`, sem erro). Tolerância (setting
  `financeiro_baixa`, só para baixa automática): recebido < cobrança − tolerância → NÃO baixa; grava
  `partialPaidAmount/partialPaidAt`, registra pendência no contrato (ou avisa o Financeiro quando já liberado) e
  devolve `partial: true`. `payment.approved` leva `source`, `externalPaymentId` e `changes` (status/paidAmount/paidAt).
  Varredura `conciliacao_bancaria`: só age com provedor conectado (`getChargeDetail`/`getChargeStatus` das cobranças
  abertas com `externalId`); sem provedor fica "ignorada: provedor de cobrança não conectado" em /admin/automacoes.
- **Estorno (D22)**: `reversePayment({ billingId, reason })` (requireFinanceOperator, motivo obrigatório): cobrança
  paga volta a `aberta`/`vencida` pela data, `paidAt/paidAmount` limpos e guardados em `reversedPayments[]`, evento
  `payment.reversed` com `changes`. Handler (`src/server/commissions/reversal.ts`): comissão elegível/com título que
  depende da cobrança → título não pago é cancelado e a comissão volta a "aguardando recebimento"; título pago não é
  tocado (estorno manual da comissão) e o gestor financeiro é avisado. Contrato "pago" (não liberado) volta a
  aguardar pagamento; liberado não regride (aviso ao Financeiro).
- **Canais (D23)**: helper ÚNICO `sendOrRecord` (`src/server/integrations/communications.ts`) envia pelo provedor
  quando conectado; senão registra manual (wa.me/mailto) — usado por Financeiro, Central de Vendas, Caixa de Entrada
  e Suporte. Respeita `Client.communicationOptOut` (registro `nao_enviada`) e aceita id determinístico (régua).
  `sendBillingMessage(billingId, { channel: whatsapp | email | ambos, text?, includeBoleto? })`: destinatário =
  contato do contrato → e-mail de cobrança da venda → contato principal → cliente; setting `cobranca_canais`
  (principal WhatsApp, complementar e-mail, `enviarEmailJuntoAoWhatsapp`). Webhook do WhatsApp valida
  `X-Hub-Signature-256` (WHATSAPP_APP_SECRET) e processa `statuses` (entregue/lida/falha em `communications`).
- **Régua (D24)**: setting `regua_cobranca` { ativa (padrão **false**), diasUteis, marcos [{ id, nome, offsetDias
  (negativo = antes, positivo = depois), canal, template, ativo }], pausarQuando }. Varredura `regua_cobranca`
  (`src/server/finance/regua.ts`, diária + preguiçosa em Cobranças/Contas a Receber): executa cada marco UMA vez por
  cobrança (comunicação `comm_regua_<billingId>_<marcoId>[_canal]` via `createIfAbsent`; tarefa por processId
  `regua:<billingId>` + título), com folga de 2 dias; canal não conectado → registro "não enviada" + tarefa ao
  Financeiro com texto e link prontos; evento `billing.reminder_due`. Prévia honesta em Configurações › Cobrança.
  Meu Dia deriva "vencem nos próximos N dias" do menor marco antes do vencimento quando a régua está ativa.

## Aditivos, renovação, cobrança recorrente e 3ª mensalidade (etapa 5, `src/server/finance/*`)
- **Aditivo (D25)** = coleção `contract_amendments` (`cta_<contractId>_<n>`, número `<CT>-A<nn>`), UM em andamento
  por contrato, só depois da assinatura (antes dela itens/condições mudam direto no contrato, com `versionPatchIfSent`
  guardando o snapshot em `previousVersions[]` kind "revisao"). Fluxo `rascunho → aguardando_assinatura → assinado →
  aplicado` (ou `cancelado`); `requiresSignature=false` = ajuste interno aplicado direto. O servidor calcula
  `before`/`after` (`ContractSnapshot`, `src/domain/contract-snapshot.ts`) e `changes` (de → para via `auditChanges`);
  `sendAmendmentForSignature` fixa `documentHash` e copia os signatários do contrato; assinatura manual com evidência
  (mesmo diálogo do contrato). `applyAmendment` é transacional (versão conferida): contrato ← `after`, `version+1`,
  entrada `previousVersions` kind "aditivo", `amendmentIds`; depois `contract.updated` (changes), `client_products`
  sincronizados (item novo → ativo; removido → cancelado com `cancelReason`; MRR do cliente), cobranças futuras
  refeitas (`rebuildFutureBillings`: mensalidades EM ABERTO com competência ≥ vigência canceladas e recriadas com a
  MESMA numeração/competência/vencimento; adesão/hardware a mais → cobrança avulsa; id `bill_<c>_<tipo><n>[_r<k>]`),
  comissões reconciliadas (só previstas/em carência mudam) e aviso ao gestor de Implantação para itens novos —
  **nenhum projeto novo**. Item incluído por aditivo carrega `ProposalItem.since` { amendmentId, installment,
  setupInstallment?, hardwareInstallment? }: o motor só planeja parcelas a partir daí (`planSlots`), nunca sobre
  mensalidades pagas antes do item existir. Documento: `?versao=N` (snapshot histórico, faixa "somente leitura"),
  `?aditivo=<id>` (termo com condições anteriores × novas, assinaturas e hash); seção "Aditivos aplicados" no
  contrato consolidado. Eventos `contract.amendment_created|sent|signed|applied|cancelled`. `createManualContract`
  não é mais o caminho para alterar contrato vigente.
- **Cobrança recorrente (D24b)**: `extendBillingPlan`/`generateNextBillings(contractId, actor, { months?, horizonMonths? })`
  idempotentes por id determinístico (`createBillingWithDeterministicId`); contrato de prazo fixo completa
  `termInstallments`; contrato com `autoRenew` ou sem prazo tem horizonte rolante (setting
  `financeiro_alertas.horizonteCobrancasMeses`, padrão 3) pela varredura diária `cobrancas_recorrentes`. Botão
  "Gerar próximas cobranças (N)" no card de cobranças (`pendingRecurringInstallments`). "Vencido" é estado DERIVADO
  (`isContractExpired`: liberado com `endDate` < hoje): fora do MRR/contratos ativos (overview, workspace,
  recorrência, resumo do cliente, KPI `contractEndOfMrr`) e badge nas listas/página — nada gravado no banco.
- **Renovação (D26)**: fechamento da venda e contrato ganham `autoRenew`, `renewalTermMonths`, `readjustment`
  { nenhum | percentual(percent) | indice(ipca|igpm|inpc) } e `noticeDays` (opcionais). Renovar = aditivo kind
  "renovacao": `endDate` = max(endDate, hoje) + meses, `termMonths` PRESERVADO, percentual aplicado à mensalidade
  (itens reajustados), mensalidades do novo prazo geradas (`generateNextBillings`, descontando as que o horizonte já
  criou além do fim anterior). Índice oficial NÃO é buscado: renova sem reajuste, `readjustment.pending=true` e
  tarefa ao CS "Informar índice de reajuste". Pelo CS: `completeRenewal(renewalId, termMonths, notes, actor,
  { readjustment?, requiresSignature? })` (source `renovacao_cs`; com assinatura fica `em_negociacao` até aplicar no
  Financeiro). Automática: `autoRenewContracts` (`src/server/finance/renewals.ts`, dentro da varredura
  `renovacoes`): liberado + `autoRenew` + fim em até `noticeDays` (padrão 30) → aditivo `renovacao_automatica`
  aplicado 1x (a vigência estendida sai da janela; aditivo aberto bloqueia). `ensureRenewals` não abre renovação
  de CS para contratos com `autoRenew`. Evento `contract.renewed` (+ `renewal.completed` com `amendmentId`).
  Previstas de recorrência limitadas ao fim da vigência (`recurringHorizon`).
- **3ª mensalidade (D27)**: `Commission.gateBillingId`/`expectedAt` gravados pelo motor (gatilho `mensalidade_n` e
  parcelas aguardando recebimento) — "Previsão (vencimento da 3ª mensalidade)" em Minhas comissões e no painel.

## Contas a pagar (`payables`)
- Um título por comissão elegível (`pag_<commissionId>`, `createIfAbsent`; `_2`, `_3`… depois de cancelado),
  código PAG-AAAA-NNNNN, vencimento no `diaPagamento` (setting `comissoes_pagamento`) do mês seguinte à
  elegibilidade. Fluxo `previsto → aprovado → a_pagar → pago` (pagar marca a comissão `paga` na mesma transação);
  cancelar antes de pago devolve a comissão a Elegível; estorno de comissão paga gera título negativo
  (`estorno_comissao`). Títulos manuais permitidos. Aprovar/pagar/estornar: gestor financeiro, admin, diretoria.
- **Contas a Pagar geral (D28, mesma coleção e mesma tela)**: `suppliers` (cadastro simples: nome único, documento,
  contato, PIX/banco, categoria, ativo; eventos `supplier.created|updated` com changes) em
  `/financeiro/contas-a-pagar/fornecedores`; `Payable` ganhou `supplierId`, `costCenter`, `installment/installments`
  (parcelamento: N títulos `pag_<base>_p<n>` com centavos exatos e vencimentos mensais), `seriesId`/`recurrence`
  { frequency mensal|anual, dayOfMonth, until? } (série: título-modelo com `seriesId` = próprio id; varredura
  `contas_recorrentes` cria a próxima ocorrência `pag_rec_<série>_<AAAA-MM>` 30 dias antes, origem `recorrencia`,
  idempotente e respeitando `until`), `attachmentIds` (documentos `entityType: "payable"`) e `overdueNotifiedAt`
  (varredura `contas_a_pagar_vencidas`: aviso ÚNICO ao gestor do Financeiro e a quem aprovou/programou). Categorias
  (`PayableCategory` aberto a chaves novas) e centros de custo vêm do setting `contas_a_pagar` (fixas do circuito
  sempre válidas; rótulos em `payableCategoryLabel`). Filtros por categoria, credor, centro, origem, competência,
  vencimento e série; relatório `contas_a_pagar` (competência, status derivado "vencido", CSV/XLSX/PDF) e card
  "Fluxo de caixa simplificado" (cobranças abertas/vencidas × títulos abertos por mês de vencimento, só dados reais).

## Cadastros financeiros (etapa CP/CR 1, `src/server/finance-registry/*`, `/financeiro/cadastros`)
- **Coleções novas** (regra `if false`, só servidor): `financial_accounts` (conta financeira: nome, tipo
  corrente|poupanca|cartao|dinheiro|investimento|outro, `initialBalance`, `currency` "BRL", banco/agência/conta só
  informativos), `cost_centers` (nome, descrição) e `finance_categories` (mesma entidade nos dois níveis: `parentId`
  null = categoria com `costCenterId` OBRIGATÓRIO; `parentId` = mãe = subcategoria SEM centro próprio, herda tipo e
  centro). Todas com `archived` (+ `archivedAt/By`, `archiveReason`): nada é excluído, arquiva/reativa com motivo.
  `legacyKey` guarda a chave antiga do setting `contas_a_pagar` (importação manual); `mergedIntoId` marca a origem de
  uma mesclagem.
- **Regras puras** em `src/domain/finance-registry.ts` (testes em `tests/finance/registry.test.ts`): `validateCategory`
  (categoria sem centro recusada; subcategoria exige mãe ativa de nível 1, herda o tipo, centro próprio recusado; nome
  único entre as ATIVAS do mesmo nível/tipo; tipo não muda com subcategorias ou uso), `resolveEffectiveCostCenter`
  (título/lançamento → próprio → categoria → mãe → "Sem centro de custo"; base das etapas 4 e 7), `planArchiveCategory`
  (subcategorias que vão junto + uso), `planApplyCostCenter`, `planMoveSubcategories` (mesma tipo, sem nome repetido na
  destino), `planMergeCategories` (subcategorias e registros da origem vão para a destino; origem arquivada),
  `planLegacyImport` (idempotente, só cria), `accountBalance` (saldo inicial + entradas − saídas; sem lançamentos = saldo
  inicial) e `registryProblems` (invariantes do `verify.ts`, item (w)).
- **Títulos**: `Payable.categoryId`/`costCenterId` (opcionais, gravados a partir da etapa 4) são a referência NOVA; a
  contagem de uso e a mesclagem usam só eles. `Payable.category` (chave) e `costCenter` (nome) continuam como estão; a
  tela mostra à parte "títulos antigos pela configuração" (`legacyKey`). Lançamentos de caixa (etapa 2) entram em
  `listCategoryReferences` e `accountBalance`.
- **Centro de custo em uso** (categorias ativas apontando para ele) não é arquivado: aplique outro centro antes.
- **Importar da configuração atual** (manual, `financeiro.cadastros.importar`): cria centros de
  `contas_a_pagar.centrosDeCusto` e categorias de DESPESA de `contas_a_pagar.categorias` + fixas do circuito, com o
  centro mais usado nos títulos daquela categoria ou um centro padrão escolhido; o que já existe (mesma chave antiga ou
  mesmo nome) fica como está. Não altera títulos nem o setting.
- **Eventos** (auditoria "de → para" + motivo, fora da timeline do cliente): `financial_account.*`, `cost_center.*`,
  `finance_category.*` (created/updated/archived/reactivated; `merged`; `bulk_updated` com `payload.kind`
  aplicar_centro|mover_subcategorias) e `finance_registry.imported`. Entidades no relatório de Auditoria: "Conta
  financeira", "Centro de custo", "Categoria financeira", "Cadastros financeiros"; histórico também na própria tela.
- **Acesso**: tela `financeiro.cadastros` (padrão = público de Contas a Pagar: equipe financeira e gestores; gestor fora
  do Financeiro só consulta), abas = seções `financeiro.cadastros.{contas,centros,categorias}.ver`, 12 ações com padrão =
  quem opera Contas a Pagar/Fornecedores (administrador, diretoria, papel ou departamento Financeiro). Sem item de menu:
  entra pelo cabeçalho de Contas a Pagar e por Configurações › Contas a pagar. Saldo sob "Visualizar valores" (editar
  conta exige a chave).

## Numeração transacional (`nextNumber` em `src/server/db.ts`)
- Coleção `counters` (`counter_<prefixo>_<ano>`), `runTransaction`, inicializada a partir do maior número já gravado
  (`initFrom`). Usada por VEN, CT, PR, COM e PAG; formatos antigos preservados, sem renumerar documentos.
  `verify.ts` confere que nenhum contador fica abaixo do maior número existente.

## Autorização (catálogo, precedência, escopo, invariantes, helpers)
Um só mecanismo: `session.ts` continua o único ponto de identidade (papéis de `ROLE_KEYS`, sessão por cookie) e as
permissões são uma camada sobre ele; não há segundo sistema de usuários, de permissões nem de menu. O frontend só
**esconde**; quem autoriza é sempre o servidor (página, Server Action, API).

### Catálogo (`src/domain/permissions/`, puro, um arquivo por módulo)
- Hierarquia MÓDULO `<m>.acessar` → TELA `<m>.<tela>.ver` → SEÇÃO/ABA `<m>.<tela>.<secao>.ver` → AÇÃO
  `<m>.<tela>[.<secao>].<verbo>` → ESCOPO por tela. 11 módulos, 66 telas, 133 seções, 250 ações (460 chaves na união
  literal `PermissionKey`). Rótulos de negócio em português em cada nó (a interface nunca mostra a chave técnica).
- Cada nó tem uma **regra padrão** na DSL (`"all"`, `any`, `all`, `role`, `department`, `manager`, `director`,
  `managerOf`, `can`) que reproduz o comportamento anterior à etapa (teste T0 contra a cópia congelada dos predicados
  antigos em `tests/permissions/legacy.ts`); `evaluateRule` é o único avaliador e `describeRule` gera o texto da
  interface ("Administrador, gestores ou departamento Financeiro").
- Extensões: `moduleGate: "ativo"` (tela que só exige o módulo ativo, ex.: Relatórios), `modules` (tela aberta por
  qualquer de vários módulos, ex.: Comissões = Financeiro ∨ Vendas), `virtual` (capacidade transversal sem página, ex.:
  `financeiro.valores` — "Visualizar valores"), `requireScreenAny` (página compartilhada, ex.: `/admin/configuracoes`),
  `redirectTo`, `nav` (menu/celular/atalho "+", com `nav.rule`/`quickAction.rule`), `guards` (funções que a chave
  protege, com qualificador `#função?<condição>` quando a chave depende do argumento — criar × editar), `checkedIn`
  (chave exigida ALÉM do dono quando uma condição ocorre), `viewGuards` (leituras protegidas por tela/seção),
  `SETTING_PERMISSION` (chave de edição de cada configuração de `upsertSetting`), `scope` (abaixo) e `applyAt`
  (documentação de onde o escopo é aplicado). `MODULE_ACCESS` segue exportado como fachada histórica.
- **Chaves protegidas** (`PROTECTED_KEYS`): `inicio.acessar`, `inicio.meu-dia.ver`, `admin.acessar`,
  `admin.usuarios.ver/editar`, `admin.acessos.ver/gerir` — base dos invariantes.

### Precedência (determinística — `resolvePermissions` em `src/server/auth/permissions.ts`)
1. **Módulo inativo na empresa** nega tudo do módulo para todos, admin incluído. `organizations/{org}.inactiveModules`
   (os desligados) tem prioridade sobre `activeModules` (forma antiga, lista dos ligados); sem nenhum dos dois, todos
   ativos (`activeModulesOfOrganization`). `inicio` e `admin` nunca são desativados. Dados não são apagados.
2. **Hierarquia por E**: efetivo(ação) = valor(ação) ∧ efetivo(seção pai) ∧ efetivo(tela) ∧ efetivo(módulo). Negar a
   tela nega todas as suas seções e ações; conceder uma ação não abre a tela.
3. **Valor próprio de cada nó** = exceção do usuário (`permission_profiles/user_<uid>`) ?? ajuste do perfil do papel
   (`permission_profiles/role_<papel>`) ?? regra padrão. Em cada nível há um só valor por chave: o mais específico vence.
   Com a exceção em **modo restrito** (`restricted: true`), um nó não marcado vale: `true` se está no caminho até um
   item marcado como Permitir; o valor do perfil/regra se está dentro de um item marcado; `false` nos demais casos
   (o módulo Início segue sempre o perfil).
4. **Escopo por tela** = exceção ?? perfil ?? padrão do papel (`scope.defaultByRole` + `overrides`), sempre dentro de
   `scope.allowed` (`clampScope`); telas com `sameAs` herdam o escopo da tela indicada (ex.: Visão Geral, Assinaturas,
   Cobranças, Contas a Receber e Recorrência seguem **Contratos**; Kanban/Treinamentos/Go-live seguem **Projetos**).
5. **Sem atalho para admin**: nenhum `role === "admin"` em `can`; o admin tem tudo porque as regras padrão o incluem e os
   invariantes impedem retirar dele as chaves protegidas.
6. Cada chave registra a **origem** (`padrao`, `perfil`, `excecao`, `modulo-inativo`, `hierarquia`) — é o que a seção
   "Acesso efetivo" do drawer mostra.

### Leitura e helpers
- `getCurrentUser` (cache por requisição) lê o usuário e, num `getAll`, perfil do papel + exceção + organização
  (`src/server/auth/permission-store.ts`) e anexa `user.permissions`. Falha nessa leitura → log + matriz padrão + todos
  os módulos ativos: nunca desloga (A4.6). Permissões de OUTRO usuário: `resolvePermissionsForUser(idOuUsuario)`.
- Importe de `@/server/auth/session`: `can(user, chave)`, `canAny`, `canSeeHref(user, href)`; **páginas**
  `requireScreen(tela | seção, { redirectTo? })` / `requireScreenAny([...])` (padrão `/meu-dia?erro=sem-permissao`);
  **actions** `requirePermission(chave)` → `PermissionError`, tratada por `failAction(error, fallback)` (relança
  redirect/notFound com `unstable_rethrow`; mensagens de `BusinessError`/`PermissionError` chegam ao usuário, erros
  técnicos viram o fallback + log); **APIs** `requireApiPermission(chave)` → usuário ou `Response` 401/403 JSON.
  Código puro (serviços usados pelo seed, testes) importa `can` de `@/server/auth/permissions` e as classes de erro de
  `@/server/auth/error-classes` (sem `next/navigation`).
- `generateMetadata` de páginas de detalhe confere permissão e escopo antes de ler dados; sem acesso, título genérico.
- Predicados antigos (`canAccessModule`, `canOperateFinance`, `canOperateImplementation/Support`, `canEditArticles`,
  `canAccessReport`, `canApproveGoLive`…) mantêm nome e assinatura e delegam para `can`. As guardas locais
  (`requireAdmin`, `requireFinanceOperator`, `requireCsUser`, `requireSalesUser`, `requireOperator`, `requireWith`) e os
  `fail()` locais foram removidos; `requireRole` fica exportado sem chamadores (compatibilidade).
- Aprovação por terceiros tem chave própria: `operacao.workflow.aprovar-qualquer` (gates de outro responsável) e
  `implantacao.go-live.aprovar-qualquer` (go-live de projeto alheio ou com "exige gestor").

### Escopo de dados (`src/server/auth/scope.ts`)
- `ScopeKind = "meus" | "equipe" | "departamento" | "unidades" | "empresa"`; `resolveDataScope(user, tela)` →
  `{ kind, userIds?, departmentKeys?, initialKind, poolUnassigned }` com a semântica de "equipe"/"departamento" de cada
  tela (`scope.variants`, descrita na interface). "unidades" vale "empresa" (não há unidade no modelo; não é oferecido).
- Helpers: `scopeAllows`, `filterByScope`, `canSeeRecord(user, tela, donos)`. Listas filtram na consulta do servidor;
  detalhe por id fora do escopo → página de acesso negado; action sobre registro fora do escopo → `PermissionError`;
  id inexistente continua `notFound`/`BusinessError`.
- Cada módulo concentra dono/escopo/capacidades num `access.ts`: `src/server/sales/access.ts`
  (`opportunityInScope`/`proposalInScope`/`visitInScope`, `assert*Access`), `finance/access.ts` (donos do contrato =
  vendedor com fallback oportunidade → cliente, ou responsável financeiro; cobrança e aditivo herdam do contrato;
  `contractAccessById`, `assert*Access`) + `finance/redact.ts` (A13), `commissions/access.ts`
  (`commissionVisibility`, `payableVisibility`, `assert*Access`), `implementation/access.ts` (donos = responsável ∪
  equipe; treinamento = instrutor ∪ donos), `cs/access.ts` (dono = responsável da conta de CS ou `ownerCsId`),
  `support/access.ts` (dono = atendente; chamado sem atendente fica na fila), `marketing/access.ts` (leads sem dono
  visíveis a quem pode atribuir/assumir), `clients/access.ts` e os resolvedores de Meu Dia/Tarefas/Performance/Gestão.
  Os resolvedores antigos que ainda existem (`resolveScope`, `resolveCommissionScope`…) são fachadas sobre o núcleo.
- Padrão = comportamento anterior (testes de equivalência em `tests/permissions/scope.test.ts`); onde não havia
  recorte, o padrão é "empresa" e o CEO/CTO pode restringir.
- Cliente 360: cada aba é uma seção (`operacao.clientes.<aba>.ver`, dados de aba negada não são lidos) e as abas de
  Implantação, Suporte, CS e Financeiro aplicam o escopo da tela dona (`getClient360(id, { sections, user })`).

### "Visualizar valores" (A13)
`financeiro.valores.ver` (e `financeiro.contratos.valores.ver`): sem a chave o servidor zera as quantias
(`redactContract`, `redactBilling`, `redactClientFinancialSummary`…) e a interface mostra "Restrito" — o número nunca vai
ao navegador. Linha digitável e PIX copia-e-cola também saem (codificam o valor).

### Navegação (A11)
`NAVIGATION`, `MOBILE_NAV` e `QUICK_ACTIONS` DERIVAM de `nav` das telas do catálogo
(`src/domain/permissions/nav-table.ts`; valores em `src/domain/navigation.ts`, só servidor). No servidor
(`src/server/auth/navigation.ts`): `filterNavigation` (layout, drawer e `/menu`), `filterMobileNav`,
`filterQuickActions`, `filterShellLinks`, `visibleScreens`, `hrefAccessMap`. O `AccessProvider`
(`src/components/auth/access-provider.tsx`) oferece `useCanSee(href)`, `<ScreenLink>` e `<CanSee>` para esconder links;
cada módulo passa capacidades calculadas no servidor aos Client Components (`SalesAccessProvider`,
`FinanceAccessProvider`, `MarketingAccessProvider`, props `capabilities`). Salvar perfil/exceção/módulos revalida o
layout: o menu muda na próxima navegação.

### Administração de acessos (`/admin/usuarios`)
- Abas `?aba=usuarios|perfis|modulos`. **Perfis e acessos**: árvore Módulo › Tela › Seção › Ação com Padrão/Permitir/Negar
  por nó, badge "Ajustado", escopo por tela, busca, "Só ajustados", restaurar padrão, motivo e últimas alterações.
  **Módulos da empresa**: liga/desliga com aviso de quantos usuários perdem acesso (Início e Administração travados).
  Drawer do usuário: **Exceções de acesso** (motivo obrigatório; bloqueada para o próprio usuário), **Acesso efetivo**
  (origem de cada decisão) e **Histórico de acesso**. As abas aparecem para quem tem a seção `.ver` e ficam somente
  leitura sem `admin.acessos.gerir` (padrão: só admin).
- **Exceções do usuário, dois modos** (`permission_profiles/user_<uid>.restricted`):
  - «Papel + exceções» (padrão): a pessoa recebe tudo o que o papel libera; Permitir/Negar ajustam itens.
  - «Só o que eu marcar» (`restricted: true`): tudo começa bloqueado (origem `restrito`). Permitir num item libera o
    caminho até ele (origem `caminho`) e, dentro dele, o que o papel dá; tela aberta por mais de um módulo fica dentro
    de qualquer um deles. O módulo Início segue sempre o papel. O caminho entra na anti-escalada (I6).
  - Cada nó do editor diz de onde vem a decisão ("Liberado pelo papel Gestor", "caminho até um item que você
    marcou", "Bloqueado: não marcado"). Antes de salvar, `previewUserPermissionOverrides` devolve a prévia exata
    (telas por módulo e quanto vem do papel sem marcação) e a interface pede confirmação.
- Leituras em `src/server/admin/access.ts`; helpers puros (árvore, validação, diff "de → para") em
  `src/server/auth/access-admin.ts`; actions `savePermissionProfile`, `saveUserPermissionOverrides`,
  `previewUserPermissionOverrides`, `saveActiveModules` em `src/server/admin/actions.ts` (só chaves do catálogo com valor booleano e escopos permitidos;
  `__proto__` recusado). `saveActiveModules` grava `inactiveModules` e `activeModules` (compatibilidade).

### Invariantes (A9 — `src/server/auth/invariants.ts`, puro)
Avaliados no **estado resultante** de criar/editar/ativar/excluir usuário e de salvar perfil, exceção e módulos:
- **I1** sempre existe ≥ 1 usuário ativo com `admin.acessos.gerir` + `admin.usuarios.editar` efetivas (só acusa quando
  a mudança quebra a condição);
- **I2** ninguém edita as próprias exceções, perde por perfil/módulo/cadastro uma chave protegida que tinha, se
  desativa/exclui ou muda o próprio papel;
- **I3** o perfil `admin` não aceita negar chaves protegidas;
- **I4** `inicio` e `admin` sempre ativos; `inicio.acessar`/`inicio.meu-dia.ver` nunca negados (evita laço de redirect);
- **I5** não se exclui quem é gestor de departamento;
- **I6** anti-escalada: só quem tem `admin.acessos.gerir` edita perfis/exceções/módulos; o ator só concede chaves e
  escopos que ele próprio tem; atribuir/retirar o papel `admin` exige `admin.acessos.gerir`.
Violação → `BusinessError` com mensagem amigável + evento `permissions.blocked`. Sem bypass hardcoded.

### Auditoria
`permissions.updated` (perfil, exceção ou módulos; `payload.changes` por chave com rótulos de negócio — "Contas a
Pagar › Visualizar: Padrão (permitido) → Negado" —, ator, alvo, motivo), `permissions.blocked`, `user.updated` (com o
que mudou; salário ocultado), `user.deleted`, `department.updated`. Histórico no drawer e na aba Perfis.

### Como adicionar tela ou ação
1. Declare no arquivo do módulo em `src/domain/permissions/` — chave estável em pt-kebab, rótulo de negócio, regra
   padrão (= quem deve ver/fazer hoje), `routes` da página, `guards` da action (`arquivo#função`, com `?condição`
   quando a chave depende do argumento), `nav` se tiver item de menu, `scope` se a tela lista registros com dono.
2. Página: `const user = await requireScreen("<m>.<tela>")` (seção: a chave da seção) — antes de ler qualquer dado;
   `generateMetadata` de detalhe confere acesso antes de ler.
3. Server action: `const user = await requirePermission("<chave>")` como primeira linha dentro do `try`, `catch` com
   `failAction`; registro por id → confira o escopo (`canSeeRecord`/`assert*Access` do módulo).
4. API: `requireApiPermission("<chave>")` (ou token de webhook/cron, listado em `scripts/check-access/analyze.ts`).
5. Interface: esconda botões com capacidades calculadas no servidor (props/contexto), nunca decida no cliente.
6. Rode `npm test` (integridade do catálogo, cobertura, equivalência, precedência, invariantes) e
   `npm run check:access` (estrito: sai 1 com qualquer pendência).

### Verificador de cobertura (A15/A21 — `npm run check:access`)
Estrito por padrão (sai 1 com pendência; `-- --report` só lista; `-- --json`). Confere: toda `page.tsx` chama
`requireScreen` da tela dona da rota (exceto as públicas isentas); toda função exportada de arquivo `"use server"` tem
dono no catálogo e chama `requirePermission` com a chave dona (ou `checkedIn`); todo `route.ts` tem
`requireApiPermission` ou isenção justificada (webhook/cron com token); chaves literais usadas no código existem no
catálogo; toda rota de tela tem página; todo guard aponta para função existente.

### Testes
`npm test` (vitest, puros): catálogo, DSL, precedência, módulos (`inactiveModules`), invariantes, T0 de equivalência,
escopo contra os resolvedores antigos, navegação, erros, verificador, um arquivo `guards-<módulo>.test.ts` por
módulo e `script-imports.test.ts` (serviços usados pelo seed/scripts não podem alcançar `next/navigation`). `npm run test:db` (docdb, transações concorrentes e authAdmin num Postgres real; CI sobe o serviço). E2E `77-acessos.mjs` (T1–T10) na pasta de e2e.

## Auditoria via eventos (D16 + D29, etapa 6B)
- Não há coleção de auditoria: cada mudança relevante emite evento com `actorId`, `occurredAt` e
  `payload.changes {campo: {from, to}}` + `payload.reason` (`auditChanges`/`describeChanges` em `src/server/audit.ts`).
  Valores de pessoas vão pelo NOME (responsáveis, gestor); salário só "valor anterior → novo valor" (nunca o número).
- **Cobertura** (inventário em `scratchpad/circuito/auditoria-inventario.md`): itens e condições do contrato e
  signatários (`contract.updated` SEMPRE, também na revisão que gera versão — `versioned`/`version` no payload), envio
  para assinatura, assinatura manual, liberação (`financial.released`), status derivado após baixa/estorno
  (`contract.updated` kind `status_derivado`, fora da timeline do cliente), dados de faturamento (`client.updated`,
  "— → valor"), pendência (`payment.pending`) e resolução (`contract.pendency_resolved`, novo), cancelamento de
  cobrança (`billing.cancelled` + `Billing.cancelledAt/cancelledBy/cancelReason`, também gravados nos cancelamentos em
  lote do contrato e do aditivo), baixa/estorno, cancelamento de contrato, aditivos/renovação, comissões, regras,
  títulos, fornecedores, `settings.updated` (inclusive os writers próprios `saveGoLiveSettings`, índices da Saúde da
  operação/Desempenho e regras de SLA — kind `sla_rule`), produtos (`product.updated`: preços, comissão, ativo),
  automações (`automation.rule_updated`), metas (`goal.*`), regra de bônus (contra a versão ativa), cadastro do cliente,
  transferência de oportunidade, acessos e usuários/departamentos. Escritas em `settings` que só gravam marcador de
  varredura ou o PADRÃO na primeira leitura não são auditadas (não são decisão de pessoa).
- **Payload imutável**: nada reescreve `payload` depois da gravação. Metadados de execução ficam em `meta`
  (`DomainEventMeta`: `handlerErrors`, `automation { ruleId, depth }` gravado NA CRIAÇÃO a partir do escopo
  `src/server/automations/scope.ts`, `support { postGoLive… }`), escritos por `writeEventMeta` (merge em `meta.*`).
  Leitor da cadeia de automação aceita o formato antigo `payload.__automation`. `handlerErrors` no topo é legado.
- **Formatação** (`src/domain/audit-format.ts`, puro): `CHANGE_FIELD_LABELS` (fallback = nome do campo; o evento pode
  trazer `payload.labels`), `formatChangeValue` (situações, datas, booleanos, quantias, listas de pessoas),
  `changeLines`/`summarizeChanges`, `redactChanges` (A13: sem "Visualizar valores" as quantias saem do objeto ANTES de
  ir à tela; sensíveis como salário sempre mascarados) e `eventChanges` (lê também o formato antigo `payload.from/to`
  de `*.status_changed`/`*.stage_changed`).
- **Timeline**: `emitEvent` copia `changes` e `reason` para `timeline_events`; `Timeline` mostra "Ver alterações (N)"
  colapsável (`ChangeList`) com "campo: antes → depois" e o motivo. Cliente 360 e Implantação redigem quantias pela
  permissão do usuário. Eventos anteriores à etapa só mostram alterações no histórico do contrato e no relatório.
- **Histórico do contrato** (`getContract`): lido de `events` do cliente com `belongsToContractHistory` — entra o
  evento com `payload.contractId` = este contrato ou cujo `entityId` é o contrato/uma cobrança/aditivo/projeto/oportunidade
  dele; `payload.contractId` de OUTRO contrato nunca entra; comissões/títulos/indicadores ficam fora (tela própria).
- **Relatório "Auditoria"** (`REPORT_KEYS`, `buildAudit` em `src/server/reports/build.ts`): eventos do período com
  alterações ou motivo; filtros período (dia), usuário (quem fez), tipo de entidade, tipo de evento e texto (sem
  acento); colunas quando, quem, evento, entidade, título, alterações (resumo "campo: de → para") e motivo; CSV/XLSX/PDF
  pela rota existente (PDF troca "→" por "->", fonte padrão). Acesso: seção `gestao.relatorios.auditoria.ver` e
  exportação `gestao.relatorios.auditoria.exportar` (padrão diretoria e administrador; ajustável por perfil/exceção);
  escopo da tela Relatórios aplicado pelo ator; quantias só com "Visualizar valores". Sem hash chain.

## Portal do Cliente (D31, etapa 6B, `src/server/portal/*`, `src/app/portal/[token]`)
- **Modelo**: coleção `portal_links` (regra `if false`, coberta em `scripts/test-rules.ts`). Id = **sha256 do token** em
  hex (64); o token são 32 bytes aleatórios (`randomBytes`) em base64url (43 caracteres), devolvido **uma vez** por
  `createPortalLink` e **nunca gravado** (nem em claro, nem cifrado). Campos: `clientId`, `contractId?` (de onde foi
  gerado; o portal mostra o CLIENTE inteiro), `label?`, `origin` ("manual" | "mensagem"), `communicationId?`,
  `expiresAt`, `revokedAt/revokedBy/revokeReason?`, `createdBy/createdByName`, `lastAccessAt?`, `accessCount`,
  `lastAccessEventDay?`. Regras puras em `src/domain/portal.ts` (formato, validade 1–365 dias — padrão 90 na tela,
  30 nas mensagens —, estado ativo/revogado/expirado, 1 evento de acesso por dia, `{linkPortal}`, máscara);
  token/hash em `src/server/portal/token.ts`.
- **Página pública** `src/app/portal/[token]/page.tsx`: fora de `(app)` (modelo `/csat`), `/portal` em `PUBLIC_PATHS`
  do proxy, `dynamic = "force-dynamic"`, metadata `robots: noindex/nofollow` e `referrer: no-referrer`; `next.config.ts`
  envia `Cache-Control: no-store, max-age=0`, `X-Robots-Tag: noindex, nofollow, noarchive` e `Referrer-Policy:
  no-referrer` em `/portal/:path*` (conferido com `next build && next start`: `Cache-Control: no-store, max-age=0`; só o
  `next dev` força `no-cache, must-revalidate` em toda página). Isenção
  justificada no catálogo (`EXEMPTIONS`). Fluxo (`loadPortalForToken`): formato → hash → transação que confere o link
  (existe, da organização, não revogado, não expirado) e grava SÓ `lastAccessAt`, `accessCount` e, no 1º acesso do dia
  (São Paulo), `lastAccessEventDay` + evento `portal.accessed` (ator "Cliente (portal)"). Inexistente, revogado,
  expirado, malformado ou falha técnica → a MESMA resposta "Link inválido ou expirado" (200, sem dados).
- **Conteúdo** (`buildPortalContent`, puro, `src/server/portal/content.ts`): contratos do cliente não cancelados, não
  vencidos e com documento gerado (ou liberados) — Resumo do contratado com `rows="client"` (sem venda, vendedor,
  situação financeira interna, contato, observações) e, só se assinado por todos, o documento
  (`components/finance/contract-document.tsx`, `audience="cliente"`: sem avisos internos, e-mails dos signatários, id do
  envelope e motivo dos aditivos); cobranças não canceladas (em aberto/vencidas todas; pagas, as 12 mais recentes) com
  tipo, parcela, competência, valor, vencimento, situação (aberta vencida = vencida, sem gravar) e pago em; linha
  digitável/PDF/link de pagamento/PIX **só quando existem** na cobrança. Nenhum id interno sai (chaves posicionais
  `c1`/`b1`). Sem boleto: botão "Solicitar 2ª via pelo WhatsApp" (wa.me do setting opcional
  `cobranca_canais.whatsappCobranca`); sem número configurado, só um texto (nenhum botão sem ação). A página só lê com
  `list/getById` (não usa `listBillingsSwept`, que grava vencidas).
- **Ações internas** (`src/server/portal/actions.ts`): `createPortalLinkAction` e `sendPortalLinkAction`
  (`financeiro.contratos.portal.gerar`), `revokePortalLinkAction` (`financeiro.contratos.portal.revogar`); escopo:
  contrato informado → `assertContractAccess`; senão `assertClientContractsAccess` (o cliente precisa de ao menos um
  contrato visível na tela Contratos). Seção `financeiro.contratos.portal.ver` (card) — as três com a regra de quem
  opera o Financeiro (= `financeiro.contratos.editar`), ajustáveis por perfil/exceção. Card `PortalLinksCard` na página
  do contrato e na aba Financeiro do Cliente 360: gerar (validade/rótulo; link exibido uma vez com Copiar/Abrir/Enviar
  por WhatsApp ou e-mail via `sendOrRecord`, templateKey `portal_link`, entidade `portal_link`) e lista dos ativos
  (rótulo, origem, criado por/em, expira, último acesso, nº de acessos) com "Revogar" (confirmação + motivo opcional).
- **`{linkPortal}` nas mensagens — decisão**: como o token só existe na criação e não pode ser guardado (nem cifrado),
  NÃO há "link ativo mais recente" reaproveitável. Cada envio cujo texto contém `{linkPortal}` gera um link NOVO
  (`createMessagePortalLink`: origem "mensagem", **30 dias**, rótulo "Cobrança · Mensalidade 3" / "Régua · 7 dias antes
  · …", `communicationId` da comunicação que o levou), listado na ficha com a origem e revogável. Motivos: o token nunca
  persiste; cada link tem dono/rastro próprio (qual mensagem o levou) e validade curta; revogar um não derruba os
  outros. Regras: `renderBillingTemplate` preserva o marcador (ou remove, com `linkPortal: ""` — tarefa/notificação da
  régua, que não chegam ao cliente); `sendBillingMessage` só cria o link se algum canal pode entregar (conectado, ou
  envio manual pela tela; régua sem canal conectado → sem link) e, na cobrança manual, só com
  `financeiro.contratos.portal.gerar` (`checkedIn` em `sendBillingMessageAction`); falha ao gerar → a mensagem segue
  sem o link (como antes); nenhum canal entregou → o link é revogado pelo sistema. Comunicação (`recordText` em
  `sendOrRecord`), evento e tarefa gravam o texto com o link **mascarado** (`redactPortalUrl`); o wa.me/mailto com o
  link real só volta à tela que enviou. verify.ts (v) acusa token em claro em qualquer texto gravado.
- **URL absoluta**: `NEXT_PUBLIC_APP_URL` (configure em produção) → `VERCEL_PROJECT_PRODUCTION_URL` → cabeçalhos da
  requisição (ação, página, cron). Fora de requisição e sem env, nenhum link de mensagem é gerado.
- **Eventos**: `portal.link_created` (`changes` status → ativo e validade), `portal.link_revoked` (`changes` ativo →
  revogado + `reason`), `portal.accessed` (1×/dia por link, `changes.lastAccessAt`) — rótulos, ícones, timeline do
  cliente e relatório de Auditoria (entidade "Link do portal do cliente").
- **Rate limit**: fica na infraestrutura (Vercel Firewall/WAF para `/portal/*`); o token de 256 bits torna adivinhação
  inviável e cada acesso válido é contado.

## Assinatura eletrônica (Clicksign, `src/server/finance/{contract-templates,contract-document,docx,signature-inbox,signature-clicksign,signature-webhook}.ts`, `/financeiro/assinaturas`)

- **Tela em abas** (`?aba=`, `ASSINATURAS_TABS`): `fila` (aguardando / prontos, como antes), `entrada` (documentos
  criados direto na Clicksign, à espera do cliente certo), `modelos` e `configuracao`. Chaves novas:
  `financeiro.assinaturas.{entrada,modelos,configuracao}.ver`, `.entrada.vincular`, `.modelos.editar` e
  `.configuracao.editar` (só gestão); escolher modelo/autenticação no contrato usa `financeiro.contratos.assinatura.editar`.
- **Signatários do contrato** (`SignatureCard` + `src/components/finance/signer-options.ts`): quem assina é escolhido
  entre os contatos do cliente e a equipe ativa da Intercert (testemunha/representante), nunca digitado solto — e a
  regra vale no servidor: `addSignerAction` recebe `{ source: contact | user, id, role }` e `addSignerFrom` resolve
  nome/e-mail do cadastro (contato precisa ser do cliente do contrato e ter e-mail que a assinatura aceite,
  `isSignerEmail` = `z.email()`, pois o cadastro de contatos/usuários é mais frouxo; usuário precisa estar ativo; na
  criação do contrato o signatário do cliente só é semeado com um e-mail que passe nessa regra). Quem
  já assina sai da lista; contato sem e-mail ou com e-mail inválido aparece desabilitado com o motivo. Remover, lembrar
  e assinar à mão (contrato e aditivo) identificam o signatário pelo e-mail gravado sem revalidá-lo (`signerEmailRef`),
  para contratos antigos que copiaram o e-mail do contato principal sem conferir. Com a Clicksign ligada, nome sem sobrenome é
  apontado com link para corrigir no cadastro. "Cadastrar novo contato" (`addContactAsSignerAction`: chave de
  assinatura + `operacao.clientes.contatos.editar` + cliente no escopo de Clientes, a opção só aparece quando a action
  vai aceitar) valida tudo ANTES de gravar (e-mail ainda não signatário, papel, nome para a Clicksign) e só então cria
  o contato (`src/server/clients/contacts.ts#createContact`, o mesmo caminho da action de Clientes) e o adiciona.
  `addSigner` também barra nome sem sobrenome/com números quando a Clicksign está configurada.
- **Configuração** (settings `assinatura_eletronica`): quem assina pela Intercert (padrão: usuário ativo chamado
  Hércules, trocável; com usuário escolhido, nome/e-mail seguem o cadastro) e a autenticação padrão (`email` = código por
  e-mail; também `whatsapp`, `sms`, `icp_brasil`). O signatário entra com `party: "contratada"` na criação do contrato e
  ao gerar o documento (`withCompanySigner`; quem já tem papel "Contratada" conta como ele).
- **Modelos** (`contract_templates`): `interos` (título + cláusulas com `{{variáveis}}`, impressas depois dos dados do
  contrato) ou `word` (.docx da Clicksign; arquivo por versão em `contract_template_files`, id `<modelo>_v<N>`, imutável).
  Variáveis ligadas a `CONTRACT_FIELDS` (sugestão pelo nome: `{{razao_social}}` → `contratante.razao_social`) ou a texto
  fixo; gravada sem ligação sai lacuna (é escolha, e bate com o "Sem campo" da tela); só uma variável que não está na
  lista gravada (modelo antigo, texto editado) com o nome exato de um campo, `{{contratante.cidade}}`, é preenchida;
  apelidos não são adivinhados ao gerar. O endereço do cliente existe inteiro
  (`contratante.endereco`) e em partes (logradouro, número, complemento, bairro, cidade, cidade/UF, UF, CEP); número,
  complemento e bairro saem vazios quando faltam (`empty: "vazio"`, não lacuna); só complemento é `optional`.
  `{{numero}}` é o número do contrato, salvo quando o modelo tem um logradouro separado e nenhuma outra variável já é
  o número do endereço (`suggestField(nome, irmãs)`): aí é o número do endereço. `contrato.produto` é o nome dos
  produtos dos itens, sem repetir ("ERP X e TEF Y"): é o que modelos chamam de "Sistema", "Sistema Operacional" ou
  "Produto" (`contrato.itens` é a lista com quantidades). O diálogo de variáveis mostra, no que
  está sem ligação, a sugestão pelo nome (`suggestUnbound`) com "usar" por linha e "Usar as N sugestões" no rodapé;
  nada é aplicado sozinho (sem campo pode ser escolha, e salvar por outro motivo não grava o que ninguém pediu). Mudar
  texto, arquivo ou ligações sobe a versão. Envio do Word por `POST /api/financeiro/modelos` (multipart; acima do
  limite das Server Actions), até 4 MB.
- **Dados obrigatórios do modelo** (`templateDataGaps` em `src/domain/contract-templates.ts`): toda variável do modelo
  precisa de texto fixo ou de um campo com dado. Só o complemento é `optional`; 1º vencimento e condição de pagamento
  são obrigatórios quando o modelo os usa (editáveis nas condições); início/fim da vigência são `afterRelease` (só
  existem depois da liberação), então a variável precisa de texto fixo no modelo (pendência `apos_liberacao`; o cartão
  do modelo e o seletor de campos avisam). Cada campo tem `source` (cliente, contato, signatário, contrato, Intercert).
  A prontidão é sempre a do PRÓXIMO envio — `documentReadiness(contract)` em `contract-document.ts`: modelo atual
  (escolhido ou padrão, não a fotografia do envio anterior) e o signatário da Intercert incluído como o envio o
  incluirá; é leve (cliente, oportunidade, contatos, organização, modelo; não lê o Word nem o detalhe do contrato). O
  cartão de assinatura mostra "N de M variáveis preenchidas" e cada pendência com onde corrigir; o botão de gerar/
  reenviar fica desabilitado; a fila "Prontos para gerar" faz o mesmo para quem pode enviar (`documentReadinessMany`:
  configuração, organização e modelos uma vez, clientes/oportunidades/contatos em lote; até 40 contratos, acima disso
  e se o cálculo falhar — registrado no log — o envio confere);
  `sendForSignature` recusa com a lista ("preencha no cadastro: …; ligue no modelo: {{x}}; use texto fixo…") e passa o
  documento já calculado ao provedor (`createEnvelope(contract, cliente, document)`), que não relê o contrato. A
  prévia (PDF/Word) também inclui o signatário da Intercert e continua disponível com as lacunas, para conferência.
  O cartão do modelo em Assinaturas › Modelos lista o que ele exige do cadastro (`templateRequirements`).
- **Representante do cliente** (`contratante.representante`, `_email`, `_cpf`): o 1º signatário, na ordem do
  contrato, qualificado como contratante, representante legal ou procurador (`clientRepresentative`, pela mesma regra
  de `clicksignRole`: fora Intercert, testemunha, avalista e fiador). O CPF vem do contato que É essa pessoa: o único
  contato do cliente com o e-mail do signatário ou, se o e-mail for compartilhado (ex.: financeiro@), o que tem o mesmo
  nome (o mesmo contato cadastrado mais de uma vez, com mesmo nome e e-mail, vale como uma pessoa se houver um só CPF);
  nunca "o que tem CPF" entre pessoas diferentes (CPF de outra pessoa no contrato é pior do que a pendência). `Contact.document` é
  validado por `isValidCpf` (`src/domain/documents.ts`) e editável em Clientes e no "cadastrar novo contato" do
  contrato. A pendência diz quem é e o que fazer (cadastrar o CPF do contato; escolher como signatário um contato do
  cliente; e-mail compartilhado sem contato com o nome; duplicados com CPFs diferentes). Na sugestão de variáveis, `{{cpf}}` ao lado de um `{{cnpj}}`
  é o CPF do representante.
- **Documento**: `sendForSignature` fixa o modelo no contrato (`documentTemplate`: id, versão, `contentHash` e, no
  modelo INTEROS, o texto) e ele entra no código de integridade (`contractDocumentHash`; contrato sem modelo mantém o
  hash antigo). `GET /api/financeiro/contratos/[id]/documento?formato=pdf|docx` gera o PDF (pdfkit) ou o Word preenchido
  (troca as variáveis mesmo partidas em vários `<w:t>`, sem dependência externa). Antes de gerar = prévia com o modelo
  atual; contrato gerado antes dos modelos continua sem cláusulas.
- **Caixa de entrada** (`signature_inbox`, id `clicksign_<envelope>`): `recordExternalEnvelope` é idempotente e sugere o
  cliente pelo CNPJ/CPF, e-mail do cliente ou contato, ou domínio corporativo (ignora quem assina pela Intercert);
  vincular cria o documento na ficha do cliente (e no contrato, se escolhido); ignorar pede motivo e pode ser desfeito.
- **Envio pela Clicksign** (`src/server/integrations/clicksign.ts` + `signature-clicksign.ts`): com
  `CLICKSIGN_API_TOKEN`, `activeSignatureProvider()` é a Clicksign (API v3; `CLICKSIGN_ENV` = `sandbox` padrão ou
  `producao`). "Enviar para assinatura" confere os nomes (nome e sobrenome, sem números) e o celular quando a
  autenticação é SMS/WhatsApp, cria o envelope (pt-BR, finalização automática, bloqueio após recusa, lembrete a cada 3
  dias), sobe o Word preenchido ou o PDF com os metadados `interos_contract_id`/`interos_number`/`interos_version`, cria
  cada signatário com o papel (`clicksignRole`) e a autenticação, ativa e dispara o e-mail. Falha no meio apaga o
  rascunho. O contrato guarda `signatureDocumentId` e `providerSignerId` em cada signatário; lembrete sai por
  `notifySigner`; gerar de novo, mudar o contrato ou cancelá-lo cancela o documento antigo na Clicksign (melhor esforço).
  O cliente da API repete em 429/5xx e devolve o erro da Clicksign legível.
- **Avisos** (`POST /api/webhooks/clicksign`, `signature-webhook.ts`): `Content-Hmac` conferido com
  `CLICKSIGN_WEBHOOK_SECRET` (503 sem o segredo, 401 inválido). O contrato vem dos metadados (ou do id do documento) e o
  aviso só vale para o envio ATUAL: versão diferente, envelope diferente (`interos_envelope_id` nos metadados; sem ele,
  o id do documento) ou contrato encerrado são ignorados, inclusive dentro da transação. `sign` marca o signatário
  (método `provedor`); `refusal` marca recusado e avisa o dono e o gestor do Financeiro; `auto_close` (logo depois da
  última assinatura) marca quem está no envelope — quem entrou no contrato depois do envio fica pendente e o contrato
  não fecha; `close`/`document_closed` não marcam ninguém (finalização manual com assinatura parcial vira nota + aviso);
  `cancel`/`deadline` viram nota + aviso. O envelope é criado com `deadline_partial_signature_action: canceled` (prazo
  vencido com assinatura parcial cancela em vez de finalizar). "Assinado por todos" sai do estado gravado
  (`ensureSignedAnnounced`): qualquer aviso confere contrato assinado e não anunciado, reserva em transação
  (`signedAnnounceClaimAt`, vence em 2 min) e anuncia uma vez (`announceContractSigned`, compartilhado com o registro
  manual, grava `signedAnnouncedAt`); falha depois de gravar a assinatura é refeita na reentrega. Documento sem contrato
  vai para a caixa de entrada (id `clicksign_<chave do documento>`; todos contam como assinados só no `auto_close`).
  A recusa grava `refusalNoticePending` no signatário junto com o status; a nota e o aviso saem enquanto estiver
  pendente (falha depois de gravar é refeita na reentrega). Todo aviso do envio atual (inclusive recusa, cancelamento e
  prazo) confere se o contrato precisa ser concluído/anunciado.
- **Envio robusto**: falha antes de ativar apaga o rascunho; depois de ativar, o envio fica gravado mesmo se o e-mail
  falhar (o lembrete reenvia); a gravação final é em transação, relendo o contrato — se ele foi assinado ou reenviado
  enquanto o envelope novo era criado (ou cancelado, alterado para nova versão), o envio novo é cancelado na
  Clicksign e o usuário é avisado; o documento anterior
  é cancelado só depois de gravar o envio (ou a versão) novo; o modelo enviado é o mesmo que fica gravado. Chamadas à
  API têm tempo-limite de 20 s; 429/5xx repetem; tempo-limite/falha de rede repete tudo menos POST (criar ou mandar
  e-mail de novo poderia duplicar). Todo cancelamento de envio na Clicksign (reenvio, nova versão, contrato cancelado,
  conflito) que a Clicksign não confirma vira nota no contrato com o envelope a cancelar lá (`cancelClicksignSend`);
  documento já cancelado lá não gera nota; já FINALIZADO gera a nota "já estava finalizado, confira" (os avisos dele
  passam a ser ignorados). Cancelar o contrato e criar versão nova gravam em transação e cancelam o envio EM VIGOR no
  momento da escrita (`writeContractReturningSend`), não o lido no início; alterar itens/condições recusa a gravação se
  o envio, a assinatura, a versão ou o status mudaram desde a leitura. O envio também é desfeito se o conteúdo do
  contrato (itens, valores, condições, signatários) mudou enquanto o envelope era criado.
- **PDF assinado** (`signed_files`, um por envio: `contract_<id>_<envelope>`; aditivo mantém o envelope): ao finalizar, o PDF assinado é baixado (link da API ou do aviso; https, até 20 MB)
  e guardado no INTEROS, porque os links da Clicksign expiram. `GET /api/financeiro/contratos/[id]/assinado` (mesmo
  acesso do documento; se ainda não guardado, busca na hora) e `GET /api/financeiro/assinaturas/entrada/[id]/arquivo`
  (`financeiro.assinaturas.entrada.ver`).
- **Tela**: a aba Configuração mostra a conexão (token, ambiente de testes x produção, segredo dos avisos), o endereço do
  webhook e os eventos a marcar na Clicksign. Sem o token, tudo segue manual com evidência. O ambiente de testes da
  Clicksign não tem validade jurídica. Não há autenticação gov.br na Clicksign (alternativas: ICP-Brasil, biometria).
- **Testar conexão** (`checkClicksignConnectionAction` → `checkClicksignConnection`, chave
  `financeiro.assinaturas.configuracao.testar`, mesma regra de quem vê a aba): os selos só dizem o que está na Vercel; o
  botão consulta a Clicksign na hora, só leitura (`GET /envelopes?page[size]=1` e `GET /webhooks`, 1 nova tentativa e
  10 s por chamada). Diz se a chave foi aceita (401/403 → apagada, errada ou do outro ambiente) e confere os webhooks
  (`src/domain/clicksign-connection.ts`): o do INTEROS (caminho `/api/webhooks/clicksign`) ativo, com os eventos de
  `CLICKSIGN_WEBHOOK_EVENTS`, segredo igual ao `CLICKSIGN_WEBHOOK_SECRET` (comparado no servidor; o segredo nunca vai
  para a tela) e no domínio deste INTEROS; os de outros serviços (ex.: Pluga) aparecem só pelo domínio, porque o
  endereço completo pode carregar chave de acesso.

## Central de Atendimento (módulo Comunicação, `src/server/conversations/*`, `/comunicacao`)

Fase 1 da Central omnichannel: WhatsApp e e-mail numa tela só. Nada é duplicado — mensagens continuam em
`communications` (agora com `conversationId` e `address`), o envio continua pelo helper único `sendOrRecord`, o SLA
pelo motor único (`entityType: "conversa"`), as permissões pelo catálogo (`src/domain/permissions/comunicacao.ts`).

- **Conversa** (`conversations`): uma aberta por canal + contato. A chave do contato vem de `src/domain/phone.ts`
  (DDD + 8 últimos dígitos: une o celular com e sem o 9, que o WhatsApp costuma omitir). Id determinístico
  `cv_<hash do contato>_<n>` criado com `createIfAbsent`: duas mensagens simultâneas do mesmo número abrem UMA conversa.
  Status `nova → na_fila | em_atendimento ⇄ aguardando_cliente → encerrada`.
- **Entrada** (`inbound.ts`, chamada pelo webhook do WhatsApp): (1) aviso repetido do provedor é ignorado — a
  comunicação tem id derivado do id da Meta; (2) identificação única (`identity.ts`: contato > cliente > lead >
  desconhecido; o lead passa a ser reconhecido); (3) conversa encontrada ou aberta e distribuída; (4) chamado aberto
  do cliente recebe a mensagem também (comportamento anterior); (5) registro técnico em `channel_events`.
- **Filas** (`service_queues`, `queues.ts`): criadas na primeira leitura (Suporte N1/N2, Financeiro, Comercial,
  Atendimento geral = padrão) com os usuários ativos de cada departamento; depois o gestor edita em
  `/comunicacao/canais?aba=filas`. Entrada sem menu (fase 1): chamado aberto → Suporte; lead → Comercial; resto → padrão.
  Distribuição pura em `src/domain/conversations.ts#pickAssignee` (menor carga, rodízio, responsável primeiro, manual),
  só para quem está **online** e abaixo do limite. Roda ao chegar mensagem, ao ficar online (`setPresence`), ao
  encerrar/transferir e ao abrir a Central (no máximo a cada 30 s). Fila sem operador: o que espera nela fica visível
  para todos os operadores (ninguém deixa de ver).
- **Janela de 24 h do WhatsApp**: fora dela a Meta recusa texto livre. Com o canal conectado e a janela fechada, o
  operador usa um **modelo aprovado** (botão «Enviar modelo» ou «Novo atendimento» com modelo) ou envia pelo aparelho.
- **Nota interna**: `communications` do canal `interno` com `templateKey: "nota_interna"`, ligada só à conversa
  (sem `clientId`: não aparece em outras telas). Transferência grava nota; o SLA continua de onde estava.
- **Escopo** (`comunicacao.central`): "meus" = comigo + sem responsável nas minhas filas (e filas sem operador);
  gestão = empresa. Fora do escopo, a conversa por id responde "não encontrada" (actions e `?conversa=`).
- **Tela**: 3 colunas (lista | conversa | contexto do cliente), atualização automática a cada 15 s com a aba visível
  (fase 1 sem tempo real). Usuário desativado sai das filas e as conversas dele voltam para a fila.
- **Registros técnicos** (`channel_events`): contato mascarado, nunca o texto; retenção de 30 dias (limpeza pelo
  agendador). Leitura em `/comunicacao/canais?aba=registros` (filtros por canal, resultado e busca) e saúde do canal.
- **Variáveis de mensagem** (`src/domain/message-variables.ts`): lista única para modelos ({{n}} ligado a uma variável),
  respostas rápidas (`{contato}`, `{operador}`…) e régua (`{valor}`, `{linkBoleto}`…). Variável sem valor bloqueia o
  envio — nunca sai «{contato}» para o cliente.
- **Modelos do WhatsApp** (`message_templates`, `templates.ts`): id `tpl_<nome>_<idioma>`; sincronizados com a Meta
  (Graph v20, `WHATSAPP_BUSINESS_ACCOUNT_ID`) a cada hora pelo agendador ou no botão; sem a conta configurada, ficam
  como rascunho. Contexto `conversa` (Central) ou `cobranca` (régua: cada etapa de WhatsApp pode apontar um modelo;
  sem valor para alguma variável, a régua cai no texto livre).
- **Respostas rápidas** (`quick_replies`, `quick-replies.ts`): «/atalho» no campo de mensagem; da empresa ou de uma
  fila; contagem de uso.
- **Mensagens automáticas** (setting `central_automaticas`, `auto-messages.ts`): tudo nasce desligado. Menu de
  boas-vindas (a resposta escolhe a fila; regra pura `pickMenuOption` exige o número no começo), fora do horário
  (setting `horario_comercial` + feriados), aviso de posição na fila, cliente sem resposta (lembrete → encerramento) e
  encerramento (o operador pode desmarcar). Só saem pelo provedor conectado e dentro da janela; nunca viram registro
  manual; cada tipo no máximo 1×/12 h por conversa.
- **Agendador** (`scheduler.ts`, `/api/cron/central`, `CRON_SECRET`): pg_cron + pg_net do Supabase a cada 5 min
  (`supabase/agendador-central.sql`, rodado uma vez no SQL Editor; o segredo fica no Vault como `interos_cron_secret`),
  porque o plano atual da Vercel só agenda uma vez por dia. Passos independentes: menu sem resposta (10 min), transbordo,
  distribuição, posição na fila, cliente sem resposta, limpeza de registros e sincronização de modelos.

- **Histórico** (`history.ts`, `/comunicacao/historico`, tela `comunicacao.historico`): conversas encerradas no escopo
  próprio da tela (operador: as suas; gestor: a equipe; direção: todas). Busca no contato e, com 3+ letras, no texto das
  mensagens do período (até 12 meses, 500 linhas; CSV até 5.000, com proteção contra fórmula). **Reabrir** volta para
  quem atendeu se a pessoa estiver disponível, senão para a fila; o SLA recomeça; recusa se o contato já tem outra
  conversa aberta no canal.
- **E-mail de entrada** (`/api/webhooks/email`): Resend (`email.received` + leitura do conteúdo na API, assinatura Svix
  com `RESEND_WEBHOOK_SECRET`) ou formato próprio/Postmark com `EMAIL_INBOUND_TOKEN`. Corta a parte citada, ignora
  respostas automáticas e e-mails do próprio remetente. A conversa guarda o assunto e o Message-ID do cliente: a
  resposta sai «Re: <assunto>», encadeada (`In-Reply-To`), com `reply_to` = `EMAIL_REPLY_TO` e a assinatura do operador.
- **Por pessoa** (`User.central`, ficha do usuário › Atendimento na Central, chave `comunicacao.canais.filas.editar`):
  recebe ou não conversas, filas (em `service_queues.memberIds`), limite próprio e canais (respeitados por
  `pickAssignee`/`isAvailableFor`) e assinatura de e-mail.
- **Cliente 360 › Atendimentos**: conversas do cliente (só metadados), conversas e 1ª resposta média em 90 dias, «Como
  falar com eles» (janela do WhatsApp por número e recusas de comunicação) e «Iniciar conversa».
- **Caixa de Entrada do Marketing**: só mensagens de leads e números desconhecidos (as de clientes ficam na Central),
  com a situação da conversa; assumir aqui assume a conversa.
- **Chamado**: aviso da conversa de origem; resposta por WhatsApp/e-mail sai pela conversa da Central do contato
  (`replyFromTicket`), então a resposta do cliente volta para a mesma conversa e o Cliente 360 vê tudo.
- **Ativação dos canais** (`activation.ts`, `/comunicacao/ativacao`, fase 0): checklist lido da configuração real
  (existência das variáveis, nunca os valores; mensagens recebidas; filas; última execução do agendador, gravada em
  `central_agendador.lastRunAt`) e a **política de gravação** (`politica_gravacao`: aviso, retenção, quem ouve, motivo).
- **Pausas** (fase 2): presença `pausa` com `User.pauseReasonKey` (motivos em `central_pausas`, aba Canais › Motivos de
  pausa). Em pausa, a distribuição não entrega conversa (só `online` recebe).
- **Ligar da conversa** (botão «Ligar» no cabeçalho, `call-button.tsx`, chave `comunicacao.ligacoes.ligar`): números
  conhecidos (`ConversationDetail.call`: o da conversa no WhatsApp, contato, telefone do chat, lead, cliente e demais
  contatos; `callNumbers` em `domain/conversation-call.ts`) ou outro digitado. Com o softphone pronto
  (`softphone-bridge.ts`), a ligação sai por ele com o parâmetro `conversation` e a rota outgoing grava
  `conversationId` (só se a conversa estiver no escopo de quem liga). Sem telefonia, abre o `tel:` do aparelho e o
  atendente registra o resultado (`registerConversationCall`: voip, `status: "manual"`). Na conversa, toda ligação
  vira um registro com ícone de telefone (`callThreadText`), nunca mensagem.
- **Aba Equipe na Central** (`?painel=equipe`, quem tem `comunicacao.central.distribuir`): `getTeamNow` (o mesmo
  cálculo da Central de Comando, no escopo da Central) mostra estado, carga/limite e as conversas de cada atendente.
  Ações: passar para outra pessoa e devolver para a fila (`redistributeConversation`, com nota; a fila é distribuída
  na hora e a tela diz para quem foi) e liberar o atendente (`releaseOperator`: devolve todas as conversas abertas
  para a fila e, se marcado, deixa a pessoa «Ausente» para sair da distribuição).
- **Central de Comando** (`supervision.ts`, `/comunicacao/supervisao`, tela `comunicacao.supervisao`, escopo: equipe do
  gerente; direção, empresa): indicadores do dia, operadores (estado, pausa, carga, conversas), filas e gargalos,
  conversa acompanhada ao vivo com **sussurro** (nota `templateKey: "sussurro"` + aviso ao operador), assumir e
  **escalar** (`Conversation.escalatedAt`: topo da lista). **Registro de supervisão** em `supervision_logs` (acompanhar
  conta o tempo por batimento de 60 s da tela; intervalo > 2 min abre outra sessão). **Painel para TV** em
  `/comunicacao/supervisao/tv`.
- **Alertas do gerente** (`central_alertas`, desligados por padrão; passo do agendador): fila cheia, SLA em risco,
  cliente sem resposta e pausa longa, como notificação ao gestor do operador ou do departamento da fila (sem gestor,
  admins), cada um no máximo a cada `repeatMinutes` (estado em `central_alertas_estado`).
- **Telefonia** (fase 3, `src/server/telephony/*`, adaptador `src/server/integrations/twilio.ts`): ligação = comunicação
  `voip` com id `call_<hash do CallSid>` (avisos repetidos não duplicam), `callStatus`, números, fila, gravação e
  recado. Rotas da Twilio em `/api/voice/{incoming,outgoing,dial-result,voicemail,recording}` (assinatura
  X-Twilio-Signature conferida). Recebida: no horário e com alguém disponível (ramal + online + atende na Central, nas
  filas do número) toca em todos; senão, correio de voz. Softphone no navegador (`@twilio/voice-sdk`, token em
  `/api/voice/token`; links `tel:` do INTEROS ligam por ele), transferência direta para ramal ou número. Gravações
  servidas por `/api/voice/recordings/<acesso>` depois de `openRecordingAction` (escopo, política, motivo e registro em
  `recording_access_logs`); o agendador apaga as vencidas. Telas: Ligações, Correio de voz e PABX (ramais, números,
  horários, provedor e tarifas, qualidade, histórico de mudanças e acessos às gravações).
- **Supervisão de ligações** (fase 4, `src/server/telephony/monitor.ts`): a ligação começa como ponte simples; quando o
  gerente pede para ouvir (Central de Comando › Ligações em andamento), a perna filha é redirecionada para a conferência
  `sup_<id>` e a principal entra nela pelo `dial-result` (estado em `Communication.monitor`: movendo → ativa →
  encerrada). O softphone do gerente liga com o parâmetro `monitor` (rota outgoing confere a permissão
  `comunicacao.supervisao.ligacoes`) e entra mudo; os modos mudam o participante pela API (ouvir = mudo, sussurrar =
  coaching só para o atendente, entrar = fala com todos). O atendente vê no softphone quem está e em que modo
  (`callMonitorNoticeAction`). A conferência é gravada como segunda parte (`recordingParts`); a duração final soma o
  antes e o depois. Cada modo vira uma linha no registro de supervisão; `/api/voice/monitor-end` fecha quando o gerente
  sai.
- **Relatórios da Central** (fase 4, `src/server/reports/central.ts`, na Central de Relatórios): «Atendimentos por
  fila» (conversas e ligações recebidas, 1ª resposta, atendimento médio, perdidas) e «Ligações e custo de telefonia»
  (custo estimado = minutos iniciados × tarifa do PABX; manuais sem custo).
- **Envio agendado de relatórios** (`src/server/reports/schedules.ts`, coleção `report_schedules`, passo do
  agendador): diário, semanal ou mensal, período relativo (ontem, semana anterior, mês anterior…), CSV/XLSX/PDF, só
  para pessoas do INTEROS. Cada destinatário recebe o relatório montado com o próprio acesso (quem não vê o tipo é
  pulado); se quem agendou perde a exportação, o envio pausa. Sem e-mail configurado, vai como notificação com o link.
- **Novos canais** (fase 5): `ConversationChannel` = whatsapp, email, instagram, messenger, telegram, chat
  (`src/domain/channels.ts`). Nos canais por id (Instagram, Messenger, Telegram, chat) a chave de contato é
  `<prefixo>:<id do provedor>` (`ig:`, `fb:`, `tg:`, `ch:`), nunca comparada com telefone/e-mail; a pessoa é
  reconhecida pela conversa anterior do mesmo id já identificada (ou, no chat, pelo e-mail/telefone do formulário).
  Envio pelo `sendOrRecord` (`channelConnected`/`deliver` em `src/server/integrations/communications.ts`). Canal que
  nenhuma fila atende cai na fila padrão.
  - **Instagram e Messenger** (`src/server/integrations/meta-social.ts`): conexão pela tela com o login da Meta
    (`/api/integrations/meta/callback`, «state» em cookie); o token da página fica cifrado em `channel_connections`
    (`src/server/integrations/vault.ts`, AES-256-GCM). Webhook `/api/webhooks/meta` com assinatura do App Secret.
    Janela: 24 h normal; até 7 dias com a etiqueta HUMAN_AGENT; automáticas só nas primeiras 24 h.
  - **Telegram** (`src/server/integrations/telegram.ts`): token do bot colado na tela; o INTEROS registra o webhook com
    segredo próprio (conferido em `/api/webhooks/telegram`). Só conversas privadas.
  - **Chat do site** (`src/server/conversations/site-chat*.ts`): `<script src="/chat/widget.js?k=…">` no site abre um
    iframe `/chat/embed` (HTML próprio, CSP com nonce e `frame-ancestors` dos sites permitidos). API pública
    `/api/chat/{start,messages}`: token HMAC do visitante, limites por IP (hash) e por minuto, e o visitante só vê as
    mensagens do canal `chat` das conversas dele (nota interna e sussurro nunca saem).

## Qualidade
- `npm run lint && npm run typecheck && npm test && npm run check:access && npm run build` devem passar antes de considerar uma entrega pronta.
- Banco local: Postgres 15+ e `DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/interos npm run db:local`
  (aplica o stub do Supabase e as migrations); `.env.local` com `DATABASE_URL=postgres://interos_app:local@127.0.0.1:5432/interos`.
  Seed: `npm run seed`. Dev: `npm run dev` (porta 3000) com `NEXT_PUBLIC_DEMO_MODE=true` para o acesso rápido (o
  login por senha exige um projeto Supabase). Usuário demo local: `hercules@intercert.com.br` / `interos123`.
