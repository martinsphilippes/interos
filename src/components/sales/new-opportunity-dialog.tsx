"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/tasks/client-combobox";
import { createOpportunityAction } from "@/server/sales/actions";
import type { SalesFormOptions } from "@/server/sales/queries";
import { OPPORTUNITY_KIND_LABELS } from "./model";
import { ProductsEditor, toPayloadLines, type EditableLine } from "./products-editor";
import { useSalesUrl } from "./use-sales-url";
import { useUrlFlag } from "@/lib/use-url-flag";

/** Botão + diálogo "Nova oportunidade" (entra em Qualificação com próxima ação obrigatória). */
export function NewOpportunityButton({ options, currentUserId, openOnUrlFlag }: { options: SalesFormOptions; currentUserId: string; /** Abre com ?novo=1 (ações rápidas). */ openOnUrlFlag?: boolean }) {
  const router = useRouter();
  const { navigate } = useSalesUrl();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState<string | undefined>();
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState<"nova_venda" | "upsell" | "cross_sell" | "renovacao">("nova_venda");
  const [ownerId, setOwnerId] = React.useState(options.sellers.some((s) => s.id === currentUserId) ? currentUserId : (options.sellers[0]?.id ?? ""));
  const [temperature, setTemperature] = React.useState<"quente" | "morno" | "frio">("morno");
  const [lines, setLines] = React.useState<EditableLine[]>([]);
  const [need, setNeed] = React.useState("");
  const [nextAction, setNextAction] = React.useState("Fazer diagnóstico com o cliente");
  const [nextActionAt, setNextActionAt] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const client = options.clients.find((c) => c.id === clientId);

  const openDialog = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    setNextActionAt(isoToDateTimeLocal(d.toISOString()));
    setOpen(true);
  };

  // Ações rápidas: ?novo=1 abre o formulário (ajuste de estado durante a renderização, sem effect).
  const flag = useUrlFlag("novo");
  const urlOpen = Boolean(openOnUrlFlag) && flag.active;
  const [urlSeen, setUrlSeen] = React.useState(false);
  if (urlOpen !== urlSeen) {
    setUrlSeen(urlOpen);
    if (urlOpen) openDialog();
  }
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next && urlOpen) flag.clear();
  };

  const submit = () => {
    const at = dateValueToIso(nextActionAt);
    startTransition(async () => {
      const result = await createOpportunityAction({
        clientId,
        title: title || (client ? `${OPPORTUNITY_KIND_LABELS[kind]} — ${client.tradeName}` : ""),
        kind,
        ownerId,
        temperature,
        products: toPayloadLines(lines),
        need,
        nextAction,
        nextActionAt: at ?? "",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Oportunidade criada");
      setOpen(false);
      setClientId(undefined);
      setTitle("");
      setLines([]);
      setNeed("");
      navigate(urlOpen ? { oportunidade: result.data.id, novo: null } : { oportunidade: result.data.id });
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={openDialog} className="min-h-[44px] md:min-h-0">
        <Plus /> Nova oportunidade
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && changeOpen(v)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Nova oportunidade</DialogTitle>
            <DialogDescription>Entra em Qualificação. Toda oportunidade nasce com uma próxima ação agendada.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Cliente" htmlFor={`${id}-c`} required>
              <ClientCombobox id={`${id}-c`} clients={options.clients} value={clientId} onChange={setClientId} placeholder="Escolha o cliente" />
            </FormField>
            <FormField label="Título" htmlFor={`${id}-t`} hint={client ? `Padrão: ${OPPORTUNITY_KIND_LABELS[kind]} — ${client.tradeName}` : undefined}>
              <Input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: ERP + TEF para 3 caixas" />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Tipo" htmlFor={`${id}-k`}>
                <Select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} options={Object.entries(OPPORTUNITY_KIND_LABELS).map(([value, label]) => ({ value, label }))} />
              </FormField>
              <FormField label="Vendedor" htmlFor={`${id}-o`} required>
                <Select id={`${id}-o`} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} options={options.sellers.map((s) => ({ value: s.id, label: s.name }))} />
              </FormField>
              <FormField label="Temperatura" htmlFor={`${id}-te`}>
                <Select id={`${id}-te`} value={temperature} onChange={(e) => setTemperature(e.target.value as typeof temperature)} options={[{ value: "quente", label: "Quente" }, { value: "morno", label: "Morno" }, { value: "frio", label: "Frio" }]} />
              </FormField>
            </div>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Produtos de interesse</h4>
              <ProductsEditor lines={lines} onChange={setLines} products={options.products} />
            </section>
            <FormField label="Necessidade" htmlFor={`${id}-n`}>
              <Textarea id={`${id}-n`} value={need} onChange={(e) => setNeed(e.target.value)} className="min-h-[64px]" />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <FormField label="Próxima ação" htmlFor={`${id}-na`} required>
                <Input id={`${id}-na`} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
              </FormField>
              <FormField label="Quando" htmlFor={`${id}-nw`} required>
                <DateInput id={`${id}-nw`} mode="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={pending} disabled={!clientId || !ownerId || nextAction.trim().length < 3 || !nextActionAt}>
              Criar oportunidade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
