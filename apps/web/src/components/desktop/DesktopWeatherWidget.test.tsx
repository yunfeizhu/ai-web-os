import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopWeatherWidget } from "./DesktopWeatherWidget";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("DesktopWeatherWidget", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders a skeleton before live data arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    act(() => {
      root.render(<DesktopWeatherWidget />);
    });

    const widget = container.querySelector('[data-testid="desktop-weather-widget"]');
    const widgetElement = widget as HTMLElement | null;

    expect(widget).not.toBeNull();
    expect(widgetElement?.style.width).toBe("360px");
    expect(widgetElement?.style.padding).toBe("14px 14px 12px");
    expect(container.querySelector('[data-testid="weather-skeleton"]')).not.toBeNull();
    expect(widget?.textContent).toContain("获取中");
    expect(widget?.textContent).not.toContain("当前位置");
    expect(widget?.textContent).not.toContain("余杭区");
    expect(widget?.textContent).not.toContain("25°");
    expect(widget?.textContent).not.toContain("微雨");
    expect(widget?.textContent).not.toContain("最高");
    expect(widget?.textContent).not.toContain("最低");
    expect(widget?.textContent).not.toContain("19:05");
  });

  it("keeps the first render stable when cached weather exists", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    localStorage.setItem(
      "ai-web-os.desktop.weather.summary",
      JSON.stringify({
        cachedAt: 1_000_000 - 5 * 60 * 1000,
        weather: {
          location: "临平区",
          currentTemp: "27°",
          condition: "多云",
          conditionIcon: "cloud",
          highTemp: "29°",
          lowTemp: "23°",
          hourly: [{ time: "17时", temperature: "27°", condition: "多云", icon: "cloud" }],
        },
      }),
    );

    const html = renderToString(<DesktopWeatherWidget />);

    expect(html).toContain("weather-skeleton");
    expect(html).toContain("获取中");
    expect(html).not.toContain("临平区");
    expect(html).not.toContain("27°");
  });

  it("loads live weather with browser coordinates", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          source: "open-meteo",
          sourceUrl: "https://api.open-meteo.com/v1/forecast",
          location: "余杭区",
          resolvedLocation: "30.42000,120.30000",
          currentTemp: "26°",
          condition: "小雨",
          conditionIcon: "rain",
          highTemp: "28°",
          lowTemp: "22°",
          hourly: [
            { time: "16时", temperature: "26°", condition: "小雨", icon: "rain" },
            { time: "17时", temperature: "25°", condition: "小雨", icon: "rain" },
            { time: "18时", temperature: "25°", condition: "阴", icon: "cloud" },
            { time: "19时", temperature: "24°", condition: "阵雨", icon: "night-rain" },
            { time: "20时", temperature: "24°", condition: "多云", icon: "cloud" },
            { time: "21时", temperature: "23°", condition: "多云", icon: "cloud" },
          ],
          updatedAt: "2026-06-24T16:00:00+08:00",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((resolve: PositionCallback) => {
          resolve({
            coords: {
              latitude: 30.42,
              longitude: 120.3,
            },
          } as GeolocationPosition);
        }),
      },
    });

    await act(async () => {
      root.render(<DesktopWeatherWidget />);
    });
    await act(async () => {
      await flushPromises();
    });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    const widget = container.querySelector('[data-testid="desktop-weather-widget"]');

    expect(requestedUrl).toContain("/weather/summary?");
    expect(requestedUrl).toContain("latitude=30.42");
    expect(requestedUrl).toContain("longitude=120.3");
    expect(requestedUrl).not.toContain("location=");
    expect(widget?.textContent).toContain("余杭区");
    expect(widget?.textContent).toContain("26°");
    expect(widget?.textContent).toContain("小雨");
    expect(widget?.textContent).toContain("28°");
    expect(widget?.textContent).toContain("16时");
  });

  it("uses fresh cached weather without locating or fetching again", async () => {
    const getCurrentPosition = vi.fn();
    const fetchMock = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    localStorage.setItem(
      "ai-web-os.desktop.weather.summary",
      JSON.stringify({
        cachedAt: 1_000_000 - 5 * 60 * 1000,
        weather: {
          location: "临平区",
          currentTemp: "27°",
          condition: "多云",
          conditionIcon: "cloud",
          highTemp: "29°",
          lowTemp: "23°",
          hourly: [
            { time: "17时", temperature: "27°", condition: "多云", icon: "cloud" },
            { time: "18时", temperature: "26°", condition: "多云", icon: "cloud" },
            { time: "19时", temperature: "25°", condition: "多云", icon: "cloud" },
          ],
        },
      }),
    );

    await act(async () => {
      root.render(<DesktopWeatherWidget />);
    });
    await act(async () => {
      await flushPromises();
    });

    const widget = container.querySelector('[data-testid="desktop-weather-widget"]');

    expect(widget?.textContent).toContain("临平区");
    expect(widget?.textContent).toContain("27°");
    expect(widget?.textContent).toContain("29°");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

function flushPromises() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
