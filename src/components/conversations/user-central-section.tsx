"use client";

import * as React from "react";
import type { UserCentralView } from "@/server/conversations/queues";
import type { ConversationChannel } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface UserCentralForm {
  attends: boolean;
  queueIds: string[];
  maxConcurrent: string;
  channels: "ambos" | ConversationChannel;
  emailSignature: string;
}

export function centralFormOf(view: UserCentralView): UserCentralForm {
  const ch = view.settings.channels;
  return {
    attends: view.settings.attends,
    queueIds: view.queues.filter((q) => q.member).map((q) => q.id),
    maxConcurrent: view.settings.maxConcurrent ? String(view.settings.maxConcurrent) : "",
    channels: ch?.length === 1 ? ch[0] : "ambos",
    emailSignature: view.settings.emailSignature ?? "",
  };
}

/** Entrada da action saveUserCentralAction a partir do formulário. */
export function centralInputOf(userId: string, f: UserCentralForm) {
  return {
    userId,
    attends: f.attends,
    queueIds: f.queueIds,
    maxConcurrent: f.maxConcurrent ? Number(f.maxConcurrent) : null,
    channels: f.channels === "ambos" ? undefined : [f.channels],
    emailSignature: f.emailSignature,
  };
}

/**
 * Ficha do usuário › Atendimento na Central: se recebe conversas, em quais filas está, limite próprio, canais e a
 * assinatura das respostas por e-mail. Controlado pelo drawer (salva junto com o resto, no mesmo botão).
 */
export function UserCentralSection({ view, value, onChange, readOnly, inactive }: { view: UserCentralView; value: UserCentralForm; onChange: (v: UserCentralForm) => void; readOnly: boolean; inactive: boolean }) {
  const set = <K extends keyof UserCentralForm>(k: K, v: UserCentralForm[K]) => onChange({ ...value, [k]: v });
  const memberQueues = view.queues.filter((q) => value.queueIds.includes(q.id));
  const defaultLimit = memberQueues.length ? Math.min(...memberQueues.map((q) => q.maxConcurrent)) : undefined;
  const id = React.useId();

  return (
    <section aria-labelledby={`${id}-t`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-t`} className="text-sm font-semibold">
          Atendimento na Central
        </h3>
        <Switch size="sm" checked={value.attends} onCheckedChange={(v) => set("attends", v)} disabled={readOnly || inactive} label="Recebe conversas" />
      </div>
      {!value.attends ? <p className="text-xs text-muted">Não recebe conversas pela distribuição automática. Ainda pode assumir e responder pela Central.</p> : null}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-muted">Filas</legend>
        {view.queues.length === 0 ? <p className="text-xs text-muted">Nenhuma fila criada.</p> : null}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {view.queues.map((q) => (
            <label key={q.id} className="flex min-h-[40px] items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
              <Checkbox
                checked={value.queueIds.includes(q.id)}
                disabled={readOnly || inactive}
                onCheckedChange={(v) => set("queueIds", v === true ? [...value.queueIds, q.id] : value.queueIds.filter((x) => x !== q.id))}
              />
              <span className="min-w-0 flex-1 truncate">{q.name}</span>
              <Badge size="sm" variant="muted">
                {q.channels.map((c) => (c === "whatsapp" ? "WhatsApp" : "e-mail")).join(" · ")}
              </Badge>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Conversas ao mesmo tempo" htmlFor={`${id}-max`}>
          <Select
            id={`${id}-max`}
            value={value.maxConcurrent}
            disabled={readOnly}
            onChange={(e) => set("maxConcurrent", e.target.value)}
            options={[{ value: "", label: defaultLimit ? `Padrão da fila (${defaultLimit})` : "Padrão da fila" }, ...[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((n) => ({ value: String(n), label: String(n) }))]}
          />
        </FormField>
        <FormField label="Canais que atende" htmlFor={`${id}-ch`}>
          <Select
            id={`${id}-ch`}
            value={value.channels}
            disabled={readOnly}
            onChange={(e) => set("channels", e.target.value as UserCentralForm["channels"])}
            options={[
              { value: "ambos", label: "WhatsApp e e-mail" },
              { value: "whatsapp", label: "Só WhatsApp" },
              { value: "email", label: "Só e-mail" },
            ]}
          />
        </FormField>
      </div>
      <FormField label="Assinatura de e-mail" htmlFor={`${id}-sig`} hint="Vai no fim das respostas por e-mail da Central.">
        <Textarea id={`${id}-sig`} rows={2} value={value.emailSignature} disabled={readOnly} onChange={(e) => set("emailSignature", e.target.value)} placeholder="Nome · Setor · Intercert · (88) 0000-0000" />
      </FormField>
      <p className="text-xs text-muted">Ao desativar o usuário, ele sai de todas as filas e as conversas abertas com ele voltam para a fila.</p>
    </section>
  );
}
