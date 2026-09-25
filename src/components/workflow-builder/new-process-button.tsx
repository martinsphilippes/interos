"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { createProcessDefinitionAction } from "@/server/process-engine/actions";

/** "Novo processo": cria a v1 em rascunho e abre o construtor. */
export function NewProcessButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await createProcessDefinitionAction({ name, description });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Processo criado");
      router.push(`/admin/workflows/processos/${res.data.id}`);
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="min-h-[44px] md:min-h-0">
        <Plus /> Novo processo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>Novo processo</DialogTitle>
              <DialogDescription>Começa como rascunho v1 com Início e Fim; desenhe as etapas no construtor.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField label="Nome" htmlFor="np-name" required>
                <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reativação de cliente em risco" autoFocus required minLength={3} />
              </FormField>
              <FormField label="Descrição" htmlFor="np-desc">
                <Textarea id="np-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Criar e abrir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
