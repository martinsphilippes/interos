"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { scheduleOpportunityNextAction } from "@/server/sales/actions";

/** Amanhã às 9h (sugestão padrão para a próxima ação). */
function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return isoToDateTimeLocal(d.toISOString());
}

/** Popover "Agendar próxima ação" (descrição + data/hora) usado na Central e no pipeline. */
export function NextActionPopover({ opportunityId, currentAction, trigger }: { opportunityId: string; currentAction?: string; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [action, setAction] = React.useState(currentAction ?? "");
  const [when, setWhen] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const submit = () => {
    const iso = dateValueToIso(when);
    if (!iso) {
      toast.error("Informe a data da próxima ação");
      return;
    }
    startTransition(async () => {
      const result = await scheduleOpportunityNextAction({ opportunityId, nextAction: action, nextActionAt: iso });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Próxima ação agendada");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !when) setWhen(tomorrowNine());
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="min-h-[44px] md:min-h-0">
            <CalendarPlus /> Agendar
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Próxima ação</p>
          <FormField label="O que fazer" htmlFor={`${id}-a`} required>
            <Input id={`${id}-a`} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Ex.: Ligar para confirmar proposta" maxLength={300} />
          </FormField>
          <FormField label="Quando" htmlFor={`${id}-w`} required>
            <DateInput id={`${id}-w`} mode="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={pending} disabled={action.trim().length < 3}>
              Agendar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
