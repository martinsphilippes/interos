# INTEROS — Arquitetura e convenções (leitura obrigatória antes de codar)

## Stack (decidida, não rediscutir)
- Next.js 16 App Router + React 19 + TypeScript estrito. Tailwind v4. Deploy na Vercel.
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

## Qualidade
- `npm run lint && npm run typecheck && npm run build` devem passar antes de considerar uma entrega pronta.
- Emuladores locais: `FIRESTORE_EMULATOR_HOST` e `FIREBASE_AUTH_EMULATOR_HOST` já estão em `.env.local`.
  Seed: `npm run seed`. Dev: `npm run dev` (porta 3000). Usuário demo: `hercules@intercert.com.br` / `interos123`.
