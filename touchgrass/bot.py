"""🌿 Touch Grass: a Telegram bot that gets your group off the screen and outside.

- /touchgrass [place]  ➜ outing plan: best weather window before sunset, real nearby
                          parks/trails from OpenStreetMap, written by a local model
- /sethome <place>      ➜ where the group usually heads out from (admins)
- /touched              ➜ photo from outside; the local vision model checks it's really
                          outdoors and counts a day on your streak
- /grassboard           ➜ the group's streaks
- /nudges on|off        ➜ the daily golden-hour nudge before sunset (admins)

The model runs on Ollama on your own machine, so plans and photos never reach a third party.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
from datetime import date, timedelta

from telegram import InlineKeyboardButton as Btn
from telegram import InlineKeyboardMarkup, Message, Update
from telegram.constants import ChatMemberStatus, ChatType
from telegram.ext import ContextTypes

from touchgrass import config, llm, outdoors, store

LOGGER = logging.getLogger("touchgrass")

PLAN_SYSTEM = (
    "You are the outdoors buddy of a group chat. Write a short, warm plan that gets people off "
    "their screens and outside. Use ONLY the places, times and weather in the facts; never invent "
    "a place. Plain text, no markdown, no hashtags, at most 90 words. Include: where to go (one "
    "spot, or two for a walk between them), when, one thing to bring, and one small outdoor "
    "mission (e.g. find three different leaves, spot a bird, watch the sunset). If the weather is "
    "bad, say so honestly and suggest the least-bad window."
)

PHOTO_PROMPT = (
    "Someone says they just went outside and sent this photo as proof. Look at it carefully. "
    "outdoors: true only if the photo was clearly taken outside (sky, plants, grass, trees, "
    "streets, water, trails). screenshot: true if it is a screenshot, a photo of a screen, a "
    "stock or AI-looking image, or a photo of a printed picture. nature: up to 4 short names "
    "of natural things you can see (e.g. 'oak leaves', 'pigeon', 'cumulus clouds'). comment: "
    "one friendly, specific sentence about what you see (max 25 words)."
)

PHOTO_SCHEMA = {
    "type": "object",
    "properties": {
        "outdoors": {"type": "boolean"},
        "screenshot": {"type": "boolean"},
        "nature": {"type": "array", "items": {"type": "string"}},
        "comment": {"type": "string"},
    },
    "required": ["outdoors", "screenshot", "nature", "comment"],
}

HELP = (
    "🌿 <b>Touch Grass</b>: less scrolling, more sky.\n\n"
    "<code>/touchgrass</code> <i>[place]</i>: best time and spot to go outside today "
    "(or reply to a 📍 location)\n"
    "<code>/touched</code>: send a photo from outside with this caption to grow your streak\n"
    "<code>/grassboard</code>: who's touched the most grass\n"
    "<code>/sethome</code> <i>place</i>: the group's home spot (admins)\n"
    "<code>/nudges on|off</code>: daily golden-hour reminder before sunset (admins)\n\n"
    "🧠 <i>Runs on an open-weight model on our own server. Your photos aren't sent anywhere else.</i>"
)

# (chat id, message id) -> {user id: first name}  (RSVPs on a plan)
_rsvps: dict[tuple[int, int], dict[int, str]] = {}


# ---------------------------------------------------------------- helpers


def esc(text: str, limit: int = 60) -> str:
    text = str(text)
    return html.escape(text if len(text) <= limit else text[: limit - 1] + "…")


def _fmt_dist(m: int) -> str:
    return f"{m} m" if m < 1000 else f"{m / 1000:.1f} km"


def _walk_min(m: int) -> int:
    return max(1, round(m / 80))  # ~4.8 km/h


def _location_of(message: Message | None):
    if not message:
        return None
    if message.venue:
        return message.venue.location
    return message.location


def _allowed(update: Update) -> bool:
    chat = update.effective_chat
    return not config.ALLOWED_CHATS or (chat is not None and chat.id in config.ALLOWED_CHATS)


async def _is_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    chat, msg = update.effective_chat, update.effective_message
    if chat.type == ChatType.PRIVATE:
        return True
    if msg and msg.sender_chat and msg.sender_chat.id == chat.id:
        return True  # anonymous admin
    user = update.effective_user
    if not user:
        return False
    member = await context.bot.get_chat_member(chat.id, user.id)
    return member.status in (ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.OWNER)


def _home_place(chat_id: int) -> outdoors.Place | None:
    home = store.home(chat_id)
    return outdoors.Place(home["name"], home["lat"], home["lon"], home["name"]) if home else None


async def _resolve_place(message: Message, args: list[str]) -> outdoors.Place | None:
    """Place from: a replied/attached location, the command argument, or the chat's home."""
    loc = _location_of(message.reply_to_message) or _location_of(message)
    if loc:
        return outdoors.Place("your pin", loc.latitude, loc.longitude, "the shared location")
    if args:
        return await outdoors.geocode(" ".join(args))
    return _home_place(message.chat_id)


# ---------------------------------------------------------------- plans


def _facts(place: outdoors.Place, fc: outdoors.Forecast, window: list, spots: list) -> dict:
    return {
        "starting_point": place.label or place.name,
        "local_time_now": fc.now.strftime("%a %H:%M"),
        "plan_for": "tomorrow (it's dark now)" if fc.tomorrow else "today",
        "sunset": fc.sunset.strftime("%a %H:%M"),
        "daylight_left_minutes": int(fc.daylight_left().total_seconds() // 60),
        "best_window": [
            {"time": h.time.strftime("%a %H:%M"), "temp_c": round(h.temp), "rain_chance": h.rain_chance,
             "sky": h.sky, "wind_kmh": round(h.wind)}
            for h in window
        ],
        "nearby_spots": [
            {"name": s.name, "type": s.kind, "distance": _fmt_dist(s.distance), "walk_minutes": _walk_min(s.distance)}
            for s in spots
        ],
    }


def fallback_plan(facts: dict) -> str:
    """Used when the local model is offline: still a useful plan, just less chatty."""
    w = facts["best_window"]
    spot = facts["nearby_spots"][0] if facts["nearby_spots"] else None
    when = f"around {w[0]['time']} ({w[0]['temp_c']}°C, {w[0]['sky']})" if w else "before sunset"
    where = f"{spot['name']} ({spot['walk_minutes']} min walk)" if spot else "the nearest green patch"
    return f"Head to {where} {when}. Bring water. Mission: find three different kinds of leaves. Sunset is {facts['sunset']}."


def plan_markup(spots: list, count: int = 0) -> InlineKeyboardMarkup:
    rows = [[Btn(f"🙋 I'm in ({count})" if count else "🙋 I'm in", callback_data="grass:in")]]
    rows += [[Btn(f"🗺 {s.name[:28]}", url=s.map_url)] for s in spots[:2]]
    return InlineKeyboardMarkup(rows)


async def build_plan(place: outdoors.Place) -> tuple[str, list]:
    fc, spots = await asyncio.gather(
        outdoors.forecast(place.lat, place.lon),
        outdoors.nearby_spots(place.lat, place.lon),
        return_exceptions=True,
    )
    if isinstance(fc, Exception):
        raise fc
    if isinstance(spots, Exception):
        LOGGER.warning("Overpass lookup failed: %s", spots)
        spots = []
    window = outdoors.best_window(fc)
    facts = _facts(place, fc, window, spots)
    try:
        plan = await llm.chat("Facts (JSON):\n" + json.dumps(facts, ensure_ascii=False), system=PLAN_SYSTEM)
        source = f"🧠 <i>{esc(config.MODEL, 30)} · local</i>"
    except llm.LLMError as e:
        LOGGER.warning("Plan model unavailable: %s", e)
        plan, source = fallback_plan(facts), "📐 <i>offline plan (model unreachable)</i>"

    lines = [f"🌿 <b>Touch Grass</b> ➜ <b>{esc(place.label or place.name, 50)}</b>", ""]
    if window:
        a, b = window[0], window[-1]
        lines.append(
            f"⏰ <b>Best window:</b> {a.time:%H:%M}–{(b.time + timedelta(hours=1)):%H:%M} · "
            f"{round(a.temp)}°C · {a.sky} · 🌧 {max(h.rain_chance for h in window)}%"
        )
    if fc.tomorrow:
        lines.append(f"🌙 <b>It's dark now.</b> Plan for tomorrow · sunrise {fc.sunrise:%H:%M}, sunset {fc.sunset:%H:%M}")
    else:
        left = int(fc.daylight_left().total_seconds() // 60)
        lines.append(f"🌇 <b>Sunset:</b> {fc.sunset:%H:%M} ({left // 60}h {left % 60}m of light left)")
    for s in spots[:4]:
        lines.append(f"📍 {esc(s.name, 40)} <i>({s.kind}, {_fmt_dist(s.distance)})</i>")
    lines += ["", f"<blockquote>{html.escape(plan)}</blockquote>", source]
    return "\n".join(lines), spots


# ---------------------------------------------------------------- commands


async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if _allowed(update):
        await update.effective_message.reply_text(HELP)


async def touchgrass_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    message = update.effective_message
    try:
        place = await _resolve_place(message, context.args or [])
    except outdoors.OutdoorsError as e:
        await message.reply_text(f"❌ {esc(e, 200)}")
        return
    if not place:
        await message.reply_text(
            "🌿 <b>Where are you?</b>\n"
            "<code>/touchgrass Dhaka</code> • or reply to a 📍 location with <code>/touchgrass</code>\n"
            "Admins can save the group's spot with <code>/sethome place</code>."
        )
        return
    msg = await message.reply_text("🌱 <i>Checking the sky and the map…</i>")
    try:
        text, spots = await build_plan(place)
    except outdoors.OutdoorsError as e:
        await msg.edit_text(f"❌ Couldn't get the weather: {esc(e, 200)}")
        return
    await msg.edit_text(text, reply_markup=plan_markup(spots))


async def sethome_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    message = update.effective_message
    if not await _is_admin(update, context):
        await message.reply_text("🛡 Only admins can set the group's home spot.")
        return
    try:
        loc = _location_of(message.reply_to_message)
        if loc:
            place = outdoors.Place("Group spot", loc.latitude, loc.longitude, "Group spot")
        elif context.args:
            place = await outdoors.geocode(" ".join(context.args))
        else:
            await message.reply_text("<b>Usage:</b> <code>/sethome Dhaka</code> or reply to a 📍 location.")
            return
    except outdoors.OutdoorsError as e:
        await message.reply_text(f"❌ {esc(e, 200)}")
        return
    store.set_home(message.chat_id, place.label or place.name, place.lat, place.lon)
    nudge = (
        f"\n☀️ I'll nudge everyone ~{config.NUDGE_BEFORE_SUNSET} min before sunset when the weather's nice "
        "(<code>/nudges off</code> to stop)."
        if config.NUDGE_BEFORE_SUNSET and store.nudges_on(message.chat_id) else ""
    )
    await message.reply_text(f"🏡 <b>Home spot saved:</b> {esc(place.label or place.name)}{nudge}")


async def nudges_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    message = update.effective_message
    arg = (context.args or [""])[0].lower()
    if arg not in ("on", "off"):
        state = "on" if store.nudges_on(message.chat_id) else "off"
        await message.reply_text(f"☀️ Golden-hour nudges are <b>{state}</b>. Use <code>/nudges on|off</code>.")
        return
    if not await _is_admin(update, context):
        await message.reply_text("🛡 Only admins can change nudges.")
        return
    store.set_nudges(message.chat_id, arg == "on")
    await message.reply_text(f"☀️ Golden-hour nudges <b>{arg}</b>.")


async def touched_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    message = update.effective_message
    target = message if message.photo else message.reply_to_message
    if not target or not target.photo:
        await message.reply_text(
            "📸 <b>Prove it!</b> Send a photo from outside with the caption <code>/touched</code>, "
            "or reply to your photo with <code>/touched</code>.\n"
            "<i>Checked by a model on our own server. Your photo isn't sent anywhere else.</i>"
        )
        return
    user = message.from_user
    if not user or not target.from_user or target.from_user.id != user.id:
        await message.reply_text("🙅 You can only log your own photos.")
        return
    if target.forward_origin:
        await message.reply_text("🙅 Forwarded photos don't count. Take a fresh one outside!")
        return
    msg = await message.reply_text("🔍 <i>Looking at your photo…</i>")
    try:
        file = await target.photo[-1].get_file()
        photo = bytes(await file.download_as_bytearray())
        verdict = await llm.chat_json(PHOTO_PROMPT, PHOTO_SCHEMA, images=[photo])
    except llm.LLMError as e:
        LOGGER.warning("Photo check failed: %s", e)
        await msg.edit_text(
            "🤖 The local vision model isn't available right now, so I can't check photos.\n"
            f"<i>Ask the owner to run</i> <code>ollama pull {esc(config.MODEL, 40)}</code>."
        )
        return
    comment = esc(verdict.get("comment", ""), 200)
    if not verdict.get("outdoors") or verdict.get("screenshot"):
        await msg.edit_text(f"🏠 <b>Not quite outside…</b>\n<i>{comment}</i>\n\nGo get some real sky! ☀️")
        return
    today = date.today()
    rec, new = store.log_day(
        message.chat_id, user.id, user.first_name or "Someone", today.isoformat(), (today - timedelta(days=1)).isoformat()
    )
    nature = ", ".join(esc(n, 30) for n in (verdict.get("nature") or [])[:4])
    head = "✅ <b>Grass touched!</b>" if new else "✅ <b>Already counted today</b>, but nice shot!"
    days = "day" if rec["streak"] == 1 else "days"
    await msg.edit_text(
        f"{head} {user.mention_html()}\n<i>{comment}</i>\n"
        + (f"🔎 Spotted: {nature}\n" if nature else "")
        + f"\n🔥 Streak: <b>{rec['streak']}</b> {days} · 🏆 best {rec['best']} · 🌿 {rec['total']} total"
    )


async def grassboard_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    message = update.effective_message
    board = store.board(message.chat_id)
    if not board:
        await message.reply_text("🌱 Nobody has touched grass yet. Be the first: send a photo with <code>/touched</code>!")
        return
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    def live(r: dict) -> int:
        return r["streak"] if r["last"] >= yesterday else 0

    rows = sorted(board.values(), key=lambda r: (live(r), r["total"]), reverse=True)
    medals = ["🥇", "🥈", "🥉"]
    lines = ["🌿 <b>Grass board</b>\n"]
    for i, r in enumerate(rows[:10]):
        rank = medals[i] if i < 3 else f"{i + 1}."
        lines.append(f"{rank} <b>{esc(r['name'], 25)}</b> ➜ 🔥 {live(r)} · 🏆 {r['best']} · 🌿 {r['total']}")
    await message.reply_text("\n".join(lines))


# ---------------------------------------------------------------- buttons


async def rsvp_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    key = (query.message.chat.id, query.message.message_id)
    people = _rsvps.setdefault(key, {})
    if people.pop(query.from_user.id, None):
        await query.answer("👋 You're out.")
    else:
        people[query.from_user.id] = query.from_user.first_name or "Someone"
        await query.answer(("🌿 See you outside! " + ", ".join(people.values()))[:190])
    markup = query.message.reply_markup
    if markup and markup.inline_keyboard:
        label = f"🙋 I'm in ({len(people)})" if people else "🙋 I'm in"
        rows = [[Btn(label, callback_data="grass:in")], *markup.inline_keyboard[1:]]
        try:
            await query.edit_message_reply_markup(InlineKeyboardMarkup(rows))
        except Exception:
            pass


async def plan_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    place = _home_place(query.message.chat.id)
    if not place:
        await query.answer("Set a home spot first: /sethome <place>", show_alert=True)
        return
    await query.answer("🌱 Planning…")
    try:
        text, spots = await build_plan(place)
    except outdoors.OutdoorsError as e:
        await query.message.reply_text(f"❌ Couldn't get the weather: {esc(e, 200)}")
        return
    await query.message.reply_text(text, reply_markup=plan_markup(spots))


# ---------------------------------------------------------------- golden-hour nudge


def nudge_text(fc: outdoors.Forecast) -> str | None:
    """The nudge for this forecast, or None if it's not time (or the weather's bad)."""
    if fc.tomorrow or not fc.hours:
        return None
    left = int(fc.daylight_left().total_seconds() // 60)
    if not 30 <= left <= config.NUDGE_BEFORE_SUNSET:
        return None
    now = fc.hours[0]
    if outdoors.hour_score(now) < 30:
        return None  # storm or downpour: no point
    return (
        f"☀️ <b>Golden hour's coming!</b> Sunset is at {fc.sunset:%H:%M}, so there's "
        f"<b>{left // 60}h {left % 60}m</b> of light left ({round(now.temp)}°C, {now.sky}).\n"
        "Put the phone down and go touch some grass 🌿"
    )


async def nudge_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    for chat_id in store.chats_with_home():
        if not store.nudges_on(chat_id) or (config.ALLOWED_CHATS and chat_id not in config.ALLOWED_CHATS):
            continue
        home = store.home(chat_id)
        try:
            fc = await outdoors.forecast(home["lat"], home["lon"])
            day = fc.now.date().isoformat()
            if store.last_nudge(chat_id) == day:
                continue
            text = nudge_text(fc)
            if not text:
                continue
            store.set_last_nudge(chat_id, day)
            await context.bot.send_message(
                chat_id, text, reply_markup=InlineKeyboardMarkup([[Btn("🌿 Plan a walk", callback_data="grass:plan")]])
            )
        except Exception as e:
            LOGGER.warning("Nudge for %s failed: %s", chat_id, e)
