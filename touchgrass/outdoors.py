"""Open data for going outside: weather (Open-Meteo) and nearby green spots (OpenStreetMap).

Both services are free, need no API key and are built on open data. The model only
writes the plan. Places, times and weather come from here, so it can't make up a park.
"""
from __future__ import annotations

import asyncio
import json
import math
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from touchgrass import config

UA = {"User-Agent": "TouchGrassBot/1.0 (+https://github.com/aminul821/TOUCHGRASS)"}
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


class OutdoorsError(Exception):
    pass


def _get_json(url: str, data: bytes | None = None, timeout: float = 25) -> dict:
    req = urllib.request.Request(url, data=data, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        raise OutdoorsError(f"{urllib.parse.urlparse(url).netloc}: {e}") from e


# ---------------------------------------------------------------- places


@dataclass
class Place:
    name: str
    lat: float
    lon: float
    label: str = ""


async def geocode(query: str) -> Place:
    url = "https://geocoding-api.open-meteo.com/v1/search?" + urllib.parse.urlencode(
        {"name": query, "count": 1, "language": "en", "format": "json"}
    )
    data = await asyncio.to_thread(_get_json, url)
    results = data.get("results") or []
    if not results:
        raise OutdoorsError(f"I couldn't find a place called “{query}”.")
    r = results[0]
    label = ", ".join(x for x in (r.get("name"), r.get("admin1"), r.get("country")) if x)
    return Place(r["name"], r["latitude"], r["longitude"], label)


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@dataclass
class Spot:
    name: str
    kind: str
    lat: float
    lon: float
    distance: int  # metres

    @property
    def map_url(self) -> str:
        return f"https://www.openstreetmap.org/?mlat={self.lat:.5f}&mlon={self.lon:.5f}#map=17/{self.lat:.5f}/{self.lon:.5f}"


_KINDS = {
    ("leisure", "park"): "park",
    ("leisure", "garden"): "garden",
    ("leisure", "nature_reserve"): "nature reserve",
    ("natural", "wood"): "woods",
    ("landuse", "forest"): "forest",
    ("natural", "beach"): "beach",
    ("natural", "peak"): "peak",
    ("tourism", "viewpoint"): "viewpoint",
    ("route", "hiking"): "hiking trail",
    ("waterway", "riverbank"): "riverside",
}


def _kind(tags: dict) -> str:
    for (k, v), label in _KINDS.items():
        if tags.get(k) == v:
            return label
    return "green space"


async def nearby_spots(lat: float, lon: float, radius: int | None = None, limit: int = 6) -> list[Spot]:
    radius = radius or config.SEARCH_RADIUS
    around = f"(around:{radius},{lat},{lon})"
    query = (
        "[out:json][timeout:20];("
        f'nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]{around};'
        f'nwr["natural"~"^(wood|beach|peak)$"]["name"]{around};'
        f'nwr["landuse"="forest"]["name"]{around};'
        f'nwr["tourism"="viewpoint"]{around};'
        f'relation["route"="hiking"]["name"]{around};'
        ");out center tags 80;"
    )
    data = await asyncio.to_thread(
        _get_json, OVERPASS_URL, urllib.parse.urlencode({"data": query}).encode(), 35
    )
    seen: set[str] = set()
    spots: list[Spot] = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        kind = _kind(tags)
        name = tags.get("name:en") or tags.get("name") or ("Viewpoint" if kind == "viewpoint" else "")
        plat = el.get("lat") or (el.get("center") or {}).get("lat")
        plon = el.get("lon") or (el.get("center") or {}).get("lon")
        if not name or plat is None or plon is None:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        spots.append(Spot(name, kind, plat, plon, int(distance_m(lat, lon, plat, plon))))
    # Prefer named parks/trails over anonymous viewpoints, then the closest ones.
    spots.sort(key=lambda s: (s.name == "Viewpoint", s.distance))
    return spots[:limit]


# ---------------------------------------------------------------- weather

WMO = {
    0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
    77: "snow grains", 80: "light showers", 81: "showers", 82: "violent showers",
    85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail",
    99: "thunderstorm with hail",
}


@dataclass
class Hour:
    time: datetime
    temp: float
    rain_chance: int
    code: int
    wind: float

    @property
    def sky(self) -> str:
        return WMO.get(self.code, "mixed weather")


@dataclass
class Forecast:
    now: datetime  # local time at the place
    sunrise: datetime
    sunset: datetime
    hours: list[Hour] = field(default_factory=list)  # daylight hours from now on

    @property
    def tomorrow(self) -> bool:
        """It's already dark, so the plan is for tomorrow."""
        return self.sunset.date() != self.now.date()

    def daylight_left(self) -> timedelta:
        if self.tomorrow:
            return timedelta(0)
        return max(self.sunset - self.now, timedelta(0))


async def forecast(lat: float, lon: float) -> Forecast:
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
            "daily": "sunrise,sunset",
            "current": "temperature_2m",
            "timezone": "auto",
            "forecast_days": 2,
        }
    )
    data = await asyncio.to_thread(_get_json, url)
    now = datetime.fromisoformat(data["current"]["time"])
    daily = data["daily"]
    days = [
        (datetime.fromisoformat(rise), datetime.fromisoformat(sset))
        for rise, sset in zip(daily["sunrise"], daily["sunset"])
    ]
    # Today if there's at least ~45 min of light left, otherwise tomorrow.
    sunrise, sunset = days[0]
    if sunset - now < timedelta(minutes=45) and len(days) > 1:
        sunrise, sunset = days[1]
    h = data["hourly"]
    hours = []
    for i, t in enumerate(h["time"]):
        ts = datetime.fromisoformat(t)
        if ts + timedelta(hours=1) <= max(now, sunrise) or ts >= sunset:
            continue
        hours.append(
            Hour(
                ts,
                h["temperature_2m"][i],
                int(h["precipitation_probability"][i] or 0),
                int(h["weather_code"][i] or 0),
                h["wind_speed_10m"][i] or 0,
            )
        )
    return Forecast(now, sunrise, sunset, hours)


def hour_score(h: Hour) -> float:
    """Higher is nicer to be outside. Pure heuristics, no model involved."""
    score = 100.0
    score -= h.rain_chance * 0.8
    if h.code >= 95:
        score -= 80  # thunder: stay in
    elif h.code in (65, 67, 75, 82, 86):
        score -= 40
    elif h.code >= 51:
        score -= 15
    if h.temp < 12:
        score -= (12 - h.temp) * 3
    elif h.temp > 26:
        score -= (h.temp - 26) * 4
    score -= max(h.wind - 20, 0) * 1.5
    return score


def best_window(fc: Forecast, length: int = 2) -> list[Hour]:
    """The best `length` consecutive daylight hours."""
    hours = fc.hours
    if len(hours) <= length:
        return hours
    best = max(range(len(hours) - length + 1), key=lambda i: sum(hour_score(h) for h in hours[i : i + length]))
    return hours[best : best + length]
