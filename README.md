# 🌿 TOUCHGRASS

**A Telegram bot that gets your group off the screen and outside, powered by an open-weight model running on your own machine.**

Group chats are great at keeping people indoors. Touch Grass pushes the other way: it
tells you when and where to go outside today, checks that you actually went, and gives the
group a streak to compete on. The phone part takes a few seconds. The rest happens outside.

## ✨ What it does

| Command | What happens |
|---|---|
| `/touchgrass [place]` | Finds the **best 2-hour weather window before sunset** and **real parks, gardens, trails and viewpoints nearby**, then writes a short plan with one small outdoor mission. Friends tap **🙋 I'm in**. Works with a place name, a reply to a 📍 location, or the group's home spot. |
| `/touched` | Send a photo from outside with this caption (or reply to your photo). A **local vision model** checks it was really taken outdoors and rejects screenshots, photos of screens and forwards. It says what it spotted and adds a day to your streak. |
| `/grassboard` | The group's streak leaderboard 🥇🥈🥉 |
| `/sethome <place>` | The group's usual starting point (admins; or reply to a 📍 location) |
| `/nudges on\|off` | A daily **golden-hour nudge** about 2 hours before sunset, only when the weather is good (admins) |

A plan looks like this (illustrative):

```
🌿 Touch Grass ➜ Dhaka, Dhaka Division, Bangladesh

⏰ Best window: 15:00–17:00 · 24°C · mostly clear · 🌧 5%
🌇 Sunset: 17:40 (6h 25m of light left)
📍 Botanical Garden (garden, 1.2 km)
📍 Viewpoint (viewpoint, 1.5 km)

│ <the local model's plan: where, when, what to bring, a mini mission>
🧠 gemma3:4b · local
```

## 🧠 How it works

```
            ┌────────────── facts (code) ──────────────┐
/touchgrass → Open-Meteo forecast → score each daylight hour (rain, storms, temp, wind)
            → OpenStreetMap / Overpass → real named green spots, sorted by distance
            └──────────────────────┬───────────────────┘
                                   ▼
                 local open-weight model (Ollama, Gemma 3)
                 "use ONLY these places" → friendly plan + mission

/touched    → photo → local vision model with a JSON schema
              {outdoors, screenshot, nature[], comment} → streak only if outdoors && !screenshot
```

- **Facts first, model second.** Code picks the time window and looks up the places. The
  model only gets that JSON, so it can't invent a park that doesn't exist.
- **Structured output.** Photo checks use Ollama's `format` (JSON schema), so the bot reads
  booleans, not free text.
- **Graceful when the model is down.** `/touchgrass` posts a plain template plan instead.
  `/touched` says it can't check photos right now and never counts a photo it hasn't checked.

## 🔓 Why open-source AI

- **Your photos stay home.** People send pictures of exactly where they are. They go to
  the model on your own machine, not to someone else's API.
- **Free to run.** An open model on your own box, plus Open-Meteo and OpenStreetMap
  (open data, no API keys), means no per-request bill.
- **Swap models with one line.** `OLLAMA_MODEL=gemma3:4b` on a laptop, `gemma3:12b` or
  `qwen2.5vl` on a bigger machine.

## 🚀 Run it

**1. Create a bot** with [@BotFather](https://t.me/BotFather) and copy the token.
In a group, make it an admin or turn off its privacy mode (`/setprivacy` → Disable) so it
can see `/touched` photo captions.

**2a. Docker (bot + Ollama together):**

```bash
cp .env.example .env        # put BOT_TOKEN in it
docker compose up -d        # the first start downloads gemma3:4b (~3 GB)
```

**2b. Or run it directly:**

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma3:4b

python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # put BOT_TOKEN in it
python -m touchgrass
```

Then in your group: `/sethome Your City` and `/touchgrass`.

### Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | — | Token from @BotFather (**required**) |
| `OLLAMA_URL` | `http://localhost:11434` | Your Ollama server |
| `OLLAMA_MODEL` | `gemma3:4b` | Any Ollama model. Use a vision model (`gemma3`, `qwen2.5vl`, `llava`) for `/touched` |
| `SEARCH_RADIUS` | `3000` | How far to look for parks and trails, in metres |
| `NUDGE_BEFORE_SUNSET` | `120` | Minutes before sunset for the daily nudge (`0` = off) |
| `ALLOWED_CHATS` | — | Only work in these chat ids (empty = anywhere) |
| `DATA_PATH` | `data/touchgrass.json` | Where home spots and streaks are saved |

## 🧪 Tests

```bash
pip install pytest && python -m pytest -q
```

The tests run offline. Weather, map and model responses are faked in their real formats.

## 🧱 Project structure

```
touchgrass/
├── __main__.py   # entry point, handlers, golden-hour job
├── bot.py        # commands, plans, photo checks, nudges
├── outdoors.py   # Open-Meteo weather + OpenStreetMap green spots + window scoring
├── llm.py        # local open-weight model via Ollama (text, vision, JSON schema)
├── store.py      # JSON store: home spots, streaks
└── config.py     # settings from .env
tests/            # offline tests
```

## 🙏 Built on

[Ollama](https://ollama.com) · [Gemma 3](https://ai.google.dev/gemma) ·
[Open-Meteo](https://open-meteo.com) · [OpenStreetMap](https://www.openstreetmap.org) (© OpenStreetMap contributors, ODbL) ·
[python-telegram-bot](https://python-telegram-bot.org)

MIT licensed.
