/**
 * Signatários ligados aos contatos no banco (npm run test:db): contrato refeito da mesma venda reaproveita quem assina,
 * corrigir o signatário grava no contato (e nos outros contratos não enviados) e editar o contato atualiza o contrato.
 *
 * Isolamento: cliente, contatos, oportunidade e contratos com prefixo próprio, apagados no fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list, update } from "@/server/db";
import { COLLECTIONS, type Client, type Contact, type Contract, type Opportunity } from "@/domain/types";
import { createContact } from "@/server/clients/contacts";
import { createManualContract, editSigner, ensureContractForOpportunity, syncContractSignersFromContact } from "@/server/finance/service";

const RUN = `s${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_fin`, name: "Financeiro Teste" };
const CLIENT_ID = `${RUN}_cli`;
const OPP_ID = `${RUN}_opp`;

const contractsOfClient = () => list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", CLIENT_ID]] });
const clientSigner = (c: Contract) => c.signers.find((s) => s.party !== "contratada");

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  await create<Client>(COLLECTIONS.clients, { legalName: `Quantso ${RUN} LTDA`, tradeName: `Quantso ${RUN}`, document: "35176948000187", status: "prospect", email: `${RUN}@quantso-teste.com.br`, address: { city: "Salvador", state: "BA" }, mrr: 0, tags: [] } as never, CLIENT_ID);
});

afterAll(async () => {
  const sql = docdb.sql();
  await sql`delete from interos.contracts where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.contacts where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.opportunities where id = ${OPP_ID}`;
  await sql`delete from interos.events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
});

describe("signatários e contatos do cliente", () => {
  it("contato de teste → contrato da venda; corrigir no contrato grava no contato; contrato refeito mantém a correção", async () => {
    const teste = await createContact({ clientId: CLIENT_ID, name: "TESTE", email: `teste.${RUN}@gmail.com`, isPrimary: true }, ACTOR);
    await create<Opportunity>(
      COLLECTIONS.opportunities,
      { clientId: CLIENT_ID, title: "ERP", kind: "nova_venda", stage: "ganho", products: [], ownerId: ACTOR.id, probability: 100, closing: { contactId: teste.id, contactName: "TESTE" }, createdBy: ACTOR.id } as never,
      OPP_ID,
    );
    const first = (await ensureContractForOpportunity(OPP_ID, ACTOR))!;
    expect(clientSigner(first)).toMatchObject({ name: "TESTE", email: `teste.${RUN}@gmail.com`, contactId: teste.id });

    // Correção no contrato, com «atualizar o contato»: o contato do cliente passa a ser a pessoa certa.
    const certo = `philippe.${RUN}@quantso-teste.com.br`;
    const r = await editSigner({ contractId: first.id, email: `teste.${RUN}@gmail.com`, name: "Philippe Martins", newEmail: certo, role: "Contratante", updateContact: true }, ACTOR);
    expect(r).toMatchObject({ contactId: teste.id, contactCreated: false });
    expect(await getById<Contact>(COLLECTIONS.contacts, teste.id)).toMatchObject({ name: "Philippe Martins", email: certo });
    expect(clientSigner((await getById<Contract>(COLLECTIONS.contracts, first.id))!)).toMatchObject({ name: "Philippe Martins", email: certo, contactId: teste.id });

    // Contrato cancelado e refeito da mesma venda: quem assina vem do contrato anterior, não volta o "TESTE".
    await update<Contract>(COLLECTIONS.contracts, first.id, { status: "cancelado" });
    const second = (await ensureContractForOpportunity(OPP_ID, ACTOR))!;
    expect(second.id).not.toBe(first.id);
    expect(clientSigner(second)).toMatchObject({ name: "Philippe Martins", email: certo, contactId: teste.id, status: "pendente" });
    expect(second.signers.filter((s) => s.party !== "contratada")).toHaveLength(1);
  });

  it("corrigir sem atualizar o contato vale só para o contrato; e-mail de outro contato é recusado", async () => {
    const c = await createManualContract({ clientId: CLIENT_ID, recurrence: "mensal", termMonths: 12, billingDay: 10 }, ACTOR);
    const signer = clientSigner(c)!;
    const contactBefore = (await getById<Contact>(COLLECTIONS.contacts, signer.contactId!))!;
    await editSigner({ contractId: c.id, email: signer.email, name: "Só Neste Contrato", newEmail: `so.${RUN}@quantso-teste.com.br`, role: "Contratante", updateContact: false }, ACTOR);
    expect(await getById<Contact>(COLLECTIONS.contacts, contactBefore.id)).toMatchObject({ name: contactBefore.name, email: contactBefore.email });
    const after = clientSigner((await getById<Contract>(COLLECTIONS.contracts, c.id))!)!;
    expect(after).toMatchObject({ name: "Só Neste Contrato" });
    expect(after.contactId).toBeUndefined();

    const maria = await createContact({ clientId: CLIENT_ID, name: "Maria Souza", email: `maria.${RUN}@quantso-teste.com.br` }, ACTOR);
    await expect(editSigner({ contractId: c.id, email: after.email, name: "Outra Pessoa", newEmail: maria.email!, role: "Contratante", updateContact: true }, ACTOR)).rejects.toThrow(/já é o e-mail do contato Maria Souza/);
    // Sem contato ligado, «atualizar o contato» cadastra a pessoa.
    const created = await editSigner({ contractId: c.id, email: after.email, name: "Pessoa Nova", newEmail: `nova.${RUN}@quantso-teste.com.br`, role: "Contratante", updateContact: true }, ACTOR);
    expect(created.contactCreated).toBe(true);
    expect(clientSigner((await getById<Contract>(COLLECTIONS.contracts, c.id))!)).toMatchObject({ name: "Pessoa Nova", contactId: created.contactId });
  });

  it("editar o contato atualiza contratos não enviados; enviado e cancelado ficam como estão", async () => {
    const pessoa = await createContact({ clientId: CLIENT_ID, name: "Carlos Antigo", email: `carlos.${RUN}@quantso-teste.com.br` }, ACTOR);
    const base = { name: "Carlos Antigo", email: pessoa.email!, role: "Contratante", status: "pendente" as const };
    const mk = async (patch: Partial<Contract>, linked: boolean) => {
      const c = await createManualContract({ clientId: CLIENT_ID, recurrence: "mensal", termMonths: 12, billingDay: 10 }, ACTOR);
      await update<Contract>(COLLECTIONS.contracts, c.id, { signers: [linked ? { ...base, contactId: pessoa.id } : base], ...patch });
      return c.id;
    };
    const open = await mk({}, true);
    const legacy = await mk({}, false);
    const sent = await mk({ signatureEnvelopeId: "env_x" }, true);
    const cancelled = await mk({ status: "cancelado" }, true);

    const novo = `carlos.novo.${RUN}@quantso-teste.com.br`;
    await update<Contact>(COLLECTIONS.contacts, pessoa.id, { name: "Carlos Novo", email: novo });
    const n = await syncContractSignersFromContact({ id: pessoa.id, clientId: CLIENT_ID, name: "Carlos Novo", email: novo }, pessoa.email, ACTOR);
    expect(n).toBe(2);
    const byId = new Map((await contractsOfClient()).map((c) => [c.id, c]));
    expect(byId.get(open)!.signers[0]).toMatchObject({ name: "Carlos Novo", email: novo, contactId: pessoa.id });
    expect(byId.get(legacy)!.signers[0]).toMatchObject({ name: "Carlos Novo", email: novo, contactId: pessoa.id });
    expect(byId.get(sent)!.signers[0]).toMatchObject({ name: "Carlos Antigo" });
    expect(byId.get(cancelled)!.signers[0]).toMatchObject({ name: "Carlos Antigo" });
  });
});
