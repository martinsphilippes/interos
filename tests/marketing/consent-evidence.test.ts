/**
 * Comprovantes do consentimento LGPD — regras puras: arquivos em partes (src/domain/stored-files.ts) e o que pode ser
 * anexado/removido (src/domain/consent-evidence.ts).
 */
import { describe, expect, it } from "vitest";
import { STORED_FILE_CHUNK_BYTES, chunkBytesAt, chunkCountFor, fileExtension, formatBytes, safeFileName, sha256Tag, SHA256_TAG } from "@/domain/stored-files";
import {
  CONSENT_EVIDENCE_MAX_BYTES,
  CONSENT_EVIDENCE_UNDO_MS,
  canRemoveConsentEvidence,
  consentEvidenceKind,
  consentEvidenceMimeType,
  consentEvidenceProblem,
  extensionForMimeType,
  isInlineEvidenceType,
  isValidEvidenceThumbnail,
} from "@/domain/consent-evidence";

const MB = 1024 * 1024;

describe("arquivos em partes", () => {
  it("partes de 2 MB: quantidade e tamanho de cada parte (a última é o resto)", () => {
    expect(STORED_FILE_CHUNK_BYTES).toBe(2 * MB);
    expect(chunkCountFor(1)).toBe(1);
    expect(chunkCountFor(2 * MB)).toBe(1);
    expect(chunkCountFor(2 * MB + 1)).toBe(2);
    expect(chunkCountFor(50 * MB)).toBe(25);
    expect(chunkBytesAt(5 * MB, 0)).toBe(2 * MB);
    expect(chunkBytesAt(5 * MB, 2)).toBe(1 * MB);
    expect(chunkBytesAt(4 * MB, 1)).toBe(2 * MB);
    expect(chunkBytesAt(10, 0)).toBe(10);
  });

  it("parte fora do intervalo ou não inteira não existe", () => {
    expect(chunkBytesAt(5 * MB, 3)).toBe(0);
    expect(chunkBytesAt(5 * MB, -1)).toBe(0);
    expect(chunkBytesAt(5 * MB, 1.5)).toBe(0);
    expect(chunkBytesAt(5 * MB, Number.NaN)).toBe(0);
  });

  it("hash no formato gravado", () => {
    const hex = "A".repeat(64);
    expect(sha256Tag(hex)).toBe(`sha256:${"a".repeat(64)}`);
    expect(SHA256_TAG.test(sha256Tag(hex))).toBe(true);
    expect(SHA256_TAG.test(`sha256:${"g".repeat(64)}`)).toBe(false);
    expect(SHA256_TAG.test("a".repeat(64))).toBe(false);
  });

  it("nome seguro: sem caminho, controle ou reservados; corta mantendo a extensão", () => {
    expect(safeFileName("C:\\Users\\ana\\print 1.png")).toBe("print 1.png");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName('a<b>:"c|d?*e.pdf')).toBe("abcde.pdf");
    expect(safeFileName("linha\u0000\u0007\nquebrada.txt")).toBe("linhaquebrada.txt");
    // Caractere invisível que inverte o texto ("termo-‮fdp.mp4" apareceria como "termo-4pm.pdf").
    expect(safeFileName("termo-\u202Efdp.mp4")).toBe("termo-fdp.mp4");
    expect(safeFileName("a\u200Bb\uFEFF\u2066c.png")).toBe("abc.png");
    expect(safeFileName("   ")).toBe("arquivo");
    expect(safeFileName("..")).toBe("arquivo");
    const long = `${"x".repeat(200)}.jpeg`;
    expect(safeFileName(long)).toHaveLength(120);
    expect(safeFileName(long).endsWith(".jpeg")).toBe(true);
  });

  it("extensão e tamanho legível", () => {
    expect(fileExtension("Termo.PDF")).toBe("pdf");
    expect(fileExtension("sem-extensao")).toBe("");
    expect(fileExtension(".oculto")).toBe("");
    expect(fileExtension("ponto.")).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(850 * 1024)).toBe("850 KB");
    expect(formatBytes(12.5 * MB)).toBe("12,5 MB");
    expect(formatBytes(50 * MB)).toBe("50 MB");
    expect(formatBytes(3 * 1024 * MB)).toBe("3 GB");
    expect(formatBytes(1.5 * 1024 * MB)).toBe("1,5 GB");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("comprovantes do consentimento", () => {
  it("tipo vem da extensão (nunca do navegador); HTML, SVG e executáveis ficam de fora", () => {
    expect(consentEvidenceMimeType("print.PNG")).toBe("image/png");
    expect(consentEvidenceMimeType("termo.pdf")).toBe("application/pdf");
    expect(consentEvidenceMimeType("PTT-20261110-WA0001.opus")).toBe("audio/ogg");
    expect(consentEvidenceMimeType("email.eml")).toBe("message/rfc822");
    for (const name of ["pagina.html", "desenho.svg", "virus.exe", "script.js", "sem-extensao"]) expect(consentEvidenceMimeType(name), name).toBeNull();
  });

  it("o que impede anexar: tipo, vazio, acima de 50 MB", () => {
    expect(consentEvidenceProblem({ name: "print.png", size: 1000 })).toBeNull();
    expect(consentEvidenceProblem({ name: "grande.mp4", size: CONSENT_EVIDENCE_MAX_BYTES })).toBeNull();
    expect(consentEvidenceProblem({ name: "pagina.html", size: 10 })).toMatch(/\.html não são aceitos/);
    expect(consentEvidenceProblem({ name: "sem-extensao", size: 10 })).toMatch(/sem extensão/);
    expect(consentEvidenceProblem({ name: "vazio.pdf", size: 0 })).toMatch(/vazio/);
    expect(consentEvidenceProblem({ name: "enorme.mp4", size: CONSENT_EVIDENCE_MAX_BYTES + 1 })).toMatch(/limite é 50 MB/);
  });

  it("abrir no navegador só para imagem, PDF, áudio, vídeo e texto", () => {
    expect(isInlineEvidenceType("image/png")).toBe(true);
    expect(isInlineEvidenceType("application/pdf")).toBe(true);
    expect(isInlineEvidenceType("audio/ogg")).toBe(true);
    expect(isInlineEvidenceType("image/heic")).toBe(false);
    expect(isInlineEvidenceType("message/rfc822")).toBe(false);
    expect(isInlineEvidenceType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
  });

  it("tipo do ícone e extensão para arquivo sem extensão", () => {
    expect(consentEvidenceKind("image/webp")).toBe("imagem");
    expect(consentEvidenceKind("application/vnd.ms-outlook")).toBe("email");
    expect(consentEvidenceKind("video/quicktime")).toBe("video");
    expect(consentEvidenceKind("application/msword")).toBe("documento");
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("text/html")).toBeNull();
  });

  it("miniatura: só data URL de imagem em base64 e dentro do limite", () => {
    expect(isValidEvidenceThumbnail("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
    expect(isValidEvidenceThumbnail("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isValidEvidenceThumbnail("data:text/html;base64,PGgxPg==")).toBe(false);
    expect(isValidEvidenceThumbnail("https://exemplo.com/a.png")).toBe(false);
    expect(isValidEvidenceThumbnail(`data:image/png;base64,${"A".repeat(70_000)}`)).toBe(false);
  });

  it("remover: quem tem a chave, sempre; quem anexou (e pode anexar), só na primeira hora", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    const base = { viewerId: "u1", uploadedById: "u1", completedAt: "2026-11-10T14:30:00Z", now };
    expect(canRemoveConsentEvidence({ ...base, canRemoveAny: false, canRemoveOwn: true })).toBe(true);
    expect(canRemoveConsentEvidence({ ...base, viewerId: "u2", canRemoveAny: false, canRemoveOwn: true })).toBe(false);
    expect(canRemoveConsentEvidence({ ...base, canRemoveAny: false, canRemoveOwn: false })).toBe(false);
    expect(canRemoveConsentEvidence({ ...base, uploadedById: "u2", canRemoveAny: false, canRemoveOwn: true })).toBe(false);
    const late = new Date(Date.parse(base.completedAt) + CONSENT_EVIDENCE_UNDO_MS + 1000);
    expect(canRemoveConsentEvidence({ ...base, now: late, canRemoveAny: false, canRemoveOwn: true })).toBe(false);
    expect(canRemoveConsentEvidence({ ...base, now: late, canRemoveAny: true, canRemoveOwn: false })).toBe(true);
    expect(canRemoveConsentEvidence({ ...base, completedAt: undefined, canRemoveAny: false, canRemoveOwn: true })).toBe(false);
  });
});
