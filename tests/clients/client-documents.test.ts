/**
 * Documentos do cliente (regras puras): tipos aceitos (sem HTML/SVG), tamanho, o que abre no navegador, nome e
 * categoria sugeridos pelo nome do arquivo (contrato social, cartão CNPJ…), mesmo nome para a versão, quem pode remover
 * (gestor sempre; quem enviou só na primeira hora), documento ativo e a regra comum de remoção dos envios.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_MAX_BYTES,
  CLIENT_DOCUMENT_TYPES,
  CLIENT_DOCUMENT_UNDO_MS,
  CLIENT_ESSENTIAL_DOCUMENTS,
  canRemoveClientDocument,
  clientDocumentExtensionFor,
  clientDocumentFileUrl,
  clientDocumentMimeType,
  clientDocumentProblem,
  isActiveDocument,
  isInlineClientDocumentType,
  sameDocumentTitle,
  suggestDocumentCategory,
  suggestDocumentTitle,
} from "@/domain/client-documents";
import { canRemoveUpload } from "@/domain/stored-files";

describe("tipos e tamanho", () => {
  it("aceita PDF, imagens, Office, XML, ZIP, e-mail e PDF assinado (.p7s); recusa HTML, SVG, scripts e executáveis", () => {
    for (const name of ["contrato.pdf", "cnpj.PNG", "rg.jpeg", "foto.heic", "planilha.xlsx", "ficha.docx", "nfe.xml", "pacote.zip", "email.eml", "assinado.p7s", "dados.csv"]) {
      expect(clientDocumentMimeType(name), name).not.toBeNull();
    }
    for (const name of ["pagina.html", "pagina.htm", "logo.svg", "script.js", "app.exe", "sem-extensao"]) {
      expect(clientDocumentMimeType(name), name).toBeNull();
    }
    expect(Object.values(CLIENT_DOCUMENT_TYPES).some((t) => /html|svg|javascript/.test(t))).toBe(false);
    expect(CLIENT_DOCUMENT_ACCEPT).toContain(".pdf");
    expect(CLIENT_DOCUMENT_ACCEPT).not.toContain(".html");
  });

  it("explica por que não aceita: tipo, vazio e acima do limite", () => {
    expect(clientDocumentProblem({ name: "x.html", size: 10 })).toMatch(/\.html não são aceitos/);
    expect(clientDocumentProblem({ name: "x", size: 10 })).toMatch(/sem extensão/);
    expect(clientDocumentProblem({ name: "x.pdf", size: 0 })).toBe("O arquivo está vazio.");
    expect(clientDocumentProblem({ name: "x.pdf", size: CLIENT_DOCUMENT_MAX_BYTES + 1 })).toMatch(/o limite é 50 MB/);
    expect(clientDocumentProblem({ name: "x.pdf", size: CLIENT_DOCUMENT_MAX_BYTES })).toBeNull();
  });

  it("abre no navegador só PDF, imagem comum e texto; o resto baixa", () => {
    expect(isInlineClientDocumentType("application/pdf")).toBe(true);
    expect(isInlineClientDocumentType("image/png")).toBe(true);
    expect(isInlineClientDocumentType("text/plain")).toBe(true);
    for (const type of ["image/heic", "application/xml", "application/zip", "text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
      expect(isInlineClientDocumentType(type), type).toBe(false);
    }
  });

  it("extensão para arquivo sem extensão (print colado)", () => {
    expect(clientDocumentExtensionFor("image/jpeg")).toBe("jpg");
    expect(clientDocumentExtensionFor("image/png")).toBe("png");
    expect(clientDocumentExtensionFor("text/html")).toBeNull();
  });
});

describe("sugestões pelo nome do arquivo", () => {
  it("categoria: contrato social, cartão CNPJ, documentos dos sócios, comprovantes, certidões…", () => {
    const cases: [string, string][] = [
      ["Contrato Social - Padaria.pdf", "Contrato social"],
      ["contrato_social_2024.pdf", "Contrato social"],
      ["Alteração contratual 3.pdf", "Contrato social"],
      ["CCMEI.pdf", "Contrato social"],
      ["Cartão CNPJ.pdf", "Cartão CNPJ"],
      ["cartao-cnpj.png", "Cartão CNPJ"],
      ["Comprovante de Inscrição e Situação Cadastral.pdf", "Cartão CNPJ"],
      ["CNH João.jpg", "Documento dos sócios"],
      ["rg_maria.jpeg", "Documento dos sócios"],
      ["Comprovante de endereço.pdf", "Comprovante de endereço"],
      ["conta de luz maio.pdf", "Comprovante de endereço"],
      ["Alvará de funcionamento.pdf", "Alvará e licenças"],
      ["CND federal.pdf", "Certidão"],
      ["Procuração.pdf", "Procuração"],
      ["boleto-setup.pdf", "Comprovante de pagamento"],
      ["DANFE 123.pdf", "Documento fiscal"],
      ["Proposta comercial.pdf", "Proposta"],
      ["Contrato de prestação de serviços.pdf", "Contrato"],
      ["Ficha cadastral.xlsx", "Cadastro"],
      ["Comprovante de Inscrição Estadual.pdf", "Cadastro"],
      ["inscricao-municipal.pdf", "Cadastro"],
      ["comprovante_inscricao_situacao_cadastral.pdf", "Cartão CNPJ"],
      ["foto.png", "Outro"],
    ];
    for (const [file, category] of cases) expect(suggestDocumentCategory(file), file).toBe(category);
  });

  it("documentos de cadastro conferidos pela aba", () => {
    expect([...CLIENT_ESSENTIAL_DOCUMENTS]).toEqual(["Contrato social", "Cartão CNPJ"]);
  });

  it("nome: sem extensão, separadores viram espaço, primeira letra maiúscula", () => {
    expect(suggestDocumentTitle("contrato_social-2024.pdf")).toBe("Contrato social 2024");
    expect(suggestDocumentTitle("Cartão CNPJ.pdf")).toBe("Cartão CNPJ");
    expect(suggestDocumentTitle("print-2026-11-10-09h30m00s.png")).toBe("Print de 10/11/2026 09h30");
    expect(suggestDocumentTitle("rg - joão.jpg")).toBe("Rg - joão");
    expect(suggestDocumentTitle(".pdf")).toBe("Documento");
    expect(suggestDocumentTitle(`${"a".repeat(300)}.pdf`)).toHaveLength(160);
  });

  it("nome igual à categoria vira o nome da categoria (com acentos)", () => {
    expect(suggestDocumentTitle("cartao-cnpj.png", "Cartão CNPJ")).toBe("Cartão CNPJ");
    expect(suggestDocumentTitle("CONTRATO_SOCIAL.pdf", "Contrato social")).toBe("Contrato social");
    expect(suggestDocumentTitle("contrato social 2024.pdf", "Contrato social")).toBe("Contrato social 2024");
  });

  it("mesmo nome para a versão: ignora maiúsculas, acentos e espaços extras", () => {
    expect(sameDocumentTitle("Cartão CNPJ", "cartao  cnpj ")).toBe(true);
    expect(sameDocumentTitle("Contrato social", "Contrato social 2024")).toBe(false);
  });
});

describe("remover", () => {
  const now = new Date("2026-11-10T15:00:00.000Z");
  const base = { canRemoveAny: false, canRemoveOwn: true, viewerId: "u1", uploadedById: "u1", now };

  it("quem enviou só na primeira hora; gestor sempre; outra pessoa nunca", () => {
    expect(canRemoveClientDocument({ ...base, completedAt: new Date(now.getTime() - 10 * 60_000).toISOString() })).toBe(true);
    expect(canRemoveClientDocument({ ...base, completedAt: new Date(now.getTime() - CLIENT_DOCUMENT_UNDO_MS - 1).toISOString() })).toBe(false);
    expect(canRemoveClientDocument({ ...base, viewerId: "u2", completedAt: now.toISOString() })).toBe(false);
    expect(canRemoveClientDocument({ ...base, canRemoveOwn: false, completedAt: now.toISOString() })).toBe(false);
    expect(canRemoveClientDocument({ ...base, canRemoveAny: true, viewerId: "u2", completedAt: "2020-01-01T00:00:00.000Z" })).toBe(true);
    expect(canRemoveClientDocument({ ...base, completedAt: undefined })).toBe(false);
  });

  it("regra comum de remoção dos envios (janela informada)", () => {
    expect(canRemoveUpload({ ...base, completedAt: new Date(now.getTime() - 5_000).toISOString(), undoMs: 10_000 })).toBe(true);
    expect(canRemoveUpload({ ...base, completedAt: new Date(now.getTime() - 20_000).toISOString(), undoMs: 10_000 })).toBe(false);
    expect(canRemoveUpload({ ...base, completedAt: "não é data", undoMs: 10_000 })).toBe(false);
  });

  it("documento ativo: removido não conta", () => {
    expect(isActiveDocument({})).toBe(true);
    expect(isActiveDocument({ status: "ativo" })).toBe(true);
    expect(isActiveDocument({ status: "removido" })).toBe(false);
  });
});

it("endereço do arquivo (abrir e baixar)", () => {
  expect(clientDocumentFileUrl("c 1", "f/2")).toBe("/api/clientes/c%201/documentos/f%2F2");
  expect(clientDocumentFileUrl("c1", "f2", true)).toBe("/api/clientes/c1/documentos/f2?download=1");
});
