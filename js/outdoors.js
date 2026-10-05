// Open data for going outside: weather (Open-Meteo) and nearby green spots (OpenStreetMap).
// Both are free, need no API key, and allow calls straight from the browser.
// The AI only writes the plan. Places, times and weather come from here, so it can't invent a park.

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export class OutdoorsError extends Error {}

async function getJSON(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    throw new OutdoorsError(`${new URL(url).host} is unreachable (${e.message || e})`);
  }
  if (!res.ok) throw new OutdoorsError(`${new URL(url).host} returned HTTP ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------ places

export async function geocode(query, fetchFn = fetch) {
  const url = `${GEOCODE_URL}?${new URLSearchParams({ name: query, count: "1", language: "en", format: "json" })}`;
  const data = await getJSON(fetchFn, url);
  const r = (data.results || [])[0];
  if (!r) throw new OutdoorsError(`I couldn't find a place called “${query}”.`);
  const label = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
  return { name: r.name, label, lat: r.latitude, lon: r.longitude };
}

export function distanceM(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dp = rad(lat2 - lat1);
  const dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

const KINDS = [
  ["leisure", "park", "park"],
  ["leisure", "garden", "garden"],
  ["leisure", "nature_reserve", "nature reserve"],
  ["natural", "wood", "woods"],
  ["landuse", "forest", "forest"],
  ["natural", "beach", "beach"],
  ["natural", "peak", "peak"],
  ["tourism", "viewpoint", "viewpoint"],
  ["route", "hiking", "hiking trail"],
];

function kindOf(tags) {
  const hit = KINDS.find(([k, v]) => tags[k] === v);
  return hit ? hit[2] : "green space";
}

export function overpassQuery(lat, lon, radius) {
  const around = `(around:${radius},${lat},${lon})`;
  return (
    "[out:json][timeout:20];(" +
    `nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]${around};` +
    `nwr["natural"~"^(wood|beach|peak)$"]["name"]${around};` +
    `nwr["landuse"="forest"]["name"]${around};` +
    `nwr["tourism"="viewpoint"]${around};` +
    `relation["route"="hiking"]["name"]${around};` +
    ");out center tags 80;"
  );
}

export function parseSpots(data, lat, lon, limit = 6) {
  const seen = new Set();
  const spots = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const kind = kindOf(tags);
    const name = tags["name:en"] || tags.name || (kind === "viewpoint" ? "Viewpoint" : "");
    const plat = el.lat ?? el.center?.lat;
    const plon = el.lon ?? el.center?.lon;
    if (!name || plat == null || plon == null) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    spots.push({ name, kind, lat: plat, lon: plon, distance: Math.round(distanceM(lat, lon, plat, plon)) });
  }
  // Named parks and trails first, anonymous viewpoints last, then the closest.
  spots.sort((a, b) => (a.name === "Viewpoint") - (b.name === "Viewpoint") || a.distance - b.distance);
  return spots.slice(0, limit);
}

export async function nearbySpots(lat, lon, { radius = 3000, fetchFn = fetch } = {}) {
  const body = new URLSearchParams({ data: overpassQuery(lat, lon, radius) });
  const data = await getJSON(fetchFn, OVERPASS_URL, { method: "POST", body });
  return parseSpots(data, lat, lon);
}

// ------------------------------------------------------------------ weather

const WMO = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
  82: "violent showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm",
  96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

export const skyOf = (code) => WMO[code] || "mixed weather";

// Open-Meteo returns local wall-clock times ("2026-10-05T17:40") for the place's time zone.
// We keep them as UTC timestamps so the visitor's own time zone never shifts them.
export const parseLocal = (s) => Date.parse(`${s}Z`);
const HOUR = 3600_000;
const pad = (n) => String(n).padStart(2, "0");
export const hhmm = (t) => `${pad(new Date(t).getUTCHours())}:${pad(new Date(t).getUTCMinutes())}`;
export const dayName = (t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(t).getUTCDay()];
const dateOf = (t) => new Date(t).toISOString().slice(0, 10);

export function parseForecast(data) {
  const now = parseLocal(data.current.time);
  const days = data.daily.sunrise.map((rise, i) => [parseLocal(rise), parseLocal(data.daily.sunset[i])]);
  // Today if there's at least ~45 min of light left, otherwise tomorrow.
  let [sunrise, sunset] = days[0];
  if (sunset - now < 45 * 60_000 && days[1]) [sunrise, sunset] = days[1];
  const h = data.hourly;
  const hours = [];
  h.time.forEach((t, i) => {
    const ts = parseLocal(t);
    if (ts + HOUR <= Math.max(now, sunrise) || ts >= sunset) return;
    hours.push({
      time: ts,
      temp: h.temperature_2m[i],
      rainChance: h.precipitation_probability[i] || 0,
      code: h.weather_code[i] || 0,
      wind: h.wind_speed_10m[i] || 0,
    });
  });
  const tomorrow = dateOf(sunset) !== dateOf(now);
  return {
    now,
    sunrise,
    sunset,
    hours,
    tomorrow,
    daylightLeftMin: tomorrow ? 0 : Math.max(0, Math.round((sunset - now) / 60_000)),
  };
}

export async function forecast(lat, lon, fetchFn = fetch) {
  const url = `${FORECAST_URL}?${new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
    daily: "sunrise,sunset",
    current: "temperature_2m",
    timezone: "auto",
    forecast_days: "2",
  })}`;
  return parseForecast(await getJSON(fetchFn, url));
}

// Higher is nicer to be outside. Plain heuristics, no AI involved.
export function hourScore(h) {
  let score = 100 - h.rainChance * 0.8;
  if (h.code >= 95) score -= 80; // thunder: stay in
  else if ([65, 67, 75, 82, 86].includes(h.code)) score -= 40;
  else if (h.code >= 51) score -= 15;
  if (h.temp < 12) score -= (12 - h.temp) * 3;
  else if (h.temp > 26) score -= (h.temp - 26) * 4;
  score -= Math.max(h.wind - 20, 0) * 1.5;
  return score;
}

// The best `length` consecutive daylight hours.
export function bestWindow(fc, length = 2) {
  const { hours } = fc;
  if (hours.length <= length) return hours;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i + length <= hours.length; i++) {
    const s = hours.slice(i, i + length).reduce((sum, h) => sum + hourScore(h), 0);
    if (s > bestScore) [best, bestScore] = [i, s];
  }
  return hours.slice(best, best + length);
}

export const fmtDist = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
export const walkMin = (m) => Math.max(1, Math.round(m / 80)); // ~4.8 km/h
export const mapUrl = (s) => `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(5)}#map=17/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}`;
