/**
 * Criação de empresa no ERP pelo INTEROS (npm run test:db), contra o ERP simulado: a licença inicial passa pelo mesmo
 * plano das alterações, então uma seleção que esse plano recusaria ("basta um" sem nenhuma alternativa) para ANTES de
 * qualquer chamada ao ERP — a empresa não pode ficar criada lá sem a licença.
 *
 * Isolamento: cliente e alterações com prefixo próprio, apagados no fim; o catálogo vigente volta ao recorte original.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, list } from "@/server/db";
import { COLLECTIONS, type Client } from "@/domain/types";
import type { ErpChangeRequest } from "@/domain/erp/types";
import { setErpFetch } from "@/server/erp/http";
import { importErpCatalog, resetCatalogCache } from "@/server/erp/catalog-store";
import { ErpChangeBlocked } from "@/server/erp/changes";
import { provisionCompany, type ProvisionInput } from "@/server/erp/provisioning";
import { createFakeErp, fixtureCatalog, type FakeErp } from "./fake-erp";

const RUN = `erpprov${Date.now().toString(36)}`;
const CLIENT = `${RUN}_c`;
const ANA = { id: `${RUN}_ana`, name: "Ana Comercial" };
const ENV_KEYS = ["ERP_INTERCERT_URL", "ERP_INTERCERT_AMBIENTE", "ERP_INTERCERT_TOKEN_LICENCAS", "ERP_INTERCERT_SEGREDO_ASSINATURA", "ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO"] as const;
const savedEnv: Record<string, string | undefined> = {};
let erp: FakeErp;

const input = (units: string[]): ProvisionInput => ({
  clientId: CLIENT,
  company: { tipo: "varejo", razaoSocial: "Loja Basta Um Ltda", nomeFantasia: null, cnpj: "11.222.333/0001-81", inscricaoEstadual: null, inscricaoMunicipal: null, regimeTributario: null, email: null, telefone: null, endereco: null },
  units,
  admin: { nome: "Admin Teste", email: "admin@exemplo.com.br", telefone: null },
  entregaConvite: "interos",
  reason: "Contrato assinado (teste)",
  actor: ANA,
});
const changesOfClient = () => list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["clientId", "==", CLIENT]] });

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.ERP_INTERCERT_URL = "http://localhost:9";
  process.env.ERP_INTERCERT_AMBIENTE = "homologacao";
  process.env.ERP_INTERCERT_TOKEN_LICENCAS = "token-de-teste";
  process.env.ERP_INTERCERT_SEGREDO_ASSINATURA = "segredo-de-teste-com-mais-de-32-caracteres!";
  process.env.ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO = "credencial-de-teste";
  // 05.08 Sugestão de reposição passa a exigir um destes: 05.04 Pedido de compra ou 05.06 Recebimento de mercadorias.
  const catalog = fixtureCatalog();
  const unit = catalog.items.find((i) => i.code === "05.08") as { dependencies: Record<string, unknown> };
  unit.dependencies = { ...unit.dependencies, requiredAnyOf: [["05.04", "05.06"]] };
  erp = createFakeErp({ catalog });
  setErpFetch(erp.fetch);
  resetCatalogCache();
  await importErpCatalog(null);
  await create<Client>(COLLECTIONS.clients, { legalName: "Loja Basta Um Ltda", tradeName: "Loja Basta Um", status: "ativo", address: {}, mrr: 0, tags: [] } as unknown as Parameters<typeof create<Client>>[1], CLIENT);
});

afterAll(async () => {
  // O catálogo vigente do ambiente volta a ser o recorte original.
  setErpFetch(createFakeErp().fetch);
  resetCatalogCache();
  await importErpCatalog(null);
  setErpFetch(null);
  resetCatalogCache();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  const sql = docdb.sql();
  await sql`delete from interos.erp_change_requests where data->>'clientId' = ${CLIENT}`;
  await sql`delete from interos.events where data->>'clientId' = ${CLIENT}`;
  await sql`delete from interos.clients where id = ${CLIENT}`;
});

describe("criar empresa no ERP com dependência 'basta um'", () => {
  it("sem nenhuma alternativa: para antes de chamar o ERP e explica o que falta", async () => {
    const callsBefore = erp.calls.length;
    let error: unknown = null;
    try {
      await provisionCompany(input(["01.04", "05.08"]));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErpChangeBlocked);
    expect((error as ErpChangeBlocked).code).toBe("lote_invalido");
    expect((error as Error).message).toBe("Sugestão de reposição exige um destes: 05.04 Pedido de compra ou 05.06 Recebimento de mercadorias. Inclua um deles no pedido.");
    expect(erp.calls.length).toBe(callsBefore);
    expect(await changesOfClient()).toEqual([]);
  });

  it("com uma das alternativas: segue para a criação no ERP", async () => {
    const result = await provisionCompany(input(["01.03", "01.04", "05.04", "05.08"]));
    // O ERP simulado não tem a rota de criação (404): o que importa aqui é que o pedido chegou a ele.
    expect(erp.calls.some((c) => c.method === "POST" && c.path === "/api/interos/v1/empresas")).toBe(true);
    expect(result.change.kind).toBe("provisionamento");
    expect(result.change.provisioning?.units).toEqual(["01.03", "01.04", "05.04", "05.08"]);
  });
});
