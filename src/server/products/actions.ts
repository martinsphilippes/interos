"use server";

/**
 * Server Actions da Gestão de Produtos (abas Módulos, Pacotes e Simulador de /admin/produtos). Cada uma exige a chave
 * do catálogo de acessos; o serviço confere as regras de negócio e grava em transação com auditoria.
 */
import { revalidatePath } from "next/cache";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult, CurrentUser } from "@/domain/types";
import { getCommercialCatalog, quoteUnitsOf } from "./catalog";
import {
  cancelPackageVersionSchema,
  cancelPriceSchema,
  createPackageSchema,
  packageVersionSchema,
  priceSchema,
  saveModuleSchema,
  unitDetailSchema,
  updatePackageSchema,
} from "./schemas";
import {
  addModulePrice,
  addProductPackageVersion,
  cancelModulePrice,
  cancelProductPackageVersion,
  createProductPackage,
  listCommercialModules,
  saveCommercialModule,
  unitDetail,
  updateProductPackage,
  type ProductActor,
  type UnitDetail,
} from "./service";

const PAGE = "/admin/produtos";

function actorOf(user: CurrentUser): ProductActor {
  return { id: user.id, name: user.name, departmentId: user.departmentId };
}

async function catalogUnits() {
  const catalog = await getCommercialCatalog();
  return { catalog, units: quoteUnitsOf(catalog.index) };
}

async function modulesByCode() {
  return new Map((await listCommercialModules()).map((m) => [m.code, m]));
}

/** Ficha comercial de um módulo do ERP (nome, texto para proposta, situação, segmentos, regras). */
export async function saveCommercialModuleAction(input: unknown): Promise<ActionResult<{ code: string }>> {
  try {
    const user = await requirePermission("admin.produtos.modulos.editar");
    const data = saveModuleSchema.parse(input);
    const { units } = await catalogUnits();
    const saved = await saveCommercialModule(data, actorOf(user), units);
    revalidatePath(PAGE);
    return { ok: true, data: { code: saved.code } };
  } catch (error) {
    return failAction(error, "Não foi possível salvar a ficha do módulo", "produtos");
  }
}

/** Nova versão de preço de um módulo (a partir de hoje ou de uma data futura). */
export async function addModulePriceAction(input: unknown): Promise<ActionResult<{ code: string; version: number }>> {
  try {
    const user = await requirePermission("admin.produtos.modulos.precificar");
    const data = priceSchema.parse(input);
    const { units } = await catalogUnits();
    const result = await addModulePrice(data, actorOf(user), units);
    revalidatePath(PAGE);
    return { ok: true, data: result };
  } catch (error) {
    return failAction(error, "Não foi possível gravar o preço", "produtos");
  }
}

/** Cancela uma versão de preço que começa hoje ou depois (fica no histórico). */
export async function cancelModulePriceAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission("admin.produtos.modulos.precificar");
    const data = cancelPriceSchema.parse(input);
    await cancelModulePrice(data, actorOf(user));
    revalidatePath(PAGE);
    return { ok: true, data: null };
  } catch (error) {
    return failAction(error, "Não foi possível cancelar a versão de preço", "produtos");
  }
}

/** Cria um pacote (em definição) com a primeira versão. */
export async function createPackageAction(input: unknown): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  try {
    const user = await requirePermission("admin.produtos.pacotes.editar");
    const data = createPackageSchema.parse(input);
    const [{ units }, modules] = await Promise.all([catalogUnits(), modulesByCode()]);
    const result = await createProductPackage(data, actorOf(user), units, modules);
    revalidatePath(PAGE);
    return { ok: true, data: result };
  } catch (error) {
    return failAction(error, "Não foi possível criar o pacote", "produtos");
  }
}

/** Nome, segmento, descrição e situação do pacote. */
export async function updatePackageAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission("admin.produtos.pacotes.editar");
    const data = updatePackageSchema.parse(input);
    const { units } = await catalogUnits();
    await updateProductPackage(data, actorOf(user), units);
    revalidatePath(PAGE);
    return { ok: true, data: null };
  } catch (error) {
    return failAction(error, "Não foi possível salvar o pacote", "produtos");
  }
}

/** Nova versão do pacote (módulos incluídos, mensalidade e implantação a partir de uma data). */
export async function addPackageVersionAction(input: unknown): Promise<ActionResult<{ version: number; warnings: string[] }>> {
  try {
    const user = await requirePermission("admin.produtos.pacotes.editar");
    const data = packageVersionSchema.parse(input);
    const [{ units }, modules] = await Promise.all([catalogUnits(), modulesByCode()]);
    const result = await addProductPackageVersion(data, actorOf(user), units, modules);
    revalidatePath(PAGE);
    return { ok: true, data: result };
  } catch (error) {
    return failAction(error, "Não foi possível gravar a versão do pacote", "produtos");
  }
}

/** Cancela uma versão do pacote que começa hoje ou depois. */
export async function cancelPackageVersionAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission("admin.produtos.pacotes.editar");
    const data = cancelPackageVersionSchema.parse(input);
    await cancelProductPackageVersion(data, actorOf(user));
    revalidatePath(PAGE);
    return { ok: true, data: null };
  } catch (error) {
    return failAction(error, "Não foi possível cancelar a versão do pacote", "produtos");
  }
}

/** O que a unidade inclui, exige e quem depende dela (catálogo do ERP), para a ficha do módulo. */
export async function loadUnitDetailAction(input: unknown): Promise<ActionResult<UnitDetail>> {
  try {
    await requirePermission("admin.produtos.modulos.ver");
    const { code } = unitDetailSchema.parse(input);
    const { catalog } = await catalogUnits();
    const detail = unitDetail(catalog.index, code);
    if (!detail) return { ok: false, error: "Este código não é uma unidade comercial do catálogo em uso." };
    return { ok: true, data: detail };
  } catch (error) {
    return failAction(error, "Não foi possível ler o catálogo do módulo", "produtos");
  }
}
