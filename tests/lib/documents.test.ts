/** CPF: dígitos verificadores, com ou sem máscara. */
import { describe, expect, it } from "vitest";
import { isValidCpf } from "@/domain/documents";

describe("isValidCpf", () => {
  it("aceita CPF válido com ou sem máscara e recusa dígito errado, repetido ou tamanho errado", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("1234567890")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
});
