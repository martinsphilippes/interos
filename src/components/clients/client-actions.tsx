"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, CheckSquare, GitBranch, MessageCircle, MoreHorizontal, Pencil, Phone, StickyNote, TrendingUp } from "lucide-react";
import type { Client, Contact, Product } from "@/domain/types";
import type { ClientFormOptions } from "@/server/clients/queries";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClientEditDrawer } from "./client-edit-drawer";
import { ContactEventDialog } from "./contact-event-dialog";
import { NoteDialog } from "./note-form";
import { StatusDialog } from "./status-dialog";
import { UpsellDialog } from "./upsell-dialog";

export interface ClientActionsProps {
  client: Client;
  contacts: Contact[];
  availableProducts: Product[];
  ownedCategories: string[];
  options: ClientFormOptions;
}

/** Barra de ações do cabeçalho da Ficha 360º. Tudo que o usuário faz aqui vira evento na timeline. */
export function ClientActions({ client, contacts, availableProducts, ownedCategories, options }: ClientActionsProps) {
  const [statusOpen, setStatusOpen] = React.useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline">
        <Link href={`/tarefas?novo=1&cliente=${client.id}`}>
          <CheckSquare /> Nova tarefa
        </Link>
      </Button>
      <ClientEditDrawer
        client={client}
        options={options}
        trigger={
          <Button variant="outline">
            <Pencil /> Editar
          </Button>
        }
      />
      <NoteDialog
        clientId={client.id}
        clientName={client.tradeName}
        trigger={
          <Button variant="outline">
            <StickyNote /> Registrar nota
          </Button>
        }
      />
      <UpsellDialog
        clientId={client.id}
        clientName={client.tradeName}
        products={availableProducts}
        ownedCategories={ownedCategories}
        trigger={
          <Button>
            <TrendingUp /> Gerar oportunidade
          </Button>
        }
      />
      <ContactEventDialog
        clientId={client.id}
        clientName={client.tradeName}
        channel="ligacao"
        contacts={contacts}
        clientPhone={client.phone}
        clientWhatsapp={client.whatsapp}
        trigger={
          <Button variant="outline" size="icon" aria-label="Ligar" title="Ligar">
            <Phone />
          </Button>
        }
      />
      <ContactEventDialog
        clientId={client.id}
        clientName={client.tradeName}
        channel="whatsapp"
        contacts={contacts}
        clientPhone={client.phone}
        clientWhatsapp={client.whatsapp}
        trigger={
          <Button variant="outline" size="icon" aria-label="WhatsApp" title="WhatsApp">
            <MessageCircle />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Mais ações">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
            <ArrowLeftRight /> Alterar status
          </DropdownMenuItem>
          {client.workflowInstanceId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/workflow/${client.workflowInstanceId}`}>
                  <GitBranch /> Abrir jornada no workflow
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <StatusDialog clientId={client.id} currentStatus={client.status} open={statusOpen} onOpenChange={setStatusOpen} />
    </div>
  );
}
