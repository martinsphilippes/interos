import { Boxes, Briefcase, Clock, CreditCard, FileText, Landmark, MessagesSquare, Package, Phone, PhoneCall, ShieldCheck, Smartphone, Wrench, type LucideIcon } from "lucide-react";
import type { ProductCategory } from "@/domain/constants";
import type { Tone } from "@/components/ui/tone";

/** Ícone e tom por categoria de produto (lista de produtos contratados do Cliente 360º). */
export const PRODUCT_CATEGORY_VISUAL: Record<ProductCategory, { icon: LucideIcon; tone: Tone }> = {
  erp: { icon: Boxes, tone: "info" },
  tef: { icon: CreditCard, tone: "secondary" },
  maquininha: { icon: Smartphone, tone: "success" },
  telefonia: { icon: Phone, tone: "purple" },
  omnichannel: { icon: MessagesSquare, tone: "secondary" },
  pabx: { icon: PhoneCall, tone: "purple" },
  certificado: { icon: ShieldCheck, tone: "warning" },
  ponto: { icon: Clock, tone: "purple" },
  notas: { icon: FileText, tone: "info" },
  banco: { icon: Landmark, tone: "success" },
  servico: { icon: Wrench, tone: "neutral" },
  consultoria: { icon: Briefcase, tone: "brand" },
  outro: { icon: Package, tone: "neutral" },
};

export function productVisual(category: ProductCategory | undefined) {
  return PRODUCT_CATEGORY_VISUAL[category ?? "outro"] ?? PRODUCT_CATEGORY_VISUAL.outro;
}
