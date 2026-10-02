/**
 * Dados puros da organização do seed (usuários e departamentos), sem banco nem Auth: usados pelo seed e pelos
 * testes de permissões (fixtures em memória, T0).
 */
import type { DepartmentKey, RoleKey } from "../../src/domain/constants";
import type { UserKey } from "./context";

const DOMAIN = "intercert.com.br";

export interface UserSpec {
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

export const DEPARTMENTS: { key: DepartmentKey; name: string; manager: UserKey; color: string; description: string }[] = [
  { key: "marketing", name: "Marketing", manager: "mateus", color: "#8B5CF6", description: "Captação e qualificação de leads (MQL)." },
  { key: "vendas", name: "Vendas", manager: "igor", color: "#F26A21", description: "Oportunidades, propostas e fechamento." },
  { key: "financeiro", name: "Financeiro", manager: "karem", color: "#0E7C9B", description: "Contratos, cobrança e liberação para implantação." },
  { key: "implantacao", name: "Implantação", manager: "lando", color: "#2563EB", description: "Projetos de implantação até o go-live." },
  { key: "cs", name: "Customer Success", manager: "felipe", color: "#16A34A", description: "Ativação, saúde, renovação e expansão da base." },
  { key: "suporte", name: "Suporte", manager: "lando", color: "#DC2626", description: "Atendimento e resolução de chamados com SLA." },
  { key: "administrativo", name: "Administrativo", manager: "karem", color: "#6B7280", description: "Rotinas administrativas e RH." },
  { key: "diretoria", name: "Diretoria", manager: "hercules", color: "#94A3BA", description: "Direção executiva e cockpit." },
];

