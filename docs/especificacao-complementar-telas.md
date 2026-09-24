# INTEROS — Especificação complementar: revisão das telas e consolidação

Fonte: prompt complementar do Philippe (24/09/2026) acompanhado de 17 telas conceituais
(14 distintas). Não substitui o Prompt Mestre.

## Regra mais importante
Não reconstruir o sistema. Não criar módulos, entidades, rotas ou dashboards duplicados
(nada de /dashboard-v2, /vendas-new, /sla2). Para cada requisito: EXISTE → reutilizar;
EXISTE PARCIALMENTE → complementar; NÃO EXISTE → implementar; EXISTE DUPLICADO → consolidar.
As imagens são referência visual, de UX e funcional, não pixel a pixel. Nomes, valores e
datas das imagens são fictícios: os componentes consomem os dados reais.

## Identidade visual
Escura e sofisticada: azul-marinho/preto com laranja INTEROS como destaque. Um Design
System único (cabeçalho, sidebar, cards, botões, inputs, tabelas, badges, modais,
tipografia, espaçamentos, estados) reutilizado em todas as telas.

## Requisitos
1. Jornada única: Lead → Qualificação → Oportunidade → Venda → Contrato → Implantação →
   Cliente ativo → CS → Suporte → Renovação/Expansão, sempre a mesma entidade.
2. Cliente 360º: cadastro, contatos, responsável, gestor da conta, cidade, origem, data de
   entrada, status, produtos, contratos, mensalidades, cobranças, oportunidades,
   implantação, treinamentos, chamados, atendimentos, tarefas, documentos, interações,
   renovações, saúde, próximos vencimentos, pendências e uma linha do tempo única.
3. Meu Dia: tarefas, pendências, compromissos, follow-ups, oportunidades a contatar,
   clientes aguardando retorno, chamados, SLAs a vencer, implantações atrasadas, visitas,
   reuniões, contratos pendentes, metas, alertas, prioridades; ordenado por prioridade/prazo.
4. Central de Vendas como workspace: esquerda fila/funil (novos, contato, proposta,
   negociação, visita, follow-up, ganhos, perdidos); centro oportunidade com comunicação e
   histórico (mensagens, notas internas, anexos, ligação, estágio, transferência, proposta,
   agendamento, ganho/perdido); direita contexto do cliente (empresa, contato, telefone,
   e-mail, interesses, responsável, interações, próxima ação, compromissos, localização).
5. Visitas: registrar (data/hora, responsável, motivo, status, observações, resultado),
   abrir endereço em mapas, distância/rota quando possível; aparecem na oportunidade, no
   Cliente 360, no Meu Dia, na agenda e na linha do tempo.
6. Marketing: leads captados, qualificados, CPL, conversão, evolução, origem; canais
   configuráveis; desempenho por canal; lead com origem, campanha, interesse, pontuação,
   responsável, status, próxima ação.
7. Prospecção ativa separada da entrada de leads: lista, contatos, trabalhados,
   interessados, reuniões, conversões, responsáveis, progresso, período, objetivo.
8. Central de Suporte como workspace (fila: novos, em atendimento, aguardando cliente, em
   risco, críticos; centro: protocolo, assunto, prioridade, responsável, SLA, conversa,
   anexos, notas, eventos, ligações, transferências; direita: cliente, produtos, SLA,
   histórico). Nunca isolado do Cliente 360.
9. Base de Conhecimento por produto, módulo, categoria, problema e palavra-chave, pronta
   para IA.
10. SLA operacional global: dentro do prazo, em risco, violados, taxa de cumprimento,
    tempo médio de 1ª resposta e de resolução; por departamento, funcionário, cliente,
    prioridade, período e tipo de processo; alertas antes da violação.
11. Financeiro operacional (não ERP): contratos, produto, valor, vencimento, assinatura,
    status financeiro, responsável, recorrência, recebido, em aberto, vencido, aguardando
    assinatura; linha do tempo criado → enviado → visualizado → assinado → cobrança →
    pagamento; pronto para integrar assinatura e cobrança externas.
12. Construtor Visual de Workflows: blocos início, tarefa, aprovação, condição, espera,
    notificação, integração, encerramento; cada etapa com nome, departamento, responsável
    padrão, prazo, SLA, campos obrigatórios, checklist, automações, condições,
    notificações; usa as MESMAS tarefas, departamentos, usuários, clientes, SLAs e
    notificações do sistema.
13. Dashboard do Gestor: colaboradores, produtividade, SLA, tarefas, pendências críticas,
    desempenho, metas, carga por colaborador com redistribuição, alertas (SLA a vencer,
    sobrecarga, implantação atrasada, backlog, meta abaixo).
14. Cockpit da Diretoria (empresa inteira): receita recorrente, novas vendas, clientes
    ativos, resultado operacional quando houver dado, meta global, evolução, saúde
    operacional, desempenho por departamento, funil, implantação, suporte, inadimplência,
    renovação, alertas estratégicos. "Onde está o problema da empresa?"
15. Saúde da operação: índice consolidado configurável (produtividade, SLA, qualidade,
    atrasos, backlog, satisfação, metas), explicável.
16. Meu Desempenho: meta geral, produtividade, qualidade, SLA, tarefas, evolução, metas
    individuais, realizado × objetivo, indicadores por função.
17. Gamificação: pontos, ranking, posição, evolução, níveis, sequência, conquistas,
    medalhas, campanhas, desafios, alimentados por eventos reais.
18. Bônus e premiação (separado da gamificação): critérios configuráveis com meta,
    realizado, peso, valor, faixa, regra; faixas com nomes configuráveis; acumulado,
    projeção, % atingido, próxima faixa, composição, histórico.
19. Simulador de resultado sem alterar dados reais.
20. Uma única engine de metas para Meu Desempenho, Gestor, Diretoria, Ranking e Bônus.
21. Comunicação omnichannel: estruturar interface e adapters; NÃO simular integração
    externa como se estivesse funcionando.
22. PWA único; mobile com barra inferior e experiência própria (Meu Dia, tarefas,
    clientes, oportunidade, suporte, agenda, desempenho, notificações).
23. Nada de ilhas: cada evento alimenta indicadores, desempenho, metas, gamificação,
    bônus, gestor e diretoria.

## Prioridade
Fluxo operacional → conexão entre módulos → modelo de dados → ações funcionando →
dashboards com dados reais → responsividade/PWA → refinamento visual → automações
avançadas → IA avançada.

## Mapa de referências (scratchpad/ref)
01 Marketing e Captação · 02 Financeiro e Contratos · 03 Login · 04 Central de Vendas ·
05 Mobile PWA · 06 Construtor de Workflows · 07 Cockpit da Diretoria · 08 Meu Desempenho ·
09 Ranking e Gamificação · 10 Dashboard do Gestor · 11 Bônus e Premiação · 12 Cliente 360º ·
13 Central de Suporte · 14 Gestão de SLA.
