import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { cleanFacts, config, createServer } from "../server/index.mjs";
import { SYSTEM_PROMPT } from "../js/plan.js";

const FACTS = {
  starting_point: "Dhaka",
  plan_for: "today",
  sunset: "Mon 17:40",
  best_window: [{ time: "Mon 15:00", temp_c: 24, rain_chance: 5, sky: "clear", wind_kmh: 8 }],
  nearby_spots: [{ name: "Botanical Garden", type: "garden", distance: "1.2 km", walk_minutes: 14 }],
};

// A fake Ollama: records requests, answers after `delay` ms.
function fakeOllama({ delay = 0, status = 200 } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    await new Promise((r) => setTimeout(r, delay));
    return { ok: status === 200, status, json: async () => ({ message: { content: "Walk to Botanical Garden.\nMission: spot a crow." } }) };
  };
  return { calls, fetchFn };
}

async function start(env = {}, ollama = fakeOllama()) {
  const cfg = config({ PORT: "0", ...env });
  const { server } = createServer(cfg, ollama.fetchFn);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, ollama, close: () => new Promise((r) => server.close(r)) };
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/api/plan`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("a plan comes from Hermes with the shared prompt and cleaned facts", async (t) => {
  const s = await start();
  t.after(s.close);
  const res = await post(s.base, { facts: { ...FACTS, evil: "x".repeat(5000) } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: "Walk to Botanical Garden.\nMission: spot a crow.", model: "hermes3:3b" });
  const sent = s.ollama.calls[0].body;
  assert.equal(sent.model, "hermes3:3b");
  assert.equal(sent.messages[0].content, SYSTEM_PROMPT);
  assert.ok(!sent.messages[1].content.includes("evil"));
  assert.equal(sent.options.num_predict, 220);
});

test("cleanFacts caps sizes and rejects junk", () => {
  assert.equal(cleanFacts(null), null);
  assert.equal(cleanFacts({ best_window: "no" }), null);
  const f = cleanFacts({ ...FACTS, starting_point: "a".repeat(500), nearby_spots: Array(20).fill(FACTS.nearby_spots[0]) });
  assert.equal(f.starting_point.length, 120);
  assert.equal(f.nearby_spots.length, 8);
});

test("bad input gets 400, huge bodies 413, GET 405", async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await post(s.base, { nope: 1 })).status, 400);
  assert.equal((await fetch(`${s.base}/api/plan`, { method: "POST", body: "not json" })).status, 400);
  assert.equal((await post(s.base, { facts: { ...FACTS, pad: "x".repeat(20_000) } })).status, 413);
  assert.equal((await fetch(`${s.base}/api/plan`)).status, 405);
});

test("CORS only for the allowed origin", async (t) => {
  const s = await start({ ALLOWED_ORIGINS: "https://aminul821.github.io" });
  t.after(s.close);
  const ok = await fetch(`${s.base}/api/plan`, { method: "OPTIONS", headers: { Origin: "https://aminul821.github.io" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://aminul821.github.io");
  const bad = await fetch(`${s.base}/api/plan`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("rate limit per visitor", async (t) => {
  const s = await start({ RATE_PER_MINUTE: "2" });
  t.after(s.close);
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await post(s.base, { facts: FACTS }, { "X-Forwarded-For": "1.2.3.4" })).status);
  codes.push((await post(s.base, { facts: FACTS }, { "X-Forwarded-For": "5.6.7.8" })).status);
  assert.deepEqual(codes, [200, 200, 429, 200]);
});

test("one generation at a time, a full queue answers 503", async (t) => {
  const s = await start({ MAX_QUEUE: "1", RATE_PER_MINUTE: "100" }, fakeOllama({ delay: 150 }));
  t.after(s.close);
  const codes = await Promise.all([1, 2, 3].map((i) => post(s.base, { facts: FACTS }, { "X-Forwarded-For": `9.9.9.${i}` }).then((r) => r.status)));
  assert.deepEqual(codes.sort(), [200, 200, 503]);
});

test("a model error becomes 502, not a crash", async (t) => {
  const s = await start({}, fakeOllama({ status: 500 }));
  t.after(s.close);
  assert.equal((await post(s.base, { facts: FACTS })).status, 502);
  assert.equal((await fetch(`${s.base}/health`)).status, 200);
});

test("serves the website but nothing else", async (t) => {
  const s = await start();
  t.after(s.close);
  const home = await fetch(`${s.base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.equal((await fetch(`${s.base}/js/app.js`)).status, 200);
  for (const p of ["/server/index.mjs", "/README.md", "/package.json", "/tests/server.test.js", "/.git/config"]) {
    assert.equal((await fetch(`${s.base}${p}`)).status, 404, p);
  }
  // Raw path traversal (fetch would normalise it, so use http directly).
  const code = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: new URL(s.base).port, path: "/js/../../etc/passwd" }, (r) => resolve(r.statusCode));
  });
  assert.equal(code, 404);
});

test("wildcard origins match subdomains only", async (t) => {
  const s = await start({ ALLOWED_ORIGINS: "https://*.onrender.com" });
  t.after(s.close);
  const allow = async (o) => (await fetch(`${s.base}/health`, { headers: { Origin: o } })).headers.get("access-control-allow-origin");
  assert.equal(await allow("https://touchgrass.onrender.com"), "https://touchgrass.onrender.com");
  assert.equal(await allow("https://evil.com/.onrender.com"), null);
  assert.equal(await allow("http://touchgrass.onrender.com"), null);
  assert.equal(await allow("https://onrender.com.evil.com"), null);
});
