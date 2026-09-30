/**
 * Verificador de cobertura de acesso (A15/A21): `npm run check:access`.
 *
 * Modo estrito (padrão): sai com código 1 se houver qualquer pendência (página sem requireScreen, função "use server"
 * sem dono ou sem requirePermission, API sem guarda, chave inexistente, tela sem página, guard sem função).
 * `--report`: só lista as pendências e sai com 0 (fase de migração: a lista é o trabalho da fase seguinte).
 * `--json`: imprime o relatório em JSON.
 */
import path from "node:path";
import { analyzeAccess, formatReport } from "./check-access/analyze";

const args = new Set(process.argv.slice(2));
const report = analyzeAccess(path.resolve(__dirname, ".."));
console.log(args.has("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
const pending = report.findings.length;
if (!args.has("--json")) {
  console.log("");
  console.log(pending ? `${pending} pendência(s).${args.has("--report") ? " Modo relatório: saída 0." : ""}` : "Cobertura completa.");
}
process.exit(pending && !args.has("--report") ? 1 : 0);
