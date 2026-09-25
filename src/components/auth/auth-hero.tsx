import { BarChart3, Layers, Workflow } from "lucide-react";
import { InterosMark } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

const FEATURES = [
  { label: "Gestão integrada", icon: Layers },
  { label: "Workflows inteligentes", icon: Workflow },
  { label: "Metas e desempenho", icon: BarChart3 },
];

/** Marca grande "INTEROS by Intercert". */
export function AuthBrand({ className }: { className?: string }) {
  return (
    <div className={cn("inline-flex flex-col", className)}>
      <div className="flex items-center gap-3 lg:gap-4">
        <InterosMark className="size-12 lg:size-[72px]" />
        <span className="text-[40px] font-extrabold leading-none tracking-tight text-white lg:text-[68px]">INTEROS</span>
      </div>
      <span className="mt-1 self-end text-sm font-medium text-muted lg:text-lg">
        by <span className="font-bold text-white">Inter</span>
        <span className="font-bold text-brand">cert</span>
      </span>
    </div>
  );
}

/** Coluna de apresentação do login: marca, proposta de valor, três destaques e a ilustração. */
export function AuthHero({ className }: { className?: string }) {
  return (
    <section className={cn("relative flex flex-col", className)} aria-label="INTEROS">
      <AuthBrand />
      <span className="mt-6 h-1 w-16 rounded-full bg-brand" aria-hidden />
      <h1 className="mt-6 max-w-xl text-[34px] font-bold leading-[1.1] tracking-tight text-white lg:text-[46px]">O sistema operacional da sua empresa</h1>
      <p className="mt-3 max-w-xl text-base text-muted lg:text-lg">Processos, pessoas e resultados em um só lugar.</p>
      <ul className="mt-8 flex flex-wrap gap-4">
        {FEATURES.map((f) => (
          <li key={f.label} className="flex w-[118px] flex-col items-center gap-2 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl border border-border-strong bg-surface/70 text-brand shadow-card backdrop-blur" aria-hidden>
              <f.icon className="size-7" />
            </span>
            <span className="text-sm font-medium leading-tight text-foreground">{f.label}</span>
            <span className="h-0.5 w-7 rounded-full bg-brand" aria-hidden />
          </li>
        ))}
      </ul>
      <AuthIllustration className="mt-6 hidden w-full max-w-[640px] lg:block" />
    </section>
  );
}

/** Rede de nós e painéis flutuantes em SVG puro (sem imagens externas). */
export function AuthIllustration({ className }: { className?: string }) {
  const nodes: [number, number, "o" | "b"][] = [
    [40, 250, "b"],
    [120, 205, "o"],
    [205, 232, "b"],
    [262, 150, "o"],
    [318, 196, "b"],
    [395, 120, "o"],
    [452, 175, "b"],
    [528, 88, "o"],
    [600, 40, "b"],
    [470, 262, "o"],
    [330, 282, "b"],
  ];
  const links: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [2, 10], [10, 9], [9, 6], [3, 5],
  ];
  return (
    <svg viewBox="0 0 640 300" className={className} aria-hidden>
      <defs>
        <radialGradient id="auth-glow-o" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F26A21" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#F26A21" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="auth-glow-b" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="auth-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16294a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0c1a2e" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="auth-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF8A4C" />
          <stop offset="100%" stopColor="#F26A21" />
        </linearGradient>
      </defs>

      {/* Linhas da rede */}
      {links.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke={nodes[b][2] === "o" ? "#F26A21" : "#3B82F6"} strokeOpacity="0.45" strokeWidth="1.4" />
      ))}

      {/* Painel: gráfico de barras */}
      <g transform="translate(46 150) skewY(-6)">
        <rect width="150" height="108" rx="12" fill="url(#auth-panel)" stroke="#26395a" />
        <rect x="16" y="16" width="56" height="6" rx="3" fill="#3B82F6" opacity="0.8" />
        {[30, 44, 36, 58, 72].map((h, i) => (
          <rect key={i} x={20 + i * 24} y={92 - h} width="14" height={h} rx="3" fill={i % 2 ? "url(#auth-bar)" : "#3B82F6"} opacity={i % 2 ? 1 : 0.85} />
        ))}
      </g>

      {/* Painel: perfil */}
      <g transform="translate(236 176) skewY(-6)">
        <rect width="132" height="66" rx="12" fill="url(#auth-panel)" stroke="#26395a" />
        <circle cx="28" cy="33" r="12" fill="#3B82F6" opacity="0.85" />
        <rect x="50" y="22" width="64" height="6" rx="3" fill="#60a5fa" opacity="0.8" />
        <rect x="50" y="36" width="44" height="6" rx="3" fill="#3B82F6" opacity="0.55" />
      </g>

      {/* Painel: donut */}
      <g transform="translate(410 190) skewY(-6)">
        <rect width="92" height="86" rx="12" fill="url(#auth-panel)" stroke="#26395a" />
        <circle cx="46" cy="43" r="22" fill="none" stroke="#1a2b45" strokeWidth="9" />
        <circle cx="46" cy="43" r="22" fill="none" stroke="#3B82F6" strokeWidth="9" strokeDasharray="96 138" transform="rotate(-90 46 43)" />
        <circle cx="46" cy="43" r="22" fill="none" stroke="#F26A21" strokeWidth="9" strokeDasharray="30 138" strokeDashoffset="-96" transform="rotate(-90 46 43)" />
      </g>

      {/* Painel: alvo (metas) */}
      <g transform="translate(508 104) skewY(-6)">
        <rect width="104" height="90" rx="12" fill="url(#auth-panel)" stroke="#26395a" />
        {[30, 21, 12, 4].map((r, i) => (
          <circle key={r} cx="52" cy="45" r={r} fill="none" stroke={i % 2 ? "#F26A21" : "#3B82F6"} strokeWidth="4" opacity="0.9" />
        ))}
        <line x1="52" y1="45" x2="82" y2="18" stroke="#F26A21" strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* Painel: checklist */}
      <g transform="translate(330 78) skewY(-6)">
        <rect width="104" height="70" rx="12" fill="url(#auth-panel)" stroke="#26395a" />
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(14 ${14 + i * 16})`}>
            <rect width="9" height="9" rx="2" fill="#F26A21" />
            <rect x="16" y="2" width={56 - i * 10} height="5" rx="2.5" fill="#60a5fa" opacity="0.7" />
          </g>
        ))}
      </g>

      {/* Nós com brilho */}
      {nodes.map(([x, y, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="11" fill={`url(#auth-glow-${c})`} opacity="0.55" />
          <circle cx={x} cy={y} r="3.6" fill={c === "o" ? "#FF8A4C" : "#60a5fa"} />
        </g>
      ))}
    </svg>
  );
}
