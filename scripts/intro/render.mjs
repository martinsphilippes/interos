/**
 * Grava a abertura do INTEROS (scripts/intro/intro.html) em vídeo.
 *
 *   node scripts/intro/render.mjs            → public/intro/interos-intro.{mp4,webm} + poster
 *   node scripts/intro/render.mjs 1.2 3.5    → só os quadros desses instantes (PNG, para conferir)
 *
 * Precisa do Playwright (Chromium) e do ffmpeg no PATH. Os quadros vão para
 * uma pasta temporária e são apagados no fim. Ver docs/abertura.md.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// require (e não import): acha também o Playwright instalado fora do projeto
const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outDir = join(root, "public/intro");
const FPS = 60;

const stills = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, "intro.html")).href + "?t=0");
await page.evaluate(() => window.introReady);
const { DURATION } = await page.evaluate(() => window.INTRO);

async function frameAt(t) {
  const dataUrl = await page.evaluate((tt) => {
    window.renderFrame(tt);
    return document.getElementById("c").toDataURL("image/png");
  }, t);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

if (stills.length) {
  const dir = join(here, "stills");
  mkdirSync(dir, { recursive: true });
  for (const t of stills) {
    const file = join(dir, `t-${t.toFixed(2)}.png`);
    writeFileSync(file, await frameAt(t));
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "interos-intro-"));
const total = Math.round(DURATION * FPS);
for (let i = 0; i < total; i++) {
  writeFileSync(join(tmp, `f${String(i).padStart(4, "0")}.png`), await frameAt(i / FPS));
  if (i % 60 === 0) console.log(`quadro ${i}/${total}`);
}
await browser.close();

mkdirSync(outDir, { recursive: true });
const input = ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(tmp, "f%04d.png")];
// MP4 (H.264 High, nível 5.0 = avc1.640032) para Chrome, Safari, Edge e Firefox
execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-profile:v", "high", "-level", "5.0", "-pix_fmt", "yuv420p",
  "-preset", "slow", "-crf", "20", "-movflags", "+faststart", "-an", join(outDir, "interos-intro.mp4")], { stdio: "inherit" });
// WebM (VP9) para o Chromium sem H.264 (Playwright)
execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-deadline", "good",
  "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", join(outDir, "interos-intro.webm")], { stdio: "inherit" });
// Poster: o primeiro quadro, para a tela não ficar vazia enquanto o vídeo carrega
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(tmp, "f0000.png"), "-q:v", "4", join(outDir, "interos-intro-poster.jpg")], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
console.log("pronto:", outDir);
