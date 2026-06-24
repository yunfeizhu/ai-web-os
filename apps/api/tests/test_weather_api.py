from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import weather as weather_api


OPEN_METEO_SAMPLE = {
    "latitude": 30.42,
    "longitude": 120.3,
    "timezone": "Asia/Shanghai",
    "current": {
        "time": "2026-06-24T16:00",
        "temperature_2m": 25.3,
        "weather_code": 61,
        "is_day": 1,
    },
    "hourly": {
        "time": [
            "2026-06-24T15:00",
            "2026-06-24T16:00",
            "2026-06-24T17:00",
            "2026-06-24T18:00",
            "2026-06-24T19:00",
            "2026-06-24T20:00",
            "2026-06-24T21:00",
        ],
        "temperature_2m": [26.0, 25.3, 24.8, 24.4, 24.1, 23.8, 23.5],
        "weather_code": [3, 61, 61, 61, 80, 80, 3],
        "is_day": [1, 1, 1, 1, 0, 0, 0],
    },
    "daily": {
        "time": ["2026-06-24", "2026-06-25"],
        "weather_code": [61, 80],
        "temperature_2m_max": [25.4, 27.1],
        "temperature_2m_min": [21.8, 22.6],
    },
}


FREE_API_GEOCODER_SAMPLE = {
    "status": 0,
    "msg": {
        "status": 0,
        "message": "Success",
        "result": {
            "address_component": {
                "nation": "中国",
                "province": "浙江省",
                "city": "杭州市",
                "district": "临平区",
            },
            "ad_info": {
                "district": "临平区",
            },
        }
    },
}


def test_weather_summary_maps_open_meteo_payload_and_district(monkeypatch):
    async def fake_fetch(latitude: float, longitude: float):
        assert latitude == 30.42
        assert longitude == 120.3
        return (
            OPEN_METEO_SAMPLE,
            "https://api.open-meteo.com/v1/forecast?latitude=30.42&longitude=120.3",
        )

    async def fake_reverse_geocode(latitude: float, longitude: float):
        assert latitude == 30.42
        assert longitude == 120.3
        return FREE_API_GEOCODER_SAMPLE, "https://www.free-api.com/urltask"

    monkeypatch.setattr(weather_api, "_fetch_open_meteo_weather_payload", fake_fetch)
    monkeypatch.setattr(weather_api, "_fetch_free_api_reverse_geocode_payload", fake_reverse_geocode)

    app = FastAPI()
    app.include_router(weather_api.router, prefix="/api/v1/weather")
    client = TestClient(app)

    response = client.get(
        "/api/v1/weather/summary",
        params={"latitude": 30.42, "longitude": 120.3},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "open-meteo"
    assert payload["location"] == "临平区"
    assert payload["currentTemp"] == "25°"
    assert payload["condition"] == "小雨"
    assert payload["conditionIcon"] == "rain"
    assert payload["highTemp"] == "25°"
    assert payload["lowTemp"] == "22°"
    assert payload["hourly"][0] == {
        "time": "16时",
        "temperature": "25°",
        "condition": "小雨",
        "icon": "rain",
    }
    assert payload["hourly"][-1]["time"] == "21时"
    assert payload["hourly"][-1]["icon"] == "cloud"


def test_weather_summary_returns_bad_gateway_when_provider_fails(monkeypatch):
    async def fail_fetch(latitude: float, longitude: float):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(weather_api, "_fetch_open_meteo_weather_payload", fail_fetch)

    app = FastAPI()
    app.include_router(weather_api.router, prefix="/api/v1/weather")
    client = TestClient(app)

    response = client.get(
        "/api/v1/weather/summary",
        params={"latitude": 30.42, "longitude": 120.3},
    )

    assert response.status_code == 502
    assert "provider unavailable" in response.json()["detail"]
