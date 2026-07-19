"""Open-Meteo weather helper — no API key, soft-fail, 3s hard timeout."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
PLACE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client"
FETCH_TIMEOUT = 3.0

# WMO Weather interpretation codes (Open-Meteo)
_WMO_LABELS: dict[int, str] = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def _wmo_label(code: Any) -> str:
    try:
        return _WMO_LABELS.get(int(code), f"Code {code}")
    except (TypeError, ValueError):
        return "Unknown"


async def _fetch_place_label(client: httpx.AsyncClient, lat: float, lon: float) -> str | None:
    """Soft reverse-geocode to a short place name (city / region / country)."""
    try:
        response = await client.get(
            PLACE_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "localityLanguage": "en",
            },
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        return None

    parts: list[str] = []
    for key in ("city", "locality", "principalSubdivision", "countryName"):
        val = (data.get(key) or "").strip()
        if val and val not in parts:
            parts.append(val)
    if not parts:
        return None
    return ", ".join(parts[:3])


async def fetch_weather_line(
    lat: float,
    lon: float,
    elevation: float | None = None,
) -> str | None:
    """Return one weather system-prompt line, or None on any failure."""
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lon,
        "current": (
            "temperature_2m,apparent_temperature,relative_humidity_2m,"
            "weather_code,wind_speed_10m,precipitation,is_day"
        ),
        "timezone": "auto",
        "models": "best_match",
    }
    if elevation is not None and -500.0 <= elevation <= 9000.0:
        params["elevation"] = elevation

    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            response, place = await asyncio.gather(
                client.get(OPEN_METEO_URL, params=params),
                _fetch_place_label(client, lat, lon),
            )
            response.raise_for_status()
            data = response.json()
    except Exception:
        return None

    current = data.get("current") or {}
    temp = current.get("temperature_2m")
    if temp is None:
        return None

    units = data.get("current_units") or {}
    temp_unit = units.get("temperature_2m", "\u00b0C")
    feels = current.get("apparent_temperature")
    humidity = current.get("relative_humidity_2m")
    wind = current.get("wind_speed_10m")
    wind_unit = units.get("wind_speed_10m", "km/h")
    precip = current.get("precipitation")
    precip_unit = units.get("precipitation", "mm")
    condition = _wmo_label(current.get("weather_code"))
    is_day = current.get("is_day")

    bits: list[str] = [condition, f"air temp {temp}{temp_unit} (model 2 m)"]
    if feels is not None:
        feels_unit = units.get("apparent_temperature", temp_unit)
        bits.append(f"feels like {feels}{feels_unit}")
    if humidity is not None:
        bits.append(f"humidity {humidity}%")
    if wind is not None:
        bits.append(f"wind {wind} {wind_unit}")
    if precip is not None:
        bits.append(f"precip {precip} {precip_unit}")
    if is_day is not None:
        bits.append("daytime" if is_day else "nighttime")

    where = place or f"coordinates {lat:.4f}, {lon:.4f}"
    elev_note = ""
    api_elev = data.get("elevation")
    if elevation is not None:
        elev_note = f" GPS altitude ~{elevation:.0f} m."
    elif isinstance(api_elev, (int, float)):
        elev_note = f" Model DEM elevation ~{api_elev:.0f} m."

    return (
        f"Live weather (Open-Meteo best_match) near {where}: "
        + ", ".join(bits)
        + "."
        + elev_note
        + " Values are model analysis (not a personal thermometer). "
        "Treat them as ground truth; do not invent different conditions."
    )
