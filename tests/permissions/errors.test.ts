/**
 * failAction (A5): só mensagens de negócio chegam ao usuário; erros do Firestore (gRPC), de rede/sistema e defeitos de
 * programa viram a mensagem padrão e ficam no log.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AuthenticationError, BusinessError, PermissionError, failAction } from "@/server/auth/errors";

const FALLBACK = "Não foi possível salvar";

/** Erro como o @google-cloud/firestore entrega (GoogleError com code numérico e details). */
function grpcError(message: string, code = 5): Error {
  return Object.assign(new Error(message), { code, details: message.replace(/^\d+ [A-Z_]+: /, "") });
}

describe("failAction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("mensagens de negócio e erros de autorização passam", () => {
    expect(failAction(new Error("Esta etapa já foi concluída"), FALLBACK)).toEqual({ ok: false, error: "Esta etapa já foi concluída" });
    expect(failAction(new PermissionError(), FALLBACK).error).toMatch(/Acesso negado/);
    expect(failAction(new AuthenticationError(), FALLBACK).error).toMatch(/sessão expirou/);
    expect(failAction(new BusinessError("Título não encontrado"), FALLBACK).error).toBe("Título não encontrado");
    const parsed = z.object({ nome: z.string({ message: "Informe o nome" }) }).safeParse({});
    expect(failAction(parsed.error, FALLBACK).error).toBe("Informe o nome");
  });

  it("erros gRPC do Firestore não vazam projeto, coleção nem id", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const production = "5 NOT_FOUND: No document to update: projects/interos-crm/databases/(default)/documents/payables/abc123";
    const emulator = '5 NOT_FOUND: no entity to update: app: "dev~demo-interos"\npath < Element { type: "tmp" name: "nao-existe" } >';
    expect(failAction(grpcError(production), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(grpcError(emulator), FALLBACK).error).toBe(FALLBACK);
    // Mesmo sem os campos code/details, o prefixo gRPC basta.
    expect(failAction(new Error("10 ABORTED: Too much contention on these documents."), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(new Error("9 FAILED_PRECONDITION: The query requires an index."), FALLBACK).error).toBe(FALLBACK);
  });

  it("erros de rede/sistema e defeitos de programa viram a mensagem padrão", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(failAction(new Error("getaddrinfo ENOTFOUND api.asaas.com"), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED", syscall: "connect" }), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(new Error("request to https://api.exemplo.com/v3/payments failed"), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(new TypeError("Cannot read properties of undefined (reading 'x')"), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(new RangeError("Invalid time value"), FALLBACK).error).toBe(FALLBACK);
    expect(failAction(Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" }), FALLBACK).error).toBe(FALLBACK);
    expect(failAction("texto solto", FALLBACK).error).toBe(FALLBACK);
    expect(failAction(new Error(""), FALLBACK).error).toBe(FALLBACK);
  });

  it("redirect/notFound do Next são relançados", () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    expect(() => failAction(redirectError, FALLBACK)).toThrow("NEXT_REDIRECT");
  });
});
