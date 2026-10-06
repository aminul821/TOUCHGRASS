# 🌿 Touch Grass

**A website that tells you the best time and spot to go outside today, then checks that you actually went. The AI runs in your browser, so your location and photos never leave your phone.**

**▶ Live: https://touchgrass-zxhn.onrender.com** (Render) · [GitHub Pages mirror](https://aminul821.github.io/TOUCHGRASS/)

Open it, tap **📍 Use my location**, and you get:

- ⏰ **The best 2-hour window before sunset**, scored from the hourly forecast (rain, storms, temperature, wind), and how much daylight is left.
- 📍 **Real parks, gardens, woods, trails and viewpoints nearby** from OpenStreetMap, on a map.
- 🧠 **A short plan and a mini mission** ("spot a crow and three kinds of leaves") written by an **open-weight model running in your browser**.

Then tap **🌿 I'm going outside**. The screen turns into a calm "put the phone away" card with your mission. When you're back, tap **📸 I'm back. Prove it.** and take a photo. An open **CLIP** model, also in your browser, checks it was taken outdoors (not indoors, not a screenshot, not a photo of a screen), says what it spotted, and adds a day to your **streak** and **grass journal**.

The screen part takes a minute. The rest happens outside.

## 🧠 Open-source AI, all on your device

| Job | Model | Runs with |
|---|---|---|
| Write the plan | **Qwen 2.5 1.5B** (default), Llama 3.2 1B or Gemma 3 1B, open weights | [WebLLM](https://github.com/mlc-ai/web-llm) on WebGPU |
| …on phones without WebGPU | **Qwen 3 0.6B**, open weights (`onnx-community/Qwen3-0.6B-ONNX`) | [transformers.js](https://github.com/huggingface/transformers.js) on WebAssembly (CPU) |
| …or optionally on a server | **Hermes 3** (Llama 3.2 3B, Nous Research, open weights, `hermes3:3b`) | [Ollama](https://ollama.com) in `server/` (Docker) |
| Or write the plan | Any model on your own [Ollama](https://ollama.com), e.g. `gemma3:4b` | Ollama on your computer |
| Check the photo | **CLIP ViT-B/32**, open weights (`Xenova/clip-vit-base-patch32`) | [transformers.js](https://github.com/huggingface/transformers.js) (WebAssembly, works on phones) |

- **No server, no API keys, no account.** It's a static site. Weather is from [Open-Meteo](https://open-meteo.com) and places from [OpenStreetMap](https://www.openstreetmap.org), both open data, called straight from the browser.
- **Facts first, model second.** Code picks the time window and finds the places. The model only gets that JSON and is told to use only those places, so it can't send you to a park that doesn't exist.
- **AI on every phone.** If the browser has no usable GPU, the page switches to a smaller model that runs on the CPU instead of skipping the AI.
- **Asks before big downloads.** You get a plain plan right away. The language model (0.5–1 GB) downloads only when you tap **✨ Let the on-device AI write it**, once. After that it loads from the browser cache.
- **Works on the trail.** A service worker caches the app. Once the CLIP model is cached (~90 MB), the photo check and journal work with **no signal**. Your last plan is saved too.
- **📤 Invite friends** shares the plan, the spot's map link and the mission through the phone's share sheet.
- **Busy map servers are handled.** If the main OpenStreetMap (Overpass) server is overloaded, it tries public mirrors.
- **Never breaks.** No WebGPU, no connection, or a model error? You still get the plain plan. A photo that couldn't be checked is never counted.
- **Your data stays put.** The journal, streak and photo thumbnails live in your browser's storage on this device. **Delete my journal** wipes them.

## ☁️ Hosting

| Part | Where |
|---|---|
| Website | **GitHub Pages**, and **Render** as a free static site (`render.yaml` Blueprint) |
| AI | **In the visitor's browser.** No server needed. |
| Optional Hermes 3 server | `server/`: any Docker host with ~4 GB RAM. Not deployed right now. |

**Deploy the website on Render:** Dashboard → **New → Blueprint** → pick this repo → Apply.

### Optional: the Hermes 3 server

For phones that can't download a model, `server/` runs **Hermes 3 3B** (Nous Research, open
weights) on **Ollama**, CPU only, and serves the website too. When `DEFAULT_SERVER_URL`
(`js/libs.js`) answers `/health`, the plan card adds a **☁️ Ask Hermes (no download)** button.
Otherwise the button stays hidden.

- **It gets only the facts:** the weather window and place names. Never GPS coordinates, never photos.
- **Small image:** it copies only Ollama's binaries and CPU libraries (376 MB instead of 9 GB) and bakes the model in.
- **Protected:** Ollama stays private on `127.0.0.1`. The API (`POST /api/plan`) has cleaned, size-capped input, CORS for the site's domains, a per-visitor rate limit, and one generation at a time.
- **Where to host it:** it needs ~2.5 GB of RAM, which means a paid plan on Render (Pro) or a Hugging Face PRO account (Docker Spaces; `.github/workflows/hf-space.yml` deploys it with an `HF_TOKEN` secret). Free tiers don't have enough memory.

Run the server locally with Docker:

```bash
docker build -f server/Dockerfile -t touchgrass-hermes .
docker run -p 10000:10000 touchgrass-hermes
# website: http://localhost:10000 · API: POST /api/plan · health: /health
```

## 🚀 Run it yourself

It's plain HTML, CSS and JavaScript modules, with no build step.

```bash
git clone https://github.com/aminul821/TOUCHGRASS && cd TOUCHGRASS
npx http-server -c-1 -p 8080 .     # then open http://localhost:8080
```

Location, WebGPU and the service worker need `https://` or `localhost`.

**Deploying:** every push to `main` runs the tests and publishes to GitHub Pages
(`.github/workflows/pages.yml`). One-time setup: the repo must be **public** (Pages on a
free account needs that), then **Settings → Pages → Source: GitHub Actions**.

**Using Ollama instead of the in-browser model:** open **⚙️ AI settings**, pick *Ollama on this computer*, then let the page talk to Ollama:

```bash
OLLAMA_ORIGINS=https://aminul821.github.io ollama serve
ollama pull gemma3:4b
```

## 🧪 Tests

```bash
npm test     # node's built-in test runner, no dependencies
```

The tests cover weather parsing and window scoring, after-dark plans, OpenStreetMap parsing, both AI backends and the fallback, the photo verdicts, and streaks across days and month ends. Weather, map and model responses are faked in their real formats.

## 🧱 Project structure

```
index.html            the five screens: where → plan → outside → proof → journal
css/style.css         mobile-first, light and dark
js/app.js             UI and state (localStorage)
js/outdoors.js        Open-Meteo weather, OpenStreetMap spots, best-window scoring
js/plan.js            facts → plan: WebLLM (GPU), transformers.js (CPU), Ollama or template
js/libs.js            pinned AI library URLs, WebGPU check
js/vision.js          CLIP photo check (transformers.js)
js/journal.js         streaks and journal (pure functions)
sw.js                 offline app shell
server/index.mjs      Hermes server: /api/plan → Hermes 3 on Ollama, plus the website
server/Dockerfile     Ollama (CPU only) + hermes3:3b + Node
render.yaml           Render Blueprint: the website as a free static site
.github/workflows/    tests + GitHub Pages, and an optional Hugging Face Space deploy
tests/                node --test unit tests
```

## 🙏 Built on

[Hermes 3](https://nousresearch.com/hermes3/) · [Ollama](https://ollama.com) · [Render](https://render.com) · [WebLLM](https://github.com/mlc-ai/web-llm) · [Qwen 2.5](https://github.com/QwenLM/Qwen2.5) · [transformers.js](https://github.com/huggingface/transformers.js) · [CLIP](https://github.com/openai/CLIP) ·
[Open-Meteo](https://open-meteo.com) · [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL) · [Leaflet](https://leafletjs.com)

MIT licensed.
