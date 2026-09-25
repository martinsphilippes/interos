/**
 * Google Maps Platform (somente servidor, GOOGLE_MAPS_API_KEY): Geocoding API e Distance Matrix API.
 * Usado por src/server/sales/maps.ts quando `isConnected("mapas")`; qualquer falha devolve null e o
 * chamador cai na estimativa local. Sem "server-only" porque maps.ts é compartilhado; a chave não tem
 * prefixo NEXT_PUBLIC_ e nunca chega ao navegador.
 */

const TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.error(`[mapas] Google respondeu HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error("[mapas] falha ao chamar o Google Maps", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function googleGeocode(addressLine: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !addressLine) return null;
  const json = (await getJson(`https://maps.googleapis.com/maps/api/geocode/json?region=br&address=${encodeURIComponent(addressLine)}&key=${encodeURIComponent(key)}`)) as {
    status?: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  } | null;
  const loc = json?.status === "OK" ? json.results?.[0]?.geometry?.location : undefined;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

export async function googleRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const json = (await getJson(
    `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${from.lat},${from.lng}&destinations=${to.lat},${to.lng}&key=${encodeURIComponent(key)}`,
  )) as { status?: string; rows?: { elements?: { status?: string; distance?: { value: number }; duration?: { value: number } }[] }[] } | null;
  const el = json?.status === "OK" ? json.rows?.[0]?.elements?.[0] : undefined;
  if (!el || el.status !== "OK" || !el.distance || !el.duration) return null;
  return { distanceKm: Math.round(el.distance.value / 100) / 10, durationMinutes: Math.round(el.duration.value / 60) };
}
