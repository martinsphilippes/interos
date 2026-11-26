import "server-only";
/**
 * API de provisionamento do ERP (contrato v1, `/api/interos/v1/empresas`, `Authorization: Bearer <id>.<segredo>`,
 * corpo direto e erro `{ erro: { codigo, mensagem, campos } }`). Toda alteração leva `Idempotency-Key`: repetir com a
 * MESMA chave é seguro; chave nova é operação nova.
 *
 * Atenção (homologação local, 26/11/2026): `POST /empresas` com chave NOVA reaplica a criação inteira (reverte ajustes
 * e reativa empresa inativada pelo cliente). O INTEROS só repete a criação com a chave original e reconcilia sempre
 * por `GET /empresas/{id}`.
 */
import { erpRequest, type ErpResponse } from "./http";

const BASE = "/api/interos/v1";
const enc = encodeURIComponent;

export interface ErpConvite {
  idUsuario: string | null;
  entrega: "interos" | "erp" | string;
  entregue: boolean | null;
  canal: string | null;
  detalhe: string | null;
  expiraEm: string | null;
  /** Link de uso único: só na primeira resposta; nunca é gravado. */
  link: string | null;
  linkRedigido: boolean;
  aviso?: string | null;
}

export interface ErpEmpresaAdministrador {
  idUsuario: string;
  nome: string;
  email: string;
  situacao: string;
  convite: { estado: string; expiraEm: string | null; enviadoEm: string | null; detalheEntrega: string | null } | null;
  primeiroAcessoEm: string | null;
  ultimoAcessoEm: string | null;
}

export interface ErpImplantacao {
  operacao: "criar" | "vincular" | null | string;
  estado: "nao_iniciada" | "em_andamento" | "concluida" | "falhou" | string;
  etapas: { etapa: string; estado: string; concluidaEm: string | null; erro: string | null; tentativas: number }[];
  tentativas?: number;
  ultimoErro?: string | null;
}

/** O objeto `empresa` (contrato v1 §8.0): fotografia completa devolvida por toda operação. */
export interface ErpEmpresa {
  idEmpresa: string;
  contaInterosId: string;
  tipo: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  situacao: "ativa" | "inativa" | "suspensa" | string;
  suspensao: { modo: string; motivo: string; referenciaContrato: string | null; desde: string } | null;
  historicoSituacao: { evento: string; modo: string | null; motivo: string | null; referenciaContrato: string | null; em: string; requestId: string | null }[];
  /** Módulos do provisionamento (vocabulário amplo: pdv, vendas…); null = empresa anterior ao contrato (sem restrição). */
  modulos: string[] | null;
  contrato: { referencia: string | null; plano: string | null } | null;
  implantacao: ErpImplantacao;
  unidades: { idUnidade: string; codigo: string; nome: string; cnpj: string | null; situacao: string }[];
  administradores: ErpEmpresaAdministrador[];
  usuarios: { ativos: number; convidados: number; suspensos: number; inativos: number };
  ultimaAtividadeEm: string | null;
  vinculadaEm: string;
  atualizadaEm: string;
}

export interface ErpProvisioningStatus {
  situacao: string;
  versao: string;
  cliente: { id: string; nome: string; escopos: string[] };
  horarioServidor: string;
  requestId: string;
}

export async function getProvisioningStatus(): Promise<ErpResponse<ErpProvisioningStatus>> {
  return erpRequest<ErpProvisioningStatus>({ api: "provisionamento", method: "GET", path: `${BASE}/status` });
}

export interface CreateCompanyBody {
  contaInterosId: string;
  empresa: {
    tipo?: string;
    razaoSocial: string;
    nomeFantasia?: string | null;
    cnpj: string;
    inscricaoEstadual?: string | null;
    inscricaoMunicipal?: string | null;
    regimeTributario?: string | null;
    cnae?: string | null;
    email?: string | null;
    telefone?: string | null;
    endereco?: { cep?: string | null; logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; municipio?: string | null; codigoMunicipioIbge?: string | null; uf?: string | null } | null;
  };
  unidadeInicial?: { nome?: string | null; codigo?: string | null; fusoHorario?: string | null } | null;
  modulos: string[];
  administrador: { nome: string; email: string; telefone?: string | null };
  entregaConvite?: "interos" | "erp";
  contrato?: { referencia?: string | null; plano?: string | null } | null;
}

/** Cria a empresa contratante (201 criada, 200 já existia para esta conta). Até 60 s no ERP. */
export async function createCompany(body: CreateCompanyBody, idempotencyKey: string): Promise<ErpResponse<{ empresa: ErpEmpresa; convite: ErpConvite | null }>> {
  return erpRequest({ api: "provisionamento", method: "POST", path: `${BASE}/empresas`, body, idempotencyKey, timeoutMs: 58_000 });
}

export async function getCompany(idEmpresa: string): Promise<ErpResponse<{ empresa: ErpEmpresa }>> {
  return erpRequest({ api: "provisionamento", method: "GET", path: `${BASE}/empresas/${enc(idEmpresa)}` });
}

export async function listCompanies(query: { contaInterosId?: string; cursor?: string; limite?: number } = {}): Promise<ErpResponse<{ itens: ErpEmpresa[]; proximoCursor: string | null }>> {
  return erpRequest({ api: "provisionamento", method: "GET", path: `${BASE}/empresas`, query });
}

export interface LinkCompanyBody {
  contaInterosId: string;
  idEmpresa: string;
  cnpj: string;
  codigoVinculo: string;
  modulos?: string[];
  contrato?: { referencia?: string | null; plano?: string | null } | null;
}

/** Vincula empresa que já usa o ERP, com o código de consentimento do administrador dela (vale 72 h, uso único). */
export async function linkCompany(body: LinkCompanyBody, idempotencyKey: string): Promise<ErpResponse<{ empresa: ErpEmpresa }>> {
  return erpRequest({ api: "provisionamento", method: "POST", path: `${BASE}/empresas/vincular`, body, idempotencyKey, timeoutMs: 30_000 });
}

export async function resumeImplementation(idEmpresa: string, idempotencyKey: string): Promise<ErpResponse<{ empresa: ErpEmpresa; convite?: ErpConvite | null }>> {
  return erpRequest({ api: "provisionamento", method: "POST", path: `${BASE}/empresas/${enc(idEmpresa)}/implantacao/retomar`, body: {}, idempotencyKey, timeoutMs: 58_000 });
}

export async function resendInvite(idEmpresa: string, body: { idUsuario?: string; email?: string; entregaConvite?: "interos" | "erp" }, idempotencyKey: string): Promise<ErpResponse<{ empresa: ErpEmpresa; convite: ErpConvite | null }>> {
  return erpRequest({ api: "provisionamento", method: "POST", path: `${BASE}/empresas/${enc(idEmpresa)}/convites/reenviar`, body, idempotencyKey, timeoutMs: 30_000 });
}

/**
 * Vocabulário amplo do provisionamento (contrato v1 §9). Enquanto o ERP não unifica os vocabulários, a criação recebe
 * estes módulos derivados das unidades escolhidas (a licença detalhada vai em seguida pela API de licenças).
 */
export const PROVISIONING_MODULES = ["pdv", "vendas", "estoque", "compras", "financeiro", "fiscal", "relatorios", "comercio_digital", "gestao_contabil", "rede_certificacao"] as const;
export type ProvisioningModule = (typeof PROVISIONING_MODULES)[number];

/** Família do catálogo v2 (NN) → módulo amplo do provisionamento. Cadastros (01) e administração são sempre do ERP. */
const PROVISIONING_BY_FAMILY: Record<string, ProvisioningModule> = {
  "02": "fiscal",
  "03": "fiscal",
  "04": "fiscal",
  "22": "fiscal",
  "05": "compras",
  "06": "vendas",
  "08": "vendas",
  "25": "vendas",
  "07": "pdv",
  "46": "pdv",
  "09": "estoque",
  "10": "estoque",
  "15": "estoque",
  "11": "comercio_digital",
  "12": "comercio_digital",
  "35": "comercio_digital",
  "18": "financeiro",
  "19": "financeiro",
  "36": "financeiro",
  "20": "vendas",
  "21": "relatorios",
  "51": "gestao_contabil",
  "48": "gestao_contabil",
  "52": "rede_certificacao",
};

/** Módulos amplos para a criação a partir das unidades escolhidas (sempre ao menos um). */
export function provisioningModulesFor(unitCodes: readonly string[]): ProvisioningModule[] {
  const set = new Set<ProvisioningModule>();
  for (const code of unitCodes) {
    const mapped = PROVISIONING_BY_FAMILY[code.slice(0, 2)];
    if (mapped) set.add(mapped);
  }
  if (set.size === 0) set.add("vendas");
  return PROVISIONING_MODULES.filter((m) => set.has(m));
}
