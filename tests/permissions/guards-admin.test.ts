/**
 * Guardas do módulo Administração (trilho A): páginas de src/app/(app)/admin/**, actions de admin/automations/
 * process-engine com a chave do catálogo, A12 (Configurações Financeiras: cada configuração tem seção de
 * visualização e chave de edição; as abas aparecem pelas seções) e escopo da tela Usuários.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NODE_BY_KEY, SETTING_PERMISSION } from "@/domain/permissions";
import { SETTING_KEYS } from "@/server/admin/schemas";
import { computeDataScope, filterByScope } from "@/server/auth/scope";
import { SETTINGS_TABS, visibleSettingsTabs, type SettingsAccess } from "@/components/admin/admin-model";
import { analyzeAccess } from "../../scripts/check-access/analyze";
import { SEED_DEPARTMENTS, SEED_USERS } from "./fixtures";

const SCOPE = /src\/app\/\(app\)\/admin\/|src\/server\/(admin|automations|process-engine)\//;

describe("cobertura do módulo admin (check:access)", () => {
  const report = analyzeAccess(path.resolve(__dirname, "../.."));

  it("zero pendências nas páginas e actions do trilho A", () => {
    const mine = report.findings.filter((f) => SCOPE.test(f.target));
    expect(mine).toEqual([]);
  });

  it("perfis/exceções/módulos deixaram de ser futureGuards", () => {
    expect(report.totals.futurePending).toEqual([]);
  });
});

describe("A12 — Configurações (gerais e financeiras)", () => {
  it("toda configuração gravável tem chave de edição com a seção de visualização correspondente no catálogo", () => {
    for (const key of SETTING_KEYS) {
      const edit = SETTING_PERMISSION[key];
      expect(edit, key).toBeDefined();
      expect(NODE_BY_KEY.get(edit)?.kind, edit).toBe("acao");
      expect(NODE_BY_KEY.has(edit.replace(/\.editar$/, ".ver")), `${edit} → .ver`).toBe(true);
    }
  });

  it("perfil só com as seções financeiras vê só as abas financeiras", () => {
    const access: SettingsAccess = {
      visible: ["gate_financeiro", "financeiro_alertas", "regua_cobranca", "contas_a_pagar"],
      editable: ["gate_financeiro"],
      saudeIndice: { visible: false, operationHealthEditable: false, performanceIndexEditable: false },
      sla: { visible: false, edit: false, delete: false },
    };
    expect(visibleSettingsTabs(access)).toEqual(["gate-financeiro", "cobranca", "contas-a-pagar"]);
  });

  it("perfil com tudo vê todas as abas (comportamento anterior do admin)", () => {
    const access: SettingsAccess = {
      visible: [...SETTING_KEYS],
      editable: [...SETTING_KEYS],
      saudeIndice: { visible: true, operationHealthEditable: true, performanceIndexEditable: true },
      sla: { visible: true, edit: true, delete: true },
    };
    expect(visibleSettingsTabs(access)).toEqual([...SETTINGS_TABS]);
  });
});

describe("escopo da tela Usuários (admin.usuarios)", () => {
  const org = { users: SEED_USERS.map((u) => ({ id: u.id, departmentId: u.departmentId, managerId: u.managerId, active: true })), departments: SEED_DEPARTMENTS };
  const rows = SEED_USERS.map((u) => ({ id: u.id, managerId: u.managerId, departmentId: u.departmentId }));
  const ownerOf = (u: (typeof rows)[number]) => ({ owners: [u.id, u.managerId], departmentId: u.departmentId });
  const karem = SEED_USERS.find((u) => u.id === "user_karem")!;

  it("padrão (empresa) não recorta: gestor, diretoria e admin veem todos, como antes", () => {
    const scope = computeDataScope(karem, "admin.usuarios", "empresa", org);
    expect(filterByScope(rows, ownerOf, scope)).toHaveLength(rows.length);
  });

  it("restrito a 'meus' pelo CEO/CTO: a gestora vê a si e aos liderados diretos", () => {
    const scope = computeDataScope(karem, "admin.usuarios", "meus", org);
    const ids = filterByScope(rows, ownerOf, scope).map((u) => u.id).sort();
    expect(ids).toEqual(["user_anapaula", "user_karem"]);
  });
});
