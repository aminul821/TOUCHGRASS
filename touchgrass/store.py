"""Tiny JSON store: each chat's home spot, nudge setting and streaks."""
from __future__ import annotations

import json
import os
import threading

from touchgrass import config

_lock = threading.Lock()


def _load() -> dict:
    try:
        with open(config.DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


_data: dict = _load()


def _save() -> None:
    os.makedirs(os.path.dirname(config.DATA_PATH), exist_ok=True)
    tmp = config.DATA_PATH + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, config.DATA_PATH)


def _chat(chat_id: int) -> dict:
    return _data.setdefault(str(chat_id), {})


def home(chat_id: int) -> dict | None:
    """{"name", "lat", "lon"} the chat heads out from, set with /sethome."""
    return _data.get(str(chat_id), {}).get("home")


def set_home(chat_id: int, name: str, lat: float, lon: float) -> None:
    _chat(chat_id)["home"] = {"name": name, "lat": lat, "lon": lon}
    _save()


def nudges_on(chat_id: int) -> bool:
    return _data.get(str(chat_id), {}).get("nudges", True)


def set_nudges(chat_id: int, on: bool) -> None:
    _chat(chat_id)["nudges"] = on
    _save()


def chats_with_home() -> list[int]:
    return [int(cid) for cid, c in _data.items() if c.get("home")]


def board(chat_id: int) -> dict[str, dict]:
    """{user_id: {"name", "last", "streak", "best", "total"}}"""
    return _data.get(str(chat_id), {}).get("streaks", {})


def log_day(chat_id: int, user_id: int, name: str, today: str, yesterday: str) -> tuple[dict, bool]:
    """Count one verified day outside. Returns (the user's record, whether today was new)."""
    users = _chat(chat_id).setdefault("streaks", {})
    rec = users.setdefault(str(user_id), {"name": name, "last": "", "streak": 0, "best": 0, "total": 0})
    rec["name"] = name
    if rec["last"] == today:
        return rec, False
    rec["streak"] = rec["streak"] + 1 if rec["last"] == yesterday else 1
    rec["best"] = max(rec["best"], rec["streak"])
    rec["total"] += 1
    rec["last"] = today
    _save()
    return rec, True


def last_nudge(chat_id: int) -> str:
    return _data.get(str(chat_id), {}).get("last_nudge", "")


def set_last_nudge(chat_id: int, day: str) -> None:
    _chat(chat_id)["last_nudge"] = day
    _save()
