---
title: Touch Grass, a website that runs an open-weight model on your phone to get you outside
published: false
tags: devchallenge, hf26challenge
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built

**Touch Grass** is a website that answers one question: *when and where should I go outside today?* Then it checks that you actually went.

1. Tap **📍 Use my location**. You get the **best 2-hour window before sunset** (scored from the hourly forecast), **real parks, gardens, trails and viewpoints nearby** on a map, and a short plan with a **mini mission** ("spot a crow and three kinds of leaves").
2. Tap **🌿 I'm going outside**. The page turns into a dark, calm card: *Put the phone away.* Just your mission and the sunset time.
3. Back home, tap **📸 I'm back. Prove it.** and take a photo. An AI checks it was really taken outdoors (not indoors, not a screenshot, not a photo of a screen), says what it spotted, and adds a day to your **streak** and **grass journal**.

Tap **📤 Invite friends** to send the plan and map link to your group.

It's for anyone who opens their phone "for a minute" and looks up two hours later. The screen part takes about a minute. The rest happens outside.

## Demo

**Try it live:** https://touchgrass-zxhn.onrender.com (hosted on Render) · mirror: https://aminul821.github.io/TOUCHGRASS/

Open it on your phone (Chrome or Edge on Android works best), tap **📍 Use my location**, and you'll have a plan in a few seconds. The first time you tap **✨ Let the on-device AI write it**, the model downloads once (0.5–1 GB, so use Wi-Fi). After that it runs on your phone, even offline.

## Code

{% github aminul821/TOUCHGRASS %}

No build step: plain HTML, CSS and JavaScript modules. `js/outdoors.js` handles weather, places and scoring, `js/plan.js` the language model, `js/vision.js` the photo check, and `js/journal.js` the streaks.

## How I Built It

**Everything AI runs in the visitor's browser.** There's no backend at all, just a static site on Render.

- **Plan writer:** [WebLLM](https://github.com/mlc-ai/web-llm) runs **Qwen 2.5 1.5B Instruct** (open weights, 4-bit) on WebGPU. You can switch to Llama 3.2 1B or Gemma 3 1B, or point it at your own **Ollama** server. On phones with no WebGPU, it automatically uses **Qwen 3 0.6B** through transformers.js on the CPU, so every phone gets the AI plan.
- **Optional Hermes server:** for phones that can't download a model, the repo also has a small Docker server (`server/`) that runs **Hermes 3 3B** (Nous Research, open weights) on **Ollama**, CPU only. It gets only the facts, never coordinates or photos. It needs ~2.5 GB of RAM, so it isn't deployed on a free tier. The site only shows its button when the server answers.
- **Front end on Render:** the website is deployed on **Render** as a static site from a `render.yaml` Blueprint, and redeploys on every push.
- **Photo checker:** [transformers.js](https://github.com/huggingface/transformers.js) runs **CLIP ViT-B/32** (open weights) on WebAssembly, so it works even on phones without WebGPU. It's zero-shot: the photo is scored against labels like "a photo of a park with grass and trees" vs "a screenshot of a phone or computer" vs "a photo taken indoors in a room". It passes only if 60%+ of the probability goes to the outdoor labels. A second pass names what's in it ("trees", "bird", "clouds").
- **Open data:** [Open-Meteo](https://open-meteo.com) for the hourly forecast and sunset, and [OpenStreetMap](https://www.openstreetmap.org) via Overpass for green spots, drawn with Leaflet. Neither needs an API key.

**Facts first, model second.** A 1.5B model will happily invent a park, so it never gets the chance:

1. Code scores every daylight hour (rain chance, storm codes, temperature comfort, wind) and picks the best 2 in a row.
2. Code gets real named places from OpenStreetMap, removes duplicates and sorts them by distance.
3. The model gets only that JSON, with instructions to use only those places, and writes the human part: which spot, what to bring, a mission.
4. If anything fails (no WebGPU, offline, model error), you still get a plain template plan. A photo that couldn't be checked is never counted.

**Respect the download.** The plain plan shows instantly. The ~1 GB language model downloads only when you tap **✨ Let the on-device AI write it**. After that, WebLLM's cache makes it load in seconds. A service worker caches the app, so once CLIP (~90 MB) is cached, the photo check and journal work **on the trail with no signal**.

## Why Does Open Innovation Matter?

- **Your location and photos never leave your phone.** This app sees exactly where you are and pictures of where you've been. With a closed API that data goes to someone else's server. Here the model weights come to *you* instead.
- **It costs nothing to run, for anyone.** No inference bill and no API keys means I can leave it online for free forever, and anyone can fork it and host their own copy on GitHub Pages in two minutes.
- **Swap models freely.** A dropdown switches between Qwen, Llama and Gemma. Got a gaming PC? Point it at Ollama and use a bigger model. No vendor lock-in and no deprecation emails.
- **It works where closed APIs can't:** on a hill with one bar of signal, after the models are cached.
- **Open maps make it honest.** The plan can only use places that exist in OpenStreetMap, the same map local hikers and gardeners edit.
- **It runs on every phone, not just new ones.** Because the models are open, I could pick a small one for phones without WebGPU (Qwen 3 0.6B on the CPU) and a bigger one for phones with a GPU. With a closed API I'd get one model at one price, and nothing at all offline.

## My Agent Session

I built Touch Grass with **Claude Code** as my coding agent. I described the idea and made the calls (website instead of a bot, which models, where to host), and the agent wrote the code, tests and docs. Then it checked the site in a real Chromium browser, light and dark mode, and loaded the real WebLLM and transformers.js libraries to make sure they work. The open-weight models are what run inside the app; Claude Code was only the tool I used to build it.

## Prize Categories

- **Render**: Render hosts the app's front end at https://touchgrass-zxhn.onrender.com (static site from a `render.yaml` Blueprint, redeployed on every push).
