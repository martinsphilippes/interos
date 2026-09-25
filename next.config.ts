import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  // Versão exibida no rodapé da sidebar.
  env: { NEXT_PUBLIC_APP_VERSION: packageJson.version },
  // pdfkit lê as fontes padrão (data/*.afm) via __dirname: precisa rodar fora do bundle do servidor.
  serverExternalPackages: ["pdfkit", "exceljs"],
};

export default nextConfig;
