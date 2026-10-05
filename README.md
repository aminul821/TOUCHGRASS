# 🌿 Touch Grass

**A website that tells you the best time and spot to go outside today, then checks that you actually went. The AI runs in your browser, so your location and photos never leave your phone.**

**▶ Live: https://aminul821.github.io/TOUCHGRASS/**

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
| Or write the plan | Any model on your own [Ollama](https://ollama.com), e.g. `gemma3:4b` | Ollama on your computer |
| Check the photo | **CLIP ViT-B/32**, open weights (`Xenova/clip-vit-base-patch32`) | [transformers.js](https://github.com/huggingface/transformers.js) (WebAssembly, works on phones) |

- **No server, no API keys, no account.** It's a static site. Weather is from [Open-Meteo](https://open-meteo.com) and places from [OpenStreetMap](https://www.openstreetmap.org), both open data, called straight from the browser.
- **Facts first, model second.** Code picks the time window and finds the places. The model only gets that JSON and is told to use only those places, so it can't send you to a park that doesn't exist.
- **Asks before big downloads.** You get a plain plan right away. The ~1 GB language model downloads only when you tap **✨ Let the on-device AI write it**, once. After that it loads from the browser cache.
- **Works on the trail.** A service worker caches the app. Once the CLIP model is cached (~90 MB), the photo check and journal work with **no signal**. Your last plan is saved too.
- **Never breaks.** No WebGPU, no connection, or a model error? You still get the plain plan. A photo that couldn't be checked is never counted.
- **Your data stays put.** The journal, streak and photo thumbnails live in your browser's storage on this device. **Delete my journal** wipes them.

## 🚀 Run it yourself

It's plain HTML, CSS and JavaScript modules, with no build step.

```bash
git clone https://github.com/aminul821/TOUCHGRASS && cd TOUCHGRASS
npx http-server -c-1 -p 8080 .     # then open http://localhost:8080
```

Location, WebGPU and the service worker need `https://` or `localhost`.

**Deploying:** every push to `main` runs the tests and publishes to GitHub Pages
(`.github/workflows/pages.yml`). Turn it on once in **Settings → Pages → Source: GitHub Actions**.

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
js/plan.js            facts → plan: WebLLM, Ollama or template
js/vision.js          CLIP photo check (transformers.js)
js/journal.js         streaks and journal (pure functions)
sw.js                 offline app shell
tests/                node --test unit tests
```

## 🙏 Built on

[WebLLM](https://github.com/mlc-ai/web-llm) · [Qwen 2.5](https://github.com/QwenLM/Qwen2.5) · [transformers.js](https://github.com/huggingface/transformers.js) · [CLIP](https://github.com/openai/CLIP) ·
[Open-Meteo](https://open-meteo.com) · [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL) · [Leaflet](https://leafletjs.com)

MIT licensed.
