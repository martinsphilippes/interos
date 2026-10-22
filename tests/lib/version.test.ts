/** Troca de versão: só o erro de Server Action de outro deploy vira "recarregar"; o resto continua "Algo deu errado". */
import { describe, expect, it } from "vitest";
import { isNewVersionError } from "@/lib/version";

describe("isNewVersionError", () => {
  it("reconhece o UnrecognizedActionError do Next pelo nome ou pela mensagem", () => {
    const byName = Object.assign(new Error("qualquer"), { name: "UnrecognizedActionError" });
    expect(isNewVersionError(byName)).toBe(true);
    expect(isNewVersionError(new Error('Server Action "40b7862d5b" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'))).toBe(true);
    expect(isNewVersionError(new Error("Failed to find Server Action. This request might be from an older or newer deployment."))).toBe(true);
  });

  it("não confunde com outros erros", () => {
    expect(isNewVersionError(new Error("Contato não encontrado neste cliente"))).toBe(false);
    expect(isNewVersionError(Object.assign(new Error("x"), { digest: "123" }))).toBe(false);
    expect(isNewVersionError(null)).toBe(false);
    expect(isNewVersionError("Server Action was not found")).toBe(false);
  });
});
