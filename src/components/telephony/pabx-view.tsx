"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveExtensionsAction, savePabxAction } from "@/server/telephony/actions";
import type { PabxQuality } from "@/server/telephony/queries";
import type { PabxConfig } from "@/domain/telephony";
import { formatCallDuration, formatDateTime } from "@/lib/format";
import { displayPhone } from "@/domain/phone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

function SaveBar({ dirty, pending, onSave, onReset }: { dirty: boolean; pending: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
      {dirty ? <span className="text-sm text-muted">Alterações não salvas</span> : null}
      <Button variant="ghost" onClick={onReset} disabled={!dirty || pending}>
        Descartar
      </Button>
      <Button onClick={onSave} loading={pending} disabled={!dirty}>
        Salvar
      </Button>
    </div>
  );
}

export interface ExtensionRow {
  userId: string;
  name: string;
  department: string;
  extension: string;
  queues: string[];
  online: boolean;
}

/** Ramais: quem tem ramal recebe as ligações das filas em que está (estando online e atendendo na Central). */
export function ExtensionsAdmin({ rows, canEdit }: { rows: ExtensionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const initial = React.useMemo(() => Object.fromEntries(rows.map((r) => [r.userId, r.extension])), [rows]);
  const [values, setValues] = React.useState<Record<string, string>>(initial);
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const save = () =>
    startTransition(async () => {
      const r = await saveExtensionsAction({ extensions: Object.entries(values).map(([userId, extension]) => ({ userId, extension })) });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.changed} ramal(is) atualizado(s)`);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted">Quem tem ramal toca nas ligações das filas em que está, quando está online. As filas de cada pessoa ficam em Canais e filas › Filas (ou na ficha do usuário).</p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead className="w-[140px]">Ramal</TableHead>
              <TableHead>Filas</TableHead>
              <TableHead>Agora</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.userId}>
                <TableCell>
                  <span className="font-medium">{r.name}</span>
                  <p className="text-xs text-muted">{r.department}</p>
                </TableCell>
                <TableCell>
                  <Input aria-label={`Ramal de ${r.name}`} inputMode="numeric" value={values[r.userId] ?? ""} disabled={!canEdit} placeholder="—" onChange={(e) => setValues((v) => ({ ...v, [r.userId]: e.target.value.replace(/\D/g, "").slice(0, 6) }))} className="h-9 w-24 font-mono" />
                </TableCell>
                <TableCell className="text-sm text-muted">{r.queues.join(", ") || "nenhuma fila"}</TableCell>
                <TableCell>{r.online ? <Badge size="sm" variant="success">Online</Badge> : <span className="text-sm text-muted">—</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {canEdit ? <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => setValues(initial)} /> : null}
    </div>
  );
}

/** Números e horário/correio de voz: o mesmo formulário do PABX, em duas abas. */
export function PabxConfigAdmin({ config, queues, canEdit, part }: { config: PabxConfig; queues: { id: string; name: string }[]; canEdit: boolean; part: "numeros" | "horarios" }) {
  const router = useRouter();
  const [c, setC] = React.useState(config);
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(c) !== JSON.stringify(config);
  const ro = !canEdit;
  const save = () =>
    startTransition(async () => {
      const r = await savePabxAction({ ...c, numbers: c.numbers.map((n) => ({ ...n, queueId: n.queueId ?? "" })) });
      if (!r.ok) return void toast.error(r.error);
      toast.success("PABX salvo");
      router.refresh();
    });
  const setNumber = (i: number, v: Partial<PabxConfig["numbers"][number]>) => setC((x) => ({ ...x, numbers: x.numbers.map((n, j) => (j === i ? { ...n, ...v } : n)) }));
  return (
    <div className="flex flex-col gap-4">
      {part === "numeros" ? (
        <>
          <p className="max-w-3xl text-sm text-muted">
            Números da empresa e para qual fila vai quem liga. A compra ou a portabilidade do número é feita no painel do provedor; depois, cadastre aqui e aponte a Voice URL do número para <code className="font-mono text-xs">/api/voice/incoming</code>.
          </p>
          {c.numbers.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nenhum número cadastrado.</p> : null}
          {c.numbers.map((n, i) => (
            <div key={i} className="grid items-end gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto_40px]">
              <FormField label="Número" htmlFor={`pn-${i}`}>
                <Input id={`pn-${i}`} value={n.number} disabled={ro} onChange={(e) => setNumber(i, { number: e.target.value })} placeholder="(88) 3570-0000" />
              </FormField>
              <FormField label="Nome" htmlFor={`pl-${i}`}>
                <Input id={`pl-${i}`} value={n.label} disabled={ro} onChange={(e) => setNumber(i, { label: e.target.value })} placeholder="Principal" />
              </FormField>
              <FormField label="Fila" htmlFor={`pq-${i}`}>
                <Select id={`pq-${i}`} value={n.queueId ?? ""} disabled={ro} onChange={(e) => setNumber(i, { queueId: e.target.value || undefined })} options={[{ value: "", label: "Fila padrão" }, ...queues.map((q) => ({ value: q.id, label: q.name }))]} />
              </FormField>
              <Switch size="sm" checked={n.active} disabled={ro} onCheckedChange={(v) => setNumber(i, { active: v })} label="Ativo" className="pb-2" />
              <Button size="icon" variant="ghost" aria-label={`Remover ${n.label || n.number}`} disabled={ro} onClick={() => setC((x) => ({ ...x, numbers: x.numbers.filter((_, j) => j !== i) }))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {canEdit ? (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setC((x) => ({ ...x, numbers: [...x.numbers, { number: "", label: "", active: true }] }))}>
              <Plus /> Número
            </Button>
          ) : null}
          <p className="text-xs text-muted">O primeiro número ativo é a bina das ligações feitas pelo softphone.</p>
        </>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-muted">
            O horário de atendimento e os feriados são os da empresa (<Link href="/admin/configuracoes" className="text-brand-fg hover:underline">Administração › Configurações</Link>). Fora dele, ou sem ninguém disponível, a ligação vai para o correio de voz.
          </p>
          <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <FormField label="Tocar por (s)" htmlFor="px-ring">
              <Input id="px-ring" type="number" min={5} max={60} value={c.ringSeconds} disabled={ro} onChange={(e) => setC((x) => ({ ...x, ringSeconds: Number(e.target.value) }))} />
            </FormField>
            <FormField label="Boas-vindas (antes do aviso de gravação)" htmlFor="px-welcome">
              <Input id="px-welcome" value={c.welcome} disabled={ro} onChange={(e) => setC((x) => ({ ...x, welcome: e.target.value }))} />
            </FormField>
          </div>
          <Switch checked={c.voicemail} disabled={ro} onCheckedChange={(v) => setC((x) => ({ ...x, voicemail: v }))} label="Correio de voz (o cliente deixa recado)" className="rounded-lg border border-border px-3 py-2" />
          <FormField label="Fora do horário" htmlFor="px-closed">
            <Textarea id="px-closed" rows={2} value={c.closedMessage} disabled={ro} onChange={(e) => setC((x) => ({ ...x, closedMessage: e.target.value }))} />
          </FormField>
          <FormField label="Sem ninguém disponível" htmlFor="px-noagent">
            <Textarea id="px-noagent" rows={2} value={c.noAgentMessage} disabled={ro} onChange={(e) => setC((x) => ({ ...x, noAgentMessage: e.target.value }))} />
          </FormField>
        </>
      )}
      {canEdit ? <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => setC(config)} /> : null}
    </div>
  );
}

/** Provedor: o que está configurado (só a existência das variáveis) e os endereços para colar no painel da Twilio. */
export function ProviderStatus({ vars, base, connected }: { vars: { name: string; present: boolean; description: string }[]; base: string; connected: boolean }) {
  const urls = [
    { label: "Voice URL do número (ligações recebidas)", url: `${base}/api/voice/incoming` },
    { label: "Voice URL do TwiML App (ligações do softphone)", url: `${base}/api/voice/outgoing` },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Provedor: <strong>Twilio</strong> · {connected ? <Badge variant="success">Conectado</Badge> : <Badge variant="muted">Não conectado</Badge>}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead>Variável (Vercel)</TableHead>
              <TableHead>Para quê</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vars.map((v) => (
              <TableRow key={v.name}>
                <TableCell className="font-mono text-xs">{v.name}</TableCell>
                <TableCell className="text-sm text-muted">{v.description}</TableCell>
                <TableCell>{v.present ? <Badge size="sm" variant="success">Configurada</Badge> : <Badge size="sm" variant="warning">Falta</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="font-medium">Endereços para o painel da Twilio (método POST)</p>
        {urls.map((u) => (
          <p key={u.url}>
            {u.label}: <code className="break-all font-mono text-xs">{u.url}</code>
          </p>
        ))}
        <p className="text-xs text-muted">Os avisos da Twilio têm a assinatura conferida com o Auth Token. Outro provedor = outro adaptador (src/server/integrations/twilio.ts mostra as funções necessárias).</p>
      </div>
    </div>
  );
}

export function QualityView({ q }: { q: PabxQuality }) {
  const tile = (label: string, value: string, hint?: string) => (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile("Ligações (30 dias)", String(q.total), "pelo provedor")}
        {tile("Atendidas", q.answeredPct !== undefined ? `${q.answeredPct}%` : "—")}
        {tile("Perdidas (recebidas)", q.missedPct !== undefined ? `${q.missedPct}%` : "—")}
        {tile("Duração média", q.avgDurationSeconds ? formatCallDuration(q.avgDurationSeconds) : "—", `${q.failed} falha(s) técnica(s)`)}
      </div>
      {q.byNumber.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número chamado</TableHead>
                <TableHead>Recebidas</TableHead>
                <TableHead>Perdidas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.byNumber.map((n) => (
                <TableRow key={n.number}>
                  <TableCell>{displayPhone(n.number) || n.number}</TableCell>
                  <TableCell className="tabular-nums">{n.total}</TableCell>
                  <TableCell className="tabular-nums">{n.missed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <p className="text-xs text-muted">Indicadores das ligações pelo provedor. Métricas de rede (atraso, perda de pacotes) dependem do Voice Insights da Twilio e entram com a supervisão de ligações.</p>
    </div>
  );
}

export function ChangesView({ events }: { events: { id: string; at: string; title: string; description?: string }[] }) {
  return events.length === 0 ? (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nenhuma mudança registrada.</p>
  ) : (
    <ul className="flex flex-col gap-2">
      {events.map((e) => (
        <li key={e.id} className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <p className="font-medium">{e.title}</p>
          <p className="text-xs text-muted">
            {formatDateTime(e.at)}
            {e.description ? ` · ${e.description}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
