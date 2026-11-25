"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { INTRO_ATTR, INTRO_VIDEO } from "@/lib/intro";

/** Textos da abertura (o sistema é só em português). */
const LABELS = {
  /** Rótulo acessível da camada. */
  title: "Abertura INTEROS",
  /** Botão "Pular". */
  skip: "Pular",
} as const;
/** Cor de fundo da camada: a do primeiro quadro do vídeo. */
const OVERLAY_BG = "#081428";

/** Rede lenta ou vídeo bloqueado: a página aparece mesmo assim. */
const LOAD_TIMEOUT_MS = 8000;
/** "Pouso" da página ao fim da abertura (transição em globals.css). */
const LANDING_MS = 1000;
/** Some a camada ao fim do vídeo e ao pular. */
const FADE_MS = 450;
const SKIP_FADE_MS = 350;
/** "Pular" aparece depois do primeiro instante e sai quando a câmera mergulha no símbolo. */
const SKIP_SHOW_AT_S = 0.6;
const SKIP_HIDE_AT_S = 5.6;
/** A página começa a "pousar" quando faltam estes segundos (o vídeo já está liso). */
const LAND_BEFORE_END_S = 0.3;

/**
 * O script inline do `<head>` (src/lib/intro.ts) decide e cobre a tela antes
 * da hidratação. Esta leitura acontece uma vez só (e fica guardada): no
 * servidor vale "não", no navegador vale o que o script decidiu.
 */
let armedAtBoot: boolean | null = null;
function readArmed(): boolean {
  if (armedAtBoot === null) {
    armedAtBoot =
      typeof document !== "undefined" &&
      document.documentElement.getAttribute(INTRO_ATTR) === "pending";
  }
  return armedAtBoot;
}
const subscribe = () => () => {};

/**
 * Contêiner da camada, filho direto de <html> e irmão do <body>. Não dá para
 * usar `createPortal(…, document.documentElement)`: o React coloca o que vai
 * para <html> dentro do <body>, e o body ganha `transform` durante a abertura
 * (o "pouso", globals.css), o que faria a camada fixa seguir o body em vez da
 * janela (maior que a tela e com o botão "Pular" para fora dela).
 */
let host: HTMLElement | null = null;
function getHost(): HTMLElement {
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("data-intro-host", "");
    document.documentElement.appendChild(host);
  }
  return host;
}

/**
 * Abertura do INTEROS (docs/abertura.md): toca o vídeo por cima da página,
 * sem som, e ao fim a camada some e a página "pousa". Acompanha a fase em
 * `<html data-io-intro>`. Sem o atributo `pending` (celular, aba que já
 * viu, navegador automatizado, menos movimento), não renderiza nada.
 */
export function IntroPlayer() {
  const labels = LABELS;
  const armed = useSyncExternalStore(subscribe, readArmed, () => false);
  const [phase, setPhase] = useState<"playing" | "leaving" | "gone">("playing");
  const [skipOn, setSkipOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const landed = useRef(false);

  /** A página "pousa" (uma vez só) e, passado o pouso, o atributo sai. */
  const land = useCallback(() => {
    if (landed.current) return;
    landed.current = true;
    const root = document.documentElement;
    root.setAttribute(INTRO_ATTR, "done");
    window.setTimeout(() => root.removeAttribute(INTRO_ATTR), LANDING_MS);
  }, []);

  /** Fim normal ou "Pular": pousa e some com a camada em fade. */
  const leave = useCallback(
    (fadeMs: number) => {
      land();
      setPhase((p) => (p === "playing" ? "leaving" : p));
      window.setTimeout(() => setPhase("gone"), fadeMs);
    },
    [land],
  );

  /** Vídeo que não toca: some tudo na hora, sem pouso. */
  const fail = useCallback(() => {
    landed.current = true;
    document.documentElement.removeAttribute(INTRO_ATTR);
    setPhase("gone");
  }, []);

  const skip = useCallback(() => {
    videoRef.current?.pause();
    leave(SKIP_FADE_MS);
  }, [leave]);

  // Vídeo que não começa a tocar a tempo (rede lenta, bloqueio): libera a página.
  useEffect(() => {
    if (!armed || phase !== "playing") return;
    const guard = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.currentTime === 0) fail();
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(guard);
  }, [armed, phase, fail]);

  // Esc, Enter ou espaço pulam.
  useEffect(() => {
    if (!armed || phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed, phase, skip]);

  // Terminou: tira o contêiner do documento.
  useEffect(() => {
    if (phase !== "gone") return;
    host?.remove();
    host = null;
  }, [phase]);

  if (!armed || phase === "gone") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label={labels.title}
      data-intro-overlay
      className="select-none"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        background: OVERLAY_BG,
        overflow: "hidden",
        opacity: phase === "leaving" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === "leaving" ? "none" : "auto",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="auto"
        poster={INTRO_VIDEO.poster}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        onPlaying={() => {
          const root = document.documentElement;
          if (root.getAttribute(INTRO_ATTR) === "pending")
            root.setAttribute(INTRO_ATTR, "playing");
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setSkipOn(
            v.currentTime > SKIP_SHOW_AT_S && v.currentTime < SKIP_HIDE_AT_S,
          );
          if (v.duration > 0 && v.duration - v.currentTime < LAND_BEFORE_END_S)
            land();
        }}
        onEnded={() => leave(FADE_MS)}
        onError={fail}
      >
        <source src={INTRO_VIDEO.mp4.src} type={INTRO_VIDEO.mp4.type} />
        <source src={INTRO_VIDEO.webm.src} type={INTRO_VIDEO.webm.type} />
      </video>
      <button
        type="button"
        data-on={skipOn}
        tabIndex={skipOn ? 0 : -1}
        onClick={skip}
        className="pointer-events-none absolute bottom-[calc(18px+env(safe-area-inset-bottom,0px))] right-[calc(18px+env(safe-area-inset-right,0px))] translate-y-1.5 cursor-pointer rounded-full border border-white/30 bg-black/30 pb-2.5 pl-[18px] pr-[15px] pt-[11px] text-[11px] font-semibold uppercase leading-none tracking-[0.22em] text-white/85 opacity-0 transition duration-[450ms] hover:bg-white/15 focus-visible:outline-white data-[on=true]:pointer-events-auto data-[on=true]:translate-y-0 data-[on=true]:opacity-100"
      >
        {labels.skip}
      </button>
    </div>,
    getHost(),
  );
}
