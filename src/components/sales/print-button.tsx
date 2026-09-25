"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="min-h-[44px] md:min-h-0">
      <Printer /> Imprimir / salvar PDF
    </Button>
  );
}
