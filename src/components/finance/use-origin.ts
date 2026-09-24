"use client";

import * as React from "react";

const noop = () => () => {};

/** Origem do site no navegador ("" no servidor), para montar links absolutos em mailto:. */
export function useOrigin(): string {
  return React.useSyncExternalStore(noop, () => window.location.origin, () => "");
}
