import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit lê as fontes padrão (data/*.afm) via __dirname: precisa rodar fora do bundle do servidor.
  serverExternalPackages: ["pdfkit", "exceljs"],
};

export default nextConfig;
