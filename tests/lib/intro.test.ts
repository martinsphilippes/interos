import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  INTRO_ATTR,
  INTRO_BOOT,
  INTRO_DAY_KEY,
  INTRO_IRIS,
  INTRO_MEDIA,
  INTRO_REDUCED_MEDIA,
  introIrisHex,
  introIrisPath,
} from "@/lib/intro";

/*
 * Abertura do INTEROS: o script inline do <head> decide, antes do primeiro
 * quadro, se cobre a tela (html[data-io-intro="pending"]) e marca o dia.
 * Aqui ele roda num navegador de mentira com cada situação.
 */
const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
})();

function boot(env: {
  search?: string;
  pathname?: string;
  width?: number;
  /** Dia gravado no localStorage (undefined = nunca tocou). */
  playedOn?: string;
  reload?: boolean;
  webdriver?: boolean;
  reducedMotion?: boolean;
  storageBroken?: boolean;
}) {
  const attrs = new Map<string, string>();
  const storage = new Map<string, string>();
  if (env.playedOn) storage.set(INTRO_DAY_KEY, env.playedOn);
  const sandbox = {
    URLSearchParams,
    Date,
    location: { search: env.search ?? "", pathname: env.pathname ?? "/meu-dia" },
    navigator: { webdriver: env.webdriver ?? false },
    matchMedia: (query: string) => ({
      matches:
        (query === INTRO_MEDIA && (env.width ?? 1440) >= 1024) ||
        (query === INTRO_REDUCED_MEDIA && !!env.reducedMotion),
    }),
    localStorage: {
      getItem: (key: string) => {
        if (env.storageBroken) throw new Error("storage indisponível");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    performance: {
      getEntriesByType: (type: string) =>
        type === "navigation"
          ? [{ type: env.reload ? "reload" : "navigate" }]
          : [],
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
      },
    },
  };
  runInNewContext(INTRO_BOOT, sandbox);
  return {
    attr: attrs.get(INTRO_ATTR) ?? null,
    day: storage.get(INTRO_DAY_KEY),
  };
}

describe("abertura do INTEROS: quando cobrir a tela", () => {
  it("primeira abertura do dia: cobre e marca o dia", () => {
    expect(boot({})).toEqual({ attr: "pending", day: TODAY });
    expect(boot({ playedOn: "2026-1-1", pathname: "/clientes" })).toEqual({
      attr: "pending",
      day: TODAY,
    });
  });

  it("já tocou hoje: navegar ou abrir outra aba não repete", () => {
    expect(boot({ playedOn: TODAY, pathname: "/meu-dia" }).attr).toBeNull();
    expect(boot({ playedOn: TODAY, pathname: "/login" }).attr).toBeNull();
    expect(boot({ playedOn: TODAY, pathname: "/clientes" }).attr).toBeNull();
  });

  it("já tocou hoje: F5 na página inicial toca de novo", () => {
    expect(boot({ playedOn: TODAY, reload: true, pathname: "/meu-dia" }).attr).toBe(
      "pending",
    );
    expect(
      boot({ playedOn: TODAY, reload: true, pathname: "/login" }).attr,
    ).toBe("pending");
    // F5 em outra tela, não.
    expect(
      boot({ playedOn: TODAY, reload: true, pathname: "/clientes" }).attr,
    ).toBeNull();
  });

  it("celular e tablet em pé (menos de 1024 px): não toca, nem no F5", () => {
    expect(boot({ width: 390 }).attr).toBeNull();
    expect(boot({ width: 1023, reload: true }).attr).toBeNull();
    // E não marca o dia: no desktop ainda é a primeira vez.
    expect(boot({ width: 390 }).day).toBeUndefined();
  });

  it("navegador automatizado (E2E, auditorias): não toca", () => {
    expect(boot({ webdriver: true }).attr).toBeNull();
  });

  it("quem pede menos movimento não vê a abertura, nem marca o dia", () => {
    expect(boot({ reducedMotion: true }).attr).toBeNull();
    expect(
      boot({ reducedMotion: true, reload: true, playedOn: TODAY }).attr,
    ).toBeNull();
    expect(boot({ reducedMotion: true }).day).toBeUndefined();
  });

  it("?intro=always força mesmo no celular, repetida ou automatizada, sem marcar o dia", () => {
    expect(
      boot({
        search: "?intro=always",
        width: 390,
        playedOn: TODAY,
        webdriver: true,
      }),
    ).toEqual({ attr: "pending", day: TODAY });
    expect(boot({ search: "?intro=always" }).day).toBeUndefined();
    expect(boot({ search: "?intro=always", playedOn: TODAY }).attr).toBe(
      "pending",
    );
  });

  it("?intro=off nunca toca", () => {
    expect(boot({ search: "?intro=off" }).attr).toBeNull();
  });

  it("sem storage (navegador restrito): a página aparece normalmente", () => {
    expect(boot({ storageBroken: true }).attr).toBeNull();
  });
});

describe("abertura do INTEROS: hexágono que se abre sobre a página", () => {
  /** O ponto está dentro do hexágono (convexo, vértices em sentido horário)? */
  const inside = (hex: [number, number][], [px, py]: [number, number]) =>
    hex.every(([ax, ay], i) => {
      const [bx, by] = hex[(i + 1) % 6];
      return (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0;
    });

  it("antes do início não recorta a camada", () => {
    expect(introIrisHex(1440, 900, INTRO_IRIS.start - 0.01)).toBeNull();
    expect(introIrisPath(1440, 900, 3)).toBeNull();
  });

  it("no fim o hexágono cobre a tela inteira, em qualquer formato de janela", () => {
    for (const [w, h] of [[1024, 768], [1440, 900], [1920, 1080], [2560, 1080], [3840, 2160]] as const) {
      const hex = introIrisHex(w, h, INTRO_IRIS.end)!;
      for (const corner of [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]) {
        expect(inside(hex, corner)).toBe(true);
      }
    }
  });

  it("no meio do caminho a página aparece só no centro", () => {
    const mid = (INTRO_IRIS.start + INTRO_IRIS.end) / 2;
    const hex = introIrisHex(1440, 900, mid)!;
    expect(inside(hex, [720, 450])).toBe(true);
    expect(inside(hex, [0, 0])).toBe(false);
  });

  it("o recorte é a tela menos o hexágono (evenodd)", () => {
    const path = introIrisPath(1440, 900, INTRO_IRIS.end)!;
    expect(path.startsWith('path(evenodd, "M0 0H1440V900H0Z M720 ')).toBe(true);
    expect(path.endsWith('Z")')).toBe(true);
  });
});
