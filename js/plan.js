// Writes the outing plan. The AI runs on the visitor's own device:
//  - "webllm": an open-weight model in the browser via WebGPU (WebLLM, MLC)
//  - "ollama": an Ollama server on this computer (needs OLLAMA_ORIGINS set to this site)
//  - "none":   no AI, a plain template
// The model only gets facts from outdoors.js and is told to use only those places.

import { bestWindow, dayName, fmtDist, hhmm, skyOf, walkMin } from "./outdoors.js";

export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";

export const MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 1.5B · best plans · ~1 GB" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B · lighter · ~0.7 GB" },
  { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 1B · lightest · ~0.7 GB" },
];

export const SYSTEM_PROMPT =
  "You are an outdoors buddy. Write a short, warm plan that gets the reader off their screen and " +
  "outside. Use ONLY the places, times and weather in the facts; never invent a place. Plain text, " +
  "no markdown, no lists, no hashtags, at most 80 words. Say where to go (one spot, or two for a walk " +
  "between them), when, and one thing to bring. End with a line that starts with 'Mission:' and gives " +
  "one small outdoor challenge (e.g. find three different leaves, spot a bird, watch the sunset). If " +
  "the weather is bad, say so honestly and suggest the least-bad window.";

const when = (h) => `${dayName(h.time)} ${hhmm(h.time)}`;

export function buildFacts(place, fc, spots) {
  const window = bestWindow(fc);
  return {
    starting_point: place.label || place.name,
    local_time_now: when({ time: fc.now }),
    plan_for: fc.tomorrow ? "tomorrow (it's dark now)" : "today",
    sunset: when({ time: fc.sunset }),
    daylight_left_minutes: fc.daylightLeftMin,
    best_window: window.map((h) => ({
      time: when(h),
      temp_c: Math.round(h.temp),
      rain_chance: h.rainChance,
      sky: skyOf(h.code),
      wind_kmh: Math.round(h.wind),
    })),
    nearby_spots: spots.map((s) => ({
      name: s.name,
      type: s.kind,
      distance: fmtDist(s.distance),
      walk_minutes: walkMin(s.distance),
    })),
  };
}

// Used when no AI is available: still a useful plan, just less chatty.
export function templatePlan(facts) {
  const w = facts.best_window[0];
  const spot = facts.nearby_spots[0];
  const at = w ? `around ${w.time} (${w.temp_c}°C, ${w.sky})` : "before sunset";
  const where = spot ? `${spot.name} (${spot.walk_minutes} min walk)` : "the nearest green patch";
  return `Head to ${where} ${at}. Bring water. Sunset is ${facts.sunset}.\nMission: find three different kinds of leaves.`;
}

// Split the model's text into the plan and its "Mission:" line.
export function splitMission(text) {
  const m = text.match(/^(.*?)(?:\n|\s)*mission\s*[:\-–]\s*(.+)$/is);
  if (!m) return { plan: text.trim(), mission: "" };
  return { plan: m[1].trim(), mission: m[2].trim().replace(/\s+/g, " ") };
}

const userPrompt = (facts) => `Facts (JSON):\n${JSON.stringify(facts)}`;

let engine = null;
let engineModel = null;

// Load (and cache) a WebLLM model in the browser. onProgress gets {text, progress 0..1}.
export async function loadWebLLM(modelId, onProgress, importFn = (u) => import(u)) {
  if (engine && engineModel === modelId) return engine;
  if (!("gpu" in navigator)) throw new Error("This browser has no WebGPU. Try Chrome or Edge, or pick another AI option.");
  const webllm = await importFn(WEBLLM_URL);
  engine = await webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
  engineModel = modelId;
  return engine;
}

export async function writeWithWebLLM(facts, modelId, onProgress, importFn) {
  const eng = await loadWebLLM(modelId, onProgress, importFn);
  const reply = await eng.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(facts) },
    ],
    temperature: 0.7,
    max_tokens: 220,
  });
  return reply.choices[0].message.content.trim();
}

export async function writeWithOllama(facts, { url, model }, fetchFn = fetch) {
  const res = await fetchFn(`${url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.7 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(facts) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  return ((await res.json()).message?.content || "").trim();
}

// Returns {plan, mission, source}. Never throws: falls back to the template.
export async function writePlan(facts, settings, { onProgress, fetchFn, importFn } = {}) {
  try {
    let text = "";
    if (settings.ai === "webllm") {
      text = await writeWithWebLLM(facts, settings.model, onProgress, importFn);
    } else if (settings.ai === "ollama") {
      text = await writeWithOllama(facts, { url: settings.ollamaUrl, model: settings.ollamaModel }, fetchFn);
    }
    if (text) {
      const source = settings.ai === "webllm" ? settings.model.split("-q4")[0].replace("-Instruct", "").replace("-it", "") : settings.ollamaModel;
      return { ...splitMission(text), source: `${source} · on your device` };
    }
  } catch (e) {
    console.warn("AI plan failed, using the template:", e);
    return { ...splitMission(templatePlan(facts)), source: "template", error: e.message || String(e) };
  }
  return { ...splitMission(templatePlan(facts)), source: "template" };
}
