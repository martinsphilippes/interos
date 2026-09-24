# Automações, varreduras e assistente (Onda 5)

## Motor de regras (TRIGGER → CONDIÇÃO → AÇÃO)

- `engine.ts`: handler `"*"` (`handleAutomationEvent`) registrado por `registerAutomationHandlers`
  (`src/server/events/handlers/automations.ts`). Carrega as `automation_rules` ativas com cache de 30s,
  monta o contexto `{ event, payload, entity, <tipo da entidade>, client, cs, sla, department }`, avalia
  as condições (`conditions.ts`) e executa as ações em sequência (`actions-registry.ts`).
- Cada execução grava `automation_runs` (sucesso / erro / ignorada, com detalhe, condições e ações) e
  atualiza `runCount`/`lastRunAt`. Execuções com efeito emitem `automation.executed` (vai para a timeline
  do cliente quando a ação o afeta: "Automação <nome>: tarefa criada").
- Proteção contra laço: as ações rodam num `AsyncLocalStorage` com a cadeia de regras; eventos gerados
  nesse escopo recebem `payload.__automation = <ruleId>` e `__automationDepth`. A mesma regra nunca
  dispara na própria cadeia e a profundidade máxima é 3 (execuções acima disso ficam como "ignorada").
- Operadores: `== != > < >= <= contains exists older_than_hours`. Caminhos com ponto; campos derivados
  `hoursSince<Campo>`/`daysSince<Campo>` (ex.: `opportunity.hoursSinceLastActivity`).
- Templates `{{caminho}}` em títulos/textos (sem expressões; caminho ausente vira vazio).
- Regras antigas do seed são normalizadas na leitura (`normalizeRule`): cron → frequência, alvo da
  varredura inferido pelo prefixo das condições, `payload.level`/`payload.adoptionPct` →
  `payload.to`/`cs.adoptionPct` em `customer.health_changed`, `criar_handoff.toDepartment` → `department`.

## Varreduras agendadas

`sweeps.ts` registra as varreduras nativas (`sla_alerts`, `followup_vendas`, `oportunidades_paradas`,
`leads_sem_contato_24h`, `renovacoes`, `saude_clientes`, `implantacoes_atrasadas`, `tarefas_recorrentes`,
`kpi_snapshots`); `scheduler.ts#runSweeps({ only, force })` roda as que venceram (controle em
`settings/sweeps.value.automacoes.<chave>`) e as regras agendadas que varrem registros
(`trigger.entity`, uma vez por registro até ele mudar). Uma regra agendada com `trigger.sweep` define a
frequência daquela varredura.

Formas de execução:

1. **Vercel Cron** → `GET /api/cron/sweep` (header `authorization: Bearer $CRON_SECRET`). O `vercel.json`
   agenda `0 9 * * *` (06:00 em Brasília) porque o plano **Hobby só permite cron diário**. Em planos pagos,
   basta trocar o schedule (ex.: `0 * * * *`) para cumprir as frequências horárias.
2. **Botão "Executar varreduras agora"** em `/admin/automacoes` (força todas ou uma a uma).
3. **De forma preguiçosa ao abrir as telas**, como os módulos já fazem: Central de Vendas (follow-up, 1x/h),
   `/cs/saude` e `/cs/renovacoes` (1x/dia), Central de Atendimento (SLA de chamados, a cada 10 min). As
   varreduras daqui gravam também esses campos de controle, então nada roda em dobro.

Sem `CRON_SECRET`, a rota só aceita chamadas locais fora de produção (`curl localhost:3000/api/cron/sweep?force=1`).

## Webhooks

A ação `webhook` só chama a URL (timeout de 5s) com `AUTOMATION_WEBHOOKS_ENABLED=true`; caso contrário a
execução fica registrada como simulada.

## Assistente (IA opcional)

`src/server/ai`: `context.ts` (builders a partir das queries dos módulos), `agents.ts` (regras
determinísticas por agente + `runWithLlm`), `provider.ts` (API Messages via fetch quando há
`ANTHROPIC_API_KEY`; modelo em `INTEROS_AI_MODEL`, padrão `claude-sonnet-5`). A Server Action
`getAgentSuggestions(kind, subjectId)` e o componente `<AgentSuggestions kind subjectId />`
(`src/components/automations/agent-suggestions.tsx`) podem ser montados em: Central de Vendas
(`comercial`, ID do usuário), projeto de implantação (`implantacao`, ID do projeto), chamado (`suporte`,
ID do chamado), carteira/ficha CS (`cs`, ID do cliente) e cockpit (`executivo`, competência AAAA-MM).
