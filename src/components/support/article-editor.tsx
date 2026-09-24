"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, Save } from "lucide-react";
import { saveArticleAction } from "@/server/support/actions";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Markdown } from "./markdown";

export interface ArticleDraft {
  id?: string;
  title: string;
  productId?: string;
  category?: string;
  body: string;
  tags: string[];
  published: boolean;
}

export interface ArticleEditorProps {
  products: { id: string; name: string }[];
  categories?: string[];
  initial?: Partial<ArticleDraft>;
  /** Chamado de origem ("Criar artigo a partir deste chamado"). */
  sourceTicketId?: string;
  trigger: React.ReactNode;
}

/** Criação/edição de artigo da base de conhecimento (markdown simples com pré-visualização). */
export function ArticleEditor({ products, categories = [], initial, sourceTicketId, trigger }: ArticleEditorProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [productId, setProductId] = React.useState(initial?.productId ?? "");
  const [category, setCategory] = React.useState(initial?.category ?? "");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [tags, setTags] = React.useState((initial?.tags ?? []).join(", "));
  const [published, setPublished] = React.useState(initial?.published ?? true);
  const id = React.useId();
  const editing = Boolean(initial?.id);

  const reset = () => {
    setTitle(initial?.title ?? "");
    setProductId(initial?.productId ?? "");
    setCategory(initial?.category ?? "");
    setBody(initial?.body ?? "");
    setTags((initial?.tags ?? []).join(", "));
    setPublished(initial?.published ?? true);
    setPreview(false);
  };

  const submit = () =>
    startTransition(async () => {
      const result = await saveArticleAction({
        id: initial?.id,
        title,
        productId: productId || undefined,
        category: category || undefined,
        body,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        published,
        sourceTicketId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Artigo atualizado" : "Artigo criado na base de conhecimento");
      setOpen(false);
      if (editing) router.refresh();
      else router.push(`/suporte/base-de-conhecimento/${result.data.id}`);
    });

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{editing ? "Editar artigo" : "Novo artigo"}</DrawerTitle>
          <DrawerDescription>Use # para títulos, - para listas, **negrito** e [texto](https://link).</DrawerDescription>
        </DrawerHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DrawerBody className="flex flex-col gap-4">
            <FormField label="Título" htmlFor={`${id}-title`} required>
              <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={5} maxLength={160} />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Produto" htmlFor={`${id}-product`}>
                <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Geral" options={products.map((p) => ({ value: p.id, label: p.name }))} />
              </FormField>
              <FormField label="Categoria" htmlFor={`${id}-category`}>
                <Input id={`${id}-category`} list={`${id}-categories`} value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} placeholder="Ex.: Fiscal" />
                <datalist id={`${id}-categories`}>
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </FormField>
            </div>
            <FormField label="Tags" htmlFor={`${id}-tags`} hint="Separadas por vírgula (ex.: nfc-e, sefaz)">
              <Input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} />
            </FormField>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">
                Conteúdo <span className="text-danger">*</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
                <Eye /> {preview ? "Editar" : "Pré-visualizar"}
              </Button>
            </div>
            {preview ? (
              <div className="min-h-[240px] rounded-lg border border-border p-4">{body.trim() ? <Markdown source={body} /> : <p className="text-sm text-muted">Nada para mostrar.</p>}</div>
            ) : (
              <Textarea aria-label="Conteúdo do artigo" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[280px] font-mono text-[13px]" required minLength={20} />
            )}
            <Switch label="Publicado" description="Artigos não publicados ficam visíveis só para a equipe de suporte." checked={published} onCheckedChange={setPublished} />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={title.trim().length < 5 || body.trim().length < 20}>
              <Save /> Salvar artigo
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
