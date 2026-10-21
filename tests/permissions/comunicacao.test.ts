/**
 * Módulo Comunicação (Central de Atendimento) — regras padrão APROVADAS (tela «Permissões da Central»). É módulo novo:
 * não há comportamento anterior (por isso fica fora do T0 em equivalence.test.ts) e as regras são provadas aqui.
 */
import { describe, expect, it } from "vitest";
import { MODULE_ACCESS, type RoleKey } from "@/domain/constants";
import { can } from "@/server/auth/permissions";
import { defaultScopeKind } from "@/server/auth/scope";
import { ALL_USERS, asCurrentUser } from "./fixtures";

const ATENDEM: RoleKey[] = ["admin", "diretoria", "gestor", "suporte", "vendas", "financeiro", "marketing", "cs", "implantacao"];
const MANAGERS: RoleKey[] = ["admin", "diretoria", "gestor"];
const USERS = ALL_USERS.map((u) => ({ u, current: asCurrentUser(u) }));

describe("Comunicação — acesso ao módulo e à Central", () => {
  it("quem atende cliente ou lead entra (colaborador não)", () => {
    for (const { u, current } of USERS) {
      const expected = ATENDEM.includes(u.role);
      expect(can(current, "comunicacao.acessar"), `${u.id} (${u.role})`).toBe(expected);
      expect(can(current, "comunicacao.central.ver"), `${u.id}`).toBe(expected);
      for (const k of ["comunicacao.central.atender", "comunicacao.central.iniciar", "comunicacao.central.transferir", "comunicacao.central.encerrar", "comunicacao.central.identificar"] as const) {
        expect(can(current, k), `${u.id} ${k}`).toBe(expected);
      }
    }
    expect([...(MODULE_ACCESS.comunicacao as readonly RoleKey[]), "admin"].sort()).toEqual([...ATENDEM].sort());
  });

  it("atribuir a outro operador e Canais e filas: só gestor, diretoria e admin", () => {
    for (const { u, current } of USERS) {
      const manager = MANAGERS.includes(u.role);
      expect(can(current, "comunicacao.central.distribuir"), `${u.id}`).toBe(manager);
      expect(can(current, "comunicacao.canais.ver"), `${u.id}`).toBe(manager);
      expect(can(current, "comunicacao.canais.filas.editar"), `${u.id}`).toBe(manager);
    }
  });

  it("escopo: operador vê o que é seu (e a fila); gestão vê a empresa", () => {
    for (const { u } of USERS) {
      const kind = defaultScopeKind({ id: u.id, role: u.role, departmentId: u.departmentId }, "comunicacao.central");
      expect(kind, `${u.id} (${u.role})`).toBe(MANAGERS.includes(u.role) ? "empresa" : "meus");
    }
  });
});
