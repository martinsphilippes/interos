/**
 * Silencia o aviso MetadataLookupWarning do Admin SDK (tentativa de descobrir credenciais na
 * metadata do GCP, inofensiva com emuladores). Deve ser o primeiro import do script.
 */
process.removeAllListeners("warning");
process.on("warning", (w: Error) => {
  if (w.name === "MetadataLookupWarning") return;
  console.warn(w);
});

export {};
