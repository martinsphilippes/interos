"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { registerOpportunityContactAction } from "@/server/sales/actions";
import { cn } from "@/lib/utils";

export interface ContactButtonsProps {
  opportunityId: string;
  phone?: string;
  whatsapp?: string;
  /** Só ícones (listas compactas). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * WhatsApp (wa.me) e Ligar (tel:): abrem o canal e registram o contato na oportunidade e na
 * timeline do cliente (a integração real com WhatsApp API/VoIP entra depois).
 */
export function ContactButtons({ opportunityId, phone, whatsapp, iconOnly, className }: ContactButtonsProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const wa = whatsappHref(whatsapp ?? phone);
  const tel = telHref(phone ?? whatsapp);

  const register = (channel: "whatsapp" | "ligacao") => {
    startTransition(async () => {
      const result = await registerOpportunityContactAction({ opportunityId, channel, outcome: channel === "whatsapp" ? "mensagem_enviada" : "atendeu" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(channel === "whatsapp" ? "WhatsApp registrado na timeline" : "Ligação registrada na timeline");
      router.refresh();
    });
  };

  const size = iconOnly ? "icon" : "sm";
  const touch = "min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0";
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {wa ? (
        <Button asChild variant="outline" size={size} className={cn(touch, iconOnly && "md:size-8")} aria-label="WhatsApp">
          <a href={wa} target="_blank" rel="noreferrer" onClick={() => register("whatsapp")} aria-disabled={pending}>
            <MessageCircle className="text-success" />
            {!iconOnly ? "WhatsApp" : null}
          </a>
        </Button>
      ) : null}
      {tel ? (
        <Button asChild variant="outline" size={size} className={cn(touch, iconOnly && "md:size-8")} aria-label="Ligar">
          <a href={tel} onClick={() => register("ligacao")} aria-disabled={pending}>
            <Phone className="text-info" />
            {!iconOnly ? "Ligar" : null}
          </a>
        </Button>
      ) : null}
      {!wa && !tel ? <span className="text-xs text-muted-light">Sem telefone</span> : null}
    </div>
  );
}
