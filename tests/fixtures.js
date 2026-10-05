// Fake API responses in the real Open-Meteo / Overpass formats.
export const GEO = {
  results: [{ name: "Dhaka", admin1: "Dhaka Division", country: "Bangladesh", latitude: 23.81, longitude: 90.41 }],
};

export const OVERPASS = {
  elements: [
    { type: "way", tags: { leisure: "park", name: "Ramna Park" }, center: { lat: 23.738, lon: 90.401 } },
    { type: "node", tags: { tourism: "viewpoint" }, lat: 23.8, lon: 90.4 },
    { type: "way", tags: { leisure: "park", name: "Ramna Park" }, center: { lat: 23.739, lon: 90.402 } },
    { type: "way", tags: { leisure: "garden", name: "Botanical Garden" }, center: { lat: 23.815, lon: 90.42 } },
    { type: "way", tags: { leisure: "park" }, center: { lat: 23.81, lon: 90.41 } },
  ],
};

export function meteo(now = "2026-10-05T11:15") {
  const time = [];
  for (const d of ["2026-10-05", "2026-10-06"]) for (let h = 0; h < 24; h++) time.push(`${d}T${String(h).padStart(2, "0")}:00`);
  const rain = time.map((_, i) => (i % 24 >= 12 && i % 24 <= 14 ? 80 : 5)); // a wet early afternoon
  return {
    current: { time: now },
    daily: { sunrise: ["2026-10-05T05:50", "2026-10-06T05:51"], sunset: ["2026-10-05T17:40", "2026-10-06T17:39"] },
    hourly: {
      time,
      temperature_2m: time.map(() => 24),
      precipitation_probability: rain,
      weather_code: rain.map((r) => (r > 50 ? 61 : 1)),
      wind_speed_10m: time.map(() => 8),
    },
  };
}

export function fakeFetch({ now } = {}) {
  return async (url, init) => {
    const json = url.includes("geocoding") ? GEO : url.includes("forecast") ? meteo(now) : OVERPASS;
    if (url.includes("overpass") && !String(init?.body).includes("around")) throw new Error("bad query");
    return { ok: true, status: 200, json: async () => json };
  };
}
