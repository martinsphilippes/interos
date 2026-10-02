/**
 * Cookie de sessão do INTEROS (substitui o session cookie do Firebase): assinatura HMAC, validade e recusa de
 * adulteração. A revogação por users.sessionsRevokedAt é conferida em getCurrentUser.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/db", () => ({ getById: vi.fn() }));
vi.mock("@/server/auth/permission-store", () => ({ loadAccessDocs: vi.fn(), permissionsForUser: vi.fn(), resolvePermissionsForUser: vi.fn() }));

const { decodeSession, encodeSession } = await import("@/server/auth/session");

describe("cookie de sessão", () => {
  it("decodifica o que foi emitido", () => {
    const now = Date.UTC(2026, 9, 1, 12);
    const payload = decodeSession(encodeSession("user_igor", now), now + 1000);
    expect(payload?.uid).toBe("user_igor");
    expect(payload?.iat).toBe(Math.floor(now / 1000));
  });

  it("expira em 14 dias", () => {
    const now = Date.UTC(2026, 9, 1, 12);
    const token = encodeSession("user_igor", now);
    expect(decodeSession(token, now + 13 * 86_400_000)).not.toBeNull();
    expect(decodeSession(token, now + 14 * 86_400_000 + 1000)).toBeNull();
  });

  it("recusa payload adulterado, assinatura trocada e formato inválido", () => {
    const token = encodeSession("user_vendas");
    const [, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "user_admin", iat: Math.floor(Date.now() / 1000), exp: 9_999_999_999 })).toString("base64url");
    expect(decodeSession(`${forged}.${mac}`)).toBeNull();
    expect(decodeSession(`${token}x`)).toBeNull();
    expect(decodeSession("abc")).toBeNull();
    expect(decodeSession(`${token}.extra`)).toBeNull();
  });
});
