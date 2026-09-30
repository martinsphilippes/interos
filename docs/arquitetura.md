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
switch,avatar,scroll-area,separator,label,progress,slot}, cmdk, sonner, server-only. Dev: tsx, dotenv, playwright.

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
src/server/auth/session.ts requireUser, getCurrentUser, permissões
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
import { requireUser } from '@/server/auth/session'
export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser()
  const data = schema.parse(input)           // lance ZodError -> retorne { ok: false, error }
  ...
  await emitEvent({ ... })
  revalidatePath('/tarefas')
  return { ok: true, data: { id } }
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

## Contas a pagar (`payables`)
- Um título por comissão elegível (`pag_<commissionId>`, `createIfAbsent`; `_2`, `_3`… depois de cancelado),
  código PAG-AAAA-NNNNN, vencimento no `diaPagamento` (setting `comissoes_pagamento`) do mês seguinte à
  elegibilidade. Fluxo `previsto → aprovado → a_pagar → pago` (pagar marca a comissão `paga` na mesma transação);
  cancelar antes de pago devolve a comissão a Elegível; estorno de comissão paga gera título negativo
  (`estorno_comissao`). Títulos manuais permitidos. Aprovar/pagar/estornar: gestor financeiro, admin, diretoria.

## Numeração transacional (`nextNumber` em `src/server/db.ts`)
- Coleção `counters` (`counter_<prefixo>_<ano>`), `runTransaction`, inicializada a partir do maior número já gravado
  (`initFrom`). Usada por VEN, CT, PR, COM e PAG; formatos antigos preservados, sem renumerar documentos.
  `verify.ts` confere que nenhum contador fica abaixo do maior número existente.

## Auditoria via eventos
- Não há coleção de auditoria: cada mudança relevante emite evento com `actorId`, `occurredAt` e
  `payload.changes {campo: {from, to}}` + `payload.reason` (`auditChanges` em `src/server/audit.ts`). Cobre itens e
  condições do contrato, regras de comissão (`commission_rule.changed`), aprovação/pagamento/cancelamento de títulos
  (`payable.*`), estorno/cancelamento/bloqueio de comissão (`commission.*`), cancelamento de contrato,
  `settings.updated`, boleto registrado (`billing.updated`), baixa (`payment.approved`) e estorno (`payment.reversed`). A timeline do cliente e do contrato usa os mesmos eventos (ícones em
  `src/components/timeline/event-icon.tsx`).

## Qualidade
- `npm run lint && npm run typecheck && npm run build` devem passar antes de considerar uma entrega pronta.
- Emuladores locais: `FIRESTORE_EMULATOR_HOST` e `FIREBASE_AUTH_EMULATOR_HOST` já estão em `.env.local`.
  Seed: `npm run seed`. Dev: `npm run dev` (porta 3000). Usuário demo: `hercules@intercert.com.br` / `interos123`.
