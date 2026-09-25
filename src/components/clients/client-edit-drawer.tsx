"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import type { Client } from "@/domain/types";
import type { ClientFormOptions } from "@/server/clients/queries";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { ClientForm, clientToFormValues } from "./client-form";

export interface ClientEditDrawerProps {
  client: Client;
  options: ClientFormOptions;
  trigger?: React.ReactNode;
}

/** Botão "Editar" que abre o formulário completo do cliente em um drawer lateral. */
export function ClientEditDrawer({ client, options, trigger }: ClientEditDrawerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Pencil /> Editar
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>Editar cliente</DrawerTitle>
          <DrawerDescription>{client.tradeName}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {/* key reabre o formulário sempre com os dados atuais do cliente. */}
          <ClientForm key={`${client.id}-${client.updatedAt}-${open}`} mode="edit" clientId={client.id} initial={clientToFormValues(client)} options={options} layout="drawer" onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
