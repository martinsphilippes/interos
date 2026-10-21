/**
 * Regras puras da parte 2 da Central: expediente (mensagem «fora do horário»), menu de boas-vindas, variáveis de
 * mensagem (modelos do WhatsApp e respostas rápidas).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS_HOURS, isBusinessOpen, nextOpeningLabel } from "@/domain/business-hours";
import { menuText, pickMenuOption, type MenuOption } from "@/domain/conversations";
import { fillPlaceholders, fillTemplate, placeholderCount, placeholdersValid, templateNameOf, templateParams, variablesFor } from "@/domain/message-variables";

/** Horário de Brasília (UTC-3) → Date. */
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe("expediente", () => {
  it("aberto de segunda a sexta, das 8h às 18h (fuso de Brasília)", () => {
    expect(isBusinessOpen(brt("2026-10-21T08:00:00"))).toBe(true); // quarta
    expect(isBusinessOpen(brt("2026-10-21T17:59:00"))).toBe(true);
    expect(isBusinessOpen(brt("2026-10-21T18:00:00"))).toBe(false);
    expect(isBusinessOpen(brt("2026-10-21T07:59:00"))).toBe(false);
    expect(isBusinessOpen(brt("2026-10-24T10:00:00"))).toBe(false); // sábado
  });

  it("feriado fecha o dia", () => {
    expect(isBusinessOpen(brt("2026-11-02T10:00:00"), DEFAULT_BUSINESS_HOURS, new Set(["2026-11-02"]))).toBe(false);
  });

  it("próxima abertura em texto", () => {
    expect(nextOpeningLabel(brt("2026-10-21T06:30:00"))).toBe("hoje às 8h");
    expect(nextOpeningLabel(brt("2026-10-21T19:00:00"))).toBe("amanhã às 8h");
    expect(nextOpeningLabel(brt("2026-10-23T19:00:00"))).toBe("segunda às 8h"); // sexta à noite
    expect(nextOpeningLabel(brt("2026-10-30T19:00:00"), DEFAULT_BUSINESS_HOURS, new Set(["2026-11-02"]))).toBe("terça às 8h");
  });

  it("perto da meia-noite usa o dia de Brasília, não o de UTC", () => {
    // 22h de sexta em Brasília = 01h de sábado em UTC: a próxima abertura continua sendo segunda.
    expect(nextOpeningLabel(brt("2026-10-23T22:00:00"))).toBe("segunda às 8h");
    expect(isBusinessOpen(brt("2026-10-23T22:00:00"))).toBe(false);
  });
});

describe("menu de boas-vindas", () => {
  const options: MenuOption[] = [
    { tecla: "1", rotulo: "Suporte", filaId: "fila_suporte_n1" },
    { tecla: "2", rotulo: "Financeiro", filaId: "fila_financeiro" },
    { tecla: "3", rotulo: "Comprar ou renovar", filaId: "fila_comercial" },
  ];

  it("texto com as opções numeradas", () => {
    expect(menuText({ texto: "Olá! Responda com o número: ", opcoes: options })).toBe("Olá! Responda com o número:\n1 · Suporte\n2 · Financeiro\n3 · Comprar ou renovar");
  });

  it("entende o número no começo da resposta", () => {
    for (const body of ["2", " 2 ", "2.", "2 - financeiro", "opção 2", "Opcao 2", "nº 2", "#2"]) expect(pickMenuOption(body, options)?.filaId, body).toBe("fila_financeiro");
  });

  it("entende o nome exato da opção", () => {
    expect(pickMenuOption("suporte", options)?.filaId).toBe("fila_suporte_n1");
  });

  it("texto livre não vira opção", () => {
    expect(pickMenuOption("tenho 3 boletos atrasados", options)).toBeUndefined();
    expect(pickMenuOption("2026 é o ano", options)).toBeUndefined();
    expect(pickMenuOption("12", options)).toBeUndefined();
    expect(pickMenuOption("bom dia", options)).toBeUndefined();
  });
});

describe("variáveis de mensagem", () => {
  it("conta e valida os {{n}} do modelo", () => {
    expect(placeholderCount("Olá {{1}}, aqui é {{2}}")).toBe(2);
    expect(placeholderCount("Sem variáveis")).toBe(0);
    expect(placeholdersValid("{{1}} e {{2}}")).toBe(true);
    expect(placeholdersValid("{{1}} e {{3}}")).toBe(false);
  });

  it("parâmetros na ordem dos {{n}}; o que faltar é apontado", () => {
    expect(templateParams(["contato", "operador"], { contato: "Joana", operador: "Karem" })).toEqual({ params: ["Joana", "Karem"], missing: [] });
    expect(templateParams(["contato", "linkBoleto"], { contato: "Joana", linkBoleto: "  " })).toEqual({ params: ["Joana", ""], missing: ["linkBoleto"] });
    expect(fillTemplate("Olá {{1}}, aqui é {{2}}.", ["Joana", "Karem"])).toBe("Olá Joana, aqui é Karem.");
  });

  it("resposta rápida: preenche {chave} e bloqueia o que não tem valor", () => {
    expect(fillPlaceholders("Oi {contato}! Sou {operador}.", { contato: "Joana", operador: "Karem" })).toEqual({ text: "Oi Joana! Sou Karem.", missing: [] });
    const r = fillPlaceholders("Oi {contato}, {contato}! Atendimento {atendimento}.", { atendimento: "AT-1" });
    expect(r.missing).toEqual(["contato"]);
    expect(r.text).toContain("{contato}");
    // Chave que não é variável fica como está (ex.: texto entre chaves do próprio operador).
    expect(fillPlaceholders("Use {codigo}", {})).toEqual({ text: "Use {codigo}", missing: [] });
  });

  it("variáveis por contexto: cobrança não oferece operador; conversa não oferece boleto", () => {
    expect(variablesFor("cobranca")).toContain("linkBoleto");
    expect(variablesFor("cobranca")).not.toContain("operador");
    expect(variablesFor("conversa")).toContain("operador");
    expect(variablesFor("conversa")).not.toContain("valor");
  });

  it("nome técnico aceito pela Meta", () => {
    expect(templateNameOf("Retomar Atendimento — 2ª via!")).toBe("retomar_atendimento_2_via");
  });
});
