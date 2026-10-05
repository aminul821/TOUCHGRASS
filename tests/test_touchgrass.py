"""Offline tests: weather, map and model responses are faked in their real formats."""
import asyncio
import io
import json
from types import SimpleNamespace

import pytest

from touchgrass import bot, config, llm, outdoors, store

GEO = {"results": [{"name": "Dhaka", "admin1": "Dhaka Division", "country": "Bangladesh",
                    "latitude": 23.81, "longitude": 90.41}]}
OVERPASS = {"elements": [
    {"type": "way", "tags": {"leisure": "park", "name": "Ramna Park"}, "center": {"lat": 23.738, "lon": 90.401}},
    {"type": "node", "tags": {"tourism": "viewpoint"}, "lat": 23.80, "lon": 90.40},
    {"type": "way", "tags": {"leisure": "park", "name": "Ramna Park"}, "center": {"lat": 23.739, "lon": 90.402}},
    {"type": "way", "tags": {"leisure": "garden", "name": "Botanical Garden"}, "center": {"lat": 23.815, "lon": 90.42}},
    {"type": "way", "tags": {"leisure": "park"}, "center": {"lat": 23.81, "lon": 90.41}},
]}


def meteo(now: str) -> dict:
    times = [f"2026-10-05T{h:02d}:00" for h in range(24)] + [f"2026-10-06T{h:02d}:00" for h in range(24)]
    rain = [80 if 12 <= i % 24 <= 14 else 5 for i in range(48)]  # a wet early afternoon
    return {
        "current": {"time": now},
        "daily": {"sunrise": ["2026-10-05T05:50", "2026-10-06T05:51"],
                  "sunset": ["2026-10-05T17:40", "2026-10-06T17:39"]},
        "hourly": {"time": times, "temperature_2m": [24.0] * 48, "precipitation_probability": rain,
                   "weather_code": [61 if r > 50 else 1 for r in rain], "wind_speed_10m": [8.0] * 48},
    }


@pytest.fixture
def world(monkeypatch, tmp_path):
    state = {"now": "2026-10-05T11:15", "llm": "ok", "prompts": []}

    def fake_get(url, data=None, timeout=0):
        if "geocoding" in url:
            return GEO
        if "forecast" in url:
            return meteo(state["now"])
        assert b"around" in data
        return OVERPASS

    def fake_post(path, payload, timeout):
        state["prompts"].append(payload)
        if state["llm"] == "down":
            raise llm.LLMError("down")
        if payload.get("format"):
            assert payload["messages"][-1]["images"]
            return {"message": {"content": json.dumps(state.get("verdict") or {
                "outdoors": True, "screenshot": False, "nature": ["banyan tree", "crow"],
                "comment": "Lovely banyan & <b>crow</b>!"})}}
        return {"message": {"content": "Walk to the Botanical Garden at 15:00 & bring water."}}

    monkeypatch.setattr(outdoors, "_get_json", fake_get)
    monkeypatch.setattr(llm, "_post", fake_post)
    monkeypatch.setattr(config, "DATA_PATH", str(tmp_path / "db.json"))
    monkeypatch.setattr(store, "_data", {})
    return state


def run(coro):
    return asyncio.run(coro)


def test_geocode_and_spots(world):
    place = run(outdoors.geocode("dhaka"))
    assert place.label == "Dhaka, Dhaka Division, Bangladesh"
    spots = run(outdoors.nearby_spots(place.lat, place.lon))
    names = [s.name for s in spots]
    assert names.count("Ramna Park") == 1  # duplicates merged
    assert names[-1] == "Viewpoint"  # unnamed viewpoints go last
    assert spots[0].distance < spots[1].distance


def test_best_window_avoids_rain(world):
    fc = run(outdoors.forecast(23.8, 90.4))
    assert fc.hours[0].time.hour == 11 and fc.hours[-1].time.hour == 17
    window = outdoors.best_window(fc)
    assert len(window) == 2 and all(h.rain_chance < 50 for h in window)


def test_after_dark_plans_for_tomorrow(world):
    world["now"] = "2026-10-05T21:00"
    fc = run(outdoors.forecast(23.8, 90.4))
    assert fc.tomorrow and fc.sunset.day == 6 and not fc.daylight_left()
    text, _ = run(bot.build_plan(outdoors.Place("x", 23.8, 90.4, "Dhaka")))
    assert "It's dark now" in text


def test_plan_uses_model_and_escapes_it(world):
    text, spots = run(bot.build_plan(outdoors.Place("x", 23.8, 90.4, "Dhaka")))
    assert "&amp; bring water" in text and "local" in text
    facts = json.loads(world["prompts"][-1]["messages"][-1]["content"].split("\n", 1)[1])
    assert [s["name"] for s in facts["nearby_spots"]] == [s.name for s in spots]


def test_plan_falls_back_when_model_is_down(world):
    world["llm"] = "down"
    text, _ = run(bot.build_plan(outdoors.Place("x", 23.8, 90.4, "Dhaka")))
    assert "offline plan" in text and "Botanical Garden" in text


def test_streaks(world):
    rec, new = store.log_day(1, 7, "A", "2026-10-04", "2026-10-03")
    assert (rec["streak"], new) == (1, True)
    assert store.log_day(1, 7, "A", "2026-10-04", "2026-10-03")[1] is False
    assert store.log_day(1, 7, "A", "2026-10-05", "2026-10-04")[0]["streak"] == 2
    rec, _ = store.log_day(1, 7, "A", "2026-10-08", "2026-10-07")
    assert (rec["streak"], rec["best"], rec["total"]) == (1, 2, 3)


def test_nudge_only_near_sunset_and_in_good_weather(world, monkeypatch):
    monkeypatch.setattr(config, "NUDGE_BEFORE_SUNSET", 120)
    for now, expect in [("2026-10-05T11:15", False), ("2026-10-05T16:00", True),
                        ("2026-10-05T17:30", False), ("2026-10-05T21:00", False)]:
        world["now"] = now
        assert bool(bot.nudge_text(run(outdoors.forecast(23.8, 90.4)))) is expect, now


# ---------------------------------------------------------------- /touched


class FakeMsg:
    def __init__(self, user_id=7, photo=True, forwarded=False):
        self.photo = [SimpleNamespace(get_file=self._get_file)] if photo else None
        self.from_user = SimpleNamespace(id=user_id, first_name="Aminul",
                                         mention_html=lambda: f'<a href="tg://user?id={user_id}">Aminul</a>')
        self.forward_origin = object() if forwarded else None
        self.reply_to_message = None
        self.chat_id = 1
        self.out = []

    async def _get_file(self):
        return SimpleNamespace(download_as_bytearray=self._bytes)

    async def _bytes(self):
        return bytearray(b"jpeg")

    async def reply_text(self, text, **_):
        self.out.append(text)
        return self

    async def edit_text(self, text, **_):
        self.out.append(text)


def touched(msg):
    update = SimpleNamespace(effective_message=msg, effective_chat=SimpleNamespace(id=1))
    run(bot.touched_cmd(update, None))
    return msg.out[-1]


def test_touched_counts_a_verified_photo(world):
    out = touched(FakeMsg())
    assert "Grass touched" in out and "&lt;b&gt;crow" in out and "Streak: <b>1</b> day " in out
    assert "Already counted today" in touched(FakeMsg())


def test_touched_rejects_indoor_forwarded_and_unchecked(world):
    world["verdict"] = {"outdoors": True, "screenshot": True, "nature": [], "comment": "That's a monitor."}
    assert "Not quite outside" in touched(FakeMsg())
    assert "Forwarded" in touched(FakeMsg(forwarded=True))
    world["llm"] = "down"
    assert "isn't available" in touched(FakeMsg())
    assert store.board(1) == {}  # nothing counted


def test_app_wires_up(monkeypatch):
    from telegram.ext import Application
    from touchgrass import __main__ as main

    built = {}
    monkeypatch.setattr(config, "BOT_TOKEN", "123:abc")
    monkeypatch.setattr(Application, "run_polling", lambda self, **kw: built.setdefault("app", self))
    main.main()
    handlers = built["app"].handlers[0]
    assert len(handlers) == 9 and built["app"].job_queue is not None
