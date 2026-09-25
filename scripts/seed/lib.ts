/**
 * Utilitários do seed: PRNG determinístico, geradores de dados brasileiros, datas relativas a
 * "hoje" e um armazém em memória que grava tudo no Firestore em lotes ao final.
 */
import { batchSet, ORG_ID } from "../../src/server/db";
import type { CollectionName } from "../../src/domain/types";

// ---------------------------------------------------------------------------
// PRNG (mulberry32) com semente fixa: o seed gera sempre o mesmo conteúdo.
// ---------------------------------------------------------------------------

export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Inteiro em [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  float(min: number, max: number, decimals = 2): number {
    const v = min + this.next() * (max - min);
    return Number(v.toFixed(decimals));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  /** N itens distintos. */
  pickN<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, n);
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export const rng = new Rng(20260924);

// ---------------------------------------------------------------------------
// Datas relativas a "hoje" (momento em que o seed roda). Horas são no fuso de
// São Paulo (UTC-3), para que "hoje" e "expediente" façam sentido na interface.
// ---------------------------------------------------------------------------

export const NOW = new Date();
const TZ_OFFSET_HOURS = 3;

/** Data em um dia relativo a hoje, em uma hora local (São Paulo). */
export function at(dayOffset: number, hour = 9, minute = 0): Date {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + dayOffset, hour + TZ_OFFSET_HOURS, minute));
  return d;
}
export function iso(d: Date): string {
  return d.toISOString();
}
/** Garante que um instante "passado" não caia depois de agora (ex.: hoje às 15h quando ainda são 10h). */
export function pastOnly(isoDate: string): string {
  if (isoDate <= NOW.toISOString()) return isoDate;
  return new Date(NOW.getTime() - rng.int(10, 90) * 60_000).toISOString();
}
export function daysAgo(days: number, hour = 9, minute = 0): string {
  return pastOnly(iso(at(-days, hour, minute)));
}
export function daysFromNow(days: number, hour = 9, minute = 0): string {
  return iso(at(days, hour, minute));
}
export function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}
export function hoursFromNow(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString();
}
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
export function addHours(isoDate: string, hours: number): string {
  return new Date(new Date(isoDate).getTime() + hours * 3_600_000).toISOString();
}
/** Dia de uma data ISO em hora comercial local aleatória (8h-17h). */
export function businessTime(isoDate: string): string {
  const d = new Date(isoDate);
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rng.int(8, 17) + TZ_OFFSET_HOURS, rng.int(0, 59)));
  return pastOnly(r.toISOString());
}
/** Competência AAAA-MM de uma data (ou de hoje com deslocamento em meses). */
export function competence(monthOffset = 0, from: Date = NOW): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + monthOffset, 1));
  return d.toISOString().slice(0, 7);
}
/** Data ISO de um dia dentro de uma competência AAAA-MM. */
export function dayInCompetence(comp: string, day: number, hour = 9): string {
  const [y, m] = comp.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(day, last), hour + TZ_OFFSET_HOURS)).toISOString();
}
export function isPast(isoDate: string): boolean {
  return new Date(isoDate).getTime() < NOW.getTime();
}
export function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}
export function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// IDs legíveis
// ---------------------------------------------------------------------------

export function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}
export function id(prefix: string, n: number, width = 3): string {
  return `${prefix}_${pad(n, width)}`;
}
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Documentos fictícios com dígitos verificadores válidos
// ---------------------------------------------------------------------------

function mod11(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}
export function cnpj(): string {
  const base: number[] = [];
  for (let i = 0; i < 8; i++) base.push(rng.int(0, 9));
  base.push(0, 0, 0, 1);
  const d1 = mod11(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join("");
}
export function cpf(): string {
  const base: number[] = [];
  for (let i = 0; i < 9; i++) base.push(rng.int(0, 9));
  const d1 = mod11(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11([...base, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join("");
}
/** Celular com DDD do Nordeste, só dígitos (ex.: 88996541234). */
export function phone(ddd?: string): string {
  const code = ddd ?? rng.pick(["88", "85", "87", "83", "84", "88", "88", "85"]);
  return `${code}9${rng.int(6000, 9999)}${pad(rng.int(0, 9999), 4)}`;
}
export function landline(ddd = "88"): string {
  return `${ddd}3${rng.int(500, 599)}${pad(rng.int(0, 9999), 4)}`;
}

// ---------------------------------------------------------------------------
// Nomes de pessoas, empresas e cidades
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Ana", "Antônio", "Beatriz", "Carlos", "Cláudia", "Daniel", "Débora", "Eduardo", "Fernanda", "Francisco",
  "Gabriela", "Geraldo", "Helena", "Iago", "Isabela", "João", "José", "Juliana", "Larissa", "Leandro",
  "Letícia", "Lucas", "Márcia", "Maria", "Mariana", "Mateus", "Natália", "Paulo", "Patrícia", "Pedro",
  "Rafaela", "Raimundo", "Renata", "Ricardo", "Roberta", "Rodrigo", "Sandra", "Sérgio", "Tatiane", "Thiago",
  "Vanessa", "Vitor", "Wellington", "Cícero", "Expedito", "Socorro", "Francisca", "Damião", "Josefa", "Valdir",
];
const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Alves", "Ferreira", "Rodrigues", "Gomes",
  "Martins", "Araújo", "Barbosa", "Ribeiro", "Carvalho", "Nascimento", "Bezerra", "Cavalcante", "Sampaio", "Landim",
  "Macêdo", "Feitosa", "Brito", "Tavares", "Monteiro", "Vieira", "Cruz", "Freitas", "Andrade", "Teixeira",
];
export function personName(): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}
export function emailFor(name: string, domain: string): string {
  const parts = slugify(name).split("-");
  return `${parts[0]}.${parts[parts.length - 1]}@${domain}`;
}

export interface City {
  name: string;
  state: string;
  ddd: string;
  lat: number;
  lng: number;
}
export const CITIES: City[] = [
  { name: "Juazeiro do Norte", state: "CE", ddd: "88", lat: -7.2131, lng: -39.3153 },
  { name: "Crato", state: "CE", ddd: "88", lat: -7.2341, lng: -39.4094 },
  { name: "Barbalha", state: "CE", ddd: "88", lat: -7.3111, lng: -39.3022 },
  { name: "Fortaleza", state: "CE", ddd: "85", lat: -3.7319, lng: -38.5267 },
  { name: "Sobral", state: "CE", ddd: "88", lat: -3.6861, lng: -40.3497 },
  { name: "Iguatu", state: "CE", ddd: "88", lat: -6.3592, lng: -39.2986 },
  { name: "Petrolina", state: "PE", ddd: "87", lat: -9.3891, lng: -40.5028 },
  { name: "Campina Grande", state: "PB", ddd: "83", lat: -7.2306, lng: -35.8811 },
  { name: "Mossoró", state: "RN", ddd: "84", lat: -5.1878, lng: -37.3442 },
];
/** Cidades com peso maior para o Cariri (sede da Intercert). */
export function pickCity(): City {
  const weighted = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8];
  return CITIES[rng.pick(weighted)];
}
const STREETS = ["Rua São Pedro", "Av. Padre Cícero", "Rua Santa Luzia", "Av. Leão Sampaio", "Rua Dr. Floro", "Av. Castelo Branco", "Rua Monsenhor Esmeraldo", "Av. Perimetral", "Rua José Marrocos", "Av. Santos Dumont", "Rua Coronel Antônio Luiz", "Av. Ailton Gomes"];
const DISTRICTS = ["Centro", "Lagoa Seca", "Triângulo", "Pirajá", "São Miguel", "Salesianos", "Limoeiro", "Franciscanos", "Aldeota", "Meireles", "Cohab", "Planalto"];
export function address(city: City, withGeo: boolean) {
  const base = {
    street: rng.pick(STREETS),
    number: String(rng.int(10, 2500)),
    district: rng.pick(DISTRICTS),
    city: city.name,
    state: city.state,
    zip: `${rng.int(60000, 63999)}${pad(rng.int(0, 999), 3)}`,
  };
  if (!withGeo) return base;
  return { ...base, lat: Number((city.lat + rng.float(-0.03, 0.03, 4)).toFixed(4)), lng: Number((city.lng + rng.float(-0.03, 0.03, 4)).toFixed(4)) };
}

export const SEGMENTS = ["varejo", "supermercado", "farmacia", "restaurante", "atacado", "loja_de_roupas", "autopecas", "material_de_construcao", "otica", "pet_shop"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_LABELS: Record<Segment, string> = {
  varejo: "Varejo",
  supermercado: "Supermercado",
  farmacia: "Farmácia",
  restaurante: "Restaurante",
  atacado: "Atacado",
  loja_de_roupas: "Loja de roupas",
  autopecas: "Autopeças",
  material_de_construcao: "Material de construção",
  otica: "Ótica",
  pet_shop: "Pet shop",
};
const COMPANY_SUFFIX: Record<Segment, string[]> = {
  varejo: ["Magazine", "Loja", "Variedades", "Bazar"],
  supermercado: ["Supermercado", "Mercadinho", "Mercantil", "Hipermercado"],
  farmacia: ["Farmácia", "Drogaria", "Farmácias"],
  restaurante: ["Restaurante", "Churrascaria", "Pizzaria", "Lanchonete"],
  atacado: ["Atacadão", "Distribuidora", "Atacado"],
  loja_de_roupas: ["Modas", "Boutique", "Confecções"],
  autopecas: ["Autopeças", "Auto Center", "Peças"],
  material_de_construcao: ["Materiais de Construção", "Construmax", "Casa do Construtor"],
  otica: ["Ótica", "Óticas"],
  pet_shop: ["Pet Shop", "Agropet", "Clínica Veterinária"],
};
const COMPANY_NAMES = ["Cariri", "Padre Cícero", "São Francisco", "Nordeste", "Juazeiro", "Bom Jesus", "Santa Clara", "Araripe", "Sertão", "Sul", "Popular", "Central", "Real", "Ideal", "Moderna", "Família", "Estrela", "Aliança", "Progresso", "Vitória", "Boa Vista", "Horizonte", "Primavera", "Serrano", "Cidade", "Novo", "Líder", "Econômica", "Preço Bom", "Big"];
export function companyName(segment: Segment): { tradeName: string; legalName: string } {
  const suffix = rng.pick(COMPANY_SUFFIX[segment]);
  const name = rng.pick(COMPANY_NAMES);
  const tradeName = `${suffix} ${name}`;
  const legalName = `${name} ${suffix.replace(/s$/, "")} ${rng.pick(["Comércio", "Comercial", "Comércio e Serviços"])} LTDA`;
  return { tradeName, legalName };
}

// ---------------------------------------------------------------------------
// Armazém em memória: os módulos adicionam documentos; o orquestrador grava tudo.
// ---------------------------------------------------------------------------

/** Campos de um documento do seed: tudo menos id/organizationId; datas opcionais. */
export type SeedDoc<T> = Omit<T, "id" | "organizationId" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string };

export class Store {
  readonly docs = new Map<CollectionName, Map<string, Record<string, unknown>>>();

  /** Adiciona (ou substitui) um documento. Devolve o objeto gravado para mutações posteriores. */
  add<T extends object>(collection: CollectionName, docId: string, data: T): T & { id: string; organizationId: string; createdAt: string; updatedAt: string } {
    const stamps = data as { createdAt?: string; updatedAt?: string };
    const createdAt = stamps.createdAt ?? NOW.toISOString();
    const doc = { ...data, organizationId: ORG_ID, createdAt, updatedAt: stamps.updatedAt ?? createdAt, id: docId };
    let bucket = this.docs.get(collection);
    if (!bucket) {
      bucket = new Map();
      this.docs.set(collection, bucket);
    }
    bucket.set(docId, doc as Record<string, unknown>);
    return doc;
  }

  get<T = Record<string, unknown>>(collection: CollectionName, docId: string): T | undefined {
    return this.docs.get(collection)?.get(docId) as T | undefined;
  }

  all<T = Record<string, unknown>>(collection: CollectionName): T[] {
    return Array.from(this.docs.get(collection)?.values() ?? []) as T[];
  }

  count(collection: CollectionName): number {
    return this.docs.get(collection)?.size ?? 0;
  }

  /** Grava uma coleção no Firestore e devolve a quantidade gravada. `id` fica de fora do documento. */
  async flush(collection: CollectionName): Promise<number> {
    const bucket = this.docs.get(collection);
    if (!bucket || bucket.size === 0) return 0;
    const writes = Array.from(bucket.entries()).map(([docId, data]) => {
      const { id: _omit, ...rest } = data;
      void _omit;
      return { collection, id: docId, data: rest };
    });
    await batchSet(writes);
    return writes.length;
  }
}
