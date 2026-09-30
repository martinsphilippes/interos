/**
 * Precedência da resolução (A4): exceção > perfil > padrão; módulo inativo vence tudo; tela negada nega seção e
 * ação concedidas; `can` acompanha ajustes; escopo sempre dentro do permitido; origem de cada decisão.
 */
import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type PermissionKey } from "@/domain/permissions";
import { can, canSeeHref, clampScope, defaultPermissionsFor, resolvePermissions } from "@/server/auth/permissions";
import { visibleNavigation } from "@/server/auth/navigation";
import { checkAccessInvariants, hasAccessAdministrator, withRoleProfile, withUser, withUserOverride, withoutUser, type AccessState } from "@/server/auth/invariants";
import { asCurrentUser, SEED_DEPARTMENTS, SEED_USERS } from "./fixtures";

const vinicius = SEED_USERS.find((u) => u.id === "user_vinicius")!; // vendas/vendas
const anapaula = SEED_USERS.find((u) => u.id === "user_anapaula")!; // financeiro/financeiro
const hercules = SEED_USERS.find((u) => u.id === "user_hercules")!; // admin/diretoria

describe("precedência de valores (A4.3)", () => {
  it("perfil vence a regra padrão (conceder e negar)", () => {
    const base = resolvePermissions(vinicius);
    expect(base.has("financeiro.contas-a-pagar.ver")).toBe(false);
    const granted = resolvePermissions(vinicius, { roleProfile: { grants: { "financeiro.contas-a-pagar.ver": true } } });
    expect(granted.has("financeiro.contas-a-pagar.ver")).toBe(true);
    expect(granted.origin["financeiro.contas-a-pagar.ver"]).toBe("perfil");
    const denied = resolvePermissions(vinicius, { roleProfile: { grants: { "vendas.propostas.ver": false } } });
    expect(denied.has("vendas.propostas.ver")).toBe(false);
    expect(denied.origin["vendas.propostas.ver"]).toBe("perfil");
  });

  it("exceção individual vence o perfil", () => {
    const perms = resolvePermissions(vinicius, {
      roleProfile: { grants: { "vendas.propostas.ver": false, "financeiro.contas-a-pagar.ver": true } },
      userOverride: { grants: { "vendas.propostas.ver": true, "financeiro.contas-a-pagar.ver": false } },
    });
    expect(perms.has("vendas.propostas.ver")).toBe(true);
    expect(perms.origin["vendas.propostas.ver"]).toBe("excecao");
    expect(perms.has("financeiro.contas-a-pagar.ver")).toBe(false);
    expect(perms.origin["financeiro.contas-a-pagar.ver"]).toBe("excecao");
  });

  it("chave ausente no ajuste = valor do nível mais geral; chave desconhecida é ignorada", () => {
    const perms = resolvePermissions(vinicius, { roleProfile: { grants: { "nao.existe.ver": true } }, userOverride: { grants: {} } });
    expect(perms.has("vendas.acessar")).toBe(true);
    expect(perms.origin["vendas.acessar"]).toBe("padrao");
    expect([...perms.keys]).toEqual([...defaultPermissionsFor(vinicius.role, vinicius.departmentId).keys]);
  });
});

describe("hierarquia (A4.2)", () => {
  it("tela negada nega seção e ação concedidas (origem 'hierarquia'); conceder ação não abre a tela", () => {
    const perms = resolvePermissions(anapaula, {
      roleProfile: { grants: { "financeiro.cobrancas.ver": false } },
      userOverride: { grants: { "financeiro.cobrancas.baixar": true } },
    });
    expect(perms.has("financeiro.cobrancas.ver")).toBe(false);
    expect(perms.has("financeiro.cobrancas.baixar")).toBe(false);
    expect(perms.origin["financeiro.cobrancas.baixar"]).toBe("hierarquia");
    expect(perms.has("financeiro.cobrancas.boleto.criar")).toBe(false);
  });

  it("seção negada nega as ações dela", () => {
    const perms = resolvePermissions(anapaula, { roleProfile: { grants: { "financeiro.comissoes.regras.ver": false } } });
    expect(perms.has("financeiro.comissoes.regras.editar")).toBe(false);
    expect(perms.origin["financeiro.comissoes.regras.editar"]).toBe("padrao"); // anapaula já não era gestora do Financeiro
    const karem = resolvePermissions({ id: "user_karem", role: "gestor", departmentId: "financeiro" }, { roleProfile: { grants: { "financeiro.comissoes.regras.ver": false } } });
    expect(karem.has("financeiro.comissoes.regras.editar")).toBe(false);
    expect(karem.origin["financeiro.comissoes.regras.editar"]).toBe("hierarquia");
    expect(karem.has("financeiro.comissoes.estornar")).toBe(true);
  });

  it("módulo negado nega tudo abaixo; tela aberta por mais de um módulo (Comissões) exige qualquer um", () => {
    const noFin = resolvePermissions(vinicius, { roleProfile: { grants: { "financeiro.acessar": false } } });
    expect(noFin.has("financeiro.dashboard.ver")).toBe(false);
    expect(noFin.has("financeiro.comissoes.ver")).toBe(true); // abre também pelo módulo Vendas
    expect(noFin.has("financeiro.comissoes.minhas.ver")).toBe(true);
    const neither = resolvePermissions(vinicius, { roleProfile: { grants: { "financeiro.acessar": false, "vendas.acessar": false } } });
    expect(neither.has("financeiro.comissoes.ver")).toBe(false);
  });

  it("tela com moduleGate 'ativo' não exige a chave do módulo (Relatórios, Valores)", () => {
    const colaborador = resolvePermissions({ role: "colaborador", departmentId: "administrativo" });
    expect(colaborador.has("gestao.acessar")).toBe(false);
    expect(colaborador.has("gestao.relatorios.ver")).toBe(true);
    expect(colaborador.has("financeiro.valores.ver")).toBe(true);
  });

  it("regra { can } acompanha o ajuste da chave referida", () => {
    const suporte = { id: "user_rafael", role: "suporte" as const, departmentId: "suporte" as const };
    expect(resolvePermissions(suporte).has("operacao.sla.qualidade-chamados.ver")).toBe(true);
    const semSuporte = resolvePermissions(suporte, { userOverride: { grants: { "suporte.acessar": false } } });
    expect(semSuporte.has("operacao.sla.qualidade-chamados.ver")).toBe(false);
    const vendas = resolvePermissions(vinicius, { userOverride: { grants: { "suporte.acessar": true } } });
    expect(vendas.has("operacao.sla.qualidade-chamados.ver")).toBe(true);
  });
});

describe("módulos ativos (A4.1)", () => {
  it("módulo inativo vence exceção e perfil, inclusive para o admin (origem 'modulo-inativo')", () => {
    const org = { activeModules: MODULE_KEYS.filter((m) => m !== "financeiro") };
    const admin = resolvePermissions(hercules, { organization: org, userOverride: { grants: { "financeiro.dashboard.ver": true } } });
    expect(admin.has("financeiro.acessar")).toBe(false);
    expect(admin.has("financeiro.dashboard.ver")).toBe(false);
    expect(admin.origin["financeiro.dashboard.ver"]).toBe("modulo-inativo");
    expect(admin.has("financeiro.valores.ver")).toBe(false); // moduleGate: exige o módulo ATIVO
    expect(admin.has("vendas.acessar")).toBe(true);
    expect(admin.activeModules.has("financeiro")).toBe(false);
  });

  it("Comissões segue o módulo primário (Financeiro) na ativação", () => {
    const perms = resolvePermissions(vinicius, { organization: { activeModules: MODULE_KEYS.filter((m) => m !== "financeiro") } });
    expect(perms.has("financeiro.comissoes.ver")).toBe(false);
  });

  it("inicio e admin nunca são desativados; lista ausente = todos ativos; chave desconhecida ignorada", () => {
    const perms = resolvePermissions(hercules, { organization: { activeModules: ["vendas", "modulo-fantasma"] } });
    expect(perms.has("inicio.meu-dia.ver")).toBe(true);
    expect(perms.has("admin.usuarios.ver")).toBe(true);
    expect(perms.has("operacao.acessar")).toBe(false);
    expect([...perms.activeModules].sort()).toEqual(["admin", "inicio", "vendas"]);
    expect(resolvePermissions(hercules, { organization: {} }).activeModules.size).toBe(MODULE_KEYS.length);
  });

  it("módulo inativo some da navegação sem afetar os outros", () => {
    const user = asCurrentUser(anapaula, { organization: { activeModules: MODULE_KEYS.filter((m) => m !== "financeiro") } });
    expect(visibleNavigation(user).some((s) => s.key === "financeiro")).toBe(false);
    expect(visibleNavigation(user).some((s) => s.key === "operacao")).toBe(true);
    expect(canSeeHref(user, "/financeiro/cobrancas")).toBe(false);
  });
});

describe("escopo (A4.4)", () => {
  it("padrão por papel e por regra (qualquer papel do departamento financeiro vê a empresa em comissões)", () => {
    expect(resolvePermissions(vinicius).scopes["financeiro.comissoes"]).toBe("meus");
    expect(resolvePermissions({ role: "gestor", departmentId: "vendas" }).scopes["financeiro.comissoes"]).toBe("equipe");
    expect(resolvePermissions({ role: "gestor", departmentId: "financeiro" }).scopes["financeiro.comissoes"]).toBe("empresa");
    expect(resolvePermissions({ role: "cs", departmentId: "financeiro" }).scopes["financeiro.comissoes"]).toBe("empresa");
  });

  it("exceção > perfil > padrão", () => {
    const perms = resolvePermissions(vinicius, { roleProfile: { scopes: { "vendas.oportunidades": "equipe" } }, userOverride: { scopes: { "vendas.oportunidades": "empresa" } } });
    expect(perms.scopes["vendas.oportunidades"]).toBe("empresa");
    expect(resolvePermissions(vinicius, { roleProfile: { scopes: { "vendas.oportunidades": "equipe" } } }).scopes["vendas.oportunidades"]).toBe("equipe");
  });

  it("nunca fora de scope.allowed; 'unidades' vale 'empresa'; telas com sameAs leem a tela de referência", () => {
    // SLA só permite departamento/empresa: "equipe" cai para o maior permitido abaixo (nenhum) → o menor permitido.
    const sla = resolvePermissions(vinicius, { userOverride: { scopes: { "operacao.sla": "equipe" } } });
    expect(sla.scopes["operacao.sla"]).toBe("departamento");
    // Suporte não tem "departamento": pedir departamento cai para "equipe".
    const sup = resolvePermissions(vinicius, { userOverride: { scopes: { "suporte.chamados": "departamento" } } });
    expect(sup.scopes["suporte.chamados"]).toBe("equipe");
    expect(clampScope("unidades", ["meus", "empresa"])).toBe("empresa");
    expect(clampScope("empresa", ["meus", "equipe"])).toBe("equipe");
    // Notificações: escopo fixo, não configurável.
    expect(resolvePermissions(vinicius, { userOverride: { scopes: { "inicio.notificacoes": "empresa" } } }).scopes["inicio.notificacoes"]).toBe("meus");
    // Pipeline lê o escopo de Oportunidades.
    const pipe = resolvePermissions(vinicius, { userOverride: { scopes: { "vendas.oportunidades": "empresa" } } });
    expect(pipe.scopes["vendas.pipeline"]).toBe("empresa");
    // Valor inválido gravado no banco é ignorado.
    const bad = resolvePermissions(vinicius, { userOverride: { scopes: { "vendas.oportunidades": "tudo" as never } } });
    expect(bad.scopes["vendas.oportunidades"]).toBe("meus");
  });
});

describe("falha de leitura e sessão (A4.6)", () => {
  it("resolução com degraded = matriz padrão, sem perder o acesso", () => {
    const perms = resolvePermissions(anapaula, { degraded: true });
    expect(perms.degraded).toBe(true);
    expect([...perms.keys]).toEqual([...defaultPermissionsFor(anapaula.role, anapaula.departmentId).keys]);
    expect(perms.has("inicio.meu-dia.ver")).toBe(true);
  });
});

describe("can/canSeeHref com e sem permissions anexadas", () => {
  it("CurrentUser usa as permissões anexadas; objeto sem elas usa a matriz padrão do papel", () => {
    const user = asCurrentUser(vinicius, { userOverride: { grants: { "vendas.visitas.ver": false } } });
    expect(can(user, "vendas.visitas.ver")).toBe(false);
    expect(can({ role: "vendas", departmentId: "vendas" }, "vendas.visitas.ver")).toBe(true);
  });

  it("canSeeHref: detalhe por id, seção com página própria, página compartilhada e rota desconhecida", () => {
    const vend = asCurrentUser(vinicius);
    expect(canSeeHref(vend, "/vendas/propostas/prop_001?x=1")).toBe(true);
    expect(canSeeHref(vend, "/financeiro/comissoes")).toBe(true);
    expect(canSeeHref(vend, "/financeiro/comissoes/regras")).toBe(false);
    expect(canSeeHref(vend, "/admin/configuracoes")).toBe(false);
    expect(canSeeHref(vend, "/rota/inexistente")).toBe(false);
    const admin = asCurrentUser(hercules);
    expect(canSeeHref(admin, "/admin/configuracoes")).toBe(true);
    expect(canSeeHref(admin, "/admin/workflows/processos/p1/execucoes")).toBe(true);
    // Página compartilhada: quem só tem Configurações Financeiras também entra.
    const finOnly = asCurrentUser(anapaula, { userOverride: { grants: { "admin.acessar": true, "financeiro.configuracoes.ver": true } } });
    expect(canSeeHref(finOnly, "/admin/configuracoes")).toBe(true);
    expect(canSeeHref(finOnly, "/admin/produtos")).toBe(false);
  });

  it("canSeeHref com ?aba= exige a seção da aba; aba sem seção vale como a tela", () => {
    // Só Configurações Financeiras (gate): vê a aba do gate, não a de SLA nem a de cobrança.
    const finGate = asCurrentUser(anapaula, { userOverride: { grants: { "admin.acessar": true, "financeiro.configuracoes.ver": true, "financeiro.configuracoes.gate.ver": true } } });
    expect(canSeeHref(finGate, "/admin/configuracoes?aba=gate-financeiro")).toBe(true);
    expect(canSeeHref(finGate, "/admin/configuracoes?aba=sla")).toBe(false);
    expect(canSeeHref(finGate, "/admin/configuracoes?aba=cobranca")).toBe(false);
    const admin = asCurrentUser(hercules);
    expect(canSeeHref(admin, "/admin/configuracoes?aba=sla")).toBe(true);
    // Cliente 360: aba negada por exceção some; as outras continuam.
    const vend = asCurrentUser(vinicius, { userOverride: { grants: { "operacao.clientes.financeiro.ver": false } } });
    expect(canSeeHref(vend, "/clientes/c1?aba=financeiro")).toBe(false);
    expect(canSeeHref(vend, "/clientes/c1?aba=suporte#topo")).toBe(true);
    expect(canSeeHref(vend, "/clientes/c1")).toBe(true);
    // Aba que o catálogo não modela (a página ignora): decide a tela.
    expect(canSeeHref(asCurrentUser(vinicius), "/financeiro/comissoes?aba=qualquer")).toBe(true);
  });

  it("canSeeHref com percent-encoding malformado devolve false (não lança)", () => {
    const admin = asCurrentUser(hercules);
    expect(canSeeHref(admin, "/vendas/%")).toBe(false);
    expect(canSeeHref(admin, "/financeiro/contratos/%E0%A4%A")).toBe(false);
    expect(canSeeHref(admin, "/financeiro/contratos/ctr%20001")).toBe(true);
  });
});

describe("ajustes gravados com chaves perigosas", () => {
  /** Monta o mapa como o SDK do Firestore decodifica (`obj[prop] = valor`): "__proto__" vira o protótipo. */
  function decodedLikeFirestore(entries: Record<string, unknown>): Record<string, boolean> {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entries)) obj[k] = v;
    return obj as Record<string, boolean>;
  }

  it("mapa com '__proto__' não concede nada (nem por perfil, nem por exceção)", () => {
    const grants = decodedLikeFirestore({});
    (grants as Record<string, unknown>)["__proto__"] = { "admin.acessar": true, "admin.acessos.gerir": true, "admin.usuarios.editar": true };
    expect(Object.keys(grants)).toEqual([]);
    expect((grants as Record<string, boolean>)["admin.acessar"]).toBe(true); // o perigo: leitura indexada enxerga
    for (const options of [{ roleProfile: { grants } }, { userOverride: { grants } }]) {
      const perms = resolvePermissions(vinicius, options);
      expect([perms.has("admin.acessar"), perms.has("admin.acessos.gerir" as PermissionKey), perms.has("admin.usuarios.editar" as PermissionKey)]).toEqual([false, false, false]);
      expect(perms.origin["admin.acessar"]).toBe("padrao");
    }
  });

  it("escopo herdado do protótipo, valor não booleano ou tela desconhecida são ignorados", () => {
    const scopes: Record<string, unknown> = {};
    scopes["__proto__"] = { "vendas.oportunidades": "empresa" };
    const perms = resolvePermissions(vinicius, {
      userOverride: { grants: { "financeiro.contas-a-pagar.ver": "true" as unknown as boolean }, scopes: scopes as Record<string, "empresa"> },
      roleProfile: { scopes: { "tela.inexistente": "empresa" } },
    });
    expect(perms.has("financeiro.contas-a-pagar.ver")).toBe(false);
    expect(perms.scopes["vendas.oportunidades" as keyof typeof perms.scopes]).toBe(resolvePermissions(vinicius).scopes["vendas.oportunidades" as keyof typeof perms.scopes]);
  });

  it("perfil negado some do menu na hora (T9 no nível do núcleo)", () => {
    const user = asCurrentUser(vinicius, { roleProfile: { grants: { "vendas.visitas.ver": false } } });
    const hrefs = visibleNavigation(user).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/vendas/visitas");
    expect(hrefs).toContain("/vendas/propostas");
  });
});

describe("invariantes (A9) — fase de persistência", () => {
  const state: AccessState = {
    users: SEED_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, active: true, managerId: u.managerId })),
    departments: SEED_DEPARTMENTS,
    roleProfiles: {},
    userOverrides: {},
  };

  it("admin sem chave protegida só por perfil negado é recusado pelos invariantes (I3) ao gravar", () => {
    const after = withRoleProfile(state, "admin", { grants: { "admin.usuarios.ver": false } });
    const v = checkAccessInvariants({ actorId: "user_philippe", before: state, after, change: { kind: "profile", role: "admin" } });
    expect(v.map((x) => x.code)).toContain("I3");
  });

  it("ninguém edita as próprias exceções nem retira de si chaves protegidas (I2)", () => {
    const own = checkAccessInvariants({ actorId: "user_hercules", before: state, after: withUserOverride(state, "user_hercules", { grants: { "vendas.visitas.ver": false } }), change: { kind: "override", userId: "user_hercules" } });
    expect(own.map((x) => x.code)).toContain("I2");
    const viaProfile = checkAccessInvariants({ actorId: "user_hercules", before: state, after: withRoleProfile(state, "admin", { grants: { "admin.acessos.ver": false } }), change: { kind: "profile", role: "admin" } });
    expect(viaProfile.map((x) => x.code)).toContain("I2");
  });

  it("sempre existe ≥ 1 usuário ativo com admin.acessos.gerir e admin.usuarios.editar (I1)", () => {
    expect(hasAccessAdministrator(state)).toBe(true);
    const onlyHercules = withoutUser(state, "user_philippe");
    const hercules = onlyHercules.users.find((u) => u.id === "user_hercules")!;
    const v = checkAccessInvariants({ actorId: "outro", before: onlyHercules, after: withUser(onlyHercules, { ...hercules, active: false }), change: { kind: "user.update", userId: "user_hercules" } });
    expect(v.map((x) => x.code)).toContain("I1");
  });

  it("hoje o resolvedor aplica o que estiver gravado (os invariantes barram a gravação, não a leitura)", () => {
    const perms = resolvePermissions(hercules, { roleProfile: { grants: { "admin.acessos.gerir": false } } });
    expect(perms.has("admin.acessos.gerir" as PermissionKey)).toBe(false);
  });
});
