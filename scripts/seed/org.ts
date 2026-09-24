/**
 * Organização, departamentos e usuários (Firestore + Firebase Auth).
 */
import { COLLECTIONS, type Department, type Organization, type User } from "../../src/domain/types";
import type { DepartmentKey, RoleKey } from "../../src/domain/constants";
import { adminAuth } from "../../src/server/firebase-admin";
import { ORG_ID } from "../../src/server/db";
import { daysAgo, type SeedDoc } from "./lib";
import type { SeedContext, UserKey } from "./context";

export const SEED_PASSWORD = "interos123";
const DOMAIN = "intercert.com.br";

interface UserSpec {
  key: UserKey;
  name: string;
  email: string;
  role: RoleKey;
  department: DepartmentKey;
  manager?: UserKey;
  jobTitle: string;
  goals?: Record<string, number>;
  /** Salário base (R$) usado no cálculo do bônus das funções com regra de bônus. */
  baseSalary?: number;
}

const SALES_GOALS = { setup: 10000, recorrencia: 5000, hardware: 25000 };
const SUPPORT_GOALS = { csat: 8.5, sla_resposta: 0.95, sla_solucao: 0.9 };
const IMPL_GOALS = { prazo: 0.9, ativacao7: 0.8 };

export const USER_SPECS: UserSpec[] = [
  { key: "hercules", name: "Hércules Andrade", email: `hercules@${DOMAIN}`, role: "admin", department: "diretoria", jobTitle: "CEO" },
  { key: "philippe", name: "Philippe Martins", email: "martinsphilippes@gmail.com", role: "admin", department: "diretoria", manager: "hercules", jobTitle: "CTO" },
  { key: "mateus", name: "Mateus Carvalho", email: `mateus@${DOMAIN}`, role: "gestor", department: "marketing", manager: "hercules", jobTitle: "Gestor de Marketing", goals: { leads: 220, mqls: 80 } },
  { key: "luciano", name: "Luciano Bezerra", email: `luciano@${DOMAIN}`, role: "marketing", department: "marketing", manager: "mateus", jobTitle: "Analista de Marketing", goals: { leads: 120, mqls: 40 } },
  { key: "igor", name: "Igor Sampaio", email: `igor@${DOMAIN}`, role: "gestor", department: "vendas", manager: "hercules", jobTitle: "Gestor Comercial", goals: SALES_GOALS },
  { key: "vinicius", name: "Vinícius Landim", email: `vinicius@${DOMAIN}`, role: "vendas", department: "vendas", manager: "igor", jobTitle: "Consultor de Vendas", goals: SALES_GOALS },
  { key: "karem", name: "Karem Feitosa", email: `karem@${DOMAIN}`, role: "gestor", department: "financeiro", manager: "hercules", jobTitle: "Gestora Financeira", goals: { inadimplencia: 0.04, mrr_crescimento: 0.08 }, baseSalary: 5500 },
  { key: "anapaula", name: "Ana Paula Macêdo", email: `anapaula@${DOMAIN}`, role: "financeiro", department: "financeiro", manager: "karem", jobTitle: "Analista Financeira", goals: { inadimplencia: 0.04 }, baseSalary: 3000 },
  { key: "lando", name: "Lando Tavares", email: `lando@${DOMAIN}`, role: "gestor", department: "implantacao", manager: "hercules", jobTitle: "Gestor de Implantação e Suporte", goals: { ...IMPL_GOALS, ...SUPPORT_GOALS }, baseSalary: 5200 },
  { key: "marcos", name: "Marcos Brito", email: `marcos@${DOMAIN}`, role: "implantacao", department: "implantacao", manager: "lando", jobTitle: "Analista de Implantação", goals: IMPL_GOALS, baseSalary: 3200 },
  { key: "bruno", name: "Bruno Monteiro", email: `bruno@${DOMAIN}`, role: "implantacao", department: "implantacao", manager: "lando", jobTitle: "Analista de Implantação", goals: IMPL_GOALS, baseSalary: 3200 },
  { key: "felipe", name: "Felipe Araújo", email: `felipe@${DOMAIN}`, role: "gestor", department: "cs", manager: "hercules", jobTitle: "Gestor de Customer Success", goals: { saude_cliente: 85, taxa_renovacao: 0.9 } },
  { key: "camila", name: "Camila Ribeiro", email: `camila@${DOMAIN}`, role: "cs", department: "cs", manager: "felipe", jobTitle: "Analista de Customer Success", goals: { saude_cliente: 85, taxa_renovacao: 0.9 } },
  { key: "rafael", name: "Rafael Nascimento", email: `rafael@${DOMAIN}`, role: "suporte", department: "suporte", manager: "lando", jobTitle: "Analista de Suporte N1", goals: SUPPORT_GOALS, baseSalary: 2800 },
  { key: "larissa", name: "Larissa Cavalcante", email: `larissa@${DOMAIN}`, role: "suporte", department: "suporte", manager: "lando", jobTitle: "Analista de Suporte N2", goals: SUPPORT_GOALS, baseSalary: 3400 },
];

const DEPARTMENTS: { key: DepartmentKey; name: string; manager: UserKey; color: string; description: string }[] = [
  { key: "marketing", name: "Marketing", manager: "mateus", color: "#8B5CF6", description: "Captação e qualificação de leads (MQL)." },
  { key: "vendas", name: "Vendas", manager: "igor", color: "#F26A21", description: "Oportunidades, propostas e fechamento." },
  { key: "financeiro", name: "Financeiro", manager: "karem", color: "#0E7C9B", description: "Contratos, cobrança e liberação para implantação." },
  { key: "implantacao", name: "Implantação", manager: "lando", color: "#2563EB", description: "Projetos de implantação até o go-live." },
  { key: "cs", name: "Customer Success", manager: "felipe", color: "#16A34A", description: "Ativação, saúde, renovação e expansão da base." },
  { key: "suporte", name: "Suporte", manager: "lando", color: "#DC2626", description: "Atendimento e resolução de chamados com SLA." },
  { key: "administrativo", name: "Administrativo", manager: "karem", color: "#6B7280", description: "Rotinas administrativas e RH." },
  { key: "diretoria", name: "Diretoria", manager: "hercules", color: "#0B1F3A", description: "Direção executiva e cockpit." },
];

export async function seedOrg(ctx: SeedContext): Promise<void> {
  const { store } = ctx;
  const createdAt = daysAgo(1100);

  store.add(COLLECTIONS.organizations, ORG_ID, {
    name: "Intercert",
    slug: "intercert",
    timezone: "America/Sao_Paulo",
    createdAt,
  } satisfies SeedDoc<Organization>);

  const userId = (key: UserKey) => `user_${key}`;

  DEPARTMENTS.forEach((d, i) => {
    store.add(COLLECTIONS.departments, `dept_${d.key}`, {
      key: d.key,
      name: d.name,
      managerId: userId(d.manager),
      color: d.color,
      order: i + 1,
      description: d.description,
      createdAt,
    } satisfies SeedDoc<Department>);
  });

  const users = {} as Record<UserKey, User>;
  for (const spec of USER_SPECS) {
    const doc = store.add(COLLECTIONS.users, userId(spec.key), {
      name: spec.name,
      email: spec.email,
      role: spec.role,
      departmentId: spec.department,
      managerId: spec.manager ? userId(spec.manager) : undefined,
      jobTitle: spec.jobTitle,
      phone: `8899${String(100000 + USER_SPECS.indexOf(spec) * 7351).slice(0, 6)}`,
      active: true,
      monthlyGoals: spec.goals,
      baseSalary: spec.baseSalary,
      createdAt,
    } satisfies SeedDoc<User>);
    users[spec.key] = doc;
  }
  ctx.users = users;
}

/** Remove os usuários do seed no Auth e recria com uid = id do documento em users. */
export async function seedAuthUsers(): Promise<number> {
  const emails = new Set(USER_SPECS.map((u) => u.email.toLowerCase()));
  const uids = new Set(USER_SPECS.map((u) => `user_${u.key}`));

  let pageToken: string | undefined;
  const toDelete: string[] = [];
  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if ((u.email && emails.has(u.email.toLowerCase())) || uids.has(u.uid)) toDelete.push(u.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);
  await Promise.all(toDelete.map((uid) => adminAuth.deleteUser(uid)));

  for (const spec of USER_SPECS) {
    await adminAuth.createUser({
      uid: `user_${spec.key}`,
      email: spec.email,
      password: SEED_PASSWORD,
      displayName: spec.name,
      emailVerified: true,
    });
  }
  return USER_SPECS.length;
}
