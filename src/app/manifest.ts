import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "INTEROS",
    short_name: "INTEROS",
    description: "Sistema operacional empresarial da Intercert.",
    lang: "pt-BR",
    start_url: "/meu-dia",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B1F3A",
    theme_color: "#0B1F3A",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
