# INTEROS — Contexto de negócio (síntese dos documentos recebidos)

Fonte: 8 documentos enviados pelo Philippe em 24/09/2026:
Especificação Funcional v1.0 (21 slides), Workflow para o Time de Desenvolvimento (19 slides),
Operational Blueprint (15 slides), Programa de Excelência em Suporte (12 páginas),
Plano de Comissionamento e Crescimento 2026 — Vendas (11 páginas),
Centro de Comando Financeiro (13 slides), Excelência em Implantação (10 slides),
planilha Modelos de Relatórios Departamentais (8 abas).

## Empresa
Intercert: revenda/integradora de software de gestão. Produto principal é o ERP
Intersys/Gdoor; portfólio de venda cruzada: TEF, maquininha Pague Assim, Intercert Ponto,
Internotas, Telefonia, PABX, Omnichannel, Banco Intercert, Consultoria Vilela, GDN Doerem.
Modelo de receita: adesão/setup + mensalidade recorrente + hardware.

## O que é o INTEROS
"Sistema operacional da Intercert": plataforma única (web + mobile) que conecta os seis
departamentos em um fluxo contínuo com uma linha do tempo única por cliente.

Fluxo ponta a ponta e gates:
1. Marketing (Mateus/Luciano) → saída: MQL (contato válido + interesse + consentimento LGPD + score mínimo)
2. Vendas (Igor/Vinícius) → saída: negócio ganho (proposta aceita + produto + valor + dados de faturamento)
3. Financeiro (Karem) → saída: contrato assinado + pagamento/condição aprovada
4. Implantação (Lando) → saída: go-live (checklist + treinamento + aceite do cliente)
5. CS (Felipe) → saída: cliente ativado (adoção mínima + responsável + plano de sucesso)
6. Suporte (Lando/equipe técnica) → saída: chamado resolvido (solução + confirmação + causa categorizada)

Regra central: nenhuma etapa avança sem gate concluído; cada passagem gera evento, histórico,
responsável, prazo e checklist. "Marcar como ganho" dispara contrato, financeiro e implantação.

## Objetos de dados por departamento
Marketing=Lead · Vendas=Oportunidade · Financeiro=Contrato · Implantação=Tarefa ·
Suporte=Chamado · CS=Perfil 360. Chave técnica: client_id único + event_id por interação.

## 17 módulos / telas
Login (MFA admins) · Meu Dia · Central de Tarefas · Workflow/Kanban · Cliente 360º · SLA ·
Meu Desempenho · Bônus e Premiação · Ranking/Gamificação · Dashboard do Gestor ·
Cockpit da Diretoria · Construtor de Workflows (versões imutáveis) · Usuários e Perfis (RBAC) ·
Financeiro/Contratos · Suporte omnichannel · Vendas/CRM · App mobile.

## Integrações previstas
WhatsApp Business API · VoIP (gravação) · Assinatura digital (hash, evidências) · Google Maps ·
Microsoft SSO · ERP/financeiro · Meta API (leads) · Push.

## KPIs (17)
Leads captados, qualificados, CPL, conversão; novas vendas, conversão do funil; MRR,
inadimplência, contas a receber; entregas no prazo, produtividade, qualidade; chamados
resolvidos, cumprimento de SLA, CSAT; taxa de renovação, saúde do cliente.

## Regras de SLA de Suporte (matriz oficial)
| Criticidade | Definição | Resposta | Resolução |
|---|---|---|---|
| Crítico | Sistema parado | 15 min | 4 h |
| Alto | Impacto direto na operação | 2 h | 1 dia útil |
| Médio | Dificuldade operacional | 8 h | 2 dias úteis |
| Baixo | Dúvida ou ajuste simples | 24 h | 3 dias úteis |
Cálculo considera horário comercial, feriados, prioridade e pausas autorizadas.

## Bônus de Suporte (até 20% do salário base)
Individual 60%: SLA resposta 30% (meta 95%), SLA resolução 30% (≥90%), CSAT 30% (>8,5),
auditoria de qualidade 10% (≥95%).
Coletivo 40%: SLA global resposta 25% (95%), SLA global resolução 25% (≥90%), CSAT geral 30%
(>8,5), churn da base 20% (<3%).
Escala: 100% metas → 100% bônus; 90–99% → 70%; 80–89% → 40%; <80% → 0.
Linhas vermelhas (zeram o mês): reclamação formal procedente, descumprimento grave de processo
(pular registro no CRM, abandono de chamado), falta grave de conduta.
Upsell: R$ 50 por oportunidade válida gerada pelo suporte (diagnóstico → registro no CRM → vendas).
Metas de qualidade: CSAT > 8,5 · churn < 3% · recorrência de chamados ≤ 10%.

## Comissionamento de Vendas 2026
Adesão/setup 25% · Recorrência: comissão paga na 3ª mensalidade · Hardware 2,5%.
Metas mensais: setup R$ 10.000 · recorrência R$ 5.000 · hardware R$ 25.000.
Prêmio por meta batida: adesão 1 salário mínimo · recorrência 1 salário mínimo · hardware R$ 500.
Estratégia: pacotes (ERP + TEF + maquininha), venda cruzada, foco em recorrência.

Regras do motor (parametrizáveis em Financeiro › Comissões › Regras; nada é fixo no código):
- **Precedência**: exceção por contrato > regra do vendedor > regra por produto/categoria > regra padrão >
  percentual do cadastro do produto. A exceção exige motivo e fica registrada (quem, quando, o quê).
- **Base**: valor contratado (itens líquidos de desconto do contrato) ou valor efetivamente recebido
  (pagamento parcial comissiona só o recebido). Percentual ou valor fixo por unidade.
- **Gatilhos**: na venda · na assinatura · no primeiro pagamento · no recebimento da cobrança · após a carência
  (permanência em dias contados do início do contrato) · recebimento + carência · na N-ésima mensalidade paga.
- **Recorrência**: a partir da mensalidade N (padrão 1) por X competências (ou enquanto o contrato estiver
  ativo); a comissão de cada competência nasce quando a mensalidade daquela competência é paga.
- **3ª mensalidade**: regra por vendedor em que a adesão (e/ou a recorrência) só é adquirida quando a 3ª
  mensalidade é paga — vale para quem tem a regra, sem virar padrão para todos.
- **Inadimplência**: cobrança vencida deixa a comissão dependente em "aguardando recebimento" (não cancela);
  paga depois, segue o fluxo. **Cancelamento** do contrato cancela o que ainda não foi adquirido e não gera
  nada futuro; comissões já pagas não são apagadas.
- **Estorno**: só manual, por gestor financeiro/diretoria, com motivo; comissão paga estornada gera título
  negativo em Contas a Pagar. Comissão pode ser bloqueada (retida) e desbloqueada com motivo.
- **Pagamento**: comissão elegível gera título em Contas a Pagar com vencimento no dia configurado do mês
  seguinte (padrão 10); o título passa por aprovado → a pagar → pago. Vendedor acompanha as suas item a item
  (situação, data provável e memória de cálculo) no Meu Desempenho e em Financeiro › Comissões.

## Cobrança: boleto, baixa, canais e régua (etapa 4)
- **Boleto**: enquanto não há provedor de cobrança conectado (banco/Asaas/Iugu a definir), o boleto é emitido no
  banco/ERP e **registrado** na cobrança (linha digitável, nosso número, PDF, PIX). O sistema nunca simula emissão:
  a cobrança fica "aguardando emissão manual" e mostra "Sem boleto" até o registro. Com provedor, a emissão passa a
  ser automática na geração das cobranças e o cancelamento é espelhado.
- **Baixa**: registro manual com comprovante é o padrão; a baixa automática (webhook do provedor ou conciliação
  diária) só existe com provedor conectado e é deduplicada (o mesmo evento nunca baixa duas vezes). Tolerância:
  diferença ≤ R$ 1,00 (configurável) baixa como paga; abaixo disso a cobrança fica em aberto com pendência no
  contrato e aviso ao Financeiro. Estorno de pagamento exige motivo; comissão com título não pago volta a aguardar,
  comissão já paga não é alterada automaticamente (estorno manual).
- **Canais com o cliente — política**: **WhatsApp é o canal principal**; **e-mail é complementar** (usado quando
  o cliente não tem WhatsApp, quando o marco da régua pede os dois, ou quando o Financeiro escolhe "Cobrar por
  e-mail"). Sem canal conectado, o sistema abre wa.me/mailto com o texto pronto e registra o envio manual — nunca
  finge que enviou. Sem WhatsApp nem e-mail cadastrados → tarefa de ligação. O cliente pode ter **opt-out por
  canal** no cadastro (nada é enviado; fica registrado "não enviada"). Fora da janela de 24 h a Meta exige template
  aprovado (pendente de conta Meta).
- **Régua de cobrança** (parametrizável em Configurações › Cobrança; **desligada até ser ativada**): marcos com dias
  ANTES (sinal negativo) ou DEPOIS (positivo) do vencimento, canal (WhatsApp, e-mail, ambos, tarefa, notificação) e
  texto com variáveis. Proposta inicial: 15 dias antes (WhatsApp), 7 dias antes (WhatsApp + e-mail), 21 dias depois
  (tarefa "Cobrar/negociar — ligação" ao Financeiro). Cada marco roda uma única vez por cobrança; contrato com
  pendência pausa a régua; o processo humano "cobrança inadimplente" continua para o escalonamento.

## Aditivos, renovação e Contas a Pagar geral (etapa 5)
- **Aditivo no mesmo contrato**: depois da assinatura, toda mudança de itens, condições, reajuste ou renovação entra
  como aditivo (rascunho → assinatura do cliente, quando exigida → aplicação pelo Financeiro). O contrato original
  fica preservado como versão anterior (documento por versão e termo aditivo próprio, com antes × depois, assinaturas
  e código de integridade). Ao aplicar: produtos do cliente sincronizados, mensalidades em aberto refeitas com os
  novos valores mantendo a numeração, adesão/hardware a mais cobrados à parte, comissões previstas recalculadas
  (as pagas não mudam; item novo só comissiona a partir da 1ª mensalidade que o inclui) e aviso à Implantação —
  nunca um projeto de implantação novo. Só um aditivo em andamento por contrato. Quem opera o Financeiro cria e
  aplica aditivos; a renovação pelo CS continua no CS.
- **Renovação**: no fechamento da venda o vendedor combina renovação automática (sim/não), prazo da renovação,
  reajuste (nenhum, percentual ou índice IPCA/IGP-M/INPC) e antecedência do aviso (padrão 30 dias). Renovar
  (pelo CS ou automaticamente) soma o novo prazo ao fim da vigência, preserva o prazo original e gera as mensalidades
  do novo período. Reajuste percentual entra na hora; **índice oficial não é consultado automaticamente** — o
  contrato renova sem reajuste e o CS recebe a tarefa "Informar índice de reajuste". Contrato vencido sem renovação
  fica marcado "Vencido" e sai do MRR (nada é apagado).
- **Cobrança recorrente**: contratos de prazo fixo têm todas as mensalidades geradas; contratos com renovação
  automática (ou sem prazo) têm horizonte rolante (padrão 3 meses, configurável) — a varredura diária gera as
  próximas sem duplicar. O gestor pode gerar as próximas na página do contrato.
- **Previsão da comissão**: comissão liberada com a 3ª mensalidade mostra a previsão (vencimento da mensalidade que
  a libera) em Minhas comissões.
- **Contas a Pagar geral** (mesma tela das comissões): fornecedores cadastrados (não confundir com clientes),
  categorias e centros de custo configuráveis (Configurações › Contas a pagar), título parcelado (N títulos),
  série recorrente (próxima ocorrência nasce 30 dias antes do vencimento; "repetir até" encerra), anexos (NF, boleto
  do fornecedor), aviso único de título vencido ao gestor financeiro, relatório "Contas a pagar" exportável e fluxo
  de caixa simplificado (a receber × a pagar por mês de vencimento, só com o que está no sistema — nada projetado).
  Comissões continuam nascendo do motor, nunca de lançamento manual.

## Financeiro: metas e bônus (deck "Centro de Comando Financeiro")
Papel: portão de qualidade do workflow. Valida e libera (faturamento correto de múltiplos
produtos, contrato assinado, confirmação de pagamento, validação de escopo) antes da
implantação, que deve ativar o cliente em < 7 dias. Meta macro da empresa: 5.000 clientes.
Linguagem SaaS: ARR, CAC, LTV.
Metas táticas: MRR +8% ao mês · ticket médio de venda R$ 350 (o slide de bônus cita R$ 300) ·
churn mensal < 3% (operacional: falta de uso/técnico/fechamento; financeiro: inadimplência,
falha de cobrança, faturamento incorreto).
Bônus por resultado com a mesma escala do Suporte (100%→100%, 90–99%→70%, 80–89%→40%, <80%→0).
Bloqueios: descumprimento grave de processo (pular etapas de liberação), vendas fora de
conformidade (faturar sem escopo documentado), churn imediato por erro operacional.
Ecossistema de produtos citado: ERP Web + InterCert Bank, Consultoria, Meios de pagamento (TEF),
Ponto e Gourmet, Certificação Digital.

## Implantação: metas e bônus (deck "Excelência em Implantação") — até 20% do salário base
Individual 60%: SLA de implantação no prazo 30% (meta 90%) · ativação em até 7 dias 30% (≥80%) ·
chamados abertos nos primeiros 30 dias 20% (≤ meta) · aprovação na auditoria de qualidade 20% (≥95%).
Coletivo 40%: SLA médio da equipe 25% (90%) · ativação geral em 7 dias 25% (≥80%) · chamados
gerais pós-implantação 30% (≤ meta) · churn inicial da base até 90 dias 20% (≤3%).
Janelas: dias 0–7 time to value · 8–30 qualidade e estabilidade · 31–90 retenção.
Escala de pagamento idêntica (100/70/40/0). Bloqueios: implantação divergente do escopo,
reclamação formal procedente, descumprimento técnico dos manuais.

## Modelos de relatórios departamentais (planilha)
Padrão: uma linha por mês (competência), campos de entrada manual + campos calculados, meta,
atingimento e status (Atingida ≥100% · Atenção 85–99% ou 90–99% conforme aba · Crítico).
Aba Diretoria consolida o indicador principal de cada departamento e alertas executivos.
Instrução explícita: ao integrar ao INTEROS, substituir entradas manuais por APIs.

| Aba | Entradas manuais | Calculados | Meta / status |
|---|---|---|---|
| Marketing | leads, MQLs, investimento, reuniões, oportunidades, meta leads, meta MQL | CPL, conv. MQL, atingimento | MQL/meta; Atenção ≥85% |
| Vendas | MQLs recebidos, reuniões, propostas, vendas, receita, ciclo (dias), meta receita | ticket médio, conversão, atingimento | receita/meta; Atenção ≥85% |
| Financeiro | faturado, recebido, vencido, MRR, contratos assinados, prazo receb., orçamento | inadimplência, var. R$ e % | Atingida: var ≥0 e inad ≤4%; Atenção: var ≥−5% e inad ≤6% |
| Implantação | novas, em andamento, concluídas, atrasadas, tempo médio, satisfação, backlog, meta % prazo (90%) | % no prazo, atingimento | Atenção ≥90% |
| CS | clientes ativos, onboardings, saúde média, NPS, cancelamentos, upsell R$, renovações, adoção, meta saúde (85) | churn | saúde ≥ meta; Atenção ≥90% da meta |
| Suporte | novos, resolvidos, backlog, SLA 1ª resposta, SLA solução, resp. média (min), solução média (h), reabertos, CSAT (escala 1–5) | taxa de reabertura | Atingida: SLA solução ≥90% e CSAT ≥4,5; Atenção: ≥85% e ≥4,2 |
| Diretoria | — | leads, receita, MRR, saúde; tabela por departamento com responsável e alerta | inadimplência máx. 4%; saúde < 70 dispara ação; 90% no prazo |

Observação: a planilha usa CSAT em escala 1–5 (meta 4,5) enquanto o deck de Suporte usa nota > 8,5
(escala 0–10). Precisa de padronização antes de implementar o KPI.

## Requisitos transversais
Auditoria imutável (usuário, timestamp, valor_antigo, valor_novo) · RBAC com manager_id
injetado nas consultas · LGPD (flag consentimento_obtido) · notificações (interna, e-mail,
push, WhatsApp) · busca global · documentos versionados · webhooks idempotentes ·
relatórios PDF/XLSX · paridade web/mobile via API.

## Roadmap sugerido nos documentos (há duas versões, precisam ser conciliadas)
Espec. Funcional: 1 Fundação (login, usuários, Meu Dia, tarefas, workflow, Cliente 360) ·
2 Receita e atendimento · 3 Gestão e performance · 4 Escala e mobilidade.
Workflow Dev: 1 Base (Cliente 360, usuários, tarefas, eventos, auditoria) · 2 Aquisição ·
3 Entrega · 4 Retenção · 5 Gestão.
Blueprint: 1 Fundações e RBAC · 2 Integrações core · 3 Automação e MVP.
Primeiro marco demonstrável: lead → venda ganha → contrato assinado → implantação → cliente
ativado → chamado resolvido.
