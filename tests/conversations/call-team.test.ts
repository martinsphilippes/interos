/**
 * Ligar a partir da conversa: números conhecidos (sem repetir, com DDD) e como a ligação aparece na conversa.
 */
import { describe, expect, it } from "vitest";
import { callNumbers, callThreadText } from "@/domain/conversation-call";

describe("ligar da conversa", () => {
  it("junta os números das fontes, sem repetir (com ou sem 55/9) e sem número curto", () => {
    expect(
      callNumbers([
        { label: "WhatsApp desta conversa", numbers: ["5588998112040"] },
        { label: "Maria", numbers: ["(88) 99811-2040", "88 3521-0000", "123"] },
        { label: "Cliente", numbers: [undefined, null, "+55 85 98888-7777"] },
      ]),
    ).toEqual([
      { label: "WhatsApp desta conversa", number: "88998112040" },
      { label: "Maria", number: "8835210000" },
      { label: "Cliente", number: "85988887777" },
    ]);
  });
  it("na conversa: para quem, por quem, resultado, duração e anotação", () => {
    expect(callThreadText({ direction: "saida", number: "88998112040", status: "atendida", durationSeconds: 192, manual: false, authorName: "Ana" })).toEqual({
      title: "Ligação para (88) 99811-2040",
      description: "por Ana · atendida · 3 min 12 s",
    });
    expect(callThreadText({ direction: "saida", number: "88998112040", status: "sem_resposta", manual: true, authorName: "você", note: "Retornar amanhã" })).toEqual({
      title: "Ligação para (88) 99811-2040",
      description: "por você · não atendeu · pelo aparelho (registro manual) · Retornar amanhã",
    });
    expect(callThreadText({ direction: "saida", status: "em_andamento", manual: false }).description).toBe("em andamento");
  });
});
