import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  // Versão exibida no rodapé da sidebar.
  env: { NEXT_PUBLIC_APP_VERSION: packageJson.version },
  // pdfkit lê as fontes padrão (data/*.afm) via __dirname: precisa rodar fora do bundle do servidor.
  serverExternalPackages: ["pdfkit", "exceljs"],
  // Portal do Cliente (D31): o token está na URL — nada em cache (proxy/CDN/navegador), nada indexado e nenhum
  // Referer para links externos (PDF do boleto, wa.me).
  async headers() {
    return [
      {
        source: "/portal/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
