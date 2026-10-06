// Touch Grass server: runs on Render next to Ollama (Hermes 3, open weights).
//
// - POST /api/plan  {facts}  -> {text, model}   the same facts the browser would give its
//                                               on-device model; no coordinates, no photos
// - GET  /health                                for Render's health check
// - GET  /*                                     the website itself (one URL for app + agent)
//
// No dependencies: Node's http module and fetch. Ollama stays private on 127.0.0.1.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SYSTEM_PROMPT } from "../js/plan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = ["index.html", "sw.js", "manifest.webmanifest", "css/", "js/", "icons/"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function config(env = process.env) {
  return {
    port: Number(env.PORT || 10000),
    ollamaUrl: (env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    model: env.OLLAMA_MODEL || "hermes3:3b",
    origins: (env.ALLOWED_ORIGINS || "https://aminul821.github.io")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    perMinute: Number(env.RATE_PER_MINUTE || 6),
    maxQueue: Number(env.MAX_QUEUE || 4),
    timeoutMs: Number(env.TIMEOUT_MS || 120_000),
  };
}

// ------------------------------------------------------------------ input checks

const str = (v, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (Number.isFinite(v) ? v : 0);

// Keep only the fields the prompt needs, with sane sizes. Anything else is dropped.
export function cleanFacts(f) {
  if (!f || typeof f !== "object" || !Array.isArray(f.best_window) || !Array.isArray(f.nearby_spots)) return null;
  return {
    starting_point: str(f.starting_point),
    local_time_now: str(f.local_time_now, 20),
    plan_for: str(f.plan_for, 40),
    sunset: str(f.sunset, 20),
    daylight_left_minutes: num(f.daylight_left_minutes),
    best_window: f.best_window.slice(0, 4).map((h) => ({
      time: str(h?.time, 20),
      temp_c: num(h?.temp_c),
      rain_chance: num(h?.rain_chance),
      sky: str(h?.sky, 40),
      wind_kmh: num(h?.wind_kmh),
    })),
    nearby_spots: f.nearby_spots.slice(0, 8).map((s) => ({
      name: str(s?.name, 80),
      type: str(s?.type, 40),
      distance: str(s?.distance, 20),
      walk_minutes: num(s?.walk_minutes),
    })),
  };
}

// ------------------------------------------------------------------ server

export function createServer(cfg = config(), fetchFn = fetch) {
  const hits = new Map(); // ip -> timestamps in the last minute
  let running = 0;
  const waiting = [];
  let ready = false;

  const limited = (ip) => {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear(); // keep memory bounded
    return recent.length > cfg.perMinute;
  };

  // One generation at a time: the CPU is the bottleneck, parallel runs only slow both down.
  async function oneAtATime(task) {
    if (running) {
      if (waiting.length >= cfg.maxQueue) throw Object.assign(new Error("busy"), { status: 503 });
      await new Promise((resolve) => waiting.push(resolve));
    }
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  async function generate(facts) {
    const res = await fetchFn(`${cfg.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        keep_alive: -1,
        options: { temperature: 0.7, num_predict: 220, num_ctx: 2048 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Facts (JSON):\n${JSON.stringify(facts)}` },
        ],
      }),
    });
    if (!res.ok) throw Object.assign(new Error(`model error ${res.status}`), { status: 502 });
    ready = true;
    return ((await res.json()).message?.content || "").trim();
  }

  // Load the model into memory at startup so the first visitor doesn't wait for it.
  async function warmUp(tries = 60) {
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchFn(`${cfg.ollamaUrl}/api/generate`, {
          method: "POST",
          body: JSON.stringify({ model: cfg.model, prompt: "", keep_alive: -1 }),
        });
        if (res.ok) {
          ready = true;
          return true;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && cfg.origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
  }

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  function readBody(req, limit = 16_000) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size <= limit) chunks.push(c); // past the limit: keep draining, stop storing
        else if (size > limit * 64) req.destroy(); // someone is streaming junk: hang up
      });
      req.on("end", () => {
        if (size > limit) reject(Object.assign(new Error("Request too large."), { status: 413 }));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  }

  async function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(ROOT, rel);
    const inside = file.startsWith(ROOT + path.sep);
    const allowed = PUBLIC.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
    const type = TYPES[path.extname(file)];
    if (!inside || !allowed || !type || rel.includes("..")) return send(res, 404, { error: "not found" });
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error("not a file");
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": s.size,
        "Cache-Control": rel === "sw.js" || rel === "index.html" ? "no-cache" : "public, max-age=300",
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(file).pipe(res);
    } catch {
      send(res, 404, { error: "not found" });
    }
  }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    cors(req, res);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if (pathname === "/health") return send(res, 200, { ok: true, model: cfg.model, ready });
      if (pathname === "/api/plan") {
        if (req.method !== "POST") return send(res, 405, { error: "use POST" });
        const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
        if (limited(ip)) return send(res, 429, { error: "Too many plans. Try again in a minute." });
        let facts;
        try {
          facts = cleanFacts(JSON.parse(await readBody(req)).facts);
        } catch (e) {
          if (e.status) throw e;
        }
        if (!facts) return send(res, 400, { error: "Send {facts} like the website does." });
        const text = await oneAtATime(() => generate(facts));
        if (!text) return send(res, 502, { error: "The model returned nothing." });
        return send(res, 200, { text, model: cfg.model });
      }
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, pathname);
      send(res, 405, { error: "method not allowed" });
    } catch (e) {
      const status = e.status || (e.name === "TimeoutError" ? 504 : 500);
      if (status >= 500 && status !== 503) console.error("plan failed:", e.message);
      if (!res.headersSent) send(res, status, { error: status === 503 ? "The server is busy. Try again soon." : e.message });
    }
  });

  return { server, warmUp };
}

// Run directly: node server/index.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = config();
  const { server, warmUp } = createServer(cfg);
  server.listen(cfg.port, () => {
    console.log(`Touch Grass server on :${cfg.port} · model ${cfg.model} · origins ${cfg.origins.join(" ")}`);
    warmUp().then((ok) => console.log(ok ? `${cfg.model} loaded and ready` : `couldn't load ${cfg.model} yet`));
  });
}
