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

> **Atualização (27/11/2026):** as duas branches foram unificadas e estão na `master` do ERP (PR #8 do repositório do
> ERP): as APIs ficam num endereço só e as três credenciais usam `Bearer <id>.<segredo>`, com escopos de uma família
> cada. O que ainda falta do lado do ERP está na seção 14.

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
| Servidor | `src/server/erp/config.ts`, `http.ts` (cliente HTTP, envelopes, repetição), `signature.ts` (HMAC), `errors.ts`, `api-licencas.ts`, `api-provisionamento.ts`, `api-torre.ts`, `catalog-store.ts`, `links.ts`, `changes.ts` (revisão, envio, aprovação, cancelamento, reconciliação, rotina), `provisioning.ts`, `company-view.ts`, `tower-view.ts`, `admin-view.ts`, `sweep.ts`, `actions.ts`, `inbound.ts` (avisos do ERP, seção 17) |
| Interface | `src/components/erp/*` (aba, árvore, revisão, detalhe do item, alteração em andamento, histórico, Torre, vínculo, criação da empresa, painel de Integrações) |
| Rotina | passo "ERP Intercert" do agendador de 5 minutos (`/api/cron/central`) |
| Webhook | `src/app/api/webhooks/erp/route.ts` (avisos do ERP na hora, seção 17) |
| Banco | `supabase/migrations/20261126000000_erp_intercert.sql`, `20261127000000_erp_eventos.sql` |

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
| `erp_events` | Cada aviso recebido do ERP (id = ambiente + hash do `eventId`): tipo, empresa, cliente, dados, situação, entregas, resultado; o aviso diário "sem licença nova" fica em um registro por empresa |

---

## 9. APIs e integrações

| API do ERP | Uso | Variáveis |
| --- | --- | --- |
| Licenças v2 + módulos v1 | catálogo, licença, simulação, envio assinado, histórico, uso, estado operacional | `ERP_INTERCERT_URL`, `ERP_INTERCERT_AMBIENTE`, `ERP_INTERCERT_TOKEN_LICENCAS`, `ERP_INTERCERT_SEGREDO_ASSINATURA` |
| Provisionamento v1 | criar empresa, vincular com código, retomar implantação, reenviar convite | `ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO` |
| Torre de Controle v1 | resumo e adoção | `ERP_INTERCERT_CREDENCIAL_TORRE` |
| Avisos do ERP (ERP → INTEROS) | `POST /api/webhooks/erp`, assinado com `X-ERP-Signature` (seção 17) | `ERP_INTERCERT_SEGREDO_EVENTOS` (no ERP: `INTEROS_OUTBOUND_SECRET` com o mesmo valor e `INTEROS_EVENTS_URL`) |

Detalhes de cada variável em `.env.example`. Os valores nunca aparecem em tela nem em registro. Desde a unificação do
ERP (27/11/2026), as três APIs ficam no mesmo endereço (`ERP_INTERCERT_URL`) e as três credenciais têm o formato
`<id>.<segredo>`, cada uma com escopos de uma família só (`docs/interos/credenciais.md` no repositório do ERP).

---

## 10. Automações e avisos

- Rotina de 5 minutos: reenvia o que aguarda sincronização, conclui o que o ERP já aplicou e confere o catálogo a cada
  6 horas.
- Avisos: pedido de aprovação (para quem pode aprovar, com link para a aba); catálogo com itens novos (para quem
  administra a integração).
- Eventos na linha do tempo do cliente: vínculo, criação no ERP, licença alterada, falha, pedido de aprovação e, com os
  avisos do ERP ligados (seção 17), mudança automática de módulos, pedido de módulo feito no ERP e limite do contrato
  atingido.
- Avisos do ERP na hora: licença aplicada ou recusada conclui na hora a alteração que perdeu a resposta; pedido de
  módulo e limite do contrato viram tarefa para o comercial do cliente.

---

## 11. Segurança

- Credenciais só no servidor; envio da licença assinado com HMAC (`X-Interos-Signature`) e evento único.
- Avisos do ERP só com assinatura válida (`X-ERP-Signature`, HMAC com segredo próprio, janela de ±5 minutos, tempo
  constante) e processados uma vez por `eventId`; o aviso de licença não muda nada sozinho, só antecipa a conferência no
  histórico do ERP.
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

### 12.1 Homologação com o ERP publicado (27/11/2026)

Ambiente: INTEROS de produção (`ERP_INTERCERT_AMBIENTE=homologacao`) ligado à prévia de homologação do ERP unificado,
com as credenciais de homologação. Dados de teste: dois clientes "TESTE HML", apagados no fim (81 registros).

| Cenário | Resultado |
| --- | --- |
| Vincular empresa existente | Aurora (empresa A do piloto) achada pelo CNPJ e vinculada; a aba mostrou "Licença ainda não registrada pelo INTEROS · ERP na v1" |
| Criar empresa pelo INTEROS | Empresa, administrador e convite criados. A licença inicial foi recusada (`403 company_not_allowed`): a empresa nova não estava na lista `empresas` da credencial de licenças. Incluída a empresa e publicado o ERP, "Tentar de novo" aplicou a licença versão 1 |
| Convite e pedido de módulo | O administrador ativou o acesso, entrou no ERP e pediu 05.02 Cotação com fornecedores; o aviso chegou na hora e virou tarefa de vendas |
| Alteração de módulo | Primeira licença da Aurora pelo INTEROS: 03.13 Importação de CT-e com 05.06 Recebimento por dependência, simulada e aplicada (licença versão 2) |
| "Basta um" no catálogo real | 02.09 e 02.14 barrados na revisão: exigem 04.01 ou 04.02 |
| Isolamento | A empresa fora da lista da credencial de licenças foi recusada pelo ERP antes de qualquer gravação |
| Torre e uso | Torre de Controle e "Uso e limites" das duas empresas, pelas credenciais da Torre e de licenças |
| Avisos | `license.applied` das duas empresas processados ("a alteração já estava concluída"); nenhum erro no navegador |

Não repetidos nesta rodada (passaram na seção 12 e nos testes): dois usuários na mesma empresa, desligar com pendência e
aprovação, falha de assinatura e teste com data. Para aprovar a homologação ainda faltam a conferência do histórico de
licença junto com o time do ERP e a validação do catálogo v2 pelo titular. O mesmo resultado, visto do ERP:
`docs/interos/pendencias-integracao.md`, §10, no repositório do ERP.

---

## 13. Ativação gradual

1. **Migration**: `supabase/migrations/20261126000000_erp_intercert.sql` aplicada no Supabase (aditiva, 4 coleções).
2. **Homologação primeiro**: na Vercel, no ambiente **Production** (as prévias do INTEROS não têm banco), defina
   `ERP_INTERCERT_AMBIENTE=homologacao` e as variáveis do ERP de homologação (ver `.env.example`) e publique. O
   endereço da homologação do ERP é o da prévia da branch de integração. Sem as variáveis a aba só explica o que falta
   — nada é enviado. Na homologação, a credencial de licenças é restrita às empresas do piloto: a empresa criada pelo
   INTEROS só recebe a licença inicial depois que o ERP inclui o id dela na lista e publica de novo. Até lá o ERP
   responde `403 company_not_allowed`, e a aba mostra "O ERP recusou a credencial do INTEROS… (Esta credencial não
   pode operar esta empresa.)". Corrigida a lista, use "Tentar de novo".
3. **Catálogo**: Administração › Integrações › ERP Intercert › "Conferir catálogo agora" (ou abra a aba de qualquer
   cliente).
4. **Quem vê**: por padrão só diretoria e administradores veem a aba; só administradores alteram e aprovam. Libere por
   perfil ou por pessoa em Administração › Usuários (ex.: implantação pode ver e alterar, sem aprovar).
5. **Primeiras empresas**: vincule 2 ou 3 clientes piloto; a primeira alteração de cada um registra o retrato do que já
   usam (nada é desligado por omissão). Use o modo "Observação" antes de "Contrato aplicado" se quiser ver o que seria
   bloqueado sem bloquear.
6. **Produção**: só depois da homologação aprovada, troque para `ERP_INTERCERT_AMBIENTE=producao` com as
   credenciais de produção e o endereço de produção do ERP. Vínculos e histórico de homologação ficam separados. As
   credenciais de produção vão **sem lista de empresas** (decisão de 27/11), e o ERP só deixa a de licenças alcançar as
   empresas ligadas ao INTEROS: as criadas por ele e as vinculadas com o código do administrador. A empresa criada pelo
   INTEROS recebe a licença inicial na hora. Uma empresa que já usa o ERP se vincula com o código de vínculo, porque a
   busca pelo CNPJ só acha empresas já ligadas ao INTEROS (seção 12.1).
7. **Avisos do ERP** (opcional, seção 17): aplique `20261127000000_erp_eventos.sql`, gere um segredo e salve o mesmo
   valor na Vercel (`ERP_INTERCERT_SEGREDO_EVENTOS`) e no ERP (`INTEROS_OUTBOUND_SECRET`), com
   `INTEROS_EVENTS_URL=https://<domínio do INTEROS>/api/webhooks/erp` no ERP. O endereço exato aparece em
   Administração › Integrações › ERP Intercert.
8. **Desligar**: remover `ERP_INTERCERT_URL` (ou o token) desliga a integração na hora; nada do ERP é apagado. Remover
   `ERP_INTERCERT_SEGREDO_EVENTOS` desliga só os avisos (o webhook responde 503 e a rotina continua confirmando).

---

## 14. Limitações conhecidas e decisões pendentes

- ~~Branches do ERP separadas~~: resolvido em 27/11/2026. O ERP unificado está na `master` do ERP (PR #8), com as
  quatro APIs num endereço e credencial única por família. Homologado com o INTEROS. A empresa criada pelo INTEROS
  recebe a licença inicial na hora quando a credencial de licenças não tem lista (produção); na homologação, depois que
  o ERP inclui o id dela na lista (seção 13, passo 2).
- Dependências "basta um" do catálogo v2 (`requiredAnyOf`, ex.: 06.12 Comissões exige 06.01, 07.01 ou 12.01): o
  INTEROS mostra no detalhe da unidade, para o lote com a explicação quando nenhuma alternativa fica ligada e desliga
  em cascata quem perde a última alternativa. A escolha da alternativa é de quem pede. Na criação da empresa, o
  assistente não deixa continuar sem a alternativa e o servidor confere de novo ANTES de chamar o ERP (a empresa não
  fica criada lá sem a licença inicial).
- O catálogo v2 ainda é "proposta" do ERP; preços e pacotes comerciais oficiais são da fase de Gestão de Produtos.
- Teste, agendamento e encerramento valem na data: o ERP aplica sozinho na primeira requisição da empresa ou na
  próxima leitura do INTEROS (correção 3 do ERP), sem esperar a rotina diária.
- O catálogo v2 do ERP unificado traz `companyKinds` por unidade; o INTEROS já lê o campo.
- Pendências do ERP: validação do catálogo v2 pelo titular (sair de "proposta") e credenciais de produção, sem lista
  de empresas (seção 13, passo 6).

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
| 11 | **Uso e inteligência comercial**: uso por módulo (já lido do ERP) → alertas de baixo uso (risco de cancelamento), módulos usados sem contrato e sugestões de venda; pedidos de módulo e limites do contrato vindos do ERP — **avisos entregues (seção 17)** | 7 + uso |
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
| Módulos do ERP | As 67 unidades comerciais do catálogo agrupadas pelos 24 módulos do ERP que as têm (de 53 no catálogo), com situação comercial (em definição, à venda, sob consulta, descontinuado), preço vigente e preço agendado. A ficha tem nome comercial, texto para proposta, segmentos, dependências comerciais, observações internas, o histórico de preços (nova versão, cancelamento da que ainda não começou) e o que a unidade inclui, exige e quem depende dela no ERP |
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

---

## 17. Avisos do ERP na hora (webhook ERP → INTEROS, 27/11/2026)

**Problema.** O INTEROS só sabia do ERP quando perguntava: a confirmação de uma licença cuja resposta se perdeu esperava
a rotina de 5 minutos, e o que acontece só no ERP (fim de teste, suspensão agendada, alguém da empresa pedindo um
módulo, limite de usuários atingido) não chegava ao comercial.

**Solução.** O ERP já tem uma fila de avisos para o INTEROS (contrato v2, eventos de saída) com assinatura e até 12
novas tentativas. O INTEROS passou a recebê-los em `POST /api/webhooks/erp`:

| Aviso do ERP | O que o INTEROS faz |
| --- | --- |
| `license.applied` / `license.rejected` | Se a alteração daquela versão ainda aguarda resposta (resposta perdida, queda), confere no histórico do ERP e conclui na hora, sem reenviar. Já concluída: só registra |
| `license.transition` | Linha "Mudança automática de módulos no ERP" no histórico do cliente, com o "de → para" de cada módulo (ex.: "vendas.pdv: ligado → desligado · situação da empresa: suspensa") |
| `upsell.requested` | Linha "Pediram … no ERP" no histórico + tarefa de prioridade alta para o comercial do cliente (ou o CS; sem nenhum, fica em vendas sem responsável), prazo de 2 dias, avisada pela notificação de tarefa |
| `limit.reached` | Linha "Limite de usuários atingido no ERP (5 de 5)" + tarefa de ampliação do contrato, **uma por mês e tipo** (o ERP avisa no máximo uma vez por dia). Documentos fiscais: só aviso, o ERP não bloqueia |
| `sync.stale` | Só informativo: o INTEROS envia a licença apenas quando algo muda, então este aviso diário é esperado. Fica um registro por empresa, fora da lista de recentes |
| Tipo novo | Registrado e ignorado (200), para o ERP não repetir à toa |

**Regras e garantias.**

1. Só com assinatura válida: `X-ERP-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256 de `${t}.${corpo}` com
   `ERP_INTERCERT_SEGREDO_EVENTOS`, janela de ±5 minutos (o ERP assina de novo a cada tentativa).
2. Uma vez só por `eventId` (`<tipo>:<empresa>:<instante>`, o mesmo em todas as tentativas): o registro é reservado em
   transação; repetida depois de concluída responde 200 sem refazer nada; simultânea à que está em andamento responde
   503 (o ERP tenta depois); interrompida há mais de 2 minutos é retomada sem repetir a linha do histórico.
3. Tarefa com id fixo por chave (pedido, ou limite + mês): duas entregas ao mesmo tempo não criam duas tarefas.
4. Empresa sem vínculo ativo no ambiente configurado: 200 e "ignorado".
5. Respostas: 503 sem configuração ou em andamento · 413 corpo acima de 64 KB · 401 assinatura (com o motivo:
   `missing`, `malformed`, `expired`, `mismatch`) · 400 corpo inválido · 200 recebido · 500 falha inesperada (o ERP
   repete). 4xx faz o ERP desistir daquele aviso; 5xx faz repetir.

**Administração.** Administração › Integrações › ERP Intercert › "Avisos do ERP na hora": se está recebendo, o endereço
para cadastrar no ERP (com botão de copiar), o último aviso, quantas empresas estão com o aviso diário de licença sem
novidade e os 20 avisos mais recentes com situação e resultado.

**Ligar.** Ver passo 7 da seção 13. Sem o segredo, nada muda: a rotina de 5 minutos continua confirmando as alterações
(pedidos de módulo e limites só chegam com os avisos ligados).

**Testes.** 10 de unidade (envelope e dados de cada tipo, no formato que o ERP manda hoje) e 14 de banco pela mesma
função do webhook: assinatura (ausente, malformada, outro segredo, vencida, corpo alterado), corpo grande e inválido,
tipo novo, empresa sem vínculo, pedido com tarefa e aviso ao comercial, entrega repetida e simultânea, limite uma vez
por mês, cliente sem comercial, documentos fiscais, transição no formato do ERP, resposta perdida concluída pelo aviso
sem reenvio, aviso de alteração já concluída, retomada depois de queda e aviso diário em um registro por empresa.

**Pedidos ao time do ERP (atendidos em 27/11).** Os avisos estão configurados na homologação e chegam na hora (seção
12.1). O `sync.stale` passou a contar desde a última confirmação, e as mudanças de `license.transition` trazem o código
comercial da unidade (`05.02`) além da chave interna do módulo (pendências do ERP, §8, itens 3 e 4).
