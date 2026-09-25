"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, Save } from "lucide-react";
import type { TicketDetail } from "@/server/support/queries";
import { saveArticleAction } from "@/server/support/actions";
import { searchTerms } from "@/server/support/knowledge-search";
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
  module?: string;
  category?: string;
  problem?: string;
  keywords: string[];
  body: string;
  tags: string[];
  published: boolean;
}

export interface ArticleEditorProps {
  products: { id: string; name: string }[];
  categories?: string[];
  modules?: string[];
  initial?: Partial<ArticleDraft>;
  /** Chamado de origem ("Criar artigo a partir deste chamado"). */
  sourceTicketId?: string;
  /**
   * Botão que abre o editor. Sem trigger, use `open`/`onOpenChange` (controlado): o rascunho vem de `initial`
   * na montagem — remonte com `key` quando o rascunho mudar.
   */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Começa aberto (ex.: /suporte/base-de-conhecimento?chamado=<id>). */
  defaultOpen?: boolean;
}

const splitList = (value: string) =>
  value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Rascunho de artigo a partir de um chamado: problema = assunto + relato do cliente, produto e categoria do
 * chamado, solução aplicada no corpo e palavras-chave tiradas do assunto.
 */
export function articleDraftFromTicket(detail: Pick<TicketDetail, "ticket" | "row">): Partial<ArticleDraft> {
  const { ticket } = detail;
  const subject = ticket.subject.replace(/^\[Reaberto\]\s*/, "");
  const keywords = [ticket.category?.toLowerCase(), ...searchTerms(subject)].filter((k): k is string => Boolean(k)).slice(0, 8);
  return {
    title: subject,
    productId: ticket.productId,
    category: ticket.category,
    module: ticket.category,
    problem: ticket.description.trim().length > 0 ? `${subject}. ${ticket.description}`.slice(0, 1000) : subject,
    keywords: Array.from(new Set(keywords)),
    body: `## Solução\n\n${ticket.solution ?? "Descreva aqui o passo a passo que resolveu o chamado."}\n`,
    tags: [ticket.category?.toLowerCase()].filter((t): t is string => Boolean(t)),
    published: false,
  };
}

/** Criação/edição de artigo da base (produto, módulo, categoria, problema, palavras-chave; markdown com pré-visualização). */
export function ArticleEditor({ products, categories = [], modules = [], initial, sourceTicketId, trigger, open: controlledOpen, onOpenChange, defaultOpen = false }: ArticleEditorProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const [preview, setPreview] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [productId, setProductId] = React.useState(initial?.productId ?? "");
  const [moduleName, setModuleName] = React.useState(initial?.module ?? "");
  const [category, setCategory] = React.useState(initial?.category ?? "");
  const [problem, setProblem] = React.useState(initial?.problem ?? "");
  const [keywords, setKeywords] = React.useState((initial?.keywords ?? []).join(", "));
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [tags, setTags] = React.useState((initial?.tags ?? []).join(", "));
  const [published, setPublished] = React.useState(initial?.published ?? true);
  const id = React.useId();
  const editing = Boolean(initial?.id);

  const reset = () => {
    setTitle(initial?.title ?? "");
    setProductId(initial?.productId ?? "");
    setModuleName(initial?.module ?? "");
    setCategory(initial?.category ?? "");
    setProblem(initial?.problem ?? "");
    setKeywords((initial?.keywords ?? []).join(", "));
    setBody(initial?.body ?? "");
    setTags((initial?.tags ?? []).join(", "));
    setPublished(initial?.published ?? true);
    setPreview(false);
  };

  const setOpen = (next: boolean) => {
    if (pending) return;
    if (next) reset();
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const submit = () =>
    startTransition(async () => {
      const result = await saveArticleAction({
        id: initial?.id,
        title,
        productId: productId || undefined,
        module: moduleName || undefined,
        category: category || undefined,
        problem: problem || undefined,
        keywords: splitList(keywords),
        body,
        tags: splitList(tags),
        published,
        sourceTicketId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Artigo atualizado" : "Artigo criado na base de conhecimento");
      setUncontrolledOpen(false);
      onOpenChange?.(false);
      if (editing) router.refresh();
      else router.push(`/suporte/base-de-conhecimento/${result.data.id}`);
    });

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger ? <DrawerTrigger asChild>{trigger}</DrawerTrigger> : null}
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{editing ? "Editar artigo" : sourceTicketId ? "Novo artigo a partir do chamado" : "Novo artigo"}</DrawerTitle>
          <DrawerDescription>Organize por produto, módulo e categoria; descreva o problema como o cliente relata e liste as palavras-chave de busca.</DrawerDescription>
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
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Produto" htmlFor={`${id}-product`}>
                <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Geral" options={products.map((p) => ({ value: p.id, label: p.name }))} />
              </FormField>
              <FormField label="Módulo" htmlFor={`${id}-module`}>
                <Input id={`${id}-module`} list={`${id}-modules`} value={moduleName} onChange={(e) => setModuleName(e.target.value)} maxLength={60} placeholder="Ex.: PDV" />
                <datalist id={`${id}-modules`}>
                  {modules.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
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
            <FormField label="Problema" htmlFor={`${id}-problem`} hint="Como o cliente descreve o sintoma. Pesa mais na busca e nas sugestões do chamado.">
              <Textarea id={`${id}-problem`} value={problem} onChange={(e) => setProblem(e.target.value)} className="min-h-[64px]" maxLength={1000} placeholder="Ex.: TEF não comunica com o ERP depois de reiniciar o computador" />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Palavras-chave" htmlFor={`${id}-keywords`} hint="Separadas por vírgula (ex.: tef, sitef, pinpad)">
                <Input id={`${id}-keywords`} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </FormField>
              <FormField label="Tags" htmlFor={`${id}-tags`} hint="Separadas por vírgula">
                <Input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} />
              </FormField>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">
                Solução / conteúdo <span className="text-danger">*</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
                <Eye /> {preview ? "Editar" : "Pré-visualizar"}
              </Button>
            </div>
            {preview ? (
              <div className="min-h-[240px] rounded-lg border border-border p-4">{body.trim() ? <Markdown source={body} /> : <p className="text-sm text-muted">Nada para mostrar.</p>}</div>
            ) : (
              <Textarea aria-label="Conteúdo do artigo" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[240px] font-mono text-[13px]" required minLength={20} />
            )}
            <p className="-mt-2 text-xs text-muted">Use # para títulos, - para listas, **negrito** e [texto](https://link).</p>
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
