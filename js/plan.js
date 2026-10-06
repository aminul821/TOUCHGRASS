// Writes the outing plan. The AI runs on the visitor's own device:
//  - "local":  an open-weight model in the browser. With WebGPU: WebLLM (MLC).
//              Without WebGPU (many phones): transformers.js on WebAssembly.
//  - "ollama": an Ollama server on this computer (needs OLLAMA_ORIGINS set to this site)
//  - "none":   no AI, a plain template
// The model only gets facts from outdoors.js and is told to use only those places.

import { TRANSFORMERS_URL, WEBLLM_URL, hasWebGPU, importLib } from "./libs.js";
import { bestWindow, dayName, fmtDist, hhmm, skyOf, walkMin } from "./outdoors.js";

export const MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", engine: "webgpu", name: "Qwen 2.5 1.5B", size: "~1 GB", note: "best plans" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", engine: "webgpu", name: "Llama 3.2 1B", size: "~0.7 GB", note: "lighter" },
  { id: "gemma3-1b-it-q4f16_1-MLC", engine: "webgpu", name: "Gemma 3 1B", size: "~0.7 GB", note: "lightest" },
  { id: "onnx-community/Qwen3-0.6B-ONNX", engine: "wasm", name: "Qwen 3 0.6B", size: "~0.5 GB", note: "works without WebGPU" },
];
export const WASM_MODEL = MODELS.find((m) => m.engine === "wasm");
export const modelLabel = (m) => `${m.name} · ${m.note} · ${m.size}`;

// The model that will actually run: a WebGPU model falls back to the WebAssembly one.
export function resolveModel(modelId, gpu) {
  const m = MODELS.find((x) => x.id === modelId) || MODELS[0];
  return m.engine === "webgpu" && !gpu ? WASM_MODEL : m;
}

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
const messages = (facts) => [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: userPrompt(facts) },
];
// Qwen 3 may still think out loud; keep only the answer.
export const stripThinking = (text) => text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

let webllmEngine = null;
let webllmModel = null;

async function writeWithWebLLM(facts, model, onProgress, importFn) {
  if (!webllmEngine || webllmModel !== model.id) {
    const webllm = await importFn(WEBLLM_URL);
    webllmEngine = await webllm.CreateMLCEngine(model.id, { initProgressCallback: onProgress });
    webllmModel = model.id;
  }
  const reply = await webllmEngine.chat.completions.create({ messages: messages(facts), temperature: 0.7, max_tokens: 220 });
  return reply.choices[0].message.content;
}

const generators = {};

async function writeWithWasm(facts, model, onProgress, importFn) {
  if (!generators[model.id]) {
    const { pipeline } = await importFn(TRANSFORMERS_URL);
    generators[model.id] = await pipeline("text-generation", model.id, {
      dtype: "q4",
      device: "wasm",
      progress_callback: (p) => {
        if (p.status === "progress" && onProgress) onProgress({ text: `Downloading ${p.file}`, progress: (p.progress || 0) / 100 });
      },
    });
  }
  onProgress?.({ text: "Writing your plan…", progress: 1 });
  const out = await generators[model.id](messages(facts), {
    max_new_tokens: 200,
    do_sample: true,
    temperature: 0.7,
    tokenizer_encode_kwargs: { enable_thinking: false },
  });
  return out[0].generated_text.at(-1).content;
}

// Is this model already downloaded? (Then it can run right away, even offline.)
export async function isModelCached(model, importFn = importLib) {
  try {
    if (model.engine === "webgpu") return await (await importFn(WEBLLM_URL)).hasModelInCache(model.id);
    const cache = await caches.open("transformers-cache");
    return (await cache.keys()).some((r) => r.url.includes(model.id));
  } catch {
    return false;
  }
}

export async function writeWithOllama(facts, { url, model }, fetchFn = fetch) {
  const res = await fetchFn(`${url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, think: false, options: { temperature: 0.7 }, messages: messages(facts) }),
  });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  return (await res.json()).message?.content || "";
}

// Returns {plan, mission, source}. Never throws: falls back to the template.
export async function writePlan(facts, settings, { onProgress, fetchFn = fetch, importFn = importLib, gpu } = {}) {
  const fallback = (error) => ({ ...splitMission(templatePlan(facts)), source: "template", ...(error && { error }) });
  if (settings.ai === "none") return fallback();
  try {
    let text;
    let source;
    if (settings.ai === "ollama") {
      text = await writeWithOllama(facts, { url: settings.ollamaUrl, model: settings.ollamaModel }, fetchFn);
      source = settings.ollamaModel;
    } else {
      const model = resolveModel(settings.model, gpu ?? (await hasWebGPU()));
      const write = model.engine === "webgpu" ? writeWithWebLLM : writeWithWasm;
      text = await write(facts, model, onProgress, importFn);
      source = model.name;
    }
    text = stripThinking(text || "");
    if (!text) return fallback("the model returned nothing");
    return { ...splitMission(text), source: `${source} · on your device` };
  } catch (e) {
    console.warn("AI plan failed, using the template:", e);
    return fallback(e.message || String(e));
  }
}
