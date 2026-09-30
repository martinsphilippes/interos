"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { REGUA_CANAL_LABELS, REGUA_CANAIS, REGUA_TEMPLATE_VARS, type CobrancaCanaisConfig, type FinanceiroBaixaConfig, type ReguaCobrancaConfig, type ReguaMarco } from "@/server/admin/schemas";
import type { ReguaPreview } from "@/server/finance/regua";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

// ---------------------------------------------------------------------------
// Régua de cobrança
// ---------------------------------------------------------------------------

interface MarcoForm {
  key: string;
  id: string;
  nome: string;
  /** Dias em módulo; o sinal vem de `quando`. */
  dias: string;
  quando: "antes" | "depois";
  canal: ReguaMarco["canal"];
  template: string;
  ativo: boolean;
}

function toForm(m: ReguaMarco, i: number): MarcoForm {
  return { key: `${m.id}-${i}`, id: m.id, nome: m.nome, dias: String(Math.abs(m.offsetDias)), quando: m.offsetDias < 0 ? "antes" : "depois", canal: m.canal, template: m.template, ativo: m.ativo };
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function offsetLabel(offset: number): string {
  if (offset === 0) return "no dia do vencimento";
  return offset < 0 ? `${-offset} dia${offset === -1 ? "" : "s"} antes do vencimento` : `${offset} dia${offset === 1 ? "" : "s"} depois do vencimento`;
}

/** Régua de cobrança: ligar/desligar, dias úteis, marcos (sinal editável) e prévia honesta do que rodaria hoje. */
export function SettingsRegua({ value, stored, preview }: { value: ReguaCobrancaConfig; stored: boolean; preview: ReguaPreview }) {
  const { pending, error, save } = useSaveSetting("regua_cobranca");
  const [form, setForm] = React.useState({ ativa: value.ativa, diasUteis: value.diasUteis, pausarPendencia: value.pausarQuando.pendencia, pausarNegociacao: value.pausarQuando.negociacao });
  const [marcos, setMarcos] = React.useState<MarcoForm[]>(() => value.marcos.map(toForm));
  const [seq, setSeq] = React.useState(value.marcos.length);
  const previewById = new Map(preview.items.map((p) => [p.marcoId, p]));

  const setMarco = (key: string, patch: Partial<MarcoForm>) => setMarcos((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const addMarco = () => {
    const n = seq + 1;
    setSeq(n);
    setMarcos((list) => [...list, { key: `novo-${n}`, id: `marco_${n}`, nome: `Marco ${n}`, dias: "3", quando: "depois", canal: "whatsapp", template: "Olá, {contato}! A {parcela} de {cliente} ({valor}) venceu em {vencimento}. {linhaDigitavel}{linkBoleto}Podemos ajudar?", ativo: true }]);
  };
  const removeMarco = (key: string) => setMarcos((list) => list.filter((m) => m.key !== key));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save(
      {
        ativa: form.ativa,
        diasUteis: form.diasUteis,
        marcos: marcos.map((m) => ({ id: m.id.trim() || slug(m.nome) || `marco_${Date.now()}`, nome: m.nome.trim(), offsetDias: (m.quando === "antes" ? -1 : 1) * Math.abs(Number(m.dias) || 0), canal: m.canal, template: m.template, ativo: m.ativo })),
        pausarQuando: { pendencia: form.pausarPendencia, negociacao: form.pausarNegociacao },
      },
      form.ativa ? "Régua de cobrança salva e ATIVA" : "Régua de cobrança salva (desligada)",
    );
  };

  const canalWarning = (canal: ReguaMarco["canal"]) => {
    if ((canal === "whatsapp" || canal === "whatsapp_email") && !preview.channels.whatsapp) return "WhatsApp não conectado: vira tarefa ao Financeiro com o texto e o link prontos.";
    if ((canal === "email" || canal === "whatsapp_email") && !preview.channels.email) return "E-mail não conectado: vira tarefa ao Financeiro com o texto e o link prontos.";
    return null;
  };

  return (
    <SettingsSection
      title="Régua de cobrança"
      description="Marcos executados uma única vez por cobrança (dias antes ou depois do vencimento — o sinal é configurável). Os marcos padrão (15 e 7 dias antes; 21 dias depois) são uma proposta: ajuste dias, sinal, canal e texto. Nada roda enquanto a régua estiver desligada."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Switch label="Régua ativa" description={form.ativa ? "Marcos executados pela varredura diária (e ao abrir Cobranças)." : "Desligada: nenhum lembrete automático é enviado."} checked={form.ativa} onCheckedChange={(v) => setForm((f) => ({ ...f, ativa: v }))} className="w-full rounded-lg border border-border px-3 py-2" />
        <Switch label="Contar em dias úteis" description="Fins de semana e feriados não contam nos dias do marco." checked={form.diasUteis} onCheckedChange={(v) => setForm((f) => ({ ...f, diasUteis: v }))} className="w-full rounded-lg border border-border px-3 py-2" />
        <Switch label="Pausar com pendência no contrato" description="Contrato com pendência financeira não recebe lembretes." checked={form.pausarPendencia} onCheckedChange={(v) => setForm((f) => ({ ...f, pausarPendencia: v }))} className="w-full rounded-lg border border-border px-3 py-2" />
        <Switch label="Pausar em negociação" description="Reservado para a negociação registrada pelo Financeiro." checked={form.pausarNegociacao} onCheckedChange={(v) => setForm((f) => ({ ...f, pausarNegociacao: v }))} className="w-full rounded-lg border border-border px-3 py-2" />
      </div>

      <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted" data-testid="regua-preview">
        <p className="font-medium text-foreground">
          Prévia de hoje ({formatDate(preview.today)}): {preview.openBillings} cobrança(s) em aberto{preview.pausedByPendency > 0 ? ` · ${preview.pausedByPendency} pausada(s) por pendência` : ""} · WhatsApp {preview.channels.whatsapp ? "conectado" : "não conectado"} · e-mail {preview.channels.email ? "conectado" : "não conectado"}
        </p>
        <p>
          {preview.ativa ? "Com a régua ativa, a próxima varredura executaria os marcos abaixo (nada é enviado por esta prévia)." : "Régua desligada: a prévia mostra o que a varredura faria se estivesse ativa — nada é enviado."}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {marcos.map((m, index) => {
          const offset = (m.quando === "antes" ? -1 : 1) * Math.abs(Number(m.dias) || 0);
          const p = previewById.get(m.id);
          const warning = canalWarning(m.canal);
          return (
            <div key={m.key} className="rounded-lg border border-border p-3 md:p-4" data-marco={m.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {index + 1}. {m.nome || "Marco"}
                  </span>
                  <Badge variant={offset < 0 ? "info" : offset > 0 ? "warning" : "muted"} size="sm">
                    {offsetLabel(offset)}
                  </Badge>
                  <Badge variant={m.ativo ? "success" : "muted"} size="sm">
                    {m.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Switch size="sm" aria-label={`Marco ${m.nome} ativo`} checked={m.ativo} onCheckedChange={(v) => setMarco(m.key, { ativo: v })} />
                  <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={`Remover marco ${m.nome}`} onClick={() => removeMarco(m.key)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Nome" htmlFor={`${m.key}-nome`} required>
                  <Input id={`${m.key}-nome`} value={m.nome} onChange={(e) => setMarco(m.key, { nome: e.target.value })} />
                </FormField>
                <FormField label="Dias" htmlFor={`${m.key}-dias`} required hint="0 = no dia do vencimento">
                  <Input id={`${m.key}-dias`} type="number" inputMode="numeric" min={0} max={90} value={m.dias} onChange={(e) => setMarco(m.key, { dias: e.target.value })} />
                </FormField>
                <FormField label="Quando" htmlFor={`${m.key}-quando`} required hint="Antes = sinal negativo; depois = positivo">
                  <Select id={`${m.key}-quando`} value={m.quando} onChange={(e) => setMarco(m.key, { quando: e.target.value as MarcoForm["quando"] })} options={[{ value: "antes", label: "Antes do vencimento" }, { value: "depois", label: "Depois do vencimento" }]} />
                </FormField>
                <FormField label="Canal" htmlFor={`${m.key}-canal`} required>
                  <Select id={`${m.key}-canal`} value={m.canal} onChange={(e) => setMarco(m.key, { canal: e.target.value as ReguaMarco["canal"] })} options={REGUA_CANAIS.map((c) => ({ value: c, label: REGUA_CANAL_LABELS[c] }))} />
                </FormField>
                <FormField label="Texto" htmlFor={`${m.key}-template`} required className="sm:col-span-2 lg:col-span-4" hint={`Variáveis: ${REGUA_TEMPLATE_VARS.join(" ")} ({linkPortal} fica vazio até existir o portal do cliente)`}>
                  <Textarea id={`${m.key}-template`} value={m.template} onChange={(e) => setMarco(m.key, { template: e.target.value })} rows={3} />
                </FormField>
              </div>
              <div className="mt-2 flex flex-col gap-1 text-xs text-muted">
                {warning ? <p className="text-warning-fg">{warning}</p> : null}
                {p ? (
                  <p>
                    Prévia de hoje: <span className="font-medium text-foreground">{p.due}</span> cobrança(s) neste marco{p.done > 0 ? ` (${p.done} já executada(s), não repetem)` : ""}
                    {p.sample.length > 0 ? ` · ${p.sample.join(" · ")}` : ""}
                  </p>
                ) : (
                  <p>Prévia disponível depois de salvar.</p>
                )}
              </div>
            </div>
          );
        })}
        <div>
          <Button type="button" variant="outline" onClick={addMarco} className="h-10 md:h-9">
            <Plus /> Adicionar marco
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Canais de cobrança
// ---------------------------------------------------------------------------

export function SettingsCobrancaCanais({ value, stored }: { value: CobrancaCanaisConfig; stored: boolean }) {
  const { pending, error, save } = useSaveSetting("cobranca_canais");
  const [form, setForm] = React.useState({ principal: value.principal, complementar: value.complementar, enviarEmailJuntoAoWhatsapp: value.enviarEmailJuntoAoWhatsapp, remetenteEmail: value.remetenteEmail ?? "" });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save({ principal: form.principal, complementar: form.complementar, enviarEmailJuntoAoWhatsapp: form.enviarEmailJuntoAoWhatsapp, remetenteEmail: form.remetenteEmail.trim() || undefined }, "Canais de cobrança salvos");
  };

  return (
    <SettingsSection
      title="Canais de cobrança"
      description="Política: WhatsApp é o canal principal com o cliente; e-mail é complementar. Sem canal conectado o sistema abre wa.me/mailto com o texto pronto e registra o envio manual — nunca finge que enviou. O cliente pode ter opt-out por canal no cadastro."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Canal principal" htmlFor="cc-principal" required>
          <Select id="cc-principal" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value as CobrancaCanaisConfig["principal"] }))} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-mail" }]} />
        </FormField>
        <FormField label="Canal complementar" htmlFor="cc-complementar" required>
          <Select id="cc-complementar" value={form.complementar} onChange={(e) => setForm((f) => ({ ...f, complementar: e.target.value as CobrancaCanaisConfig["complementar"] }))} options={[{ value: "email", label: "E-mail" }, { value: "whatsapp", label: "WhatsApp" }, { value: "nenhum", label: "Nenhum" }]} />
        </FormField>
        <Switch label="Enviar e-mail junto ao WhatsApp" description="Ao cobrar por WhatsApp, o e-mail complementar vai automaticamente (quando o cliente tem e-mail)." checked={form.enviarEmailJuntoAoWhatsapp} onCheckedChange={(v) => setForm((f) => ({ ...f, enviarEmailJuntoAoWhatsapp: v }))} className="w-full rounded-lg border border-border px-3 py-2" />
        <FormField label="Remetente exibido" htmlFor="cc-remetente" hint="Opcional (o remetente técnico é EMAIL_FROM)">
          <Input id="cc-remetente" value={form.remetenteEmail} onChange={(e) => setForm((f) => ({ ...f, remetenteEmail: e.target.value }))} placeholder="Financeiro Intercert" />
        </FormField>
      </div>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Baixa automática
// ---------------------------------------------------------------------------

export function SettingsFinanceiroBaixa({ value, stored }: { value: FinanceiroBaixaConfig; stored: boolean }) {
  const { pending, error, save } = useSaveSetting("financeiro_baixa");
  const [form, setForm] = React.useState({ toleranciaValor: String(value.toleranciaValor).replace(".", ","), pagamentoParcialAutomatico: value.pagamentoParcialAutomatico });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save({ toleranciaValor: Number(form.toleranciaValor.replace(",", ".")), pagamentoParcialAutomatico: form.pagamentoParcialAutomatico }, "Baixa automática salva");
  };

  return (
    <SettingsSection
      title="Baixa automática (provedor / conciliação)"
      description="Vale só para baixas vindas do provedor de cobrança ou da conciliação bancária — a baixa manual aceita o valor informado. Valor recebido igual ou maior que o da cobrança menos a tolerância dá baixa; abaixo disso, pendência no contrato (ou aviso ao Financeiro quando já liberado) e a cobrança fica em aberto."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tolerância de valor (R$)" htmlFor="fb-tol" required hint="Diferença aceita entre recebido e cobrança">
          <Input id="fb-tol" inputMode="decimal" value={form.toleranciaValor} onChange={(e) => setForm((f) => ({ ...f, toleranciaValor: e.target.value }))} />
        </FormField>
        <FormField label="Pagamento parcial automático" htmlFor="fb-parcial" required>
          <Select id="fb-parcial" value={form.pagamentoParcialAutomatico} onChange={(e) => setForm((f) => ({ ...f, pagamentoParcialAutomatico: e.target.value as FinanceiroBaixaConfig["pagamentoParcialAutomatico"] }))} options={[{ value: "pendencia", label: "Não baixar: registrar pendência e avisar" }, { value: "baixar", label: "Baixar com o valor recebido" }]} />
        </FormField>
      </div>
    </SettingsSection>
  );
}
