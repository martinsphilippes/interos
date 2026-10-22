/**
 * Leva o usuário a uma seção da mesma página (ex.: o cartão onde se corrige uma pendência): rola até ela, destaca por
 * um instante e põe o foco no primeiro campo (ou botão) dela, sem rolar de novo. Devolve false se a seção não existe.
 */
export function goToSection(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.classList.add("ring-2", "ring-brand");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-brand"), 2000);
  const target =
    el.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? el.querySelector<HTMLElement>("button:not([disabled]), a[href]");
  target?.focus({ preventScroll: true });
  return true;
}
