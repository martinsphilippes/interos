# INTEROS — Arquitetura e convenções (leitura obrigatória antes de codar)

## Stack (decidida, não rediscutir)
- Next.js 16 App Router + React 19 + TypeScript estrito. Tailwind v4. Deploy na Vercel com as funções em `gru1`
  (São Paulo, `regions` no vercel.json), perto do Firestore: cada tela faz várias leituras e a ida e volta até os EUA
  multiplicava a latência.
- Banco: Cloud Firestore (projeto `interos-crm`, região southamerica-east1). Acesso **somente pelo servidor** via
  `firebase-admin` (Server Components, Server Actions, Route Handlers). O SDK cliente do Firebase é usado apenas para
  **login** (Firebase Auth e-mail/senha). Regras do Firestore negam tudo ao cliente; o Admin SDK ignora regras.
- Datas: sempre strings ISO 8601 (`new Date().toISOString()`), nunca `Timestamp`. Ordenação lexicográfica funciona.
- Dinheiro: números em reais com centavos (ex.: `1234.5`). Formatação com `formatCurrency` de `@/lib/format`.
- Sessão: cookie `interos_session` (session cookie do Firebase Auth) verificado no servidor. `requireUser()` em toda
  página/ação. Ver `src/server/auth/session.ts`.
- Multiempresa: todo documento tem `organizationId`. Onda 1 usa a organização única `intercert`
  (`ORG_ID` em `src/server/db.ts`). Toda consulta filtra por `organizationId`.

## Dependências já instaladas (não rode `npm install`; se faltar algo, registre no relatório)
firebase-admin, firebase, zod, date-fns, lucide-react, recharts, @dnd-kit/{core,sortable,utilities}, clsx,
tailwind-merge, class-variance-authority, @radix-ui/react-{dialog,dropdown-menu,tabs,popover,select,tooltip,checkbox,
switch,avatar,scroll-area,separator,label,progress,slot}, cmdk, sonner, server-only. Dev: tsx, dotenv, playwright,
@firebase/rules-unit-testing (`npm run test:rules`), vitest (`npm test`).

`overrides` no package.json: `jwks-rsa` (usado por `firebase-admin/auth`) fica com `jose` 5, que tem build CommonJS.
O `jose` 6 é só ESM e o runtime de funções da Vercel não carrega ESM via `require()` (`ERR_REQUIRE_ESM`), o que
derrubava toda rota que verifica sessão com 500. Reproduzir localmente: `next build` e
`NODE_OPTIONS=--no-experimental-require-module next start`. Só remova o override quando o `jwks-rsa` voltar a
funcionar nessa condição.

## Estrutura de pastas
```
src/domain/types.ts        tipos de TODAS as entidades (fonte da verdade do modelo de dados)
src/domain/constants.ts    departamentos, papéis, navegação, rótulos, tipos de evento
src/lib/utils.ts           cn()
src/lib/format.ts          formatCurrency, formatDate, formatRelative, initials
src/server/db.ts           acesso ao Firestore: col, getById, list, create, update, remove, batch
src/server/firebase-admin.ts
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

## Regras de acesso a dados (Firestore sem índices compostos)
- Use apenas `where` de igualdade (`==`, `in`, `array-contains`) via `list()`. **Nunca** combine `where` com
  `orderBy`/range em uma mesma consulta (exige índice composto e quebra em produção). Ordene e filtre em memória.
- Volume de uma organização é pequeno (milhares de docs). Ler a coleção filtrada por `organizationId` (+ 1 ou 2
  igualdades) e agregar em memória é a abordagem padrão.
- IDs: automáticos do Firestore em runtime; no seed use IDs determinísticos (`client_001`).
- Nunca use `Timestamp` ou `FieldValue.serverTimestamp()`; use `nowIso()`.
- Documentos lidos pelo Admin SDK são objetos simples e podem ser passados a Client Components.

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

## UI
- Identidade: fundo claro na área de conteúdo, sidebar escura (navy `#0B1F3A`), acento laranja Intercert
  `#F26A21`, secundário azul-petróleo `#0E7C9B`. Cores semânticas: verde = concluído/positivo, âmbar = atenção,
  vermelho = crítico/atrasado, azul = informação/processo. Tokens em `src/app/globals.css`.
- Mobile first para uso operacional: navegação inferior no celular, drawers em vez de páginas para detalhes,
  alvos de toque ≥ 44px, tabelas viram cards em telas pequenas.
- Textos da interface em português do Brasil. Identificadores em inglês.
- Estados obrigatórios em toda lista/tela: vazio, carregando (loading.tsx), erro.
- Sem números fixos "de enfeite": todo indicador vem do banco.

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
  `<m>.<tela>[.<secao>].<verbo>` → ESCOPO por tela. 11 módulos, 65 telas, 130 seções, 238 ações (444 chaves na união
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
- Leituras em `src/server/admin/access.ts`; helpers puros (árvore, validação, diff "de → para") em
  `src/server/auth/access-admin.ts`; actions `savePermissionProfile`, `saveUserPermissionOverrides`,
  `saveActiveModules` em `src/server/admin/actions.ts` (só chaves do catálogo com valor booleano e escopos permitidos;
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
módulo e `script-imports.test.ts` (serviços usados pelo seed/scripts não podem alcançar `next/navigation`). `npm run test:rules` (regras do Firestore no emulador). E2E `77-acessos.mjs` (T1–T10) na pasta de e2e.

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

## Qualidade
- `npm run lint && npm run typecheck && npm test && npm run check:access && npm run build` devem passar antes de considerar uma entrega pronta.
- Emuladores locais: `FIRESTORE_EMULATOR_HOST` e `FIREBASE_AUTH_EMULATOR_HOST` já estão em `.env.local`.
  Seed: `npm run seed`. Dev: `npm run dev` (porta 3000). Usuário demo: `hercules@intercert.com.br` / `interos123`.
