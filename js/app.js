// Touch Grass: the page. Everything runs in this browser; state lives in localStorage.
import * as outdoors from "./outdoors.js";
import { DEFAULT_SERVER_URL, hasWebGPU } from "./libs.js";
import { MODELS, buildFacts, isModelCached, modelLabel, resolveModel, splitMission, templatePlan, writePlan } from "./plan.js";
import { checkPhoto } from "./vision.js";
import { emptyJournal, liveStreak, localDay, logOuting, totalDays } from "./journal.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ------------------------------------------------------------------ storage (best effort)

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`tg:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`tg:${key}`, JSON.stringify(value));
    } catch (e) {
      console.warn("Couldn't save", key, e);
    }
  },
  clear() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("tg:")).forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};

const settings = {
  ai: "local",
  model: MODELS[0].id,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  serverUrl: DEFAULT_SERVER_URL,
  ...store.get("settings", {}),
};
if (settings.ai === "webllm") settings.ai = "local"; // older setting name
let journal = { ...emptyJournal(), ...store.get("journal", {}) };
let current = null; // {place, fc, spots, facts}

// ------------------------------------------------------------------ screens

const SCREENS = ["where", "plan", "out", "proof", "journal"];

function show(name) {
  SCREENS.forEach((s) => ($(s).hidden = s !== name));
  $("settings").hidden = name === "out";
  if (name === "journal") renderJournal();
  if (name === "plan") setTimeout(() => map?.invalidateSize(), 50);
  window.scrollTo({ top: 0 });
}

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (!go) return;
  e.preventDefault();
  const target = go.dataset.go;
  if (target === "where" && store.get("outing")) return show("out");
  show(target === "plan" && !current ? "where" : target);
});

// ------------------------------------------------------------------ 1. where

function whereError(msg) {
  $("where-error").textContent = msg;
  $("where-error").hidden = !msg;
}

$("locate").addEventListener("click", () => {
  whereError("");
  if (!navigator.geolocation) return whereError("This browser can't share your location. Type a place instead.");
  $("locate").disabled = true;
  $("locate").textContent = "📍 Finding you…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      resetLocate();
      loadPlan({ name: "You", label: "Your location", lat: pos.coords.latitude, lon: pos.coords.longitude });
    },
    (err) => {
      resetLocate();
      whereError(err.code === 1 ? "Location is blocked. Type a place instead." : "Couldn't get your location. Type a place instead.");
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60_000 },
  );
});

function resetLocate() {
  $("locate").disabled = false;
  $("locate").textContent = "📍 Use my location";
}

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  whereError("");
  try {
    loadPlan(await outdoors.geocode(q));
  } catch (err) {
    whereError(err.message);
  }
});

function renderRecent() {
  const last = store.get("place");
  $("recent").hidden = !last;
  if (last) $("recent").textContent = `↻ Plan again for ${last.label}`;
}
$("recent").addEventListener("click", () => loadPlan(store.get("place")));

// ------------------------------------------------------------------ 2. plan

let map = null;

async function loadPlan(place) {
  store.set("place", place);
  show("plan");
  $("plan-place").textContent = place.label;
  $("offline-note").hidden = true;
  $("w-window").textContent = "…";
  $("w-detail").textContent = $("w-sunset").textContent = $("w-left").textContent = "";
  $("ai-plan").textContent = "Checking the sky and the map…";
  $("ai-plan").classList.add("loading");
  $("ai-mission").hidden = $("ai-note").hidden = $("rewrite").hidden = true;
  $("ai-source").textContent = "";
  $("spots").innerHTML = "";

  let fc;
  let spots = [];
  try {
    const [f, s] = await Promise.allSettled([
      outdoors.forecast(place.lat, place.lon),
      outdoors.nearbySpots(place.lat, place.lon),
    ]);
    if (f.status === "rejected") throw f.reason;
    fc = f.value;
    if (s.status === "fulfilled") spots = s.value;
    else console.warn("Overpass failed:", s.reason);
  } catch (err) {
    const saved = store.get("lastPlan");
    if (saved && saved.place.lat === place.lat && saved.place.lon === place.lon) {
      $("offline-note").textContent = `You're offline. This is your last plan, from ${new Date(saved.at).toLocaleString()}.`;
      $("offline-note").hidden = false;
      return renderPlan(saved.place, saved.fc, saved.spots, saved.plan);
    }
    show("where");
    return whereError(`Couldn't get the weather: ${err.message}`);
  }
  renderPlan(place, fc, spots);
}

function renderPlan(place, fc, spots, savedPlan) {
  const facts = buildFacts(place, fc, spots);
  current = { place, fc, spots, facts };
  const w = outdoors.bestWindow(fc);
  if (w.length) {
    const end = w[w.length - 1].time + 3600_000;
    $("w-window").textContent = `${outdoors.hhmm(w[0].time)}–${outdoors.hhmm(end)}`;
    $("w-detail").textContent = `${fc.tomorrow ? "Tomorrow · " : ""}${Math.round(w[0].temp)}°C · ${outdoors.skyOf(w[0].code)} · 🌧 ${Math.max(...w.map((h) => h.rainChance))}%`;
  } else {
    $("w-window").textContent = "No daylight left";
  }
  $("sun-label").textContent = fc.tomorrow ? "Tomorrow's sunset" : "Sunset";
  $("w-sunset").textContent = outdoors.hhmm(fc.sunset);
  $("w-left").textContent = fc.tomorrow
    ? `It's dark now. Sunrise ${outdoors.hhmm(fc.sunrise)}`
    : `${Math.floor(fc.daylightLeftMin / 60)}h ${fc.daylightLeftMin % 60}m of light left`;

  $("spots").innerHTML = spots.length
    ? spots
        .map(
          (s) => `<li><a href="${outdoors.mapUrl(s)}" target="_blank" rel="noopener">
            <span>📍 ${esc(s.name)} <span class="muted">· ${esc(s.kind)}</span></span>
            <span class="meta">${outdoors.fmtDist(s.distance)} · ${outdoors.walkMin(s.distance)} min</span></a></li>`,
        )
        .join("")
    : `<li class="muted">No named parks or trails mapped within 3 km. Any patch of sky counts!</li>`;
  drawMap(place, spots);

  if (savedPlan) return showPlan(savedPlan);
  showPlan({ ...splitMission(templatePlan(facts)), source: "template" });
  maybeWriteWithAI();
}

function showPlan(p) {
  current.plan = p;
  $("ai-plan").classList.remove("loading");
  $("ai-plan").textContent = p.plan;
  $("ai-mission").textContent = p.mission;
  $("ai-mission").hidden = !p.mission;
  $("ai-source").textContent = p.source === "template" ? "plain plan" : `🧠 ${p.source}`;
  $("rewrite").hidden = settings.ai === "none";
  $("share").hidden = false;
  store.set("lastPlan", { at: Date.now(), place: current.place, fc: current.fc, spots: current.spots, plan: p });
}

// Ollama and cached in-browser models write right away. A first-time 1 GB download waits for a tap.
async function maybeWriteWithAI() {
  if (settings.ai === "none") return;
  const model = resolveModel(settings.model, await hasWebGPU());
  if (settings.ai === "local" && !(await isModelCached(model))) {
    $("ai-note").innerHTML = `<div class="row">
        <button class="btn" id="ai-start">✨ On-device AI</button>
        <button class="btn" id="ai-server">☁️ Ask Hermes (no download)</button>
      </div>
      <small>✨ ${esc(model.name)} downloads once (${esc(model.size)}), then runs on this phone, even offline.<br>
      ☁️ Hermes 3 on our server answers now. It gets only the weather and place names, never your location or photos.</small>`;
    $("ai-note").hidden = false;
    $("rewrite").hidden = true;
    $("ai-start").addEventListener("click", () => writeWithAI(), { once: true });
    $("ai-server").addEventListener("click", () => writeWithAI({ ai: "server" }), { once: true });
    return;
  }
  writeWithAI();
}

async function writeWithAI(override = {}) {
  if (!current) return;
  $("ai-note").hidden = true;
  $("rewrite").hidden = true;
  $("ai-plan").classList.add("loading");
  $("ai-source").textContent = "🧠 thinking…";
  const progress = $("ai-progress");
  const result = await writePlan(current.facts, { ...settings, ...override }, {
    onProgress: (p) => {
      progress.hidden = false;
      $("ai-bar").style.width = `${Math.round((p.progress || 0) * 100)}%`;
      $("ai-progress-text").textContent = p.text || "Loading the model…";
    },
  });
  progress.hidden = true;
  showPlan(result);
  if (result.error) {
    $("ai-note").textContent = `The AI couldn't run (${result.error}), so here's a plain plan.`;
    $("ai-note").hidden = false;
  }
}
$("rewrite").addEventListener("click", () => writeWithAI(current?.plan?.source?.includes("server") ? { ai: "server" } : {}));

// Invite friends: the plan as plain text, via the phone's share sheet (or the clipboard).
function planText() {
  const w = outdoors.bestWindow(current.fc);
  const when = w.length ? `${current.fc.tomorrow ? "tomorrow " : ""}${outdoors.hhmm(w[0].time)}–${outdoors.hhmm(w.at(-1).time + 3600_000)}` : "";
  const spot = current.spots[0];
  return [
    `🌿 Let's touch grass${when ? ` ${when}` : ""}!`,
    spot ? `📍 ${spot.name}: ${outdoors.mapUrl(spot)}` : "",
    current.plan?.plan || "",
    current.plan?.mission ? `🎯 ${current.plan.mission}` : "",
    `🌇 Sunset ${outdoors.hhmm(current.fc.sunset)}`,
  ].filter(Boolean).join("\n");
}

$("share").addEventListener("click", async () => {
  const text = planText();
  try {
    if (navigator.share) return await navigator.share({ title: "Touch Grass", text, url: location.href });
    await navigator.clipboard.writeText(`${text}\n${location.href}`);
    $("share").textContent = "✓ Copied, paste it to your friends";
  } catch (e) {
    if (e.name !== "AbortError") $("share").textContent = "Couldn't share on this browser";
  }
});

function drawMap(place, spots) {
  if (!window.L) return; // offline, or the map library didn't load
  if (!map) {
    map = L.map("map", { zoomControl: false, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  map.eachLayer((l) => l instanceof L.TileLayer || map.removeLayer(l));
  const you = L.circleMarker([place.lat, place.lon], { radius: 8, color: "#2f6b3a", fillOpacity: 0.9 }).addTo(map);
  you.bindPopup(esc(place.label));
  const pts = [[place.lat, place.lon]];
  spots.forEach((s) => {
    L.marker([s.lat, s.lon]).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.kind)} · ${outdoors.fmtDist(s.distance)}`);
    pts.push([s.lat, s.lon]);
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [24, 24], maxZoom: 16 });
  else map.setView(pts[0], 15);
}

// ------------------------------------------------------------------ 3. outside

$("go-out").addEventListener("click", () => {
  const outing = {
    start: Date.now(),
    mission: current?.plan?.mission || "Find three different kinds of leaves.",
    place: current?.spots?.[0]?.name || current?.place?.label || "",
    sunset: current && !current.fc.tomorrow ? outdoors.hhmm(current.fc.sunset) : "",
  };
  store.set("outing", outing);
  renderOut(outing);
  show("out");
});

function renderOut(o) {
  $("out-since").textContent = new Date(o.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("out-mission").textContent = o.mission;
  $("out-sunset").textContent = o.sunset ? `Sunset at ${o.sunset}. Come back with a photo.` : "Come back with a photo.";
}

$("cancel-out").addEventListener("click", () => {
  store.set("outing", null);
  show(current ? "plan" : "where");
});

// ------------------------------------------------------------------ 4. proof

const MAX_PHOTO_AGE = 24 * 3600_000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't a photo I can read."));
    img.src = URL.createObjectURL(file);
  });
}

function shrink(img, size, quality) {
  const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

async function handlePhoto(file) {
  if (!file) return;
  show("proof");
  $("verdict").innerHTML = "";
  $("proof-done").hidden = $("proof-retry").hidden = true;
  let img;
  try {
    img = await loadImage(file);
  } catch (e) {
    return verdict(`<h3>🤔 Hmm</h3><p>${esc(e.message)}</p>`, false);
  }
  $("proof-img").src = img.src;
  if (file.lastModified && Date.now() - file.lastModified > MAX_PHOTO_AGE) {
    return verdict("<h3>🕰 That photo is old</h3><p>Take a fresh one outside today!</p>", false);
  }
  const progress = $("clip-progress");
  progress.hidden = false;
  $("clip-progress-text").textContent = "Looking at your photo…";
  let result;
  try {
    result = await checkPhoto(shrink(img, 448, 0.9), {
      onProgress: (p) => {
        $("clip-bar").style.width = `${Math.round(p.progress * 100)}%`;
        $("clip-progress-text").textContent = `${p.text} (first time only)`;
      },
    });
  } catch (e) {
    console.error(e);
    progress.hidden = true;
    return verdict(
      `<h3>📡 Couldn't load the photo checker</h3><p>It downloads once (~90 MB), then works offline. Try again with a connection.</p>`,
      false,
    );
  }
  progress.hidden = true;
  const tags = result.spotted.length ? `<ul class="tags">${result.spotted.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  if (!result.outdoors) {
    const why = /screen|screenshot|printed/.test(result.top) ? "That looks like a screen or a picture of one." : "That looks like it's indoors.";
    return verdict(`<h3>🏠 Not quite outside…</h3><p>${why} Go get some real sky! ☀️</p>`, false);
  }
  const outing = store.get("outing");
  const entry = {
    at: Date.now(),
    thumb: shrink(img, 160, 0.7),
    spotted: result.spotted,
    place: outing?.place || store.get("place")?.label || "",
    minutes: outing ? Math.round((Date.now() - outing.start) / 60_000) : null,
    mission: outing?.mission || "",
  };
  const logged = logOuting(journal, entry, localDay());
  journal = logged.journal;
  store.set("journal", journal);
  store.set("outing", null);
  renderChip();
  const mins = entry.minutes ? `<p>You were out for <b>${entry.minutes} min</b>.</p>` : "";
  verdict(
    `<h3>✅ Grass touched!</h3>${tags ? `<p>Spotted:</p>${tags}` : ""}${mins}
     <p>🔥 <b>${journal.streak}</b> day streak${logged.newDay ? "" : " (already counted today, nice extra!)"} · 🏆 best ${journal.best}</p>`,
    true,
  );
}

function verdict(html, ok) {
  $("verdict").innerHTML = html;
  $("proof-done").hidden = !ok;
  $("proof-retry").hidden = ok;
}

["proof-input", "retry-input", "log-input"].forEach((id) =>
  $(id).addEventListener("change", (e) => {
    handlePhoto(e.target.files[0]);
    e.target.value = "";
  }),
);
$("proof-done").addEventListener("click", () => show("journal"));

// ------------------------------------------------------------------ 5. journal

function renderChip() {
  $("streak-chip").textContent = `🔥 ${liveStreak(journal, localDay())}`;
}

function renderJournal() {
  $("j-streak").textContent = liveStreak(journal, localDay());
  $("j-best").textContent = journal.best;
  $("j-total").textContent = totalDays(journal);
  $("j-empty").hidden = journal.entries.length > 0;
  $("entries").innerHTML = journal.entries
    .map((e) => {
      const when = new Date(e.at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const tags = e.spotted?.length ? `<ul class="tags">${e.spotted.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
      return `<li><img src="${e.thumb}" alt="">
        <div><b>${esc(when)}</b>${e.minutes ? ` · ${e.minutes} min` : ""}<br>
        <span class="muted small">${esc(e.place || "")}</span>${tags}</div></li>`;
    })
    .join("");
}

// ------------------------------------------------------------------ settings

function renderSettings() {
  $("model").innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(modelLabel(m))}</option>`).join("");
  hasWebGPU().then((gpu) => {
    $("gpu-note").textContent = gpu
      ? "WebGPU is available here, so models run on your GPU."
      : `No WebGPU on this browser, so ${resolveModel(MODELS[0].id, false).name} runs on the CPU instead (slower, but works).`;
  });
  $("model").value = settings.model;
  document.querySelectorAll('input[name="ai"]').forEach((r) => (r.checked = r.value === settings.ai));
  $("ollama-url").value = settings.ollamaUrl;
  $("server-url").value = settings.serverUrl;
  $("ollama-model").value = settings.ollamaModel;
  document.querySelectorAll(".origin").forEach((el) => (el.textContent = location.origin));
}

function saveSettings() {
  settings.ai = document.querySelector('input[name="ai"]:checked')?.value || "none";
  settings.model = $("model").value;
  settings.ollamaUrl = $("ollama-url").value.trim() || "http://localhost:11434";
  settings.ollamaModel = $("ollama-model").value.trim() || "gemma3:4b";
  settings.serverUrl = $("server-url").value.trim() || DEFAULT_SERVER_URL;
  store.set("settings", settings);
}
$("settings").addEventListener("change", saveSettings);

$("wipe").addEventListener("click", () => {
  if (!confirm("Delete your journal, streak and settings from this device?")) return;
  store.clear();
  location.reload();
});

// ------------------------------------------------------------------ start

renderSettings();
renderChip();
renderRecent();
const outing = store.get("outing");
if (outing) {
  renderOut(outing);
  show("out");
} else {
  show("where");
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("No offline mode:", e));
}
