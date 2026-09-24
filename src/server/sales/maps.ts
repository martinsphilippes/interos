import type { Address } from "@/domain/types";

/**
 * Módulo de mapas (geocodificação e rota) usado pelas visitas.
 *
 * Implementação atual: MOCK sem rede. `geocode` devolve a coordenada aproximada da cidade a partir de
 * uma tabela pequena de cidades do Nordeste; `route` calcula a distância em linha reta (haversine)
 * corrigida por um fator de estrada e estima o tempo a 60 km/h.
 *
 * Integração real (Google Maps Platform): criar a variável de ambiente GOOGLE_MAPS_API_KEY (somente
 * servidor, nunca NEXT_PUBLIC_) e trocar o corpo destas duas funções por chamadas à Geocoding API
 * (https://maps.googleapis.com/maps/api/geocode/json?address=...&key=...) e à Routes API
 * (computeRoutes). A interface pública (`geocode`, `route`, `HEADQUARTERS`) não muda.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  distanceKm: number;
  durationMinutes: number;
  /** "mock" enquanto não houver chave do Google Maps. */
  provider: "mock" | "google";
}

/** Sede da Intercert: Juazeiro do Norte (CE). */
export const HEADQUARTERS: { label: string; position: LatLng } = {
  label: "Sede Intercert — Juazeiro do Norte/CE",
  position: { lat: -7.2131, lng: -39.3153 },
};

/** Capitais e cidades atendidas no Nordeste (chave: nome normalizado + UF). */
const CITY_TABLE: Record<string, LatLng> = {
  "juazeiro do norte|CE": { lat: -7.2131, lng: -39.3153 },
  "crato|CE": { lat: -7.2341, lng: -39.4094 },
  "barbalha|CE": { lat: -7.3111, lng: -39.3022 },
  "iguatu|CE": { lat: -6.3592, lng: -39.2986 },
  "sobral|CE": { lat: -3.6861, lng: -40.3497 },
  "fortaleza|CE": { lat: -3.7319, lng: -38.5267 },
  "brejo santo|CE": { lat: -7.4931, lng: -38.9853 },
  "missao velha|CE": { lat: -7.2497, lng: -39.1428 },
  "petrolina|PE": { lat: -9.3891, lng: -40.5028 },
  "recife|PE": { lat: -8.0476, lng: -34.877 },
  "araripina|PE": { lat: -7.5761, lng: -40.4981 },
  "juazeiro|BA": { lat: -9.4167, lng: -40.5033 },
  "salvador|BA": { lat: -12.9714, lng: -38.5014 },
  "campina grande|PB": { lat: -7.2306, lng: -35.8811 },
  "joao pessoa|PB": { lat: -7.1195, lng: -34.845 },
  "cajazeiras|PB": { lat: -6.8897, lng: -38.5569 },
  "mossoro|RN": { lat: -5.1878, lng: -37.3442 },
  "natal|RN": { lat: -5.7945, lng: -35.211 },
  "teresina|PI": { lat: -5.0892, lng: -42.8019 },
  "picos|PI": { lat: -7.0769, lng: -41.4669 },
  "sao luis|MA": { lat: -2.5307, lng: -44.3068 },
  "maceio|AL": { lat: -9.6658, lng: -35.735 },
  "aracaju|SE": { lat: -10.9472, lng: -37.0731 },
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Coordenada do endereço: usa lat/lng já gravados; senão, a da cidade (mock). */
export async function geocode(address: Address | undefined | null): Promise<LatLng | null> {
  if (!address) return null;
  if (typeof address.lat === "number" && typeof address.lng === "number") return { lat: address.lat, lng: address.lng };
  if (!address.city) return null;
  const city = normalize(address.city);
  const state = (address.state ?? "").toUpperCase();
  const exact = CITY_TABLE[`${city}|${state}`];
  if (exact) return exact;
  // Sem UF informada: primeira cidade com o mesmo nome.
  const match = Object.entries(CITY_TABLE).find(([key]) => key.split("|")[0] === city);
  return match ? match[1] : null;
}

/** Distância em km entre dois pontos (fórmula de haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimativa de rota (mock): linha reta × 1,25 (fator de estrada), 60 km/h. */
export async function route(from: LatLng, to: LatLng): Promise<RouteEstimate> {
  const distanceKm = Math.round(haversineKm(from, to) * 1.25 * 10) / 10;
  return { distanceKm, durationMinutes: Math.round((distanceKm / 60) * 60), provider: "mock" };
}

/** Texto de endereço em uma linha (para exibição e para o link do Google Maps). */
export function formatAddressLine(address: Address | undefined | null): string {
  if (!address) return "";
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const cityState = [address.city, address.state].filter(Boolean).join("/");
  return [street, address.district, cityState].filter(Boolean).join(" — ");
}

/** Link "Abrir no Google Maps" (não exige chave). */
export function googleMapsSearchUrl(address: Address | undefined | null): string | null {
  const line = formatAddressLine(address);
  if (!line) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`;
}
