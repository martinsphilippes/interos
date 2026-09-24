import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { ReportAccessError, buildReport, canAccessReport, reportFileName } from "@/server/reports/build";
import { EXPORT_FORMATS, isReportKey, readReportFilters, type ExportFormat } from "@/server/reports/definitions";
import { reportToCsv } from "@/server/reports/export-csv";
import { reportToXlsx } from "@/server/reports/export-xlsx";
import { reportToPdf } from "@/server/reports/export-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * Exportação de relatório: GET /api/relatorios/<tipo>?formato=csv|xlsx|pdf&de=&ate=&departamento=&colaborador=&cliente=&produto=&status=
 * Mesmas regras de acesso e mesmos dados da prévia em /gestao/relatorios.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const [user, { tipo }] = await Promise.all([requireUser(), params]);
  if (!isReportKey(tipo)) return NextResponse.json({ error: "Relatório inexistente." }, { status: 404 });
  if (!canAccessReport(user, tipo)) return NextResponse.json({ error: "Você não tem acesso a este relatório." }, { status: 403 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("formato") ?? "csv").toLowerCase();
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) return NextResponse.json({ error: "Formato inválido: use csv, xlsx ou pdf." }, { status: 400 });

  try {
    const data = await buildReport(tipo, readReportFilters(url.searchParams), user);
    const fmt = format as ExportFormat;
    const body = fmt === "csv" ? reportToCsv(data) : fmt === "xlsx" ? await reportToXlsx(data) : await reportToPdf(data);
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[fmt],
        "Content-Disposition": `attachment; filename="${reportFileName(data, fmt)}"`,
        "Content-Length": String(body.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ReportAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error(`[relatorios] falha ao exportar ${tipo} em ${format}`, error);
    return NextResponse.json({ error: "Não foi possível gerar o relatório." }, { status: 500 });
  }
}
