/**
 * Assinatura eletrônica (Financeiro › Assinaturas): abas novas depois do T0, com regra própria.
 * - Caixa de entrada e Modelos (ver e operar): quem opera o Financeiro (gestão, papel ou departamento financeiro).
 * - Configuração: ver = quem opera o Financeiro; alterar quem assina pela Intercert = só gestão (gestor, diretoria, admin).
 */
import { describe, expect, it } from "vitest";
import type { RoleKey } from "@/domain/constants";
import { can } from "@/server/auth/permissions";
import { ALL_USERS, asCurrentUser } from "./fixtures";
import { legacyCanAccessModule, legacyCanOperateFinance, legacyUser } from "./legacy";

const MANAGERS: RoleKey[] = ["admin", "diretoria", "gestor"];

describe("Assinaturas — abas da assinatura eletrônica", () => {
  it("caixa de entrada, modelos e configuração: quem opera o Financeiro; alterar a configuração: só gestão", () => {
    for (const u of ALL_USERS) {
      const current = asCurrentUser(u);
      const lu = legacyUser(u);
      const inModule = legacyCanAccessModule(lu, "financeiro");
      const operates = inModule && (MANAGERS.includes(u.role) || u.role === "financeiro" || u.departmentId === "financeiro");
      for (const k of ["financeiro.assinaturas.entrada.ver", "financeiro.assinaturas.modelos.ver", "financeiro.assinaturas.configuracao.ver", "financeiro.assinaturas.entrada.vincular", "financeiro.assinaturas.modelos.editar"] as const) {
        expect(can(current, k), `${u.id} (${u.role}/${u.departmentId}) ${k}`).toBe(operates);
      }
      expect(can(current, "financeiro.assinaturas.configuracao.editar"), `${u.id}`).toBe(inModule && MANAGERS.includes(u.role));
      // Mesma regra de quem opera o Financeiro hoje (antes: canOperateFinance).
      expect(operates, `${u.id}`).toBe(inModule && legacyCanOperateFinance(lu));
    }
  });
});
