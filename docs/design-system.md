# INTEROS — Design System escuro (contrato para as telas)

Referências visuais: `scratchpad/ref/01…14` (telas conceituais). Tema único, escuro: fundo azul-marinho quase
preto, superfícies navy com bordas finas azuladas, **laranja INTEROS** como destaque e cores semânticas vivas.
Tudo está em `src/app/globals.css` (tokens) e `src/components/ui/*` (componentes, exportados por
`@/components/ui`). **Não use cores fixas** (`bg-white`, `text-slate-*`, hex em componentes): use os tokens.

## 1. Tokens de cor

Os nomes são os mesmos do tema claro anterior (toda tela antiga mudou de tema sem reescrita). Classes Tailwind:
`bg-<token>`, `text-<token>`, `border-<token>`, com opacidade `bg-brand/20` quando preciso.

| Token | Valor | Uso |
|---|---|---|
| `canvas` | `#060d1a` | Fundo da página (body). |
| `surface` | `#0c1a2e` | Cards, tabelas, painéis. |
| `surface-muted` | `#0a1626` | Um tom abaixo: inputs, cabeçalho de tabela, áreas internas de card. |
| `surface-hover` | `#12233b` | Hover de linhas/itens, fundo neutro de ícones e chips. |
| `card-elevated` | `#102039` | Dialog, Drawer, Popover, Dropdown, Tooltip, tooltip de gráfico. |
| `border` / `border-strong` | `#1b2c47` / `#26395a` | Bordas finas (padrão) / controles e separadores de destaque. |
| `foreground` | `#e7edf6` | Texto principal. |
| `muted` / `muted-light` | `#94a3ba` / `#71839f` | Texto secundário / terciário (ambos AA sobre `surface`). |
| `track` | `#1a2b45` | Trilha de barras de progresso e anéis. |
| `overlay` | `rgb(2 6 14 / .72)` | Fundo atrás de modais. |
| `brand` (+`-hover`, `-active`, `-soft`, `-soft-hover`, `-fg`) | `#f26a21` | Ação primária, item ativo do menu, números de destaque, foco. `brand-fg #ff9a5c` = texto laranja legível. |
| `secondary` (+`-hover`, `-soft`, `-fg`) | `#1ba3c6` | Azul-petróleo: processo, série secundária. |
| `success` (+`-hover`, `-strong`, `-soft`, `-fg`) | `#22c55e` | Concluído, positivo, dentro da meta. `success-strong #15803d` = fundo de botão com texto branco. |
| `warning` (+`-hover`, `-soft`, `-fg`) | `#f59e0b` | Atenção, em risco, aguardando. Sobre `bg-warning` sólido use `text-canvas`. |
| `danger` (+`-hover`, `-strong`, `-soft`, `-fg`) | `#ef4444` | Crítico, atrasado, violado. `danger-strong` = fundo de botão destrutivo. |
| `info` (+`-hover`, `-soft`, `-fg`) | `#3b82f6` | Informação, processo, séries neutras de dados. |
| `accent-purple` (+`-soft`, `-fg`) | `#8b5cf6` | **Novo.** Metas, qualidade, conquistas, satisfação. |
| `sidebar`, `sidebar-hover`, `sidebar-border`, `sidebar-fg`, `sidebar-muted`, `sidebar-active`, `sidebar-active-fg` | `#050b16`… | **Novos.** Exclusivos do menu lateral e da barra inferior. |
| `chart-grid` / `chart-axis` | `#1a2a44` / `#8697b1` | **Novos.** Grade e eixos de gráficos. |

Regra das variantes: `<cor>` = tom vivo (barras, pontos, ícones, bordas); `<cor>-soft` = fundo translúcido
(badges, quadrados de ícone, linha destacada); `<cor>-fg` = texto claro legível sobre fundo escuro (sempre use
`-fg` para texto pequeno colorido). `text-white` só sobre fundo sólido colorido (`bg-brand`, `bg-*-strong`).

Outros tokens: raios `rounded-lg` (10px, controles) e `rounded-xl` (14px, cards); sombras `shadow-card`,
`shadow-pop`, `shadow-drawer`, `shadow-brand` (brilho laranja do botão primário); shell `h-topbar` (64px),
`w-sidebar` (264px), `w-sidebar-collapsed` (72px), `h-mobile-nav` (64px). Utilitários: `label-caps`,
`scrollbar-thin`, `scrollbar-none`, `touch-target`, `safe-bottom`, `safe-top`, `bg-dot-grid` (grade de pontos,
ex.: canvas do construtor de workflows).

### Quando usar cada cor
- **Laranja**: uma ação primária por área (botão "Novo …"), item ativo, aba ativa, valor-destaque de um card
  (ex.: "Meta global"). Não use laranja para estado ("atrasado" é vermelho).
- **Verde / âmbar / vermelho**: estado (no prazo / atenção / violado). Percentuais: `toneForPercent(v, ok, warn)`.
- **Azul**: informação, processo em andamento, série de dados neutra.
- **Roxo**: metas, qualidade, conquistas, satisfação.
- **Neutro** (`surface-hover` + `muted`): sem juízo de valor.

## 2. Tons (`src/components/ui/tone.ts`)
`type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "purple" | "secondary"` e mapas
prontos: `toneSoft` (fundo + ícone), `toneBorder`, `toneText`, `toneSolid`, `toneColor` (CSS var para SVG/recharts)
e `toneForPercent(value, ok = 90, warn = 70)`.

## 3. Componentes (`@/components/ui`)

### Revisados para o escuro (mesmas props de antes, com acréscimos)
| Componente | Notas / props novas |
|---|---|
| `Button` | variantes `primary` (laranja + `shadow-brand`), `secondary` (superfície elevada), `outline` (contorno claro), `ghost`, `destructive`, **`success`** (novo), `link`; tamanhos `sm`/`md`/`lg`/`icon`; `asChild`, `loading`. |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `rounded-xl`, `bg-surface`, borda fina. **`CardLink`** (novo): `{ href, children = "Ver detalhes", className }` — link laranja "Ver detalhes ›" para o canto do cabeçalho. |
| `StatCard` | `{ label, value, delta?: { value, direction: "up"\|"down"\|"flat", tone?, label? }, icon?, tone?: Tone, valueTone?: boolean, href?, hint?, progress?: number, compact?, className? }`. Ícone em quadrado tingido à esquerda, valor 26–28px, delta "↑ 12,4% vs. mês anterior". `compact`: rótulo em cima e valor + ícone lado a lado (grades de 2 colunas no celular). O rótulo tem `data-slot="stat-label"`. |
| `Badge` | tingido com borda: `default`, `success`, `warning`, `danger`, `info`, `brand`, **`purple`**, **`secondary`**, `outline`, `muted`, **`solid`** (laranja sólido); `size` `sm`/`md`. Cantos `rounded-md`. |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableFooter`, `TableCaption` | cabeçalho discreto (`surface-muted`, texto muted sem caixa-alta), linhas com hover. `TableRow` ganhou **`selected?: boolean`** (fundo laranja translúcido + contorno laranja); `data-state="selected"` continua valendo. |
| `Tabs`/`TabsList`/`TabsTrigger` | `variant="line"`: sublinhado e texto laranja; `variant="pills"`: pílula laranja preenchida. |
| `SegmentedControl` | opção ativa em laranja preenchido. |
| `Input`, `Select`, `Textarea`, `DateInput`, `SearchInput`, `Checkbox`, `Switch` | fundo `surface-muted`, borda `border-strong`, foco laranja (`ring-brand/25`). |
| `Dialog`, `Drawer`, `Popover`, `DropdownMenu`, `Tooltip`, `ConfirmDialog` | `bg-card-elevated`, borda `border-strong`, overlay `bg-overlay` com blur. |
| `Progress` | trilha `bg-track`; `tone` agora aceita também **`purple`** e **`neutral`**. |
| `EmptyState`, `Skeleton`, `Kbd`, `Avatar`, `SectionTitle`, `PageHeader`, `Pagination`, `SlaBadge`, `PriorityBadge`, `StatusDot`, `UserChip`, `Spinner` | cores do tema. `PageHeader`: título 22px (mobile) / 28px (desktop), subtítulo muted. |

### Novos
| Componente | Props | Uso |
|---|---|---|
| `IconTile` | `{ icon, tone?: Tone = "neutral", size?: "xs"\|"sm"\|"md"\|"lg" = "md", shape?: "square"\|"circle", className? }` | Ícone em quadrado arredondado tingido (cards, listas, alertas). |
| `MetricDelta` | `{ value: string, direction: "up"\|"down"\|"flat", tone?: Tone, label?: string, size?: "sm"\|"md", className? }` | "↑ 12,4% vs. mês anterior". Sem `tone`: subir = verde, cair = vermelho (passe `tone` quando subir for ruim, ex.: inadimplência). |
| `ScoreGauge` (client) | `{ value: number \| null, max?: number = 100, label?: ReactNode, tone?: Tone, showMax?: boolean = true, className? }` | Semicírculo vermelho→âmbar→verde com marcador e número central ("Saúde da operação 88/100 Muito boa"). |
| `ScoreRing` | `{ value: number \| null (0–100), display?: ReactNode, label?: ReactNode, tone?: Tone, size?: number = 144, thickness?: number = 10, className? }` | Anel com valor ("Índice de desempenho 91 Excelente", "Cumprimento geral 92%"). Tom automático por `toneForPercent`. |
| `ProgressList` | `{ items: { key?, label, value (0–100), display?, tone?, emphasize?, icon?, href?, hint? }[], layout?: "inline"\|"stacked", showScale?: boolean, emptyText?, className? }` | "Metas do departamento" (`stacked`), "Carga de trabalho", "Desempenho por departamento" (`inline` + `showScale`). |
| `DataList` | `{ items: { key?, icon?, label, value?, href? }[], labelWidth?: string = "9rem", className? }` | "Dados gerais" (CNPJ, responsável, telefone…). Valor vazio mostra "—". |
| `TimelineList` | `{ items: { id, icon, tone?, title, subtitle?, date?, href? }[], emptyText?, className? }` | Linha do tempo compacta dos cards (ícone circular colorido + título + subtítulo + data). |
| `ChannelCard` | `{ channel: "whatsapp"\|"voip"\|"email"\|"chat", connected: boolean, title?, actionLabel?, href?, onAction?, children?, className? }` | Card de canal. **Nunca** passe `connected` sem integração real: com `false` mostra "Não conectado · registro manual" e a ação abre o app/discador (`https://wa.me/…`, `tel:`). |
| `FilterBar` + `FilterField` | `FilterBar { children, actions?, className? }` · `FilterField { label?, htmlFor?, children, className? }` | Linha de filtros (período, departamento, busca) com rótulos pequenos acima; ações à direita. |
| `KpiStrip` | `{ children, columns?: 2\|3\|4\|5\|6 = 4, mobileColumns?: 1\|2 = 1, className? }` | Linha responsiva de `StatCard` no topo dos painéis. |

### Layout (`@/components/layout/*`)
- `AppShell { user, sections, unreadCount, quickActions?, showPresence?, children }` — o `(app)/layout.tsx` filtra
  `QUICK_ACTIONS` por papel e decide `showPresence` (vendas, suporte, cs, implantação e gestores/diretoria/admin).
- `Sidebar`: logo INTEROS (hexágono laranja), seções recolhíveis (a seção do item ativo fica sempre aberta;
  preferência em `localStorage`), item ativo laranja preenchido, "Recolher menu", marca "INTERCERT · Sistemas
  inteligentes para o seu negócio" e versão (`NEXT_PUBLIC_APP_VERSION`, vinda do `package.json` via `next.config.ts`).
- `TopBar`: busca em pílula (Ctrl+K), `PresenceSelect`, `HelpMenu` (atalhos), sino com contador laranja e bloco do
  usuário (avatar, nome, cargo) com menu. No celular: voltar (fora das abas raiz) ou símbolo, título da tela, busca,
  sino e avatar.
- `PresenceSelect { value?, className? }` — Online/Ausente/Ocupado, salva em `users.presence` e
  `users.presenceUpdatedAt` pela Server Action `setPresence` (`src/server/users/presence.ts`).
- `MobileNav { quickActions? }` — Início · Tarefas · **[+]** · Clientes · Mais (`MOBILE_NAV` + botão central);
  o "+" abre `QuickActionsSheet` (Drawer inferior). O `main` já reserva a altura da barra + safe-area.
- `InterosLogo { collapsed?, tagline? }` e `InterosMark` em `layout/logo.tsx` (reexportados por `sidebar.tsx`).
- `PageContainer { size?: "default"\|"narrow"\|"full" }`.

### Ações rápidas (`QUICK_ACTIONS` em `src/domain/constants.ts`)
| Ação | Rota | Quem vê |
|---|---|---|
| Nova tarefa | `/tarefas?novo=1` | todos |
| Novo lead | `/marketing/leads?novo=1` | módulo marketing (diretoria, gestor, marketing, vendas) |
| Nova oportunidade | `/vendas/oportunidades?novo=1` | diretoria, gestor, vendas, cs |
| Novo chamado | `/suporte/chamados?novo=1` | módulo suporte (diretoria, gestor, suporte, implantação, cs) |
| Registrar visita | `/vendas/visitas?nova=1` | diretoria, gestor, vendas |
| Novo cliente | `/clientes/novo` | todos |

`?novo=1` abre o diálogo via `useUrlFlag("novo")` (`src/lib/use-url-flag.ts`); o parâmetro é removido ao fechar.
Componentes: `NewLeadDialog`, `NewOpportunityButton`, `NewTicketDialog` aceitam `openOnUrlFlag`.

## 4. Gráficos (`src/lib/chart-theme.ts`)
`CHART_SERIES` (laranja, azul, verde, roxo, âmbar, petróleo, rosa), `CHART_COLORS` (primary, secondary, positive,
attention, negative, goal, neutral, grid, axis…), `chartAxisTick`, `chartCategoryTick`, `chartGridProps`,
`chartCursor`, `chartLineCursor`, `chartTooltipStyle` + `chartTooltipLabelStyle` + `chartTooltipItemStyle` (tooltip
padrão do recharts), `chartTooltipClassName` (tooltip customizado em JSX), `chartLegendStyle`, `chartDot(color)`,
`chartActiveDot(color)`. Linhas de 2px, grade tracejada `chart-grid`, meta em linha tracejada neutra. Nenhum
gráfico com fundo/tooltip branco.

```tsx
<CartesianGrid vertical={false} {...chartGridProps} />
<XAxis dataKey="label" tick={chartAxisTick} axisLine={false} tickLine={false} />
<Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} cursor={chartCursor} />
<Line dataKey="realizado" stroke={CHART_COLORS.primary} strokeWidth={2} dot={chartDot(CHART_COLORS.primary)} activeDot={chartActiveDot(CHART_COLORS.primary)} />
```

## 5. Padrões de composição

### Página de dashboard (Cockpit, Gestor, Meu Desempenho)
```tsx
<PageContainer>
  <PageHeader title="Cockpit da Diretoria" description="Visão estratégica e consolidada" actions={<Select …/>} />
  <KpiStrip columns={5}>
    <StatCard label="Receita recorrente" value={formatCurrency(mrr)} icon={<DollarSign />} tone="brand"
      delta={{ value: "8,4%", direction: "up", label: "vs. mês anterior" }} href="/gestao/indicadores/mrr" />
    …
  </KpiStrip>
  <div className="grid gap-4 xl:grid-cols-3">
    <Card>
      <CardHeader className="flex-row items-center justify-between"><CardTitle>Evolução da receita</CardTitle><CardLink href="…" /></CardHeader>
      <CardContent>{/* recharts com chart-theme */}</CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Saúde da operação</CardTitle></CardHeader><CardContent><ScoreGauge value={88} label="Muito boa" /></CardContent></Card>
    <Card><CardHeader><CardTitle>Desempenho por departamento</CardTitle></CardHeader><CardContent><ProgressList items={…} showScale /></CardContent></Card>
  </div>
</PageContainer>
```

### Workspace de 3 colunas (Central de Vendas, Central de Suporte)
```tsx
<PageContainer size="full">
  <PageHeader title="Central de Suporte" actions={<Button><Plus /> Novo chamado</Button>} />
  <KpiStrip columns={5} mobileColumns={2}>…StatCard compact…</KpiStrip>
  <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_360px]">
    <Card className="flex flex-col">{/* fila: Tabs variant="line" + lista de cards (item selecionado: border-brand bg-brand-soft) */}</Card>
    <Card className="flex min-h-[640px] flex-col">{/* centro: cabeçalho com Badges + conversa + composer */}</Card>
    <div className="flex flex-col gap-4">{/* direita: DataList, ChannelCard (connected={false}), TimelineList */}</div>
  </div>
</PageContainer>
```
No celular a fila vira a tela e o centro abre em Drawer (`/rota?item=<id>`).

### Tabela com painel lateral (Financeiro, Marketing)
```tsx
<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
  <Card className="overflow-hidden">
    <CardHeader><CardTitle>Gestão de contratos</CardTitle></CardHeader>
    <Table><TableHeader>…</TableHeader><TableBody>{rows.map((r) => <TableRow key={r.id} clickable selected={r.id === selectedId}>…</TableRow>)}</TableBody></Table>
  </Card>
  <Card>{/* detalhe do selecionado: DataList + TimelineList + ações */}</Card>
</div>
```
Abaixo de `xl` o painel vira Drawer; abaixo de `md` a tabela vira lista de cards.

## 6. Acessibilidade e mobile
- Contraste AA: texto sempre `foreground`, `muted`, `muted-light` ou `<cor>-fg`. Exceção de marca: texto branco
  sobre o laranja `brand` (≈3:1) nos botões primários, como nas referências — use peso `medium`/`semibold`.
- Alvos de toque ≥ 44px no celular (`min-h-[44px] md:min-h-0`). Drawers para detalhes. Safe-area com `safe-top`/
  `safe-bottom`. Scrollbars e controles nativos escuros (`color-scheme: dark`).
