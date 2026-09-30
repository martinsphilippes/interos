import "server-only";
/**
 * Fornecedores (D28): credores de Contas a Pagar. Cadastro simples (nome, documento, contato, PIX/banco, categoria),
 * auditado por evento (`supplier.created` / `supplier.updated` com changes). NÃO é o cadastro de clientes.
 */
import { create, getById, list, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges, describeChanges } from "@/server/audit";
import { COLLECTIONS, type Supplier, type UserRef } from "@/domain/types";
import type { SupplierInput } from "./schemas";

const SUPPLIER_FIELDS = ["name", "document", "email", "phone", "pixKey", "bank", "category", "notes", "active"] as const;
const SUPPLIER_LABELS: Record<string, string> = { name: "Nome", document: "CPF/CNPJ", email: "E-mail", phone: "Telefone", pixKey: "Chave PIX", bank: "Dados bancários", category: "Categoria", notes: "Observações", active: "Ativo" };

export async function listSuppliers(options: { activeOnly?: boolean } = {}): Promise<Supplier[]> {
  const all = await list<Supplier>(COLLECTIONS.suppliers);
  return all.filter((s) => !options.activeOnly || s.active !== false).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  return getById<Supplier>(COLLECTIONS.suppliers, id);
}

function normalize(input: SupplierInput, actor: UserRef): Omit<Supplier, "id" | "organizationId" | "createdAt" | "updatedAt"> {
  const bank = input.bank && (input.bank.banco || input.bank.agencia || input.bank.conta) ? { banco: input.bank.banco, agencia: input.bank.agencia, conta: input.bank.conta } : undefined;
  return {
    name: input.name.trim(),
    document: input.document || undefined,
    email: input.email,
    phone: input.phone,
    pixKey: input.pixKey,
    bank,
    category: input.category,
    notes: input.notes,
    active: input.active !== false,
    updatedBy: actor.id,
  };
}

/** Cria ou atualiza o fornecedor (nome único, sem diferenciar maiúsculas). */
export async function saveSupplier(input: SupplierInput, actor: UserRef): Promise<{ supplier: Supplier; created: boolean }> {
  const data = normalize(input, actor);
  const all = await listSuppliers();
  const duplicate = all.find((s) => s.id !== input.id && s.name.trim().toLowerCase() === data.name.toLowerCase());
  if (duplicate) throw new Error(`Já existe o fornecedor "${duplicate.name}"`);
  if (input.id) {
    const current = await getSupplier(input.id);
    if (!current) throw new Error("Fornecedor não encontrado");
    const next: Supplier = { ...current, ...data };
    const audit = auditChanges<Supplier>(current, next, [...SUPPLIER_FIELDS]);
    if (Object.keys(audit.changes).length === 0) return { supplier: current, created: false };
    await update<Supplier>(COLLECTIONS.suppliers, current.id, data);
    await emitEvent({
      type: "supplier.updated",
      actor,
      entity: { type: "supplier", id: current.id },
      title: `Fornecedor ${next.name} alterado`,
      description: describeChanges(audit, SUPPLIER_LABELS, (field, v) => (v === null ? "—" : field === "active" ? (v ? "sim" : "não") : typeof v === "object" ? JSON.stringify(v) : String(v))),
      department: "financeiro",
      payload: { supplierId: current.id, ...audit },
      timeline: false,
    });
    return { supplier: next, created: false };
  }
  const supplier = await create<Supplier>(COLLECTIONS.suppliers, { ...data, createdBy: actor.id });
  await emitEvent({
    type: "supplier.created",
    actor,
    entity: { type: "supplier", id: supplier.id },
    title: `Fornecedor ${supplier.name} cadastrado`,
    description: [supplier.category, supplier.document ? `documento ${supplier.document}` : null, supplier.email].filter(Boolean).join(" · ") || undefined,
    department: "financeiro",
    payload: { supplierId: supplier.id, ...auditChanges<Supplier>(null, supplier, [...SUPPLIER_FIELDS]) },
    timeline: false,
  });
  return { supplier, created: true };
}

export async function setSupplierActive(id: string, active: boolean, actor: UserRef): Promise<Supplier> {
  const current = await getSupplier(id);
  if (!current) throw new Error("Fornecedor não encontrado");
  if (current.active === active) return current;
  await update<Supplier>(COLLECTIONS.suppliers, id, { active, updatedBy: actor.id });
  const next = { ...current, active };
  await emitEvent({
    type: "supplier.updated",
    actor,
    entity: { type: "supplier", id },
    title: `Fornecedor ${current.name} ${active ? "reativado" : "inativado"}`,
    department: "financeiro",
    payload: { supplierId: id, ...auditChanges<Supplier>(current, next, ["active"]) },
    timeline: false,
  });
  return next;
}
