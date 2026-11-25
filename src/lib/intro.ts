/**
 * Abertura do INTEROS (vídeo, só no desktop; docs/abertura.md). A decisão de
 * tocar é tomada por um script inline no `<head>` (INTRO_BOOT), antes do
 * primeiro quadro: assim a tela já nasce coberta e a página nunca pisca antes
 * da animação. Quem toca o vídeo (`public/intro/interos-intro.*`) é
 * `src/components/intro-player.tsx`.
 *
 * Regras:
 * - só com janela de 1024 px ou mais (breakpoint `lg`): o celular nunca vê;
 * - toca na primeira abertura do dia (localStorage, data local do navegador)
 *   e ao recarregar (F5) uma página inicial (`/`, `/login` ou `/meu-dia`);
 *   navegar pelo menu ou abrir outra aba no mesmo dia não repete;
 * - "Pular", Esc, Enter ou espaço encerram na hora;
 * - nunca em navegador automatizado (`navigator.webdriver`: Playwright,
 *   Lighthouse), para o E2E e as auditorias não esperarem a animação;
 * - nunca para quem pede menos movimento (`prefers-reduced-motion`);
 * - `?intro=always` força (ignora as regras acima e não marca o dia) e
 *   `?intro=off` não toca.
 *
 * Final: o hexágono que se abre no vídeo (6,32 s a 6,95 s) é recortado na
 * camada do portal (`introIrisPath`), então por dentro dele já aparece a
 * página de verdade, que "pousa" enquanto ele cresce. Navegador sem
 * `clip-path: path()` vê o hexágono se abrir para o fundo escuro do vídeo.
 *
 * Em `<html>`, `data-io-intro` conta a fase: `pending` (coberta, vídeo a
 * caminho) → `playing` → `done` (a página "pousa", transição em globals.css)
 * → atributo removido.
 */

/** Dia (local) em que a abertura já tocou neste navegador (localStorage). */
export const INTRO_DAY_KEY = "interos-intro-day";
/** Páginas iniciais: recarregar (F5) uma delas toca de novo. */
export const INTRO_HOME_PATHS = ["/", "/login", "/meu-dia"] as const;
/** Janela mínima: o mesmo `lg` do Tailwind. */
export const INTRO_MEDIA = "(min-width: 1024px)";
/** Quem pede menos movimento não vê a abertura. */
export const INTRO_REDUCED_MEDIA = "(prefers-reduced-motion: reduce)";
/**
 * O vídeo, em dois formatos (1920 × 1080, 60 quadros, sem som, 7 s; gerado por
 * `scripts/intro/render.mjs`): o MP4 (H.264) para Chrome, Safari, Edge e
 * Firefox, e o WebM (VP9) para o Chromium sem H.264 (Playwright). O navegador
 * escolhe o primeiro que sabe tocar.
 */
export const INTRO_VIDEO = {
  mp4: {
    src: "/intro/interos-intro.mp4",
    type: 'video/mp4; codecs="avc1.640032"',
  },
  webm: { src: "/intro/interos-intro.webm", type: 'video/webm; codecs="vp9"' },
  /** Primeiro quadro, para a tela não ficar vazia enquanto o vídeo carrega. */
  poster: "/intro/interos-intro-poster.jpg",
} as const;
/**
 * O hexágono do fim do vídeo, nas medidas do vídeo (scripts/intro/intro.html:
 * IRIS_A, IRIS_B e IRIS_R). O centro é o centro do quadro.
 */
export const INTRO_IRIS = {
  start: 6.32,
  end: 6.95,
  radius: 1400,
  videoWidth: 1920,
  videoHeight: 1080,
} as const;

/**
 * Vértices do hexágono no instante `time`, na tela (`viewW` × `viewH`), com o
 * vídeo em `object-cover` (escala que cobre a tela, centrado). Antes do início,
 * `null`. A curva de tempo é a mesma do vídeo (ease-in-out cúbica); 2 px a
 * mais cobrem a borda do hexágono escuro desenhado no próprio vídeo.
 */
export function introIrisHex(viewW: number, viewH: number, time: number): [number, number][] | null {
  if (time < INTRO_IRIS.start) return null;
  const k = Math.min(1, (time - INTRO_IRIS.start) / (INTRO_IRIS.end - INTRO_IRIS.start));
  const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const scale = Math.max(viewW / INTRO_IRIS.videoWidth, viewH / INTRO_IRIS.videoHeight);
  const r = INTRO_IRIS.radius * eased * scale + 2;
  const points: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    points.push([viewW / 2 + r * Math.cos(a), viewH / 2 + r * Math.sin(a)]);
  }
  return points;
}

/**
 * `clip-path` da camada no instante `time`: a tela inteira menos o hexágono
 * (regra evenodd), ou `null` antes de ele começar a abrir.
 */
export function introIrisPath(viewW: number, viewH: number, time: number): string | null {
  const hex = introIrisHex(viewW, viewH, time);
  if (!hex) return null;
  const n = (v: number) => Math.round(v * 10) / 10;
  const hole = hex.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join(" ");
  return `path(evenodd, "M0 0H${viewW}V${viewH}H0Z ${hole}Z")`;
}

/** Atributo de fase em `<html>`. */
export const INTRO_ATTR = "data-io-intro";

/**
 * Script inline do `<head>`: sem dependências, tolerante a navegador sem
 * storage ou sem Performance API (qualquer erro = não toca, a página aparece
 * normalmente). Marca o dia só quando decide tocar.
 */
export const INTRO_BOOT =
  "(function(){try{" +
  'var q=new URLSearchParams(location.search).get("intro");' +
  'if(q==="off")return;' +
  'if(q!=="always"){' +
  "if(navigator.webdriver)return;" +
  `if(!matchMedia(${JSON.stringify(INTRO_MEDIA)}).matches)return;` +
  `if(matchMedia(${JSON.stringify(INTRO_REDUCED_MEDIA)}).matches)return;` +
  'var d=new Date(),today=d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();' +
  `if(localStorage.getItem(${JSON.stringify(INTRO_DAY_KEY)})===today){` +
  "var again=false;" +
  'try{var nav=performance.getEntriesByType("navigation")[0];' +
  `again=!!nav&&nav.type==="reload"&&${JSON.stringify([...INTRO_HOME_PATHS])}.indexOf(location.pathname)>-1}catch(e){}` +
  "if(!again)return}" +
  `localStorage.setItem(${JSON.stringify(INTRO_DAY_KEY)},today)}` +
  `document.documentElement.setAttribute(${JSON.stringify(INTRO_ATTR)},"pending")` +
  "}catch(e){}})();";
