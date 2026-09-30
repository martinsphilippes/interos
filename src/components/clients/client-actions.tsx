"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, CheckSquare, GitBranch, Headset, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, StickyNote, TrendingUp } from "lucide-react";
import type { Client, Contact, Product } from "@/domain/types";
import type { ClientFormOptions } from "@/server/clients/queries";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NewTicketDialog, type NewTicketOptions } from "@/components/support/new-ticket-dialog";
import { ClientEditDrawer } from "./client-edit-drawer";
import { ContactEventDialog } from "./contact-event-dialog";
import { NoteDialog } from "./note-form";
import { StatusDialog } from "./status-dialog";
import { UpsellDialog } from "./upsell-dialog";
import { ALL_CLIENT_CAPABILITIES, type ClientCapabilities } from "./access-model";

export interface ClientActionsProps {
  client: Client;
  contacts: Contact[];
  availableProducts: Product[];
  ownedCategories: string[];
  options: ClientFormOptions;
  /** Opções do NewTicketDialog; null quando o usuário não acessa o Suporte. */
  ticketOptions: NewTicketOptions | null;
  /** Canais conectados de fato (registro de integrações). */
  channels?: { whatsapp: boolean; voip: boolean };
  /** Ações permitidas (calculadas no servidor): sem a permissão o controle não aparece; as actions revalidam. */
  can?: ClientCapabilities;
}

type MenuDialog = "nota" | "oportunidade" | "ligar" | "whatsapp" | "status" | null;

/**
 * Ações do cabeçalho da Ficha 360º: "Editar cliente", a ação principal do estágio (cliente em
 * implantação/ativo: "Novo atendimento"; demais: "Nova tarefa") e o menu com as demais ações.
 * Tudo que o usuário faz aqui vira evento na timeline.
 */
export function ClientActions({ client, contacts, availableProducts, ownedCategories, options, ticketOptions, channels, can = ALL_CLIENT_CAPABILITIES }: ClientActionsProps) {
  const [dialog, setDialog] = React.useState<MenuDialog>(null);
  const control = (key: Exclude<MenuDialog, null>) => ({ open: dialog === key, onOpenChange: (open: boolean) => setDialog(open ? key : null) });
  const serviceStage = client.status === "ativo" || client.status === "em_implantacao" || client.status === "inativo";
  const primaryIsTicket = Boolean(ticketOptions) && serviceStage;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.edit ? (
        <ClientEditDrawer
          client={client}
          options={options}
          trigger={
            <Button variant="outline">
              <Pencil /> Editar cliente
            </Button>
          }
        />
      ) : null}
      {primaryIsTicket && ticketOptions ? (
        <NewTicketDialog
          options={ticketOptions}
          fixedClient={{ id: client.id, name: client.tradeName }}
          trigger={
            <Button>
              <Headset /> Novo atendimento
            </Button>
          }
        />
      ) : can.createTask ? (
        <Button asChild>
          <Link href={`/tarefas?novo=1&cliente=${client.id}`}>
            <Plus /> Nova tarefa
          </Link>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Mais ações">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          {primaryIsTicket && can.createTask ? (
            <DropdownMenuItem asChild>
              <Link href={`/tarefas?novo=1&cliente=${client.id}`}>
                <CheckSquare /> Nova tarefa
              </Link>
            </DropdownMenuItem>
          ) : null}
          {can.register ? (
            <DropdownMenuItem onSelect={() => setDialog("nota")}>
              <StickyNote /> Registrar nota
            </DropdownMenuItem>
          ) : null}
          {can.createOpportunity ? (
            <DropdownMenuItem onSelect={() => setDialog("oportunidade")} disabled={availableProducts.length === 0}>
              <TrendingUp /> Gerar oportunidade
            </DropdownMenuItem>
          ) : null}
          {can.register ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog("ligar")}>
                <Phone /> Ligar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("whatsapp")}>
                <MessageCircle /> WhatsApp
              </DropdownMenuItem>
            </>
          ) : null}
          {can.changeStatus ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog("status")}>
                <ArrowLeftRight /> Alterar status
              </DropdownMenuItem>
            </>
          ) : null}
          {client.workflowInstanceId && can.openWorkflow ? (
            <DropdownMenuItem asChild>
              <Link href={`/workflow/${client.workflowInstanceId}`}>
                <GitBranch /> Abrir jornada no workflow
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <NoteDialog clientId={client.id} clientName={client.tradeName} {...control("nota")} />
      <UpsellDialog clientId={client.id} clientName={client.tradeName} products={availableProducts} ownedCategories={ownedCategories} {...control("oportunidade")} />
      <ContactEventDialog clientId={client.id} clientName={client.tradeName} channel="ligacao" contacts={contacts} clientPhone={client.phone} clientWhatsapp={client.whatsapp} connected={channels?.voip} {...control("ligar")} />
      <ContactEventDialog clientId={client.id} clientName={client.tradeName} channel="whatsapp" contacts={contacts} clientPhone={client.phone} clientWhatsapp={client.whatsapp} connected={channels?.whatsapp} {...control("whatsapp")} />
      <StatusDialog clientId={client.id} currentStatus={client.status} open={dialog === "status"} onOpenChange={(open) => setDialog(open ? "status" : null)} />
    </div>
  );
}
