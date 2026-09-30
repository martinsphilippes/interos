/**
 * Módulos da empresa (A8): `inactiveModules` (os desligados) tem prioridade sobre `activeModules` (forma antiga), para
 * que um módulo novo do catálogo nasça ligado numa empresa que já desligou algum.
 */
import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/domain/permissions";
import { activeModulesOfOrganization, resolvePermissions } from "@/server/auth/permissions";
import { SEED_USERS } from "./fixtures";

const vinicius = SEED_USERS.find((u) => u.id === "user_vinicius")!;

describe("activeModulesOfOrganization", () => {
  it("sem organização ou sem os campos = todos ativos (undefined)", () => {
    expect(activeModulesOfOrganization(null)).toBeUndefined();
    expect(activeModulesOfOrganization({})).toBeUndefined();
  });

  it("inactiveModules vence activeModules e deixa ligado o que não está na lista de desligados", () => {
    // activeModules antigo sem "vendas" (como se vendas fosse um módulo novo): com inactiveModules, vendas fica ligado.
    const org = { activeModules: MODULE_KEYS.filter((m) => m !== "vendas" && m !== "marketing"), inactiveModules: ["marketing"] };
    const active = activeModulesOfOrganization(org)!;
    expect(active).toContain("vendas");
    expect(active).not.toContain("marketing");
    expect(active.length).toBe(MODULE_KEYS.length - 1);
  });

  it("inactiveModules vazio = todos ativos", () => {
    expect(activeModulesOfOrganization({ activeModules: ["vendas"], inactiveModules: [] })).toEqual([...MODULE_KEYS]);
  });

  it("só activeModules (forma antiga) continua valendo e ignora chaves desconhecidas", () => {
    expect(activeModulesOfOrganization({ activeModules: ["vendas", "modulo-fantasma"] })).toEqual(["vendas"]);
  });

  it("o núcleo nega o módulo desligado via inactiveModules", () => {
    const perms = resolvePermissions(vinicius, { organization: { activeModules: activeModulesOfOrganization({ inactiveModules: ["vendas"] }) } });
    expect(perms.has("vendas.acessar")).toBe(false);
    expect(perms.has("inicio.meu-dia.ver")).toBe(true);
  });
});
