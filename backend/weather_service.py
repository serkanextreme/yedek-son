"""Weather service — Open-Meteo integration.

Free API, no key required. Provides:
- Geocoding search (city name → lat/lon/country/timezone)
- Current weather (temperature, humidity, wind, condition)
- Sunrise / sunset times for the local timezone

Docs:
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/docs/geocoding-api
"""
import logging
from typing import List, Dict, Any, Optional

import httpx

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


# WMO weather interpretation code → Turkish label
WMO_TR: Dict[int, str] = {
    0: "Açık",
    1: "Az Bulutlu", 2: "Parçalı Bulutlu", 3: "Bulutlu",
    45: "Sisli", 48: "Kırağılı Sis",
    51: "Hafif Çisenti", 53: "Çisenti", 55: "Yoğun Çisenti",
    56: "Buzlu Çisenti", 57: "Yoğun Buzlu Çisenti",
    61: "Hafif Yağmur", 63: "Yağmur", 65: "Şiddetli Yağmur",
    66: "Buzlu Yağmur", 67: "Şiddetli Buzlu Yağmur",
    71: "Hafif Kar", 73: "Kar", 75: "Yoğun Kar",
    77: "Kar Taneleri",
    80: "Hafif Sağanak", 81: "Sağanak", 82: "Şiddetli Sağanak",
    85: "Hafif Kar Sağanağı", 86: "Yoğun Kar Sağanağı",
    95: "Gök Gürültülü Fırtına",
    96: "Fırtına + Dolu", 99: "Şiddetli Fırtına + Dolu",
}


async def search_city(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """Search cities by name; returns geocoding results (max `limit`)."""
    q = (query or "").strip()
    if len(q) < 2:
        return []
    params = {
        "name": q,
        "count": max(1, min(20, limit)),
        "language": "tr",
        "format": "json",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(GEOCODE_URL, params=params)
        r.raise_for_status()
        data = r.json()

    results = data.get("results") or []
    out: List[Dict[str, Any]] = []
    for item in results:
        out.append({
            "name": item.get("name"),
            "country": item.get("country"),
            "country_code": item.get("country_code"),
            "admin1": item.get("admin1"),  # region/state
            "latitude": item.get("latitude"),
            "longitude": item.get("longitude"),
            "timezone": item.get("timezone"),
            "population": item.get("population"),
            "elevation": item.get("elevation"),
        })
    return out


async def get_current_weather(
    latitude: float,
    longitude: float,
    city_name: Optional[str] = None,
    timezone: str = "auto",
) -> Dict[str, Any]:
    """Return current weather + sunrise/sunset for a coordinate."""
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "is_day",
            "weather_code",
            "wind_speed_10m",
            "wind_direction_10m",
        ]),
        "daily": "sunrise,sunset,temperature_2m_max,temperature_2m_min,uv_index_max",
        "timezone": timezone or "auto",
        "forecast_days": 1,
        "wind_speed_unit": "kmh",
        "temperature_unit": "celsius",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(FORECAST_URL, params=params)
        r.raise_for_status()
        data = r.json()

    current = data.get("current") or {}
    daily = data.get("daily") or {}
    code = int(current.get("weather_code") or 0)
    sunrise = (daily.get("sunrise") or [None])[0]
    sunset = (daily.get("sunset") or [None])[0]
    t_min = (daily.get("temperature_2m_min") or [None])[0]
    t_max = (daily.get("temperature_2m_max") or [None])[0]
    uv_max = (daily.get("uv_index_max") or [None])[0]

    return {
        "city": city_name or "",
        "latitude": latitude,
        "longitude": longitude,
        "timezone": data.get("timezone") or timezone,
        "temperature_c": round(float(current.get("temperature_2m") or 0), 1),
        "apparent_c": round(float(current.get("apparent_temperature") or 0), 1),
        "humidity": int(current.get("relative_humidity_2m") or 0),
        "wind_kph": round(float(current.get("wind_speed_10m") or 0), 1),
        "wind_dir_deg": int(current.get("wind_direction_10m") or 0),
        "condition": WMO_TR.get(code, "Bilinmiyor"),
        "weather_code": code,
        "is_day": bool(current.get("is_day")),
        "sunrise": sunrise,   # ISO local time
        "sunset": sunset,
        "temp_min_c": round(float(t_min), 1) if t_min is not None else None,
        "temp_max_c": round(float(t_max), 1) if t_max is not None else None,
        "uv_index_max": uv_max,
        "observed_at": current.get("time"),
    }


async def resolve_and_fetch(city: str) -> Dict[str, Any]:
    """Geocode `city` name and return weather for the top match. Raises ValueError if not found."""
    results = await search_city(city, limit=1)
    if not results:
        raise ValueError(f"Şehir bulunamadı: {city}")
    top = results[0]
    weather = await get_current_weather(
        latitude=top["latitude"],
        longitude=top["longitude"],
        city_name=top["name"],
        timezone=top.get("timezone") or "auto",
    )
    weather["country"] = top.get("country")
    weather["admin1"] = top.get("admin1")
    return weather
