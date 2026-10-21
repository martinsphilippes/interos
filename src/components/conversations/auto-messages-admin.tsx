"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveAutoMessagesAction } from "@/server/conversations/actions";
import type { AutoMessagesConfig } from "@/server/conversations/auto-messages";
import { menuText } from "@/domain/conversations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export interface AutoMessagesAdminData {
  config: AutoMessagesConfig;
  stored: boolean;
  queues: { id: string; name: string }[];
  openNow: boolean;
  nextOpening: string;
  channelConnected: boolean;
}

function Block({ title, description, active, onActive, disabled, children, badge }: { title: string; description: string; active: boolean; onActive: (v: boolean) => void; disabled: boolean; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {title} {badge}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        <Switch checked={active} onCheckedChange={onActive} disabled={disabled} aria-label={`${title}: ${active ? "ligada" : "desligada"}`} />
      </div>
      <div className={active ? "mt-4 flex flex-col gap-3" : "mt-4 flex flex-col gap-3 opacity-60"}>{children}</div>
    </section>
  );
}

/**
 * Mensagens automáticas da Central. Tudo nasce desligado. Só saem pelo provedor de verdade (canal conectado e, no
 * WhatsApp, dentro da janela de 24 h); as que dependem do tempo precisam do agendador do Supabase ativo.
 */
export function AutoMessagesAdminView({ data, canEdit }: { data: AutoMessagesAdminData; canEdit: boolean }) {
  const router = useRouter();
  const [c, setC] = React.useState<AutoMessagesConfig>(data.config);
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(c) !== JSON.stringify(data.config);
  const ro = !canEdit;
  const patch = <K extends keyof AutoMessagesConfig>(k: K, v: Partial<AutoMessagesConfig[K]>) => setC((prev) => ({ ...prev, [k]: { ...prev[k], ...v } }));
  const setOption = (i: number, v: Partial<AutoMessagesConfig["menu"]["opcoes"][number]>) => patch("menu", { opcoes: c.menu.opcoes.map((o, j) => (j === i ? { ...o, ...v } : o)) });
  const nextKey = String(Math.max(0, ...c.menu.opcoes.map((o) => Number(o.tecla) || 0)) + 1);

  const save = () =>
    startTransition(async () => {
      const r = await saveAutoMessagesAction(c);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Mensagens automáticas salvas");
      router.refresh();
    });

  const timeBadge = (
    <Badge size="sm" variant="info">
      precisa do agendador
    </Badge>
  );

  return (
    <div className="flex flex-col gap-4">
      {!data.channelConnected ? (
        <p role="note" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          O WhatsApp ainda não está conectado: nenhuma mensagem automática sai até a conexão com o provedor. Dá para deixar tudo pronto.
        </p>
      ) : null}
      <p className="max-w-3xl text-sm text-muted">
        Saem só pelo canal conectado e, no WhatsApp, só dentro da janela de 24 h (fora dela a Meta recusa texto livre). Cada uma no máximo uma vez a cada 12 h por conversa. As marcadas com «precisa do agendador» dependem da verificação a
        cada 5 minutos no Supabase.
      </p>

      <Block title="Menu de boas-vindas" description="Na primeira mensagem do cliente: a resposta escolhe a fila. Sem resposta em 10 min, vai para a fila padrão." active={c.menu.ativa} onActive={(v) => patch("menu", { ativa: v })} disabled={ro}>
        <FormField label="Texto" htmlFor="am-menu">
          <Textarea id="am-menu" rows={2} value={c.menu.texto} disabled={ro} onChange={(e) => patch("menu", { texto: e.target.value })} />
        </FormField>
        <div className="flex flex-col gap-2">
          {c.menu.opcoes.map((o, i) => (
            <div key={i} className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-2">
              <Input aria-label={`Número da opção ${i + 1}`} value={o.tecla} disabled={ro} onChange={(e) => setOption(i, { tecla: e.target.value })} className="text-center" />
              <Input aria-label={`Nome da opção ${i + 1}`} value={o.rotulo} disabled={ro} onChange={(e) => setOption(i, { rotulo: e.target.value })} />
              <Select
                aria-label={`Fila da opção ${i + 1}`}
                value={o.filaId}
                disabled={ro}
                onChange={(e) => setOption(i, { filaId: e.target.value })}
                options={[...(data.queues.some((q) => q.id === o.filaId) ? [] : [{ value: o.filaId, label: o.filaId ? "Fila inativa ou removida" : "Escolha a fila…" }]), ...data.queues.map((q) => ({ value: q.id, label: q.name }))]}
              />
              <Button size="icon" variant="ghost" aria-label={`Remover opção ${o.tecla}`} disabled={ro || c.menu.opcoes.length <= 1} onClick={() => patch("menu", { opcoes: c.menu.opcoes.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {!ro && c.menu.opcoes.length < 9 ? (
            <Button size="sm" variant="outline" className="self-start" onClick={() => patch("menu", { opcoes: [...c.menu.opcoes, { tecla: nextKey, rotulo: "", filaId: data.queues[0]?.id ?? "" }] })}>
              <Plus /> Opção
            </Button>
          ) : null}
        </div>
        <div className="rounded-lg border border-border bg-surface-muted p-3">
          <p className="mb-1 text-xs text-muted">Como o cliente recebe</p>
          <p className="whitespace-pre-line text-sm">{menuText(c.menu)}</p>
        </div>
      </Block>

      <Block
        title="Fora do horário"
        description={`Quando o cliente escreve fora do expediente (Administração › Configurações). Agora: ${data.openNow ? "aberto" : `fechado — abre ${data.nextOpening}`}.`}
        active={c.foraDoHorario.ativa}
        onActive={(v) => patch("foraDoHorario", { ativa: v })}
        disabled={ro}
      >
        <FormField label="Texto" htmlFor="am-fora" hint="{proximaAbertura} vira «amanhã às 8h», «segunda às 8h»…">
          <Textarea id="am-fora" rows={2} value={c.foraDoHorario.texto} disabled={ro} onChange={(e) => patch("foraDoHorario", { texto: e.target.value })} />
        </FormField>
      </Block>

      <Block title="Aviso de posição na fila" description="Quando o cliente espera na fila sem ninguém atender." active={c.aguardandoFila.ativa} onActive={(v) => patch("aguardandoFila", { ativa: v })} disabled={ro} badge={timeBadge}>
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <FormField label="Depois de (min)" htmlFor="am-fila-min">
            <Input id="am-fila-min" type="number" min={1} max={120} value={c.aguardandoFila.minutos} disabled={ro} onChange={(e) => patch("aguardandoFila", { minutos: Number(e.target.value) })} />
          </FormField>
          <FormField label="Texto" htmlFor="am-fila" hint="{posicao} vira a posição do cliente na fila">
            <Textarea id="am-fila" rows={2} value={c.aguardandoFila.texto} disabled={ro} onChange={(e) => patch("aguardandoFila", { texto: e.target.value })} />
          </FormField>
        </div>
      </Block>

      <Block
        title="Cliente sem resposta"
        description="Quando a equipe respondeu e o cliente sumiu: primeiro um lembrete, depois o encerramento automático (motivo «sem resposta»)."
        active={c.semResposta.ativa}
        onActive={(v) => patch("semResposta", { ativa: v })}
        disabled={ro}
        badge={timeBadge}
      >
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <FormField label="Lembrete após (h)" htmlFor="am-lemb-h">
            <Input id="am-lemb-h" type="number" min={1} max={72} value={c.semResposta.lembreteHoras} disabled={ro} onChange={(e) => patch("semResposta", { lembreteHoras: Number(e.target.value) })} />
          </FormField>
          <FormField label="Lembrete" htmlFor="am-lemb">
            <Textarea id="am-lemb" rows={2} value={c.semResposta.textoLembrete} disabled={ro} onChange={(e) => patch("semResposta", { textoLembrete: e.target.value })} />
          </FormField>
          <FormField label="Encerrar após (h)" htmlFor="am-enc-h">
            <Input id="am-enc-h" type="number" min={2} max={168} value={c.semResposta.encerrarHoras} disabled={ro} onChange={(e) => patch("semResposta", { encerrarHoras: Number(e.target.value) })} />
          </FormField>
          <FormField label="Mensagem de encerramento" htmlFor="am-enc">
            <Textarea id="am-enc" rows={2} value={c.semResposta.textoEncerramento} disabled={ro} onChange={(e) => patch("semResposta", { textoEncerramento: e.target.value })} />
          </FormField>
        </div>
        <p className="text-xs text-muted">Depois de 24 h sem o cliente escrever, a janela do WhatsApp fecha: o lembrete precisa sair antes disso.</p>
      </Block>

      <Block title="Encerramento" description="Quando o operador encerra a conversa (pode desmarcar o envio na hora)." active={c.encerramento.ativa} onActive={(v) => patch("encerramento", { ativa: v })} disabled={ro}>
        <FormField label="Texto" htmlFor="am-close">
          <Textarea id="am-close" rows={2} value={c.encerramento.texto} disabled={ro} onChange={(e) => patch("encerramento", { texto: e.target.value })} />
        </FormField>
      </Block>

      {canEdit ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
          {dirty ? <span className="text-sm text-muted">Alterações não salvas</span> : null}
          <Button variant="ghost" onClick={() => setC(data.config)} disabled={!dirty || pending}>
            Descartar
          </Button>
          <Button onClick={save} loading={pending} disabled={!dirty && data.stored}>
            Salvar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
