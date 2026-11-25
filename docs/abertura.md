# Abertura do INTEROS

Vídeo de 7 s que toca ao abrir o sistema no desktop, no mesmo padrão da abertura do portal Wellmix.

## A história (versão 2, 25/11/2026)

Os seis departamentos da Intercert são os seis vértices do hexágono da marca (docs/contexto-negocio.md):

1. O anel aparece inclinado em 3D, sobre um piso de hexágonos.
   - Os vértices acendem em sequência, cada um com o ícone do departamento (os mesmos do sistema, lucide): Marketing, Vendas, Financeiro, Implantação, CS e Suporte.
2. A linha laranja do cliente percorre o anel com um rastro.
   - Cada gate acende ao passar, com faíscas e um pulso de luz no anel: MQL, Ganho, Contrato, Go-live, Ativado e Resolvido.
3. À direita, o cartão Cliente 360° do cliente de exemplo "Mercado Silva" (fictício) ganha uma linha a cada gate, ligado ao vértice por uma curva:
   - Lead do Instagram · score 82
   - ERP + TEF + maquininha
   - Assinado · R$ 1.290/mês
   - Treinamento concluído
   - Saúde do cliente 94
   - Chamado resolvido em 1h40

   Cada passagem também corre para o centro, onde o miolo cresce: a linha do tempo única do cliente. Legenda: "Seis áreas · um só fluxo · o cliente no centro".
4. O anel endireita, fecha, encolhe e engrossa até as proporções do símbolo (anel 19,5 com traço 5 e miolo 7,5 numa caixa de 48, `src/components/layout/logo.tsx`).
5. O símbolo desliza para a esquerda, "INTEROS" se escreve letra a letra e "by Intercert" aparece embaixo.
6. A câmera mergulha no miolo laranja e um hexágono se abre do centro.
   - No sistema, a camada é recortada com esse hexágono (`introIrisPath` em `src/lib/intro.ts`), e por dentro dele já aparece a página de verdade, que "pousa" enquanto ele cresce.
   - No vídeo, e em navegador sem `clip-path: path()`, o hexágono se abre para o fundo da página (`#060d1a`).

Acabamento:
- Cada quadro é a média de 5 instantes dentro de meio quadro: desfoque de movimento, como o obturador de uma câmera.
- Grão de filme leve por cima, que some no hexágono final.

A versão 1 (PR #43) tinha o anel chapado, sem ícones, sem o cartão e com o final escuro.

## Arquivos

- `public/intro/interos-intro.mp4` (H.264), `interos-intro.webm` (VP9) e `interos-intro-poster.jpg` (primeiro quadro): 1920 × 1080, 60 quadros, sem som.
- `scripts/intro/intro.html`: a animação desenhada quadro a quadro num canvas, com as cores de `globals.css` e a fonte Geist (`scripts/intro/fonts`, licença OFL).
  - Para ver no navegador: `?play` toca a animação; `?t=3.2` mostra um instante parado.
- `scripts/intro/render.mjs` grava o vídeo e precisa do Playwright (Chromium) e do ffmpeg:
  - `node scripts/intro/render.mjs` refaz os três arquivos de `public/intro`;
  - `node scripts/intro/render.mjs 1.5 4.9` grava só esses instantes em `scripts/intro/stills/` para conferir (pasta fora do git).
- `src/lib/intro.ts`: regras, script inline do `<head>` e o hexágono final (`INTRO_IRIS`, com os mesmos tempos e raio do `intro.html`; mudou lá, mude aqui).
- `src/components/intro-player.tsx`: camada com o vídeo, o "Pular" e o recorte do hexágono a cada quadro.
- `src/app/globals.css`: o "pouso" da página, que começa quando o hexágono começa a abrir.

## Quando toca

- Só com janela de 1024 px ou mais: o celular nunca vê.
- Na primeira abertura do dia (localStorage `interos-intro-day`, data local do navegador) e ao recarregar (F5) uma página inicial (`/`, `/login` ou `/meu-dia`). Navegar pelo menu ou abrir outra aba no mesmo dia não repete.
- "Pular" (Esc, Enter ou espaço) aparece aos 0,6 s e sai aos 5,6 s, quando começa o mergulho.
- Nunca com `prefers-reduced-motion` e nunca em navegador automatizado (`navigator.webdriver`), para os testes e as auditorias não esperarem.
- O "pouso" da página começa quando o hexágono começa a abrir (6,32 s).
- Se o vídeo não começar em 8 s ou der erro, a página aparece normalmente.
- Na URL: `?intro=always` força e `?intro=off` não toca.

Testes: `tests/lib/intro.test.ts`.
