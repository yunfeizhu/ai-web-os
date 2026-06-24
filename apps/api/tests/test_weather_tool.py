import asyncio
import json

from app.core import tools as tools_module


WTTR_SAMPLE = {
    "nearest_area": [
        {
            "areaName": [{"value": "Hangzhou"}],
            "region": [{"value": "Zhejiang"}],
            "country": [{"value": "China"}],
        }
    ],
    "current_condition": [
        {
            "FeelsLikeC": "24",
            "cloudcover": "75",
            "humidity": "83",
            "observation_time": "05:30 AM",
            "precipMM": "0.1",
            "pressure": "1005",
            "temp_C": "24",
            "uvIndex": "5",
            "visibility": "10",
            "weatherDesc": [{"value": "Light rain"}],
            "winddir16Point": "NE",
            "windspeedKmph": "9",
        }
    ],
    "weather": [
        {
            "date": "2026-06-24",
            "maxtempC": "27",
            "mintempC": "22",
            "avgtempC": "24",
            "hourly": [
                {
                    "chanceofrain": "86",
                    "chanceofsnow": "0",
                    "weatherDesc": [{"value": "Patchy rain nearby"}],
                },
                {
                    "chanceofrain": "92",
                    "chanceofsnow": "0",
                    "weatherDesc": [{"value": "Light rain"}],
                },
            ],
        },
        {
            "date": "2026-06-25",
            "maxtempC": "29",
            "mintempC": "23",
            "avgtempC": "26",
            "hourly": [
                {
                    "chanceofrain": "44",
                    "chanceofsnow": "0",
                    "weatherDesc": [{"value": "Cloudy"}],
                }
            ],
        },
    ],
}


def test_query_weather_tool_formats_wttr_json(monkeypatch):
    async def fake_fetch(location: str, *, lang: str, units: str):
        assert location == "杭州"
        assert lang == "zh"
        assert units == "metric"
        return WTTR_SAMPLE, "https://wttr.in/%E6%9D%AD%E5%B7%9E?format=j1&m&lang=zh"

    monkeypatch.setattr(tools_module, "_fetch_wttr_weather_payload", fake_fetch)

    result = asyncio.run(
        tools_module.execute_tool(
            "query_weather",
            {"location": "杭州", "date": "2026-06-24", "days": 2},
        )
    )
    payload = json.loads(result)

    assert payload["source"] == "wttr.in"
    assert payload["queryLocation"] == "杭州"
    assert payload["resolvedLocation"] == "Hangzhou, Zhejiang, China"
    assert payload["current"]["description"] == "Light rain"
    assert payload["current"]["tempC"] == "24"
    assert payload["forecast"][0]["date"] == "2026-06-24"
    assert payload["forecast"][0]["chanceOfRain"] == "92"


def test_query_weather_tool_requires_location():
    result = asyncio.run(tools_module.execute_tool("query_weather", {"location": "   "}))

    assert "缺少 location" in result
