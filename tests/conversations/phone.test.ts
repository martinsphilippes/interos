/**
 * Identidade de telefone/e-mail (src/domain/phone.ts): o mesmo contato é reconhecido com ou sem DDI, com ou sem o 9
 * extra do celular (o WhatsApp entrega muitos números brasileiros sem ele), e nunca por números curtos demais.
 */
import { describe, expect, it } from "vitest";
import { contactKeyOf, displayPhone, emailIdentity, maskEmail, maskPhone, phoneIdentity, samePhoneNumber, withNinthDigit } from "@/domain/phone";

describe("phoneIdentity", () => {
  it("une celular com e sem o 9, com e sem DDI e com máscara", () => {
    const key = phoneIdentity("(88) 9 9811-2040");
    expect(key).toBe("8898112040");
    expect(phoneIdentity("+55 88 99811-2040")).toBe(key);
    expect(phoneIdentity("558898112040")).toBe(key); // como o WhatsApp entrega (sem o 9)
    expect(phoneIdentity("5588998112040")).toBe(key);
    expect(phoneIdentity("088 99811-2040")).toBe(key); // zero de discagem
  });

  it("fixo fica como está (DDD + 8 dígitos)", () => {
    expect(phoneIdentity("(88) 3570-0000")).toBe("8835700000");
  });

  it("sem DDD: só os 8 últimos; curto demais: vazio", () => {
    expect(phoneIdentity("99811-2040")).toBe("98112040");
    expect(phoneIdentity("1234567")).toBe("");
    expect(phoneIdentity(undefined)).toBe("");
  });
});

describe("samePhoneNumber", () => {
  it("reconhece o mesmo número em formatos diferentes", () => {
    expect(samePhoneNumber("558898112040", "(88) 99811-2040")).toBe(true);
    expect(samePhoneNumber("88 9811-2040", "+55 (88) 9 9811-2040")).toBe(true);
  });

  it("DDD diferente é outro número", () => {
    expect(samePhoneNumber("(85) 99811-2040", "(88) 99811-2040")).toBe(false);
  });

  it("um lado sem DDD compara os 8 últimos dígitos", () => {
    expect(samePhoneNumber("99811-2040", "(88) 99811-2040")).toBe(true);
  });

  it("vazio nunca é igual", () => {
    expect(samePhoneNumber("", "")).toBe(false);
    expect(samePhoneNumber(undefined, "(88) 99811-2040")).toBe(false);
  });
});

describe("e-mail e chave da conversa", () => {
  it("e-mail minúsculo, sem espaços; inválido = vazio", () => {
    expect(emailIdentity("  Joana@BomPreco.com ")).toBe("joana@bompreco.com");
    expect(emailIdentity("joana@")).toBe("");
  });

  it("chave por canal", () => {
    expect(contactKeyOf("whatsapp", "558898112040")).toBe("p:8898112040");
    expect(contactKeyOf("email", "Joana@BomPreco.com")).toBe("e:joana@bompreco.com");
    expect(contactKeyOf("whatsapp", "123")).toBe("");
  });

  it("mascara sem expor o número nem o e-mail inteiro", () => {
    expect(maskPhone("5588998112040")).toBe("(88) •••••-2040");
    expect(maskEmail("joana@bompreco.com")).toBe("jo•••@bompreco.com");
  });
});

describe("exibição e o 9 do celular", () => {
  it("exibe nacional com máscara", () => {
    expect(displayPhone("5588998112040")).toBe("(88) 99811-2040");
    expect(displayPhone("558835700000")).toBe("(88) 3570-0000");
  });

  it("acrescenta o 9 só em celular de 10 dígitos (como o WhatsApp entrega)", () => {
    expect(withNinthDigit("558898112040")).toBe("(88) 99811-2040");
    expect(withNinthDigit("5588998112040")).toBe("(88) 99811-2040");
    expect(withNinthDigit("558835700000")).toBe("(88) 3570-0000"); // fixo
  });
});
