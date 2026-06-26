from __future__ import annotations

import asyncio
from datetime import datetime
from math import floor
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_settings


router = APIRouter()

DEFAULT_LATITUDE = 30.41875
DEFAULT_LONGITUDE = 120.29861
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TENCENT_GEOCODER_URL = "https://apis.map.qq.com/ws/geocoder/v1/"

WeatherIcon = Literal["rain", "night-rain", "cloud", "clear", "snow", "fog"]


class WeatherHour(BaseModel):
    time: str
    temperature: str
    condition: str
    icon: WeatherIcon


class WeatherSummaryResponse(BaseModel):
    source: str
    sourceUrl: str
    location: str
    resolvedLocation: str
    currentTemp: str
    condition: str
    conditionIcon: WeatherIcon
    highTemp: str
    lowTemp: str
    hourly: list[WeatherHour]
    updatedAt: str


@router.get("/summary", response_model=WeatherSummaryResponse)
async def get_weather_summary(
    latitude: float = Query(DEFAULT_LATITUDE, ge=-90, le=90),
    longitude: float = Query(DEFAULT_LONGITUDE, ge=-180, le=180),
) -> WeatherSummaryResponse:
    try:
        weather_result, location_result = await asyncio.gather(
            _fetch_open_meteo_weather_payload(latitude, longitude),
            _safe_fetch_tencent_location_name(latitude, longitude),
        )
        payload, source_url = weather_result
    except Exception as exc:
        detail = str(exc).strip() or type(exc).__name__
        raise HTTPException(status_code=502, detail=f"天气数据源查询失败: {detail}") from exc

    return _build_weather_summary(
        payload,
        latitude=latitude,
        longitude=longitude,
        location=location_result or "当前位置",
        source_url=source_url,
    )


async def _fetch_open_meteo_weather_payload(
    latitude: float,
    longitude: float,
) -> tuple[dict[str, Any], str]:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,weather_code,is_day",
        "hourly": "temperature_2m,weather_code,is_day",
        "daily": "temperature_2m_max,temperature_2m_min,weather_code",
        "timezone": "auto",
        "forecast_days": 2,
    }
    headers = {
        "User-Agent": "AI-Web-OS/1.0 weather widget",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        response = await client.get(OPEN_METEO_FORECAST_URL, params=params, headers=headers)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("Open-Meteo 返回非 JSON 对象")
        return payload, str(response.url)


def _build_weather_summary(
    payload: dict[str, Any],
    *,
    latitude: float,
    longitude: float,
    location: str,
    source_url: str,
) -> WeatherSummaryResponse:
    current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
    daily = payload.get("daily") if isinstance(payload.get("daily"), dict) else {}
    current_code = _int_or_none(current.get("weather_code"))
    current_hour = _hour_from_time(current.get("time"))
    is_day = _bool_from_open_meteo(current.get("is_day"))

    return WeatherSummaryResponse(
        source="open-meteo",
        sourceUrl=source_url,
        location=location,
        resolvedLocation=f"{latitude:.5f},{longitude:.5f}",
        currentTemp=_format_temperature(current.get("temperature_2m")),
        condition=_weather_label(current_code),
        conditionIcon=_weather_icon(current_code, is_day=is_day, hour=current_hour),
        highTemp=_format_temperature(_first(daily.get("temperature_2m_max"))),
        lowTemp=_format_temperature(_first(daily.get("temperature_2m_min"))),
        hourly=_build_hourly(payload, current.get("time")),
        updatedAt=_current_time_iso(),
    )


async def _safe_fetch_tencent_location_name(latitude: float, longitude: float) -> str:
    try:
        payload, _source_url = await _fetch_tencent_reverse_geocode_payload(
            latitude,
            longitude,
        )
        return _tencent_district(payload) or "当前位置"
    except Exception:
        return "当前位置"


async def _fetch_tencent_reverse_geocode_payload(
    latitude: float,
    longitude: float,
) -> tuple[dict[str, Any], str]:
    key = get_settings().tencent_map_key.strip()
    if not key:
        raise RuntimeError("缺少 TENCENT_MAP_KEY")

    headers = {
        "User-Agent": "AI-Web-OS/1.0 weather widget",
        "Accept": "application/json",
    }
    params = {
        "location": f"{latitude},{longitude}",
        "key": key,
    }
    async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
        response = await client.get(TENCENT_GEOCODER_URL, params=params, headers=headers)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("腾讯地图返回非 JSON 对象")
        if payload.get("status") != 0:
            message = str(payload.get("message") or "腾讯地图逆地理编码失败")
            raise RuntimeError(message)
        return payload, TENCENT_GEOCODER_URL


def _tencent_district(payload: dict[str, Any]) -> str:
    result = payload.get("result")
    if not isinstance(result, dict):
        return ""
    address_component = result.get("address_component")
    if isinstance(address_component, dict):
        for key in ("district", "city", "province"):
            value = str(address_component.get(key) or "").strip()
            if value:
                return value
    ad_info = result.get("ad_info")
    if isinstance(ad_info, dict):
        return str(ad_info.get("name") or "").split("，")[-1].strip()
    return ""


def _build_hourly(payload: dict[str, Any], current_time: Any) -> list[WeatherHour]:
    hourly = payload.get("hourly") if isinstance(payload.get("hourly"), dict) else {}
    times = _list(hourly.get("time"))
    temperatures = _list(hourly.get("temperature_2m"))
    codes = _list(hourly.get("weather_code"))
    is_days = _list(hourly.get("is_day"))
    start_index = _first_forecast_index(times, current_time)

    hours: list[WeatherHour] = []
    for index in range(start_index, len(times)):
        hour = _hour_from_time(times[index])
        code = _int_or_none(codes[index] if index < len(codes) else None)
        is_day = _bool_from_open_meteo(is_days[index] if index < len(is_days) else None)
        hours.append(
            WeatherHour(
                time=f"{hour}时",
                temperature=_format_temperature(
                    temperatures[index] if index < len(temperatures) else None
                ),
                condition=_weather_label(code),
                icon=_weather_icon(code, is_day=is_day, hour=hour),
            )
        )
        if len(hours) >= 6:
            return hours
    return hours


def _first_forecast_index(times: list[Any], current_time: Any) -> int:
    current = _parse_time(current_time)
    if current is None:
        return 0
    for index, value in enumerate(times):
        item_time = _parse_time(value)
        if item_time is not None and item_time >= current:
            return index
    return 0


def _weather_label(code: int | None) -> str:
    if code == 0:
        return "晴"
    if code in (1, 2):
        return "多云"
    if code == 3:
        return "阴"
    if code in (45, 48):
        return "雾"
    if code in (51, 53, 55, 56, 57):
        return "微雨"
    if code == 61:
        return "小雨"
    if code == 63:
        return "中雨"
    if code in (65, 66, 67):
        return "大雨"
    if code in (71, 73, 75, 77, 85, 86):
        return "降雪"
    if code in (80, 81, 82):
        return "阵雨"
    if code in (95, 96, 99):
        return "雷雨"
    return "未知"


def _weather_icon(code: int | None, *, is_day: bool | None, hour: int) -> WeatherIcon:
    if code in (45, 48):
        return "fog"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if code in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99):
        return "rain" if _is_daylight(is_day, hour) else "night-rain"
    if code == 0:
        return "clear" if _is_daylight(is_day, hour) else "cloud"
    return "cloud"


def _is_daylight(is_day: bool | None, hour: int) -> bool:
    if is_day is not None:
        return is_day
    return 6 <= hour < 18


def _format_temperature(value: Any) -> str:
    number = _float_or_none(value)
    if number is None:
        return "--"
    return f"{floor(number + 0.5):.0f}°"


def _first(value: Any) -> Any:
    if isinstance(value, list) and value:
        return value[0]
    return None


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _float_or_none(value: Any) -> float | None:
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return None


def _bool_from_open_meteo(value: Any) -> bool | None:
    if value in (0, "0", False):
        return False
    if value in (1, "1", True):
        return True
    return None


def _parse_time(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _hour_from_time(value: Any) -> int:
    parsed = _parse_time(value)
    if parsed is None:
        return _current_hour()
    return parsed.hour


def _current_hour() -> int:
    return datetime.now(ZoneInfo(get_settings().app_timezone)).hour


def _current_time_iso() -> str:
    return datetime.now(ZoneInfo(get_settings().app_timezone)).isoformat()
