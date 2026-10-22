/**
 * Assinatura eletrônica (primeira entrega): variáveis dos modelos e sugestão de campo, valor por extenso, Word com
 * variável partida em vários trechos, sugestão do cliente na caixa de entrada, código de integridade com o modelo e o
 * PDF do contrato.
 */
import { describe, expect, it } from "vitest";
import {
  BLANK,
  companySignerReady,
  contractFieldValues,
  currencyInWords,
  extractVariables,
  fillTemplateText,
  integerInWords,
  isDefaultCompanySignerName,
  mergeVariables,
  normalizeVariableName,
  isSignerEmail,
  suggestField,
  suggestUnbound,
  templateDataGaps,
  templateRequirements,
  clientRepresentative,
  isWitnessSigner,
  unmappedVariables,
  variableValues,
} from "@/domain/contract-templates";
import { docxText, fillDocx, fillXml, inspectDocx, readZip, writeZip } from "@/server/finance/docx";
import { suggestClient } from "@/server/finance/signature-inbox";
import { contractDocumentHash } from "@/server/finance/signature";
import { contractPdf, type ContractDocumentData } from "@/server/finance/contract-document";
import type { Contract } from "@/domain/types";

const CONTRACT: Contract = {
  id: "c1",
  organizationId: "org",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  clientId: "cli1",
  number: "CTR-2026-0042",
  version: 2,
  status: "aguardando_contrato",
  items: [{ productId: "p1", productName: "INTEROS Gestão", quantity: 1, setupValue: 1500, monthlyValue: 349.9, hardwareValue: 0, discountPct: 0 }],
  setupTotal: 1500,
  monthlyTotal: 349.9,
  hardwareTotal: 0,
  billingDay: 10,
  firstDueDate: "2026-11-10",
  recurrence: "mensal",
  termMonths: 12,
  signers: [
    { name: "Maria Cliente", email: "maria@acme.com.br", role: "Contratante", status: "pendente" },
    { name: "Hércules Andrade", email: "hercules@intercert.com.br", role: "Representante legal da Contratada", status: "pendente", party: "contratada" },
  ],
  financialStatus: "pendente",
  documentIds: [],
  paymentCondition: "Adesão à vista; mensalidade no boleto.",
};

describe("variáveis do modelo", () => {
  it("acha as variáveis na ordem, sem repetir", () => {
    expect(extractVariables("Eu, {{ razao_social }}, CNPJ {{cnpj}}; de novo {{razao_social}} e {{}}")).toEqual(["razao_social", "cnpj"]);
  });
  it("sugere o campo pelo nome usado no Word da Clicksign", () => {
    expect(normalizeVariableName("Razão Social")).toBe("razao_social");
    expect(suggestField("Razão Social")).toBe("contratante.razao_social");
    expect(suggestField("CNPJ")).toBe("contratante.cnpj_cpf");
    expect(suggestField("valor_mensal")).toBe("valores.mensalidade");
    expect(suggestField("contrato.numero")).toBe("contrato.numero");
    expect(suggestField("contrato_numero")).toBe("contrato.numero");
    expect(suggestField("Bairro")).toBe("contratante.bairro");
    expect(suggestField("logradouro")).toBe("contratante.logradouro");
    expect(suggestField("Número do endereço")).toBe("contratante.numero");
    expect(suggestField("numero")).toBe("contrato.numero");
    expect(suggestField("complemento")).toBe("contratante.complemento");
    expect(suggestField("Cidade/UF")).toBe("contratante.cidade_uf");
    expect(suggestField("Nº do endereço")).toBe("contratante.numero");
    expect(suggestField("Valor de Mensalidade")).toBe("valores.mensalidade");
    expect(suggestField("cor_favorita")).toBeUndefined();
  });

  it("\"numero\" ao lado de um logradouro separado é o número do endereço; sozinho (ou só com bairro/cep) é o do contrato", () => {
    expect(suggestField("Número", ["Logradouro", "Número", "Bairro"])).toBe("contratante.numero");
    expect(suggestField("numero", ["rua", "numero"])).toBe("contratante.numero");
    expect(suggestField("Número", ["Contrato", "Número"])).toBe("contrato.numero");
    expect(suggestField("Número", ["endereco", "Número", "bairro", "cep"])).toBe("contrato.numero");
    expect(suggestField("Número", ["Logradouro", "numero_endereco", "Número"])).toBe("contrato.numero");
    expect(suggestField("Número", ["Logradouro", "contratante.numero", "Número"])).toBe("contrato.numero");
    expect(mergeVariables(["Logradouro", "Número", "Bairro"]).map((v) => v.field)).toEqual(["contratante.logradouro", "contratante.numero", "contratante.bairro"]);
    expect(mergeVariables(["numero"]).map((v) => v.field)).toEqual(["contrato.numero"]);
  });

  it("suggestUnbound: só quem está sem ligação e sem texto fixo recebe sugestão (com o contexto do modelo)", () => {
    const out = suggestUnbound([{ name: "Razão Social", field: "contratante.razao_social" }, { name: "Logradouro" }, { name: "Número", field: "contrato.numero" }, { name: "Bairro" }, { name: "Foro", fixed: "Crato/CE" }, { name: "Sistema Operacional" }]);
    expect(out).toEqual([
      { name: "Razão Social", field: "contratante.razao_social" },
      { name: "Logradouro", field: "contratante.logradouro" },
      { name: "Número", field: "contrato.numero" },
      { name: "Bairro", field: "contratante.bairro" },
      { name: "Foro", fixed: "Crato/CE" },
      { name: "Sistema Operacional" },
    ]);
  });
  it("mantém as ligações já salvas e sugere as novas", () => {
    const merged = mergeVariables(["cnpj", "cor_favorita", "data"], [{ name: "cnpj", fixed: "00.000.000/0001-00" }]);
    expect(merged).toEqual([{ name: "cnpj", fixed: "00.000.000/0001-00" }, { name: "cor_favorita" }, { name: "data", field: "contrato.data_emissao" }]);
    expect(unmappedVariables(merged)).toEqual(["cor_favorita"]);
  });
  it("preenche: campo, texto fixo e lacuna", () => {
    const values = variableValues([{ name: "nome", field: "contratante.razao_social" }, { name: "foro", fixed: "Juazeiro do Norte/CE" }, { name: "x" }], { "contratante.razao_social": "ACME LTDA" });
    expect(fillTemplateText("{{nome}} · {{foro}} · {{x}} · {{y}}", values)).toBe(`ACME LTDA · Juazeiro do Norte/CE · ${BLANK} · ${BLANK}`);
  });

  it("variável fora da lista gravada: nome exato de campo vale, apelido não; gravada sem campo é lacuna mesmo com nome exato", () => {
    const fields = { "contratante.cidade": "Crato", "contratante.bairro": "Centro", "contratante.uf": "CE" };
    const values = variableValues([{ name: "contratante.cidade" }, { name: "bairro" }], fields, ["contratante_uf", "contratante.bairro", "cidade"]);
    expect(values["contratante.cidade"]).toBe(BLANK);
    expect(values["bairro"]).toBe(BLANK);
    expect(values["contratante_uf"]).toBe("CE");
    expect(values["contratante.bairro"]).toBe("Centro");
    expect(values["cidade"]).toBe(BLANK);
  });

  it("partes opcionais do endereço vazias saem vazias, não como lacuna; dado faltante continua lacuna", () => {
    const f = contractFieldValues({
      contract: CONTRACT,
      client: { legalName: "ACME Comércio LTDA", tradeName: "ACME" },
      billingData: { document: "", email: "fin@acme.com.br", address: { street: "Sítio Boa Vista", city: "Crato", state: "CE" } },
      companyName: "Intercert",
      companyAddress: "Juazeiro do Norte/CE",
      issuedAt: "2026-10-21T15:00:00.000Z",
      labels: { recurrence: "Mensal", paymentMethod: "Boleto" },
    });
    const values = variableValues(
      [
        { name: "logradouro", field: "contratante.logradouro" },
        { name: "numero", field: "contratante.numero" },
        { name: "complemento", field: "contratante.complemento" },
        { name: "bairro", field: "contratante.bairro" },
        { name: "cep", field: "contratante.cep" },
        { name: "cnpj", field: "contratante.cnpj_cpf" },
      ],
      f,
    );
    expect(fillTemplateText("{{logradouro}}, {{numero}} {{complemento}} - {{bairro}} - {{cep}} - {{cnpj}}", values)).toBe(`Sítio Boa Vista,   -  - ${BLANK} - ${BLANK}`);
    expect(f["contratante.endereco"]).toBe("Sítio Boa Vista - Crato/CE");
  });
});

describe("valor por extenso", () => {
  it("números", () => {
    expect(integerInWords(1500)).toBe("mil e quinhentos");
    expect(integerInWords(2345)).toBe("dois mil trezentos e quarenta e cinco");
    expect(integerInWords(100)).toBe("cem");
    expect(integerInWords(1_000_001)).toBe("um milhão e um");
  });
  it("reais e centavos", () => {
    expect(currencyInWords(1500.5)).toBe("mil e quinhentos reais e cinquenta centavos");
    expect(currencyInWords(1)).toBe("um real");
    expect(currencyInWords(0.01)).toBe("um centavo");
    expect(currencyInWords(2_000_000)).toBe("dois milhões de reais");
  });
});

describe("campos do contrato", () => {
  it("monta os valores (cliente, Intercert, prazo e valores por extenso)", () => {
    const f = contractFieldValues({
      contract: CONTRACT,
      client: { legalName: "ACME Comércio LTDA", tradeName: "ACME" },
      billingData: { document: "12345678000190", email: "fin@acme.com.br", address: { street: "Rua A", number: "10", complement: "Sala 2", district: "Centro", city: "Crato", state: "CE", zip: "63100-000" } },
      companyName: "Intercert",
      companyAddress: "Juazeiro do Norte/CE",
      issuedAt: "2026-10-21T15:00:00.000Z",
      labels: { recurrence: "Mensal", paymentMethod: "Boleto" },
    });
    expect(f["contratante.razao_social"]).toBe("ACME Comércio LTDA");
    expect(f["contratante.cnpj_cpf"]).toBe("12.345.678/0001-90");
    expect(f["contratante.endereco"]).toBe("Rua A, 10 - Sala 2 - Centro - Crato/CE - CEP 63100-000");
    expect(f["contratante.logradouro"]).toBe("Rua A");
    expect(f["contratante.numero"]).toBe("10");
    expect(f["contratante.complemento"]).toBe("Sala 2");
    expect(f["contratante.bairro"]).toBe("Centro");
    expect(f["contratante.cidade_uf"]).toBe("Crato/CE");
    expect(f["contratante.representante"]).toBe("Maria Cliente");
    expect(f["contratada.representante"]).toBe("Hércules Andrade");
    expect(f["contrato.data_emissao"]).toBe("21 de outubro de 2026");
    expect(f["contrato.prazo_meses"]).toBe("12 (doze) meses");
    expect(f["valores.mensalidade_extenso"]).toBe("R$ 349,90 (trezentos e quarenta e nove reais e noventa centavos)");
    expect(f["valores.total"]).toBe("R$ 5.698,80");
  });
  it("signatário da Intercert: Hércules por padrão; precisa de nome e e-mail", () => {
    expect(isDefaultCompanySignerName("Hércules Andrade")).toBe(true);
    expect(isDefaultCompanySignerName("Hercules")).toBe(true);
    expect(isDefaultCompanySignerName("Ana Hércules")).toBe(false);
    expect(companySignerReady({ enabled: true, name: "Hércules", email: "h@intercert.com.br", role: "x" })).toBe(true);
    expect(companySignerReady({ enabled: true, name: "Hércules", email: "", role: "x" })).toBe(false);
    expect(companySignerReady({ enabled: false, name: "Hércules", email: "h@intercert.com.br", role: "x" })).toBe(false);
  });
});

/** Word mínimo (zip com word/document.xml e um cabeçalho). */
function makeDocx(documentXml: string, headerXml?: string): Buffer {
  const parts: [string, string][] = [
    ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ["word/document.xml", documentXml],
    ...(headerXml ? ([["word/header1.xml", headerXml]] as [string, string][]) : []),
  ];
  const entries = parts.map(([name]) => ({ name, method: 0, crc: 0, compressedSize: 0, size: 0, raw: Buffer.alloc(0) }));
  return writeZip(entries, new Map(parts.map(([name, xml]) => [name, Buffer.from(xml, "utf8")])));
}

const DOC = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
<w:p><w:r><w:t xml:space="preserve">Cliente: {{</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>razao_</w:t></w:r><w:r><w:t>social}} paga {{valor_mensal}} &amp; mais.</w:t></w:r></w:p>
<w:p><w:r><w:tab/><w:t>Condição: {{condicao}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Aberto {{</w:t></w:r></w:p><w:p><w:r><w:t>}} fechado em outro parágrafo</w:t></w:r></w:p>
</w:body></w:document>`;

describe("Word (.docx)", () => {
  it("acha as variáveis mesmo partidas em vários trechos (corpo e cabeçalho)", () => {
    const buf = makeDocx(DOC, `<w:hdr xmlns:w="w"><w:p><w:r><w:t>Contrato {{numero_contrato}}</w:t></w:r></w:p></w:hdr>`);
    const info = inspectDocx(buf);
    expect(info.variables).toEqual(["razao_social", "valor_mensal", "condicao", "numero_contrato"]);
    expect(info.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(info.preview).toContain("Cliente: {{razao_social}}");
  });
  it("preenche: junta os trechos da variável, escapa o XML, quebra de linha vira <w:br/>", () => {
    const filled = fillDocx(makeDocx(DOC), { razao_social: "ACME <LTDA>", valor_mensal: "R$ 10,00", condicao: "linha 1\nlinha 2" }, BLANK);
    expect(readZip(filled).map((e) => e.name)).toEqual(["[Content_Types].xml", "word/document.xml"]);
    const text = docxText(filled);
    expect(text).toContain("Cliente: ACME <LTDA> paga R$ 10,00 & mais.");
    expect(text).toContain("Condição: linha 1linha 2");
    // Variável que atravessa parágrafos não é tocada.
    expect(text).toContain("Aberto {{");
    const xml = fillXml(DOC, { condicao: "a\nb" }, BLANK);
    expect(xml).toContain('<w:t xml:space="preserve">Condição: a</w:t><w:br/><w:t xml:space="preserve">b</w:t>');
    expect(xml).toContain(`Cliente: ${BLANK}`);
    expect(fillXml(DOC, { razao_social: "A<B" }, BLANK)).toContain("Cliente: A&lt;B");
  });
  it("recusa o que não é Word", () => {
    expect(() => inspectDocx(Buffer.from("não é zip"))).toThrow(/Word/);
    const zipSemDocumento = writeZip([{ name: "a.txt", method: 0, crc: 0, compressedSize: 0, size: 0, raw: Buffer.alloc(0) }], new Map([["a.txt", Buffer.from("x")]]));
    expect(() => inspectDocx(zipSemDocumento)).toThrow(/Word/);
  });
});

describe("caixa de entrada: sugestão do cliente", () => {
  const clients = [
    { id: "a", tradeName: "ACME", email: "contato@acme.com.br", document: "12.345.678/0001-90" },
    { id: "b", tradeName: "Beta", email: "beta@gmail.com", document: "" },
  ];
  const contacts = [{ clientId: "b", email: "joao@beta.com.br", name: "João" }];
  it("pelo CNPJ, pelo e-mail do cliente, pelo contato e pelo domínio; ignora quem assina pela Intercert", () => {
    expect(suggestClient([{ name: "X", email: "x@y.com", document: "12345678000190" }], clients, contacts)?.clientId).toBe("a");
    expect(suggestClient([{ name: "Hércules", email: "contato@acme.com.br" }], clients, contacts, ["contato@acme.com.br"])).toBeNull();
    expect(suggestClient([{ name: "João", email: "JOAO@beta.com.br" }], clients, contacts)).toEqual({ clientId: "b", reason: "João é contato do cliente" });
    expect(suggestClient([{ name: "Ana", email: "ana@acme.com.br" }], clients, contacts)?.reason).toContain("@acme.com.br");
    expect(suggestClient([{ name: "Zé", email: "ze@gmail.com" }], clients, contacts)).toBeNull();
  });
});

describe("código de integridade com o modelo", () => {
  it("contratos sem modelo mantêm o hash; o modelo fixado muda o hash", () => {
    const base = contractDocumentHash(CONTRACT);
    const withTemplate = contractDocumentHash({ ...CONTRACT, documentTemplate: { id: "t1", name: "Padrão", kind: "interos", version: 1, contentHash: "sha256:aa" } });
    const otherVersion = contractDocumentHash({ ...CONTRACT, documentTemplate: { id: "t1", name: "Padrão", kind: "interos", version: 2, contentHash: "sha256:bb" } });
    expect(new Set([base, withTemplate, otherVersion]).size).toBe(3);
    const chosenOnly: Contract = { ...CONTRACT, templateId: "t9" };
    expect(contractDocumentHash(chosenOnly)).toBe(base);
  });
});

describe("PDF do contrato", () => {
  it("gera um PDF com as cláusulas e o nome do arquivo", async () => {
    const data: ContractDocumentData = {
      contract: CONTRACT,
      client: { legalName: "ACME Comércio LTDA", tradeName: "ACME" },
      billingData: { legalName: "ACME Comércio LTDA", document: "12345678000190", address: { city: "Crato", state: "CE" } },
      companyName: "Intercert",
      companyAddress: "Juazeiro do Norte/CE",
      issuedAt: "2026-10-21T15:00:00.000Z",
      template: { id: "t1", name: "Padrão", kind: "interos", version: 3, contentHash: "sha256:aa" },
      preview: false,
      values: {},
      clauses: { title: "Contrato de licenciamento", text: "CLÁUSULA PRIMEIRA – DO OBJETO\n\nTexto da cláusula com acentuação: ção, ã, é.\n\n".repeat(20) },
      gaps: [],
      variableCount: 0,
      hash: "sha256:abc",
    };
    const { buffer, fileName } = await contractPdf(data);
    expect(fileName).toBe("contrato-CTR-2026-0042-v2.pdf");
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(3000);
  });
});

describe("isSignerEmail", () => {
  it("segue a regra do zod (a mesma dos schemas): o cadastro de contatos aceita mais do que a assinatura", () => {
    expect(isSignerEmail("Maria@Acme.com.br")).toBe(true);
    expect(isSignerEmail(" ana.lima+fin@intercert.com.br ")).toBe(true);
    for (const bad of ["a..b@acme.com", "joão@acme.com.br", ".ab@acme.com", "x@y_z.com", "sem-arroba", ""]) expect(isSignerEmail(bad), bad).toBe(false);
  });
});

describe("dados obrigatórios do modelo", () => {
  const base = contractFieldValues({
    contract: CONTRACT,
    client: { legalName: "ACME Comércio LTDA", tradeName: "ACME" },
    billingData: { document: "12345678000190", email: "fin@acme.com.br", address: { street: "Rua A", number: "10", city: "Crato", state: "CE", zip: "63100-000" } },
    companyName: "Intercert",
    companyAddress: "Juazeiro do Norte/CE",
    issuedAt: "2026-10-21T15:00:00.000Z",
    labels: { recurrence: "Mensal" },
    representative: { name: "Maria Cliente", email: "maria@acme.com.br", document: "52998224725" },
  });

  it("CPF do representante vem do contato do 1º signatário, formatado; \"cpf\" ao lado de um CNPJ é o do representante", () => {
    expect(base["contratante.representante_cpf"]).toBe("529.982.247-25");
    expect(base["contratante.representante"]).toBe("Maria Cliente");
    expect(suggestField("CPF do Representante Legal")).toBe("contratante.representante_cpf");
    expect(suggestField("CPF", ["CNPJ", "CPF"])).toBe("contratante.representante_cpf");
    expect(suggestField("cpf", ["razao_social", "cpf_cnpj", "cpf"])).toBe("contratante.representante_cpf");
    expect(suggestField("CPF", ["razao_social", "CPF"])).toBe("contratante.cnpj_cpf");
    expect(mergeVariables(["CNPJ", "Representante", "CPF"]).map((v) => v.field)).toEqual(["contratante.cnpj_cpf", "contratante.representante", "contratante.representante_cpf"]);
  });

  it("representante do cliente: 1º signatário que não é da Intercert nem testemunha", () => {
    const signers = [
      { name: "Pedro Equipe", email: "pedro@intercert.com.br", role: "Testemunha" },
      { name: "Diretor Intercert", email: "dir@intercert.com.br", role: "Diretor", party: "contratada" as const },
      { name: "Maria Cliente", email: "maria@acme.com.br", role: "Contratante" },
    ];
    expect(clientRepresentative(signers)?.name).toBe("Maria Cliente");
    expect(clientRepresentative(signers.slice(0, 2))).toBeUndefined();
    expect(isWitnessSigner({ role: "TESTEMUNHA 1" })).toBe(true);
  });

  it("lista o que falta: campo sem dado (com a origem) e variável sem ligação; texto fixo e opcionais não contam", () => {
    const gaps = templateDataGaps(
      [
        { name: "Razão Social", field: "contratante.razao_social" },
        { name: "Bairro", field: "contratante.bairro" },
        { name: "Complemento", field: "contratante.complemento" },
        { name: "Forma de pagamento", field: "contrato.forma_pagamento" },
        { name: "Início", field: "contrato.inicio_vigencia" },
        { name: "Sistema Operacional" },
        { name: "Foro", fixed: "Crato/CE" },
      ],
      base,
    );
    expect(gaps).toEqual([
      { variable: "Bairro", reason: "sem_dado", field: "contratante.bairro", label: "Bairro do cliente", source: "cliente" },
      { variable: "Forma de pagamento", reason: "sem_dado", field: "contrato.forma_pagamento", label: "Forma de pagamento", source: "contrato" },
      { variable: "Início", reason: "apos_liberacao", field: "contrato.inicio_vigencia", label: "Início da vigência" },
      { variable: "Sistema Operacional", reason: "sem_ligacao", label: "Sem campo ligado nem texto fixo no modelo" },
    ]);
  });

  it("1º vencimento e condição de pagamento são obrigatórios quando o modelo usa (editáveis nas condições)", () => {
    const fields = { ...base, "contrato.primeiro_vencimento": "", "contrato.condicao_pagamento": "" };
    const gaps = templateDataGaps([{ name: "venc", field: "contrato.primeiro_vencimento" }, { name: "cond", field: "contrato.condicao_pagamento" }], fields);
    expect(gaps.map((g) => [g.variable, g.reason, g.source])).toEqual([
      ["venc", "sem_dado", "contrato"],
      ["cond", "sem_dado", "contrato"],
    ]);
  });

  it("variáveis do texto do modelo INTEROS: nome exato de campo vale; apelido fora da lista gravada é pendência", () => {
    const gaps = templateDataGaps([], base, ["contratante.razao_social", "contratante.representante_cpf", "bairro"]);
    expect(gaps.map((g) => [g.variable, g.reason])).toEqual([["bairro", "sem_ligacao"]]);
  });

  it("sem pendências quando tudo tem dado ou texto fixo", () => {
    expect(templateDataGaps([{ name: "cnpj", field: "contratante.cnpj_cpf" }, { name: "x", fixed: "ok" }], base)).toEqual([]);
  });

  it("exigências do modelo agrupadas pela origem, sem repetir campo nem contar opcionais e texto fixo", () => {
    const req = templateRequirements([
      { name: "Razão Social", field: "contratante.razao_social" },
      { name: "Cliente", field: "contratante.razao_social" },
      { name: "CPF", field: "contratante.representante_cpf" },
      { name: "Complemento", field: "contratante.complemento" },
      { name: "Mensalidade", field: "valores.mensalidade" },
      { name: "Fim", field: "contrato.fim_vigencia" },
      { name: "Foro", fixed: "Crato/CE" },
      { name: "Sistema Operacional" },
    ]);
    expect(req.bySource).toEqual([
      { source: "cliente", labels: ["Razão social do cliente"] },
      { source: "contato", labels: ["CPF do representante do cliente"] },
      { source: "contrato", labels: ["Mensalidade"] },
    ]);
    expect(req.unbound).toEqual(["Sistema Operacional"]);
    expect(req.afterRelease).toEqual(["Fim da vigência"]);
  });
});
