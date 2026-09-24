# INTEROS — Contexto de negócio (síntese dos documentos recebidos)

Fonte: 5 documentos enviados pelo Philippe em 24/09/2026:
Especificação Funcional v1.0 (21 slides), Workflow para o Time de Desenvolvimento (19 slides),
Operational Blueprint (15 slides), Programa de Excelência em Suporte (12 páginas),
Plano de Comissionamento e Crescimento 2026 — Vendas (11 páginas).

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
