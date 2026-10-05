---
title: TOUCHGRASS, a Telegram bot that sends your group chat outside (local Gemma 3 + OpenStreetMap)
published: false
tags: devchallenge, hf26challenge
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built

**TOUCHGRASS** is a Telegram bot for friend groups that live in their group chat. Instead
of keeping you on the screen, it does three things to get you outside:

- 🌿 **`/touchgrass`** finds the best 2-hour weather window before sunset and real nearby
  parks, gardens, trails and viewpoints, then writes a short plan with one small mission
  ("find three different leaves", "watch the sunset from the viewpoint"). Friends tap
  **🙋 I'm in**.
- 📸 **`/touched`**: send a photo from outside. A local vision model checks it was really
  taken outdoors (screenshots and photos of a screen are rejected), says what it spotted
  ("banyan tree, crow"), and grows your streak. **`/grassboard`** turns it into a group
  competition.
- ☀️ **Golden-hour nudge**: about 2 hours before sunset, if the weather is good, the bot
  tells the group how much light is left, with a button that plans the walk. It stays
  quiet in storms.

The screen part is one message. The rest happens outside.

## Demo

<!-- TODO: add a short screen recording: /touchgrass → plan → 🙋 I'm in → /touched photo → streak -->

## Code

{% github aminul821/TOUCHGRASS %}

- `touchgrass/llm.py`: a tiny client for a local Ollama server (text, images, JSON-schema output)
- `touchgrass/outdoors.py`: Open-Meteo forecast and sunset, OpenStreetMap (Overpass) green spots, and the weather-window scoring
- `touchgrass/bot.py`: the commands, streaks and nudges (python-telegram-bot)

`docker compose up` starts the bot and Ollama together.

## How I Built It

**Open-weight model:** [Gemma 3 4B](https://ollama.com/library/gemma3) served by
**[Ollama](https://ollama.com)** next to the bot (`docker compose up` starts both). One model handles both jobs:
writing plans (text) and checking `/touched` photos (vision). It runs on a laptop CPU.

**Open data, no API keys:** [Open-Meteo](https://open-meteo.com) for the hourly forecast
and sunrise/sunset, and [OpenStreetMap](https://www.openstreetmap.org) via the Overpass
API for parks, gardens, woods, beaches, peaks, viewpoints and hiking routes.

**Facts first, model second.** I didn't want an LLM inventing a park that doesn't exist,
so the pipeline is:

1. Code picks the best window: each daylight hour is scored on rain chance, storm codes,
   temperature comfort and wind, and the best 2 consecutive hours win.
2. Code gets real spots from OSM, removes duplicates and sorts them by distance.
3. The model gets only that JSON and is told to use only those places. It writes the
   friendly part: which spot, what to bring, a mini mission.
4. If Ollama is down, a plain template plan is posted instead. The feature never breaks.

**Photo checks use structured output.** Ollama's `format` field takes a JSON schema, so the
vision model must answer `{outdoors, screenshot, nature[], comment}`. The bot reads
booleans, not free text. A day only counts if `outdoors && !screenshot`, and forwarded
photos are rejected before the model sees them.

## Why Does Open Innovation Matter?

- **Photos stay at home.** People send pictures of where they are right now. Those
  pictures go to a model on our own server, not to a company's API. For a friends' group
  that's the difference between "fun" and "no thanks".
- **It costs nothing to run.** An open model on a small server or an old laptop, plus
  key-free open weather and map data, means no per-request bill. A nudge every afternoon
  costs nothing.
- **Swap the model with one setting.** `GRASS_MODEL=gemma3:4b` on a laptop,
  `gemma3:12b` or `qwen2.5vl` on a bigger machine. Same code, no vendor lock-in, and no
  deprecation emails.
- **Open maps make it honest.** The plan can only use real places from OpenStreetMap, the
  same map the local hiking community edits.

<!-- TODO: where did the open approach beat a closed one for you? e.g. latency on the box, privacy reactions from the group -->

## Taking it outside

<!-- TODO (bonus points): the group actually used it. Which spot did /touchgrass pick? Who's leading /grassboard? Did the vision check catch anyone faking it? -->

## My Agent Session

<!-- Optional: save the session with DevRelay and embed it here with the agent_session tag. -->

## Prize Categories

<!-- List the partner categories you're entering, or remove this section. -->
