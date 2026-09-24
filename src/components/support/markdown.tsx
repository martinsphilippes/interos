import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Renderizador mínimo de markdown para a base de conhecimento, sem dependências e sem HTML cru:
 * títulos (#, ##, ###), listas (- / * / 1.), parágrafos, **negrito**, *itálico*, `código` e
 * [links](https://...). Links só com http(s), mailto ou caminho interno (/...).
 */

type Block = { type: "h1" | "h2" | "h3" | "p"; text: string } | { type: "ul" | "ol"; items: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: (["h1", "h2", "h3"] as const)[heading[1].length - 1], text: heading[2] });
    } else if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

function safeHref(url: string): string | null {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || (url.startsWith("/") && !url.startsWith("//"))) return url;
  return null;
}

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*[^*\s][^*]*\*)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  text.split("\n").forEach((line, lineIndex) => {
    if (lineIndex > 0) out.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
    line.split(INLINE).forEach((part, i) => {
      if (!part) return;
      const key = `${keyPrefix}-${lineIndex}-${i}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) out.push(<strong key={key}>{part.slice(2, -2)}</strong>);
      else if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
        out.push(
          <code key={key} className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.9em]">
            {part.slice(1, -1)}
          </code>,
        );
      else if (/^\[[^\]]+\]\([^)\s]+\)$/.test(part)) {
        const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)!;
        const href = safeHref(url);
        out.push(
          href ? (
            <a key={key} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel={href.startsWith("/") ? undefined : "noreferrer"} className="font-medium text-secondary-fg underline underline-offset-2 hover:text-secondary">
              {label}
            </a>
          ) : (
            <span key={key}>{label}</span>
          ),
        );
      } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) out.push(<em key={key}>{part.slice(1, -1)}</em>);
      else out.push(<React.Fragment key={key}>{part}</React.Fragment>);
    });
  });
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={cn("flex flex-col gap-3 text-[15px] leading-relaxed text-foreground", className)}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case "h1":
            return (
              <h2 key={key} className="mt-2 text-xl font-semibold tracking-tight">
                {renderInline(b.text, key)}
              </h2>
            );
          case "h2":
            return (
              <h3 key={key} className="mt-2 text-lg font-semibold tracking-tight">
                {renderInline(b.text, key)}
              </h3>
            );
          case "h3":
            return (
              <h4 key={key} className="mt-1 text-base font-semibold">
                {renderInline(b.text, key)}
              </h4>
            );
          case "ul":
          case "ol": {
            const List = b.type === "ul" ? "ul" : "ol";
            return (
              <List key={key} className={cn("flex flex-col gap-1 pl-6", b.type === "ul" ? "list-disc" : "list-decimal")}>
                {b.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </List>
            );
          }
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}
