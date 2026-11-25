# Abertura do INTEROS

Vídeo de 7 s que toca ao abrir o sistema no desktop, no mesmo padrão da abertura do portal Wellmix.

## A história

Os seis departamentos da Intercert são os seis vértices do hexágono da marca (docs/contexto-negocio.md):

1. Os vértices acendem em sequência: Marketing, Vendas, Financeiro, Implantação, CS e Suporte.
2. A linha laranja do cliente percorre o anel, e cada gate acende ao passar: MQL, Ganho, Contrato, Go-live, Ativado e Resolvido.
3. Cada passagem vira um evento (pulso ciano) que corre para o centro, onde o miolo cresce. É a linha do tempo única do cliente.
   - Legenda: "Seis áreas · um só fluxo · o cliente no centro".
4. O anel fecha, encolhe e engrossa até as proporções do símbolo (anel 19,5 com traço 5 e miolo 7,5 numa caixa de 48, `src/components/layout/logo.tsx`).
5. O símbolo desliza para a esquerda, "INTEROS" se escreve letra a letra e "by Intercert" aparece embaixo.
6. A câmera mergulha no miolo laranja e um hexágono se abre do centro até o fundo da página (`#060d1a`), onde o sistema "pousa".

## Arquivos

- `public/intro/interos-intro.mp4` (H.264), `interos-intro.webm` (VP9) e `interos-intro-poster.jpg` (primeiro quadro): 1920 × 1080, 60 quadros, sem som.
- `scripts/intro/intro.html`: a animação desenhada quadro a quadro num canvas, com as cores de `globals.css` e a fonte Geist (`scripts/intro/fonts`, licença OFL).
  - Para ver no navegador: `?play` toca a animação; `?t=3.2` mostra um instante parado.
- `scripts/intro/render.mjs` grava o vídeo e precisa do Playwright (Chromium) e do ffmpeg:
  - `node scripts/intro/render.mjs` refaz os três arquivos de `public/intro`;
  - `node scripts/intro/render.mjs 1.5 4.9` grava só esses instantes em `scripts/intro/stills/` para conferir (pasta fora do git).
- `src/lib/intro.ts` (regras e script inline do `<head>`), `src/components/intro-player.tsx` (camada com o vídeo e o "Pular") e o "pouso" da página em `src/app/globals.css`.

## Quando toca

- Só com janela de 1024 px ou mais: o celular nunca vê.
- Na primeira abertura do dia (localStorage `interos-intro-day`, data local do navegador) e ao recarregar (F5) uma página inicial (`/`, `/login` ou `/meu-dia`). Navegar pelo menu ou abrir outra aba no mesmo dia não repete.
- "Pular" (Esc, Enter ou espaço) aparece aos 0,6 s e sai aos 5,6 s, quando começa o mergulho.
- Nunca com `prefers-reduced-motion` e nunca em navegador automatizado (`navigator.webdriver`), para os testes e as auditorias não esperarem.
- Se o vídeo não começar em 8 s ou der erro, a página aparece normalmente.
- Na URL: `?intro=always` força e `?intro=off` não toca.

Testes: `tests/lib/intro.test.ts`.
