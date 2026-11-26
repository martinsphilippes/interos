# Central de Produtos, Módulos e Licenciamento — ERP Intercert

Documento da integração do INTEROS com o ERP Intercert: auditoria, arquitetura, decisões, o que já está pronto (aba
**Módulos ERP** da ficha do cliente), homologação ponta a ponta, ativação gradual e o plano das próximas fases da
Central de Produtos. Resumo técnico também em `docs/arquitetura.md` › "Integração com o ERP Intercert".

---

## 1. Problema

Hoje, ligar ou desligar um módulo do ERP para um cliente é feito à mão, no próprio ERP, sem ligação com o contrato do
INTEROS. Consequências: cliente usando o que não contratou (receita perdida), cliente pagando pelo que não usa
(cancelamento), desligamentos que quebram operação em andamento (caixa aberto, nota pendente) e nenhum histórico de quem
mudou o quê.

## 2. Objetivo desta fase

Gerir os módulos do ERP **por empresa, a partir do INTEROS**, com revisão do impacto antes de enviar, aprovação para o
que é arriscado, envio seguro (sem duplicar, sem desligar nada por omissão) e auditoria completa — e preparar a base
(catálogo, vínculo, estados, eventos) para a Central de Produtos completa (fases seguintes, item 14).

---

## 3. Auditoria (fases 1 e 2)

**INTEROS:** não tinha nenhuma integração com o ERP; produtos e contratos existem, mas sem ligação com módulos.

**ERP Intercert** (repositório `Intercerterp`, somente leitura para nós). A integração está em **duas branches
divergentes**, que precisam ser unificadas pelo time do ERP:

| Branch | O que tem | Contrato |
| --- | --- | --- |
| `claude/eager-tesla-oark2w` | Provisionamento (criar/vincular empresa, convite) e Torre de Controle | `/api/interos/v1/empresas…`, em português, `Bearer <id>.<segredo>` |
| `claude/intercert-erp-modularization-8wzm4r` | Módulos v1 e Licenças v2 (catálogo, licença, simulação, histórico, uso) | `/api/interos/v1/companies…` e `/api/interos/v2…`, em inglês, `Bearer <token>` + HMAC |

A `master` do ERP não tem API para o INTEROS. Um merge de teste das duas branches deu **11 arquivos em conflito**.

**Riscos encontrados no ERP (para o time do ERP decidir):**

1. As duas branches usam o mesmo prefixo `/api/interos/v1` com contratos diferentes (rotas e envelopes em conflito).
2. Três vocabulários de módulo convivem: módulos amplos do provisionamento (`vendas`, `fiscal`…), chaves v1
   (`vendas.pdv`…) e códigos do catálogo v2 (`07.01`…).
3. A API v1 de módulos ignora a restrição `companyIds` da credencial (segurança: uma credencial restrita enxerga outras
   empresas).
4. `POST /empresas` com chave de idempotência nova reaplica a criação inteira.
5. A Torre de Controle devolve dados de módulos não contratados (o INTEROS cruza com o contrato antes de mostrar).
6. O catálogo v2 ainda está marcado como "proposta" (aguarda validação do titular).
7. Testes, agendamentos e encerramentos só são aplicados pela rotina diária do ERP (até 24 h depois da data).
8. Empresas suspensas mantêm ligadas unidades não vendáveis.
9. `upsell-requests` expõe o nome completo de quem pediu (dado pessoal enviado ao INTEROS).
10. Um evento usado por uma requisição inválida fica preso àquele corpo (reenvio corrigido → 409); um número de versão
    recusado nunca mais é aceito. O INTEROS já gera evento e versão novos por lote.

---

## 4. Responsabilidades

| Assunto | Quem é dono |
| --- | --- |
| O que a empresa **contratou** (licença desejada, versão, motivo, aprovação) | INTEROS |
| O que está **ligado de fato**, configuração da empresa, pendências operacionais | ERP |
| Catálogo técnico de módulos (códigos, dependências, situação técnica) | ERP (o INTEROS importa por versão) |
| Preço, pacote comercial, proposta, contrato e cobrança | INTEROS (fases seguintes) |
| Permissões dos funcionários do cliente dentro do ERP | ERP (o INTEROS não mexe) |

---

## 5. Arquitetura e decisões

### 5.1 Fluxo de uma alteração

```
preparar (seleção na tela, guardada na sessão)
  → revisar no servidor: plano completo (dependências + cascata) + simulação do ERP + se exige aprovação
  → confirmar (motivo obrigatório)  ── exige aprovação e a pessoa não pode aprovar → "aguardando aprovação"
  → envio assinado do retrato completo (PUT v2, versão nova, evento = id da alteração)
  → resposta do ERP: aplicada | recusada | conflito | falhou (nova tentativa com a MESMA chave)
  → reconciliação pelo histórico do ERP quando a resposta se perde
```

### 5.2 Decisões

- **Um caminho de escrita só:** o retrato completo da licença (`PUT /api/interos/v2/companies/{id}/license`), sempre
  com códigos de unidade explícitos (nunca o código do módulo inteiro, que ligaria unidades futuras sozinho).
- **Versão monotônica emitida pelo INTEROS:** `max(versão emitida, versão aplicada no ERP) + 1` a cada lote.
- **Idempotência:** o id da alteração é o `X-Interos-Event-Id`; toda nova tentativa reenvia **o mesmo corpo com a mesma
  chave**; o ERP devolve a resposta original em vez de aplicar de novo.
- **Concorrência:** uma alteração aberta por empresa; a confirmação confere, em transação, que a versão que a pessoa
  revisou ainda é a atual ("outra pessoa alterou… o estado foi recarregado"; a seleção pendente é mantida).
- **Aprovação:** exigida para desligamento com pendência, obrigação ou cascata, para suspensão e somente leitura e para
  passar a aplicar o contrato no ERP. Quem pediu não aprova o próprio pedido; quem tem a permissão de aprovar e pede
  envia direto (registrado como aprovado por ele). Aprovadores recebem notificação com link para a aba.
- **Travas de segurança:** a primeira licença parte do que a empresa usa hoje no ERP e **não sai sem essa leitura**
  (sem ela desligaria tudo que não estivesse na lista); **desligamento não sai sem a simulação** do ERP (ela mostra o
  que está em andamento); empresa de demonstração do ERP não pode ser vinculada em produção.
- **Novas tentativas:** só para falhas temporárias (rede, tempo esgotado, ERP indisponível, empresa ocupada
  `license_busy`), em 1, 5, 15, 60, 360 e 720 minutos (no máximo 8), pela rotina de 5 minutos. Credencial recusada não
  é repetida sozinha: a pessoa corrige e usa "Tentar de novo" (ou Administração › Integrações › "Reenviar pendentes").
- **Catálogo por versão:** importado e guardado com a diferença para a versão anterior; conferido a cada 6 horas;
  itens novos (ex.: módulo 51) aparecem sozinhos na aba e avisam quem administra a integração.
- **Estados independentes** por unidade: comercial (INTEROS), operacional (ERP: ativo, em encerramento, consulta
  histórica, inativo, aguardando configuração) e sincronização (sincronizado, processando, aguardando aprovação, falha,
  divergente). O rótulo principal mostra o mais importante para agir.
- **Ambientes separados** (`homologacao` / `producao`): vínculos, catálogo e histórico nunca se misturam; a rotina só
  reenvia alterações do ambiente configurado.
- **Integração inerte sem variáveis de ambiente:** nada é lido nem enviado; a aba explica o que falta.

### 5.3 Onde está no código

| Camada | Arquivos |
| --- | --- |
| Domínio puro | `src/domain/erp/catalog.ts` (catálogo, papéis, dependências), `license.ts` (plano e retrato), `status.ts` (estados), `tower.ts` (blocos da Torre), `packages.ts` (pacotes de partida), `types.ts` |
| Servidor | `src/server/erp/config.ts`, `http.ts` (cliente HTTP, envelopes, repetição), `signature.ts` (HMAC), `errors.ts`, `api-licencas.ts`, `api-provisionamento.ts`, `api-torre.ts`, `catalog-store.ts`, `links.ts`, `changes.ts` (revisão, envio, aprovação, cancelamento, reconciliação, rotina), `provisioning.ts`, `company-view.ts`, `tower-view.ts`, `admin-view.ts`, `sweep.ts`, `actions.ts` |
| Interface | `src/components/erp/*` (aba, árvore, revisão, detalhe do item, alteração em andamento, histórico, Torre, vínculo, criação da empresa, painel de Integrações) |
| Rotina | passo "ERP Intercert" do agendador de 5 minutos (`/api/cron/central`) |
| Banco | `supabase/migrations/20261126000000_erp_intercert.sql` |

---

## 6. O que a aba Módulos ERP entrega (pedido "Tela de gestão de módulos ERP por empresa")

| Pedido | Como ficou |
| --- | --- |
| 1. Aba na ficha da empresa | Aba **Módulos ERP**; cabeçalho fixo com nome da empresa no ERP e ID ERP (copiar), modo de controle, versão da licença; catálogo por família com busca, filtro por estado (12 filtros) e seções recolhíveis; cada linha com nome, descrição, estado e chave liga/desliga quando aplicável; detalhe do item com dependências, configuração pendente e uso sob demanda; recursos da plataforma marcados como obrigatórios |
| 2. Mesmos módulos no provisionamento | Assistente "Criar empresa no ERP": dados da empresa → módulos a partir de um pacote (personalização desta empresa mostrada) → administrador e convite → revisão do conjunto final (com dependências) → resultado |
| 3. Revisão e confirmação | Várias alterações preparadas e revisadas juntas; dependências incluídas e cascata mostradas com confirmação; simulação do ERP com pendências, obrigações, integrações afetadas e política; motivo; resultado devolvido pelo ERP; em falha ou concorrência a seleção é mantida, o estado é recarregado e dá para retomar sem duplicar |
| 4. Permissões internas | Ver, alterar, aprovar, ver histórico, ver Torre e criar/vincular, separadas no catálogo; escopo de cliente conferido no servidor; histórico com empresa, autor, data, motivo, antes/depois e referência da operação no ERP |
| 5. Torre de Controle | Contratadas, configuradas e ativas; blocos com "ativo", "sem movimento", "módulo desativado" (com a data) e "dados indisponíveis"; períodos anteriores à desativação consultáveis; uso e limites |
| 6. Homologação ponta a ponta | Ver item 12 |

---

## 7. Papéis e permissões

| Chave | O que libera | Padrão |
| --- | --- | --- |
| `operacao.clientes.erp.ver` | Aba Módulos ERP (catálogo, estado, uso) | Diretoria e administrador |
| `operacao.clientes.erp-historico.ver` | Histórico e auditoria das alterações | Diretoria e administrador |
| `operacao.clientes.erp-torre.ver` | Torre de Controle da empresa | Diretoria e administrador |
| `operacao.clientes.erp.alterar` | Preparar, revisar, enviar, tentar de novo, cancelar | Administrador |
| `operacao.clientes.erp.aprovar` | Aprovar desligamentos que exigem aprovação | Administrador |
| `operacao.clientes.erp.provisionar` | Criar a empresa no ERP e vincular empresa existente | Administrador |
| `admin.integracoes.erp-catalogo` | Conferir o catálogo agora | Administrador |
| `admin.integracoes.erp-reprocessar` | Reenviar alterações pendentes agora | Administrador |

Toda action confere a permissão e o escopo do cliente no servidor; a interface só esconde botões.

---

## 8. Estrutura de dados

| Coleção | Conteúdo |
| --- | --- |
| `erp_links` | Vínculo cliente ↔ empresa do ERP por ambiente (id ERP, CNPJ, tipo, como foi vinculado, última leitura); trava por empresa para não vincular a mesma empresa a dois clientes |
| `erp_catalogs` | Cada versão do catálogo importada (itens, contagens, diferença para a anterior, origem) e o ponteiro da versão vigente por ambiente |
| `erp_licenses` | Licença por vínculo: versão emitida, último retrato confirmado pelo ERP, versão aplicada, alteração aberta |
| `erp_change_requests` | Cada alteração: pedido, plano completo, retrato enviado, antes/depois, simulação vista, aprovação, motivo, contrato, tentativas, erros, resposta do ERP e referências (`requestId`) |

---

## 9. APIs e integrações

| API do ERP | Uso | Variáveis |
| --- | --- | --- |
| Licenças v2 + módulos v1 | catálogo, licença, simulação, envio assinado, histórico, uso, estado operacional | `ERP_INTERCERT_URL`, `ERP_INTERCERT_AMBIENTE`, `ERP_INTERCERT_TOKEN_LICENCAS`, `ERP_INTERCERT_SEGREDO_ASSINATURA` |
| Provisionamento v1 | criar empresa, vincular com código, retomar implantação, reenviar convite | `ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO` (+ `ERP_INTERCERT_URL_PROVISIONAMENTO` se em outro endereço) |
| Torre de Controle v1 | resumo e adoção | `ERP_INTERCERT_CREDENCIAL_TORRE` (+ `ERP_INTERCERT_URL_TORRE` se em outro endereço) |

Detalhes de cada variável em `.env.example`. Os valores nunca aparecem em tela nem em registro.

---

## 10. Automações e avisos

- Rotina de 5 minutos: reenvia o que aguarda sincronização, conclui o que o ERP já aplicou e confere o catálogo a cada
  6 horas.
- Avisos: pedido de aprovação (para quem pode aprovar, com link para a aba); catálogo com itens novos (para quem
  administra a integração).
- Eventos na linha do tempo do cliente: vínculo, criação no ERP, licença alterada, falha, pedido de aprovação.

---

## 11. Segurança

- Credenciais só no servidor; envio da licença assinado com HMAC (`X-Interos-Signature`) e evento único.
- O link do convite do administrador é mostrado uma única vez e **nunca é gravado**; o corpo enviado ao ERP na criação
  (com dados do administrador) não vai para o navegador.
- Endereço do ERP só `https` (ou `http` para `localhost` em desenvolvimento); redirecionamentos recusados.
- Escopo de cliente conferido em toda action; quem pediu não aprova o próprio pedido.

---

## 12. Homologação ponta a ponta (26/11/2026)

Ambiente: INTEROS local (build de produção) ligado a duas instâncias locais do ERP com dados fictícios — licenças e
módulos na branch de modularização, provisionamento e Torre na branch do provisionamento (mesmo id de empresa nas duas).
Usuários: Hércules (administrador) e Lando (gestor com permissão de alterar liberada por exceção, sem aprovar).

| # | Cenário | Resultado |
| --- | --- | --- |
| 1 | Vincular duas empresas fictícias com combinações diferentes de módulos (Loja Demonstração e Gama Store) | Vinculadas por CNPJ + id conferidos no ERP; Gama mostra "Aguardando configuração" (PDV sem terminal, NF-e sem certificado, loja não publicada) |
| 2 | Dois usuários na mesma empresa | Lando revisou, Hércules enviou antes (v2); o envio do Lando foi recusado com "outra pessoa alterou", a seleção dele ficou, ele revisou e enviou (v3) |
| 3 | Desligar módulo com operação pendente | Desligar o caixa trouxe cascata (frente de caixa, reserva, crediário, devolução, fidelidade) e a simulação apontou caixa aberto e atendimento em espera; ficou aguardando aprovação, Hércules foi avisado e aprovou; o ERP pôs o caixa em encerramento (v4) |
| 4 | Ligar módulo com dependência | Religar a frente de caixa incluiu o caixa por dependência (v5) |
| 5 | Falha de configuração | Com o segredo de assinatura errado, o ERP recusou ("assinatura inválida"); corrigido o segredo, "Tentar de novo" aplicou com a **mesma chave** (v6) — no ERP há um único registro da versão 6, com o evento do INTEROS |
| 6 | Isolamento | A outra empresa e a terceira empresa do ERP não mudaram; histórico do ERP com os eventos exatos do INTEROS (v1–v3 na Gama, v4–v7 na Loja) |
| 7 | Torre de Controle | Blocos ativos com números do ERP; "Trocas e devoluções" como **módulo desativado** com a data e consulta do período anterior; a Gama (sem dados na Torre local) aparece como **dados indisponíveis**, não "sem movimento" |
| 8 | Teste com data | SPED Fiscal liberado em teste por 15 dias (v7) |
| 9 | Criar empresa no ERP | Empresa criada e vinculada pelo assistente; licença inicial ficou aguardando porque, no ambiente dividido, a API de licenças ainda não conhece empresas criadas pela outra branch (some com o ERP unificado) |

Testes automáticos: 862 de unidade (16 novos de estados/Torre/pacotes/CNPJ, 8 de licença, 25 de catálogo/HTTP) e 194
de banco (13 novos do serviço de alterações contra um ERP simulado: primeira licença, concorrência, aprovação,
cancelamento, queda, empresa ocupada, resposta perdida, isolamento e histórico). Os testes de banco acharam e
corrigiram dois defeitos antes da homologação (cancelamento que lia depois de escrever e reenvio que podia sair depois de
cancelado); a homologação achou um terceiro (resultado da criação da empresa sumia da tela).

---

## 13. Ativação gradual

1. **Migration**: `supabase/migrations/20261126000000_erp_intercert.sql` aplicada no Supabase (aditiva, 4 coleções).
2. **Homologação primeiro**: na Vercel, defina `ERP_INTERCERT_AMBIENTE=homologacao` e as variáveis do ERP de
   homologação (ver `.env.example`) e publique. Sem as variáveis a aba só explica o que falta — nada é enviado.
3. **Catálogo**: Administração › Integrações › ERP Intercert › "Conferir catálogo agora" (ou abra a aba de qualquer
   cliente).
4. **Quem vê**: por padrão só diretoria e administradores veem a aba; só administradores alteram e aprovam. Libere por
   perfil ou por pessoa em Administração › Usuários (ex.: implantação pode ver e alterar, sem aprovar).
5. **Primeiras empresas**: vincule 2 ou 3 clientes piloto; a primeira alteração de cada um registra o retrato do que já
   usam (nada é desligado por omissão). Use o modo "Observação" antes de "Contrato aplicado" se quiser ver o que seria
   bloqueado sem bloquear.
6. **Produção**: só depois do ERP unificado e homologado, troque para `ERP_INTERCERT_AMBIENTE=producao` com as
   credenciais de produção. Vínculos e histórico de homologação ficam separados.
7. **Desligar**: remover `ERP_INTERCERT_URL` (ou o token) desliga a integração na hora; nada do ERP é apagado.

---

## 14. Limitações conhecidas e decisões pendentes

- Enquanto as duas branches do ERP não forem unificadas, empresa criada pelo provisionamento não aparece na API de
  licenças (licença inicial fica aguardando) e o vínculo por código (branch do provisionamento) não vale para a API de
  licenças (branch de módulos).
- O catálogo v2 ainda é "proposta" do ERP; preços e pacotes comerciais oficiais são da fase de Gestão de Produtos.
- Teste, agendamento e encerramento dependem da rotina diária do ERP (até 24 h).
- O catálogo não traz para quais tipos de empresa cada unidade vale: o assistente de criação ainda mostra unidades de
  escritório contábil para varejo (o ERP recusa na licença). Pedido ao ERP: preencher `kinds` por unidade.
- Decisões do time do ERP: unificar as branches e o prefixo `/api/interos`; um vocabulário de módulos; restringir a v1
  por `companyIds`; idempotência do `POST /empresas`; validar o catálogo; credenciais de homologação e produção.

---

## 15. Próximas fases da Central de Produtos (plano)

Ordem pensada para entregar valor cedo e não refazer nada: cada fase usa o catálogo, o vínculo, os estados e os
eventos desta.

| Fase | Entrega | Depende de |
| --- | --- | --- |
| 7 | **Gestão de Produtos** (área própria): produto → módulo → submódulo → recurso, hardware separado; ficha do módulo comercial (descrição, regras, dependências comerciais) — **entregue (seção 16)** | catálogo importado |
| 8 | **Preços e pacotes versionados**: modelos de preço (fixo, por unidade, por usuário, por faixa, setup), pacotes por segmento com versão, sem cobrança dupla (o que vem no pacote não é cobrado de novo) — **entregue (seção 16)** | 7 |
| 9 | **Proposta → contrato → aditivo** com módulos: o aceite do aditivo prepara a alteração de licença (revisão e aprovação como hoje) | 8 + circuito de receita existente |
| 10 | **Cobrança**: mensalidade por módulo no faturamento (boletos Bradesco já existentes), testes que viram contrato, limites e excedentes | 9 |
| 11 | **Uso e inteligência comercial**: uso por módulo (já lido do ERP) → alertas de baixo uso (risco de cancelamento), módulos usados sem contrato e sugestões de venda; pedidos de módulo vindos do ERP | 7 + uso |
| 12 | **Painéis**: MRR/ARR por módulo e pacote, churn, adoção, receita perdida; operações em massa com simulação (ex.: novo pacote para 50 clientes) | 8–11 |
| 13 | **Segmentação e implantação**: pacotes por segmento a partir do uso real; implantação guiada pelos módulos contratados (tarefas por módulo) | 11 |

Critério de aceite de cada fase: testes de unidade e de banco, verificação de acesso completa, homologação com o ERP de
homologação e nenhuma alteração irreversível em produção sem validação.

---

## 16. Gestão de Produtos (fases 7 e 8, 26/11/2026)

**Problema.** Os módulos do ERP não tinham camada comercial: não havia onde dizer o que é vendido, por quanto, desde
quando e em que pacote, nem como evitar cobrar duas vezes um módulo que já vem no pacote.

**Onde.** Administração › Produtos, nas abas **Módulos do ERP**, **Pacotes** e **Simulador de preço** (a aba
**Produtos** continua o catálogo usado em propostas, contratos e comissões; hardware e serviços seguem lá).

| Aba | O que faz |
| --- | --- |
| Módulos do ERP | As 67 unidades comerciais do catálogo agrupadas pelos 53 módulos do ERP, com situação comercial (em definição, à venda, sob consulta, descontinuado), preço vigente e preço agendado. A ficha tem nome comercial, texto para proposta, segmentos, dependências comerciais, observações internas, o histórico de preços (nova versão, cancelamento da que ainda não começou) e o que a unidade inclui, exige e quem depende dela no ERP |
| Pacotes | Pacotes por segmento com versões (módulos incluídos, mensalidade, implantação, início da vigência, motivo). Novo pacote parte de um pacote de partida do ERP (varejo essencial, moda, supermercado, bebidas, e-commerce, escritório contábil) ou do zero; mostra dependências que faltam, módulos que o ERP ainda não vende e a economia sobre os mesmos módulos avulsos |
| Simulador | Pacote + módulos avulsos com quantidades, pelo preço vigente na data escolhida, sem cobrança dupla; aponta dependências que faltam (com "Acrescentar") e copia o resumo para a proposta |

**Regras de negócio.**

1. Preço e pacote são **versionados por data**: mudar = nova versão a partir de hoje ou de uma data futura; o passado
   não muda. Versão que começa hoje ou depois pode ser cancelada (fica no histórico).
2. Modelos: mensalidade fixa; por quantidade (base com unidades incluídas + valor por unidade adicional, ex.: terminal,
   usuário, filial); por faixa (o valor da faixa em que a quantidade cai). Implantação é cobrança única.
3. **Sem cobrança dupla**: o que está no pacote não é cobrado de novo; dentro do pacote só se cobra a quantidade além
   da incluída. Sem preço vigente, o total aparece como incompleto (nunca se inventa preço).
4. "À venda" só para módulos que o ERP já vende (homologados). Um módulo à venda sem preço avulso é vendido só em
   pacote.
5. Pacote nasce em definição e só vai à venda com versão vigente ou agendada.

**Catálogo.** Enquanto a integração com o ERP não está ligada em produção, a Gestão de Produtos usa o **catálogo de
referência** (a proposta 2.0.0 do ERP, embutida no INTEROS) e avisa isso na tela. Quando o catálogo oficial for
importado, ele passa a valer automaticamente; fichas cujo código saiu do catálogo aparecem para revisão.

**Acessos.** Por padrão só administradores veem e alteram. Para a diretoria ou o comercial, libere em Administração ›
Usuários › Perfis e acessos: "Módulos do ERP", "Pacotes" e "Simulador de preço" (ver) e, se for o caso, editar a
ficha, criar versões de preço e editar pacotes (as duas últimas são sensíveis).

**Próximo passo (fase 9).** Usar a simulação na proposta e no contrato (guardando a versão de preço e de pacote usada),
para o aceite preparar a alteração de licença no ERP.

