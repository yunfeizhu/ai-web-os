"use client";

import { useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/backend";

const WEATHER_LOCATION_STORAGE_KEY = "ai-web-os.desktop.weather.location";
const WEATHER_CACHE_STORAGE_KEY = "ai-web-os.desktop.weather.summary";
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const WEATHER_REFRESH_MS = 30 * 60 * 1000;

type HourlyWeather = {
  time: string;
  temperature: string;
  condition: string;
  icon: WeatherIconKind;
};

type WeatherIconKind = "rain" | "sunset" | "night-rain" | "cloud" | "clear" | "snow" | "fog";

type DesktopWeatherSummary = {
  location: string;
  currentTemp: string;
  condition: string;
  conditionIcon: WeatherIconKind;
  highTemp: string;
  lowTemp: string;
  hourly: HourlyWeather[];
};

type WeatherLocation = {
  latitude: number;
  longitude: number;
};

type WeatherSummaryApiResponse = DesktopWeatherSummary & {
  source?: string;
  sourceUrl?: string;
  resolvedLocation?: string;
  updatedAt?: string;
};

type WeatherWidgetState =
  | { status: "loading" }
  | { status: "ready"; weather: DesktopWeatherSummary }
  | { status: "error" };

const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  latitude: 30.41875,
  longitude: 120.29861,
};

export function DesktopWeatherWidget() {
  const [weatherState, setWeatherState] = useState<WeatherWidgetState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function refreshWeather() {
      try {
        const cachedWeather = readCachedWeather();
        if (cachedWeather) {
          if (!cancelled) {
            setWeatherState({ status: "ready", weather: cachedWeather });
          }
          return;
        }

        const location = await resolveWeatherLocation();
        const nextWeather = await fetchDesktopWeather(location);
        writeCachedWeather(nextWeather);
        if (!cancelled) {
          setWeatherState({ status: "ready", weather: nextWeather });
        }
      } catch {
        if (!cancelled) {
          setWeatherState((current) => (current.status === "ready" ? current : { status: "error" }));
        }
      }
    }

    void refreshWeather();
    const timer = window.setInterval(() => void refreshWeather(), WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (weatherState.status !== "ready") return null;

  return (
    <section
      aria-label="桌面天气"
      data-testid="desktop-weather-widget"
      className="absolute left-8 select-none overflow-hidden"
      style={{
        top: 146,
        zIndex: 1,
        width: 360,
        maxWidth: "calc(100vw - 48px)",
        borderRadius: 22,
        padding: "14px 14px 12px",
        color: "rgba(255,255,255,0.96)",
        pointerEvents: "none",
        background:
          "linear-gradient(145deg, rgba(98,112,130,0.68), rgba(70,86,106,0.58) 54%, rgba(50,68,88,0.52))",
        border: "1px solid rgba(255,255,255,0.2)",
        boxShadow:
          "0 12px 34px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.1)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        textShadow: "0 2px 12px rgba(0,0,0,0.28)",
      }}
    >
      <WeatherContent weather={weatherState.weather} />
    </section>
  );
}

function WeatherContent({ weather }: { weather: DesktopWeatherSummary }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[18px] font-bold leading-none">
            <span>{weather.location}</span>
            <LocationArrowIcon size={12} />
          </div>
          <div
            className="mt-2 font-extralight leading-none tabular-nums"
            style={{ fontSize: 48, letterSpacing: 0 }}
          >
            {weather.currentTemp}
          </div>
        </div>

        <div
          className="flex flex-col items-end pt-0.5 text-right"
          data-testid="weather-current-condition"
        >
          <div className="flex flex-col items-center gap-0.5">
            <WeatherIcon kind={weather.conditionIcon} size={24} />
            <div className="text-[16px] font-semibold leading-none">{weather.condition}</div>
          </div>
          <div className="mt-3 grid grid-cols-[auto_auto_auto_auto] items-end gap-x-1.5">
            <span className="text-[11px] font-bold leading-[0.9]">
              最<br />高
            </span>
            <span className="text-[26px] font-light leading-none tabular-nums">
              {weather.highTemp}
            </span>
            <span className="text-[11px] font-bold leading-[0.9]">
              最<br />低
            </span>
            <span className="text-[26px] font-light leading-none tabular-nums">
              {weather.lowTemp}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-6 gap-1">
        {weather.hourly.map((item, index) => (
          <HourlyForecast key={`${item.time}-${index}`} item={item} />
        ))}
      </div>
    </>
  );
}

function HourlyForecast({ item }: { item: HourlyWeather }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div className="text-[11px] font-bold leading-none text-white/70">
        {item.time}
      </div>
      <WeatherIcon kind={item.icon} />
      <div className="text-[15px] font-bold leading-none tabular-nums">
        {item.temperature}
      </div>
    </div>
  );
}

async function fetchDesktopWeather(location: WeatherLocation): Promise<DesktopWeatherSummary> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
  });
  const response = await fetch(buildApiUrl(`/weather/summary?${params.toString()}`), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return normalizeWeatherSummary((await response.json()) as WeatherSummaryApiResponse);
}

async function resolveWeatherLocation(): Promise<WeatherLocation> {
  const stored = readStoredWeatherLocation();
  if (stored) return stored;

  const browserLocation = await requestBrowserWeatherLocation();
  const location = browserLocation ?? DEFAULT_WEATHER_LOCATION;
  writeStoredWeatherLocation(location);
  return location;
}

function requestBrowserWeatherLocation(): Promise<WeatherLocation | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        maximumAge: WEATHER_REFRESH_MS,
        timeout: 5000,
      },
    );
  });
}

function readStoredWeatherLocation(): WeatherLocation | null {
  try {
    const raw = window.localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeatherLocation>;
    const latitude = parsed.latitude;
    const longitude = parsed.longitude;
    if (
      typeof latitude === "number" &&
      typeof longitude === "number" &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      return {
        latitude,
        longitude,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function writeStoredWeatherLocation(location: WeatherLocation) {
  try {
    window.localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Local storage can be unavailable in privacy modes; the widget can still refresh from default coordinates.
  }
}

function readCachedWeather(): DesktopWeatherSummary | null {
  try {
    const raw = window.localStorage.getItem(WEATHER_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      cachedAt?: unknown;
      weather?: WeatherSummaryApiResponse;
    };
    if (
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt) ||
      Date.now() - parsed.cachedAt > WEATHER_CACHE_TTL_MS ||
      !parsed.weather
    ) {
      return null;
    }
    const weather = normalizeWeatherSummary(parsed.weather);
    if (isGenericWeatherLocation(weather.location)) {
      return null;
    }
    return weather;
  } catch {
    return null;
  }
}

function writeCachedWeather(weather: DesktopWeatherSummary) {
  if (isGenericWeatherLocation(weather.location)) {
    return;
  }
  try {
    window.localStorage.setItem(
      WEATHER_CACHE_STORAGE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        weather,
      }),
    );
  } catch {
    // Local storage can be unavailable in privacy modes; the widget can still refresh live data.
  }
}

function isGenericWeatherLocation(location: string) {
  return location.trim() === "当前位置";
}

function normalizeWeatherSummary(payload: WeatherSummaryApiResponse): DesktopWeatherSummary {
  return {
    location: payload.location || "天气暂不可用",
    currentTemp: payload.currentTemp || "--",
    condition: payload.condition || "--",
    conditionIcon: normalizeIcon(payload.conditionIcon),
    highTemp: payload.highTemp || "--",
    lowTemp: payload.lowTemp || "--",
    hourly:
      Array.isArray(payload.hourly) && payload.hourly.length
        ? payload.hourly.slice(0, 6).map((item) => ({
            time: item.time || "--",
            temperature: item.temperature || "--",
            condition: item.condition || "",
            icon: normalizeIcon(item.icon),
          }))
        : [],
  };
}

function normalizeIcon(value: unknown): WeatherIconKind {
  if (
    value === "rain" ||
    value === "sunset" ||
    value === "night-rain" ||
    value === "cloud" ||
    value === "clear" ||
    value === "snow" ||
    value === "fog"
  ) {
    return value;
  }
  return "cloud";
}

function WeatherIcon({ kind, size = 25 }: { kind: WeatherIconKind; size?: number }) {
  if (kind === "sunset") return <SunsetIcon size={size} />;
  if (kind === "night-rain") return <NightRainIcon size={size} />;
  if (kind === "clear") return <ClearIcon size={size} />;
  if (kind === "snow") return <SnowIcon size={size} />;
  if (kind === "fog") return <FogIcon size={size} />;
  if (kind === "cloud") return <CloudIcon size={size} />;
  return <RainIcon size={size} />;
}

function LocationArrowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M15.4 2.6 11 15.3c-.25.7-1.24.73-1.53.05L7.25 10.2 2.1 7.98c-.68-.29-.65-1.28.05-1.53L14.8 2.1c.42-.15.75.18.6.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ClearIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M24 12.5v-4M24 39.5v-4M35.5 24h4M8.5 24h4M32.2 15.8l2.85-2.85M12.95 35.05l2.85-2.85M32.2 32.2l2.85 2.85M12.95 12.95l2.85 2.85"
        stroke="#FFD23F"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="8.2" fill="#FFD23F" />
      <circle cx="21.5" cy="20.5" r="3.8" fill="rgba(255,255,255,0.42)" />
    </svg>
  );
}

function RainIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M15.2 31.7h20.3c4.8 0 8.5-3.25 8.5-7.6 0-4.15-3.38-7.33-7.74-7.58C34.7 11.93 30.45 8.8 25.5 8.8c-5.48 0-10.06 3.76-11.2 8.84C8.78 18.12 5 21.88 5 26.58c0 2.98 2.54 5.12 5.72 5.12h4.48Z"
        fill="white"
      />
      <path
        d="M14.7 36.2 13.1 40M23.8 36.2 22.2 40M32.9 36.2 31.3 40"
        stroke="#5CE1FF"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SnowIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M15.2 31.7h20.3c4.8 0 8.5-3.25 8.5-7.6 0-4.15-3.38-7.33-7.74-7.58C34.7 11.93 30.45 8.8 25.5 8.8c-5.48 0-10.06 3.76-11.2 8.84C8.78 18.12 5 21.88 5 26.58c0 2.98 2.54 5.12 5.72 5.12h4.48Z"
        fill="white"
      />
      <path
        d="M15 38h.1M24 38h.1M33 38h.1"
        stroke="#BDEBFF"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FogIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M15.2 29.5h20.3c4.8 0 8.5-3.25 8.5-7.6 0-4.15-3.38-7.33-7.74-7.58C34.7 9.73 30.45 6.6 25.5 6.6c-5.48 0-10.06 3.76-11.2 8.84C8.78 15.92 5 19.68 5 24.38c0 2.98 2.54 5.12 5.72 5.12h4.48Z"
        fill="white"
      />
      <path
        d="M10 35h27M14 40h24"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloudIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M15.2 33h20.3c4.8 0 8.5-3.25 8.5-7.6 0-4.15-3.38-7.33-7.74-7.58C34.7 13.23 30.45 10.1 25.5 10.1c-5.48 0-10.06 3.76-11.2 8.84C8.78 19.42 5 23.18 5 27.88 5 30.86 7.54 33 10.72 33h4.48Z"
        fill="white"
      />
    </svg>
  );
}

function NightRainIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M33.4 11.4c-1.1 4.55 2.18 9.05 6.9 9.38-1.5 1.7-3.76 2.65-6.1 2.38-4.05-.47-6.92-4.12-6.45-8.15.24-2.05 1.3-3.82 2.83-4.98.9-.68 2.02.2 1.74 1.27Z"
        fill="white"
      />
      <path
        d="M14.5 32.2h19.3c4.35 0 7.7-2.95 7.7-6.88 0-3.76-3.06-6.64-7-6.86-1.42-4.16-5.27-7-9.75-7-4.96 0-9.1 3.4-10.14 8-5 .43-8.42 3.84-8.42 8.1 0 2.7 2.3 4.64 5.18 4.64h3.13Z"
        fill="white"
      />
      <path
        d="M15.2 36.2 13.8 39.7M24 36.2 22.6 39.7M32.8 36.2 31.4 39.7"
        stroke="#5CE1FF"
        strokeWidth="2.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunsetIcon({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M15 29.5c.88-4.1 4.52-7.18 8.9-7.18s8.03 3.08 8.9 7.18"
        stroke="#FFD23F"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path d="M8.5 32.5h31" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M13.5 37.5h21" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M24 8.5v6.2M14.2 12.7l3.2 4.3M33.8 12.7 30.6 17M10.5 23.5h5.2M32.3 23.5h5.2"
        stroke="#FFD23F"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M24 19.2v-4.5" stroke="#FFD23F" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
