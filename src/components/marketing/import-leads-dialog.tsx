"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { importLeads } from "@/server/marketing/actions";
import type { ImportReport } from "@/server/marketing/service";
import { CsvInput, ImportReportView } from "./csv-import-panel";
import { LEAD_CSV_FIELDS, csvToRecords } from "./csv";
import type { MarketingOptions } from "./marketing-model";

const EXAMPLE = `nome;empresa;telefone;e-mail;cidade;origem;interesse
Maria Souza;Mercadinho Boa Vista;(88) 99876-5432;maria@exemplo.com;Crato;Instagram;ERP com PDV e TEF
João Lima;Farmácia Central;88991234567;;Juazeiro do Norte;indicacao;Emissão de notas fiscais`;

/** Importação de leads por CSV (colado ou arquivo), com relatório de criados, duplicados e inválidos. */
export function ImportLeadsDialog({ options }: { options: MarketingOptions }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [origin, setOrigin] = React.useState("manual");
  const [campaignId, setCampaignId] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [pending, startTransition] = React.useTransition();

  const parsed = React.useMemo(() => (text.trim() ? csvToRecords(text, LEAD_CSV_FIELDS) : null), [text]);
  const missingName = parsed !== null && !parsed.recognized.includes("nome");

  const close = (v: boolean) => {
    if (pending) return;
    setOpen(v);
    if (!v) {
      setReport(null);
      setText("");
    }
  };

  const submit = () => {
    if (!parsed || parsed.rows.length === 0) return;
    startTransition(async () => {
      const result = await importLeads({ rows: parsed.rows, defaultOrigin: origin, campaignId: campaignId || undefined, ownerId: ownerId || undefined, consent });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReport(result.data);
      toast.success(`${result.data.created.length} lead(s) importado(s)`);
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload /> Importar CSV
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Importar leads</DialogTitle>
            <DialogDescription>Colunas aceitas: nome, empresa, telefone, e-mail, cidade, origem, interesse. Leads com telefone ou e-mail já cadastrados são ignorados.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-4">
            {report ? (
              <ImportReportView report={report} />
            ) : (
              <>
                <CsvInput value={text} onChange={setText} example={EXAMPLE} />
                {parsed ? (
                  <p className={missingName ? "text-sm text-danger" : "text-sm text-muted"}>
                    {missingName
                      ? "A coluna “nome” não foi encontrada no cabeçalho."
                      : `${parsed.rows.length} linha(s) · colunas reconhecidas: ${parsed.recognized.join(", ")}${parsed.ignored.length ? ` · ignoradas: ${parsed.ignored.join(", ")}` : ""}`}
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label="Origem padrão" htmlFor="imp-origin" hint="Quando a linha não traz origem válida.">
                    <Select id="imp-origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
                      {options.sources.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Campanha" htmlFor="imp-campaign">
                    <Select id="imp-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                      <option value="">Sem campanha</option>
                      {options.campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Responsável" htmlFor="imp-owner">
                    <Select id="imp-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                      <option value="">Sem responsável</option>
                      {options.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
                <Checkbox label="Todos os contatos deram consentimento LGPD" description="Marque apenas se a base foi coletada com autorização (ex.: formulário com aceite)." checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {report ? (
              <>
                <Button variant="outline" onClick={() => setReport(null)}>
                  Importar outro
                </Button>
                <Button onClick={() => close(false)}>Concluir</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => close(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={submit} loading={pending} disabled={!parsed || parsed.rows.length === 0 || missingName}>
                  Importar {parsed?.rows.length ? `${parsed.rows.length} linha(s)` : ""}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
