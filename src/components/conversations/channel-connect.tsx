"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Copy, Globe, MessagesSquare, Plus, Send, Trash2, Unplug } from "lucide-react";
import { chooseMetaPageAction, connectTelegramAction, disconnectMetaAction, disconnectTelegramAction, startMetaLoginAction } from "@/server/conversations/channel-setup-actions";
import { saveSiteChatAction } from "@/server/conversations/site-chat-actions";
import type { SocialStatus, TelegramStatus } from "@/server/conversations/channel-setup";
import type { SiteChatConfig } from "@/domain/site-chat";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

function Box({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">{children}</div>;
}

export function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-surface-muted px-2 py-1.5 font-mono text-xs">{value}</code>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Copiar: ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => toast.success("Copiado"));
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

/** Instagram e Messenger: login da Meta, escolha da página e desconectar. */
export function SocialConnect({ status, canEdit, base, result }: { status: SocialStatus; canEdit: boolean; base: string; result?: { kind: string; reason?: string } }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    if (result?.kind === "ok") toast.success("Instagram/Messenger conectado");
    if (result?.kind === "erro") toast.error(result.reason ?? "Não foi possível conectar");
  }, [result]);
  const login = () =>
    startTransition(async () => {
      const r = await startMetaLoginAction();
      if (!r.ok) return void toast.error(r.error);
      window.location.assign(r.data.url);
    });
  const choose = (pageId: string) =>
    startTransition(async () => {
      const r = await chooseMetaPageAction({ pageId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Página conectada");
      router.replace("/comunicacao/canais?aba=social");
      router.refresh();
    });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted">As mensagens do Instagram Direct e do Messenger da página da empresa entram na Central como as do WhatsApp. A resposta sai pela própria página (até 24 h depois da última mensagem do cliente; até 7 dias como atendimento humano).</p>
      <Box>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <Camera className="size-4" aria-hidden /> <MessagesSquare className="size-4" aria-hidden /> Página da Meta
          </p>
          <Badge variant={status.connected ? "success" : "muted"}>{status.connected ? "Conectado" : "Não conectado"}</Badge>
        </div>
        {status.connected ? (
          <>
            <p className="text-sm">
              Página <strong>{status.pageName}</strong>
              {status.instagram ? (
                <>
                  {" "}
                  · Instagram <strong>{status.instagramUsername ? `@${status.instagramUsername}` : "ligado"}</strong>
                </>
              ) : (
                " · sem Instagram ligado à página"
              )}
            </p>
            <p className="text-xs text-muted">
              Conectado por {status.connectedByName} em {status.connectedAt ? formatDateTime(status.connectedAt) : "—"}. O token da página fica cifrado no servidor.
            </p>
            {canEdit ? (
              <Button variant="outline" className="self-start" onClick={() => setConfirm(true)} disabled={pending}>
                <Unplug /> Desconectar
              </Button>
            ) : null}
          </>
        ) : status.pending.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Escolha a página que vai atender:</p>
            {status.pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-sm">
                  <strong>{p.name}</strong>
                  <span className="block text-xs text-muted">{p.instagram ? `Instagram: ${p.instagram.startsWith("conta") ? p.instagram : `@${p.instagram}`}` : "sem Instagram ligado"}</span>
                </span>
                <Button size="sm" onClick={() => choose(p.id)} disabled={pending || !canEdit}>
                  Conectar esta
                </Button>
              </div>
            ))}
          </div>
        ) : status.appConfigured ? (
          canEdit ? (
            <Button className="self-start" onClick={login} loading={pending}>
              Conectar com a Meta
            </Button>
          ) : (
            <p className="text-sm text-muted">Peça a um gestor para conectar.</p>
          )
        ) : (
          <p className="text-sm text-muted">Antes, o app da Meta precisa estar configurado na Vercel: META_APP_ID e META_APP_SECRET (e META_VERIFY_TOKEN para o webhook).</p>
        )}
      </Box>
      <Box>
        <p className="text-sm font-medium">No painel do app da Meta</p>
        <CopyLine label="URI de redirecionamento do OAuth (Facebook Login)" value={`${base}/api/integrations/meta/callback`} />
        <CopyLine label="Webhook (produtos Messenger e Instagram, campo «messages»)" value={`${base}/api/webhooks/meta`} />
        <p className="text-xs text-muted">Permissões usadas: páginas, mensagens do Messenger e do Instagram. Para responder entre 24 h e 7 dias, o app precisa da permissão «Human Agent» aprovada pela Meta.</p>
      </Box>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Desconectar o Instagram e o Messenger?"
        description="As mensagens novas deixam de entrar na Central e as respostas não saem mais pela página. As conversas e o histórico continuam."
        confirmLabel="Desconectar"
        destructive
        onConfirm={async () => {
          const r = await disconnectMetaAction();
          if (!r.ok) return void toast.error(r.error);
          toast.success("Desconectado");
          router.refresh();
        }}
      />
    </div>
  );
}

/** Telegram: colar o token do bot (o INTEROS registra o webhook com segredo) e desconectar. */
export function TelegramConnect({ status, canEdit }: { status: TelegramStatus; canEdit: boolean }) {
  const router = useRouter();
  const [token, setToken] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  const connect = () =>
    startTransition(async () => {
      const r = await connectTelegramAction({ token });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Telegram conectado: @${r.data.botUsername}`);
      setToken("");
      router.refresh();
    });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted">Quem conversar com o bot da empresa no Telegram cai na Central. Crie o bot no @BotFather (/newbot) e cole aqui o token que ele mostrar.</p>
      <Box>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <Send className="size-4" aria-hidden /> Bot do Telegram
          </p>
          <Badge variant={status.connected ? "success" : "muted"}>{status.connected ? "Conectado" : "Não conectado"}</Badge>
        </div>
        {status.connected ? (
          <>
            <p className="text-sm">
              Bot <strong>@{status.botUsername}</strong> · link para os clientes: <code className="font-mono text-xs">https://t.me/{status.botUsername}</code>
            </p>
            <p className="text-xs text-muted">
              Conectado por {status.connectedByName} em {status.connectedAt ? formatDateTime(status.connectedAt) : "—"}. Token e segredo do webhook ficam cifrados no servidor.
            </p>
          </>
        ) : null}
        {canEdit ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <FormField label={status.connected ? "Trocar o bot (novo token)" : "Token do bot"} htmlFor="tg-token" className="flex-1">
              <Input id="tg-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…" />
            </FormField>
            <Button onClick={connect} loading={pending} disabled={token.trim().length < 20}>
              Conectar
            </Button>
            {status.connected ? (
              <Button variant="outline" onClick={() => setConfirm(true)} disabled={pending}>
                <Unplug /> Desconectar
              </Button>
            ) : null}
          </div>
        ) : null}
      </Box>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Desconectar o Telegram?"
        description="O INTEROS desliga o webhook do bot: mensagens novas deixam de entrar. As conversas e o histórico continuam."
        confirmLabel="Desconectar"
        destructive
        onConfirm={async () => {
          const r = await disconnectTelegramAction();
          if (!r.ok) return void toast.error(r.error);
          toast.success("Telegram desconectado");
          router.refresh();
        }}
      />
    </div>
  );
}

/** Chat do site: ligar, aparência, formulário, sites permitidos e o código para colar no site. */
export function SiteChatAdmin({ config, canEdit, base }: { config: SiteChatConfig; canEdit: boolean; base: string }) {
  const router = useRouter();
  const initial = React.useMemo(() => ({ ...config }), [config]);
  const [c, setC] = React.useState(initial);
  const [domain, setDomain] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(c) !== JSON.stringify(initial);
  const ro = !canEdit;
  const set = (v: Partial<SiteChatConfig>) => setC((x) => ({ ...x, ...v }));
  const save = () =>
    startTransition(async () => {
      const { publicKey, ...rest } = c;
      void publicKey;
      const r = await saveSiteChatAction(rest);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Chat do site salvo");
      router.refresh();
    });
  const snippet = config.publicKey ? `<script src="${base}/chat/widget.js?k=${config.publicKey}" async></script>` : "";
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted">Uma janela de conversa no site da empresa. O visitante deixa nome e contato, e a conversa entra na Central como as demais. Fora do horário, ele ainda deixa a mensagem.</p>
      <Box>
        <Switch checked={c.enabled} disabled={ro} onCheckedChange={(v) => set({ enabled: v })} label="Chat do site ligado" />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
          <FormField label="Título da janela" htmlFor="sc-title">
            <Input id="sc-title" value={c.title} disabled={ro} onChange={(e) => set({ title: e.target.value })} />
          </FormField>
          <FormField label="Cor" htmlFor="sc-color">
            <Input id="sc-color" type="color" value={c.color} disabled={ro} onChange={(e) => set({ color: e.target.value })} className="h-11 p-1" />
          </FormField>
          <FormField label="Posição" htmlFor="sc-pos">
            <Select
              id="sc-pos"
              value={c.position}
              disabled={ro}
              onChange={(e) => set({ position: e.target.value as SiteChatConfig["position"] })}
              options={[
                { value: "direita", label: "Direita" },
                { value: "esquerda", label: "Esquerda" },
              ]}
            />
          </FormField>
        </div>
        <FormField label="Saudação" htmlFor="sc-greet">
          <Input id="sc-greet" value={c.greeting} disabled={ro} onChange={(e) => set({ greeting: e.target.value })} />
        </FormField>
        <div className="flex flex-wrap gap-4">
          <Switch size="sm" checked={c.askEmail} disabled={ro} onCheckedChange={(v) => set({ askEmail: v })} label="Pedir e-mail" />
          <Switch size="sm" checked={c.askPhone} disabled={ro} onCheckedChange={(v) => set({ askPhone: v })} label="Pedir telefone" />
          <Switch size="sm" checked={c.requireContact} disabled={ro} onCheckedChange={(v) => set({ requireContact: v })} label="Exigir e-mail ou telefone" />
        </div>
        <FormField label="Fora do horário" htmlFor="sc-off">
          <Textarea id="sc-off" rows={2} value={c.offlineMessage} disabled={ro} onChange={(e) => set({ offlineMessage: e.target.value })} />
        </FormField>
        <FormField label="Aviso de privacidade (aparece no formulário)" htmlFor="sc-priv">
          <Input id="sc-priv" value={c.privacyNotice} disabled={ro} onChange={(e) => set({ privacyNotice: e.target.value })} />
        </FormField>
      </Box>
      <Box>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Globe className="size-4" aria-hidden /> Sites onde o chat pode aparecer
        </p>
        {c.allowedDomains.length === 0 ? <p className="text-sm text-warning-fg">Nenhum site na lista: o chat funciona em qualquer site que tiver o código. Recomendado: cadastrar o domínio da empresa.</p> : null}
        <div className="flex flex-wrap gap-2">
          {c.allowedDomains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm">
              {d}
              {canEdit ? (
                <button type="button" aria-label={`Remover ${d}`} className="text-muted hover:text-foreground" onClick={() => set({ allowedDomains: c.allowedDomains.filter((x) => x !== d) })}>
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <Input aria-label="Novo site" placeholder="intercert.com.br" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Button
              variant="outline"
              onClick={() => {
                const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
                if (!d) return;
                set({ allowedDomains: Array.from(new Set([...c.allowedDomains, d])) });
                setDomain("");
              }}
            >
              <Plus /> Adicionar
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted">Vale também para os subdomínios (ex.: loja.intercert.com.br). O navegador bloqueia o chat em sites fora da lista.</p>
      </Box>
      {snippet ? (
        <Box>
          <p className="text-sm font-medium">Código para o site</p>
          <CopyLine label="Cole antes de </body> em todas as páginas" value={snippet} />
          {config.enabled ? (
            <a className="text-sm font-medium text-brand-fg hover:underline" href={`${base}/chat/embed?k=${config.publicKey}`} target="_blank" rel="noreferrer">
              Abrir a janela do chat para testar
            </a>
          ) : (
            <p className="text-xs text-muted">Ligue o chat e salve para ele aparecer no site.</p>
          )}
        </Box>
      ) : null}
      {canEdit ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
          {dirty ? <span className="text-sm text-muted">Alterações não salvas</span> : null}
          <Button variant="ghost" onClick={() => setC(initial)} disabled={!dirty || pending}>
            Descartar
          </Button>
          <Button onClick={save} loading={pending} disabled={!dirty && Boolean(config.publicKey)}>
            Salvar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
