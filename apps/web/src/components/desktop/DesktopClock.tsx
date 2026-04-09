"use client";

import { useEffect, useState } from "react";

export function DesktopClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");

  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const weekDay = weekDays[now.getDay()];
  const dateStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;

  return (
    <div
      className="absolute top-8 left-8 select-none"
      style={{ zIndex: 1 }}
    >
      {/* 时间主体 */}
      <div className="flex items-end gap-1">
        <span
          style={{
            fontSize: 72,
            fontWeight: 200,
            letterSpacing: "-2px",
            lineHeight: 1,
            color: "rgba(255,255,255,0.92)",
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 2px 24px rgba(0,0,0,0.4)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {hours}:{minutes}
        </span>
        <span
          style={{
            fontSize: 28,
            fontWeight: 300,
            lineHeight: 1,
            marginBottom: 10,
            color: "rgba(255,255,255,0.5)",
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 2px 12px rgba(0,0,0,0.3)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {seconds}
        </span>
      </div>

      {/* 日期 + 星期 */}
      <div
        className="flex items-center gap-2 mt-1"
        style={{ textShadow: "0 1px 8px rgba(0,0,0,0.4)" }}
      >
        <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.7)", letterSpacing: "0.5px" }}>
          {dateStr}
        </span>
        <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.25)", display: "inline-block" }} />
        <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.7)", letterSpacing: "0.5px" }}>
          {weekDay}
        </span>
      </div>
    </div>
  );
}
