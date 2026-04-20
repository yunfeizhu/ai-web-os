"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { apiFetch, completeOnce } from "@/lib/backend";

type CalendarView = "month" | "week" | "day";
type YearPickerMode = "month" | "year";

interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  color: string;
  tags: string[];
}

interface EventDraft {
  id?: string;
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  color: string;
  tags: string;
}

const EVENT_COLORS = ["#2563eb", "#7c3aed", "#059669", "#ea580c", "#e11d48"];
const MONTH_LABELS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PICKER_WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, "0");
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
});

function formatDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, offset));
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

function startOfMonthGrid(date: Date) {
  return startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
}

function endOfMonthGrid(date: Date) {
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return endOfWeek(last);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sameDay(left: Date, right: Date) {
  return dateKey(left) === dateKey(right);
}

function emptyDraft(date = new Date()): EventDraft {
  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return {
    title: "",
    description: "",
    location: "",
    start_at: formatDateTimeLocal(start),
    end_at: formatDateTimeLocal(end),
    all_day: false,
    color: EVENT_COLORS[0],
    tags: "",
  };
}

function splitLocalDateTime(value: string) {
  const [datePart = "", rawTime = "09:00"] = value.split("T");
  return {
    datePart,
    timePart: rawTime.slice(0, 5) || "09:00",
  };
}

function joinLocalDateTime(datePart: string, timePart: string) {
  return `${datePart}T${timePart}`;
}

function addMinutesToLocalDateTime(value: string, minutes: number) {
  const next = new Date(value);
  next.setMinutes(next.getMinutes() + minutes);
  return formatDateTimeLocal(next);
}

function localDateTimeValue(value: string) {
  return new Date(value).getTime();
}

function formatDateChip(datePart: string) {
  if (!datePart) {
    return "选择日期";
  }
  const parsed = new Date(`${datePart}T12:00:00`);
  return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
}

function formatDateChipMeta(datePart: string) {
  if (!datePart) {
    return "点按整块选择日期";
  }
  const parsed = new Date(`${datePart}T12:00:00`);
  return WEEKDAY_LABELS[parsed.getDay()];
}

export function CalendarApp() {
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(new Date());
  const [focusedDate, setFocusedDate] = useState(startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [yearPickerCursor, setYearPickerCursor] = useState(new Date().getFullYear());
  const [yearPickerMode, setYearPickerMode] = useState<YearPickerMode>("month");
  const today = useMemo(() => startOfDay(new Date()), []);
  const yearPickerRef = useRef<HTMLDivElement | null>(null);

  const range = useMemo(() => {
    if (view === "day") {
      const start = startOfDay(cursor);
      const end = addDays(start, 1);
      return { start, end };
    }
    if (view === "week") {
      return { start: startOfWeek(cursor), end: addDays(endOfWeek(cursor), 1) };
    }
    return {
      start: startOfMonthGrid(cursor),
      end: addDays(endOfMonthGrid(cursor), 1),
    };
  }, [cursor, view]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CalendarEvent[]>(
        `/calendar/events?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(
          range.end.toISOString(),
        )}`,
      );
      setEvents(data);
    } catch {
      setStatusText("日历数据读取失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [cursor, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setYearPickerCursor(cursor.getFullYear());
  }, [cursor]);

  useEffect(() => {
    if (!yearPickerOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!yearPickerRef.current?.contains(event.target as Node)) {
        setYearPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [yearPickerOpen]);

  const monthCells = useMemo(() => {
    const cells: Date[] = [];
    let current = range.start;
    while (current < range.end) {
      cells.push(current);
      current = addDays(current, 1);
    }
    return cells;
  }, [range]);

  const groupedByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((event) => {
      const key = dateKey(new Date(event.start_at));
      map[key] = [...(map[key] || []), event];
    });
    Object.keys(map).forEach((key) => {
      map[key].sort((left, right) => left.start_at.localeCompare(right.start_at));
    });
    return map;
  }, [events]);

  const upcoming = useMemo(
    () =>
      [...events]
        .filter((event) => new Date(event.end_at).getTime() >= Date.now())
        .sort((left, right) => left.start_at.localeCompare(right.start_at))
        .slice(0, 6),
    [events],
  );

  const focusedDayEvents = useMemo(() => {
    return [...(groupedByDay[dateKey(focusedDate)] || [])].sort((left, right) =>
      left.start_at.localeCompare(right.start_at),
    );
  }, [focusedDate, groupedByDay]);

  const visibleDays = useMemo(() => {
    return view === "week"
      ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index))
      : [cursor];
  }, [cursor, view]);

  const navigateCursor = (direction: -1 | 1) => {
    setCursor((current) => {
      const next =
        view === "month"
          ? addMonths(current, direction)
          : view === "week"
            ? addDays(current, direction * 7)
            : addDays(current, direction);
      setFocusedDate(startOfDay(next));
      return next;
    });
  };

  const rangeTitle = useMemo(() => {
    if (view === "month") {
      return `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = endOfWeek(cursor);
      return `${start.getMonth() + 1} 月 ${start.getDate()} 日 - ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
    }
    return `${cursor.getMonth() + 1} 月 ${cursor.getDate()} 日`;
  }, [cursor, view]);

  const openYearPicker = () => {
    setYearPickerCursor(cursor.getFullYear());
    setYearPickerMode("month");
    setYearPickerOpen(true);
  };

  const jumpToMonth = (year: number, month: number) => {
    const preservedDay = Math.min(focusedDate.getDate(), new Date(year, month + 1, 0).getDate());
    const next = new Date(year, month, preservedDay);
    setCursor(next);
    setFocusedDate(startOfDay(next));
    setView("month");
    setYearPickerOpen(false);
  };

  const yearBlockStart = useMemo(() => yearPickerCursor - (yearPickerCursor % 12), [yearPickerCursor]);
  const yearChoices = useMemo(() => Array.from({ length: 12 }, (_, index) => yearBlockStart + index), [yearBlockStart]);

  const jumpToYear = (year: number) => {
    setYearPickerCursor(year);
    setYearPickerMode("month");
  };

  const openCreateModal = (date = cursor) => {
    setDraft(emptyDraft(date));
    setModalOpen(true);
  };

  const openEditModal = (event: CalendarEvent) => {
    setDraft({
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      start_at: event.start_at.slice(0, 16),
      end_at: event.end_at.slice(0, 16),
      all_day: event.all_day,
      color: event.color,
      tags: (event.tags || []).join(", "),
    });
    setModalOpen(true);
  };

  const saveEvent = async () => {
    if (!draft.title.trim()) {
      setStatusText("请输入事件标题。");
      return;
    }
    if (localDateTimeValue(draft.end_at) <= localDateTimeValue(draft.start_at)) {
      setStatusText("结束时间需要晚于开始时间。");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        location: draft.location.trim(),
        start_at: new Date(draft.start_at).toISOString(),
        end_at: new Date(draft.end_at).toISOString(),
        all_day: draft.all_day,
        color: draft.color,
        tags: draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      const path = draft.id ? `/calendar/events/${draft.id}` : "/calendar/events";
      await apiFetch(path, {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setModalOpen(false);
      await loadEvents();
      setStatusText(draft.id ? "事件已更新。" : "事件已创建。");
    } catch {
      setStatusText("事件保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (eventId: string) => {
    try {
      await apiFetch(`/calendar/events/${eventId}`, { method: "DELETE" });
      setModalOpen(false);
      await loadEvents();
      setStatusText("事件已删除。");
    } catch {
      setStatusText("删除失败。");
    }
  };

  const runAssistant = async () => {
    if (!assistantInput.trim()) {
      setStatusText("请先输入你的安排需求。");
      return;
    }
    setAssistantBusy(true);
    setStatusText("");
    try {
      const result = await completeOnce(
        `请根据下面的日程需求，输出一个 JSON 数组。每项包含 title、description、location、start_at、end_at、all_day、color、tags。时间请输出 ISO 字符串。\n\n当前参考日期：${new Date().toISOString()}\n用户需求：${assistantInput}`,
        "你是日程规划助手。只返回 JSON 数组，不要输出解释、markdown 或代码块。",
      );
      const parsed = parseAssistantEvents(result.content) as Array<{
        title: string;
        description?: string;
        location?: string;
        start_at: string;
        end_at: string;
        all_day?: boolean;
        color?: string;
        tags?: string[];
      }>;
      for (const item of parsed) {
        await apiFetch("/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.title,
            description: item.description || "",
            location: item.location || "",
            start_at: item.start_at,
            end_at: item.end_at,
            all_day: item.all_day || false,
            color: item.color || EVENT_COLORS[0],
            tags: item.tags || [],
          }),
        });
      }
      if (parsed[0]?.start_at) {
        const firstDate = startOfDay(new Date(parsed[0].start_at));
        setCursor(firstDate);
        setFocusedDate(firstDate);
      }
      setAssistantInput("");
      await loadEvents();
      setStatusText("智能助手已把日程加入日历。");
    } catch {
      setStatusText("智能日程生成失败。请尝试更明确的时间描述。");
    } finally {
      setAssistantBusy(false);
    }
  };

  return (
    <div
      data-desktop-blocker="true"
      className="flex h-full min-w-0 overflow-hidden rounded-[28px]"
      style={{
        color: "var(--t1)",
        background:
          "radial-gradient(circle at top right, rgba(59,130,246,0.12), transparent 24%), radial-gradient(circle at bottom left, rgba(236,72,153,0.08), transparent 20%), linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.98))",
      }}
    >
      <section className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex flex-wrap items-center gap-3 border-b px-5 py-4"
          style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.76)" }}
        >
          <div>
            <div className="text-[12px] font-medium" style={{ color: "#2563eb" }}>
              日程规划
            </div>
            <div className="mt-1 text-[24px] font-semibold">日历</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="rounded-full border px-3 py-2"
              style={pillStyle(sameDay(startOfDay(cursor), today))}
              onClick={() => {
                const next = new Date();
                setCursor(next);
                setFocusedDate(startOfDay(next));
              }}
            >
              今天
            </button>
            <button className="rounded-full border px-3 py-2" style={pillStyle()} onClick={() => navigateCursor(-1)}>
              <ChevronLeft size={15} />
            </button>
            <button className="rounded-full border px-3 py-2" style={pillStyle()} onClick={() => navigateCursor(1)}>
              <ChevronRight size={15} />
            </button>
            {(["month", "week", "day"] as CalendarView[]).map((mode) => (
              <button
                key={mode}
                className="rounded-full border px-3 py-2 text-[13px]"
                style={pillStyle(view === mode)}
                onClick={() => {
                  setView(mode);
                  setFocusedDate(startOfDay(cursor));
                }}
              >
                {mode === "month" ? "月" : mode === "week" ? "周" : "日"}
              </button>
            ))}
            <button
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-white"
              style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)" }}
              onClick={() => openCreateModal()}
            >
              <Plus size={15} />
              新建事件
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="relative" ref={yearPickerRef}>
                <button
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-left transition-colors transition-shadow"
                  style={{
                    borderColor: yearPickerOpen ? "rgba(37,99,235,0.22)" : "rgba(15,23,42,0.08)",
                    background: yearPickerOpen
                      ? "linear-gradient(180deg, rgba(239,246,255,0.96), rgba(255,255,255,0.98))"
                      : "rgba(255,255,255,0.86)",
                    boxShadow: yearPickerOpen ? "0 14px 30px rgba(37,99,235,0.12)" : "none",
                  }}
                  onClick={() => (yearPickerOpen ? setYearPickerOpen(false) : openYearPicker())}
                >
                  <div>
                    <div className="text-[11px] font-medium tracking-[0.08em]" style={{ color: "#64748b" }}>
                      快速切换
                    </div>
                    <div className="mt-1 text-[18px] font-semibold">{rangeTitle}</div>
                  </div>
                  <ChevronDown
                    size={16}
                    style={{
                      color: "#64748b",
                      transform: yearPickerOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 160ms ease",
                    }}
                  />
                </button>

                {yearPickerOpen && (
                  <div
                    className="absolute left-0 top-[calc(100%+12px)] z-20 w-[360px] rounded-[28px] border p-4 shadow-2xl backdrop-blur-xl"
                    style={{
                      borderColor: "rgba(15,23,42,0.08)",
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
                      boxShadow: "0 28px 80px rgba(15,23,42,0.14)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        className="rounded-full border px-3 py-2"
                        style={pillStyle()}
                        onClick={() =>
                          setYearPickerCursor((current) =>
                            yearPickerMode === "year" ? current - 12 : current - 1,
                          )
                        }
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <div className="text-center">
                        <div className="text-[12px]" style={{ color: "#64748b" }}>
                          {yearPickerMode === "year" ? "选择年份" : "选择年份与月份"}
                        </div>
                        <button
                          className="mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[22px] font-semibold transition-colors hover:bg-slate-100"
                          onClick={() => setYearPickerMode((current) => (current === "month" ? "year" : "month"))}
                        >
                          {yearPickerMode === "year"
                            ? `${yearBlockStart} - ${yearBlockStart + 11}`
                            : `${yearPickerCursor} 年`}
                          <ChevronDown
                            size={16}
                            style={{
                              color: "#64748b",
                              transform: yearPickerMode === "year" ? "rotate(180deg)" : "rotate(0deg)",
                              transition: "transform 160ms ease",
                            }}
                          />
                        </button>
                      </div>
                      <button
                        className="rounded-full border px-3 py-2"
                        style={pillStyle()}
                        onClick={() =>
                          setYearPickerCursor((current) =>
                            yearPickerMode === "year" ? current + 12 : current + 1,
                          )
                        }
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>

                    {yearPickerMode === "year" ? (
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {yearChoices.map((year) => {
                          const isSelected = yearPickerCursor === year;
                          const isCurrentViewYear = cursor.getFullYear() === year;
                          const isCurrentYear = today.getFullYear() === year;
                          return (
                            <button
                              key={year}
                              className="rounded-[18px] border px-3 py-4 text-left transition-transform hover:-translate-y-0.5"
                              style={{
                                borderColor: isSelected
                                  ? "rgba(37,99,235,0.24)"
                                  : isCurrentYear
                                    ? "rgba(239,68,68,0.18)"
                                    : "rgba(15,23,42,0.08)",
                                background: isSelected
                                  ? "linear-gradient(135deg, rgba(219,234,254,0.92), rgba(255,255,255,0.96))"
                                  : isCurrentYear
                                    ? "linear-gradient(135deg, rgba(254,242,242,0.96), rgba(255,255,255,0.96))"
                                    : "rgba(255,255,255,0.88)",
                                boxShadow: isSelected ? "0 14px 28px rgba(37,99,235,0.1)" : "none",
                              }}
                              onClick={() => jumpToYear(year)}
                            >
                              <div className="text-[18px] font-semibold">{year}</div>
                              <div
                                className="mt-1 text-[11px]"
                                style={{ color: isSelected ? "#2563eb" : isCurrentYear ? "#dc2626" : "#94a3b8" }}
                              >
                                {isSelected ? (isCurrentViewYear ? "当前视图年份" : "已选年份") : isCurrentYear ? "今年" : "选择年份"}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {MONTH_LABELS.map((label, monthIndex) => {
                          const isSelected =
                            cursor.getFullYear() === yearPickerCursor && cursor.getMonth() === monthIndex;
                          const isCurrentMonth =
                            today.getFullYear() === yearPickerCursor && today.getMonth() === monthIndex;
                          return (
                            <button
                              key={label}
                              className="rounded-[18px] border px-3 py-3 text-left transition-transform hover:-translate-y-0.5"
                              style={{
                                borderColor: isSelected
                                  ? "rgba(37,99,235,0.24)"
                                  : isCurrentMonth
                                    ? "rgba(239,68,68,0.18)"
                                    : "rgba(15,23,42,0.08)",
                                background: isSelected
                                  ? "linear-gradient(135deg, rgba(219,234,254,0.92), rgba(255,255,255,0.96))"
                                  : isCurrentMonth
                                    ? "linear-gradient(135deg, rgba(254,242,242,0.96), rgba(255,255,255,0.96))"
                                    : "rgba(255,255,255,0.88)",
                                boxShadow: isSelected ? "0 14px 28px rgba(37,99,235,0.1)" : "none",
                              }}
                              onClick={() => jumpToMonth(yearPickerCursor, monthIndex)}
                            >
                              <div className="text-[14px] font-semibold">{label}</div>
                              <div
                                className="mt-1 text-[11px]"
                                style={{ color: isSelected ? "#2563eb" : isCurrentMonth ? "#dc2626" : "#94a3b8" }}
                              >
                                {isSelected ? "当前视图" : isCurrentMonth ? "本月" : `${monthIndex + 1} 月`}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <button
                      className="mt-4 w-full rounded-full border px-4 py-3 text-[13px] font-medium"
                      style={pillStyle()}
                      onClick={() => {
                        const now = new Date();
                        setCursor(now);
                        setFocusedDate(startOfDay(now));
                        setView("month");
                        setYearPickerOpen(false);
                      }}
                    >
                      回到本月
                    </button>
                  </div>
                )}
              </div>
              <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                {statusText || "单击日期查看安排，双击日期或使用新建按钮创建事件。"}
              </div>
            </div>

            {loading ? (
              <div className="flex h-[420px] items-center justify-center gap-3 text-[14px]" style={{ color: "var(--t3)" }}>
                <Loader2 size={18} className="animate-spin" />
                正在读取日程...
              </div>
            ) : view === "month" ? (
              <div className="grid min-h-max gap-3 pb-4">
                <div className="grid grid-cols-7 gap-3 px-1">
                  {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label) => (
                    <div
                      key={label}
                      className="text-center text-[11px] font-semibold tracking-[0.08em]"
                      style={{ color: "#94a3b8" }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-3">
                {monthCells.map((cell) => {
                  const dayEvents = groupedByDay[dateKey(cell)] || [];
                  const isToday = sameDay(cell, today);
                  const isCurrentMonth = cell.getMonth() === cursor.getMonth();
                  const isFocused = sameDay(cell, focusedDate);
                  return (
                    <button
                      key={cell.toISOString()}
                      onClick={() => setFocusedDate(startOfDay(cell))}
                      onDoubleClick={() => openCreateModal(cell)}
                      className="flex min-h-[112px] flex-col rounded-[24px] border p-3 text-left"
                      style={{
                        borderColor: isToday
                          ? "rgba(239,68,68,0.26)"
                          : isFocused
                            ? "rgba(37,99,235,0.22)"
                            : "rgba(15,23,42,0.08)",
                        background:
                          isToday
                            ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(254,242,242,0.94))"
                            : isFocused
                              ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,255,0.92))"
                            : isCurrentMonth
                              ? "rgba(255,255,255,0.9)"
                              : "rgba(248,250,252,0.78)",
                        boxShadow: isToday
                          ? "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 24px rgba(239,68,56,0.08)"
                          : isFocused
                            ? "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 24px rgba(37,99,235,0.08)"
                            : "none",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[10px] font-medium" style={{ color: isToday ? "#dc2626" : "transparent" }}>
                          {isToday ? "今天" : " "}
                        </div>
                        <div
                          className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[12px] font-semibold"
                          style={{
                            background: isToday ? "#f04438" : "transparent",
                            color: isToday ? "#ffffff" : isCurrentMonth ? "#0f172a" : "#94a3b8",
                            boxShadow: isToday ? "0 8px 18px rgba(240,68,56,0.24)" : "none",
                          }}
                        >
                          {cell.getDate()}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        {dayEvents.slice(0, 3).map((event) => (
                          <div
                            key={event.id}
                            onClick={(evt) => {
                              evt.stopPropagation();
                              openEditModal(event);
                            }}
                            className="truncate rounded-full px-2 py-1 text-[11px] font-medium text-white"
                            style={{ background: event.color }}
                          >
                            {event.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[11px]" style={{ color: "var(--t3)" }}>
                            +{dayEvents.length - 3} 个事件
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 pb-4">
                {visibleDays.map((cell) => {
                  const dayEvents = groupedByDay[dateKey(cell)] || [];
                  const isToday = sameDay(cell, today);
                  const isFocused = sameDay(cell, focusedDate);
                  return (
                    <div
                      key={cell.toISOString()}
                      className="rounded-[28px] border p-4"
                      style={{
                        borderColor: isToday
                          ? "rgba(239,68,68,0.18)"
                          : isFocused
                            ? "rgba(37,99,235,0.18)"
                            : "rgba(15,23,42,0.08)",
                        background: isToday
                          ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(254,242,242,0.9))"
                          : isFocused
                            ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,255,0.9))"
                          : "rgba(255,255,255,0.88)",
                      }}
                      onClick={() => setFocusedDate(startOfDay(cell))}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-[14px] font-semibold"
                            style={{
                              background: isToday ? "#f04438" : "rgba(15,23,42,0.06)",
                              color: isToday ? "#ffffff" : "#0f172a",
                              boxShadow: isToday ? "0 10px 22px rgba(240,68,56,0.22)" : "none",
                            }}
                          >
                            {cell.getDate()}
                          </div>
                          <div>
                            <div className="text-[16px] font-semibold">
                              {cell.getMonth() + 1} 月 {cell.getDate()} 日
                            </div>
                            <div className="text-[12px]" style={{ color: isToday ? "#dc2626" : "var(--t3)" }}>
                              {isToday ? "今天" : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][cell.getDay()]}
                            </div>
                          </div>
                        </div>
                        <button className="rounded-full border px-3 py-2 text-[12px]" style={pillStyle()} onClick={() => openCreateModal(cell)}>
                          新建
                        </button>
                      </div>
                      <div className="flex flex-col gap-3">
                        {dayEvents.length === 0 ? (
                          <div className="rounded-[20px] border border-dashed px-4 py-4 text-[13px]" style={{ borderColor: "rgba(15,23,42,0.1)", color: "var(--t3)" }}>
                            这一天还没有安排。
                          </div>
                        ) : (
                          dayEvents.map((event) => (
                            <button
                              key={event.id}
                              onClick={() => openEditModal(event)}
                              className="rounded-[20px] border px-4 py-4 text-left"
                              style={{
                                borderColor: "rgba(15,23,42,0.08)",
                                background: `linear-gradient(135deg, ${event.color}18, rgba(255,255,255,0.96))`,
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: event.color }} />
                                <span className="text-[15px] font-semibold">{event.title}</span>
                              </div>
                              <div className="mt-2 text-[12px]" style={{ color: "var(--t3)" }}>
                                {new Date(event.start_at).toLocaleString()} - {new Date(event.end_at).toLocaleString()}
                              </div>
                              {(event.location || event.description) && (
                                <div className="mt-2 text-[13px] leading-6">
                                  {[event.location, event.description].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside
            className="flex w-[320px] shrink-0 flex-col border-l px-4 py-4"
            style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.78)" }}
          >
            <div className="flex items-center gap-2">
              <CalendarDays size={18} color="#2563eb" />
              <div className="text-[18px] font-semibold">智能日程助手</div>
            </div>
            <p className="mt-2 text-[12px] leading-6" style={{ color: "var(--t3)" }}>
              直接写“下周三下午安排产品评审，周四上午和设计同步，周五留出两小时写周报”这类自然语言，我会自动生成事件。
            </p>
            <textarea
              value={assistantInput}
              onChange={(event) => setAssistantInput(event.target.value)}
              className="mt-4 min-h-[140px] rounded-[24px] border px-4 py-4 text-[13px] outline-none"
              style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.92)" }}
              placeholder="输入你的安排需求..."
            />
            <button
              onClick={() => void runAssistant()}
              disabled={assistantBusy}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-[13px] font-medium text-white"
              style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", opacity: assistantBusy ? 0.7 : 1 }}
            >
              {assistantBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              生成并加入日历
            </button>

            <div className="mt-6 text-[12px] font-medium" style={{ color: "#64748b" }}>
              选中日期
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <div
                className="rounded-[24px] border px-4 py-4"
                style={{
                  borderColor: sameDay(focusedDate, today) ? "rgba(239,68,68,0.16)" : "rgba(15,23,42,0.08)",
                  background: sameDay(focusedDate, today)
                    ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(254,242,242,0.92))"
                    : "rgba(248,250,252,0.92)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="inline-flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-[14px] font-semibold"
                    style={{
                      background: sameDay(focusedDate, today) ? "#f04438" : "rgba(15,23,42,0.08)",
                      color: sameDay(focusedDate, today) ? "#fff" : "#0f172a",
                    }}
                  >
                    {focusedDate.getDate()}
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold">
                      {focusedDate.getMonth() + 1} 月 {focusedDate.getDate()} 日
                    </div>
                    <div className="text-[12px]" style={{ color: sameDay(focusedDate, today) ? "#dc2626" : "var(--t3)" }}>
                      {sameDay(focusedDate, today)
                        ? "今天"
                        : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][focusedDate.getDay()]}
                    </div>
                  </div>
                </div>
                <button
                  className="mt-4 rounded-full border px-3 py-2 text-[12px]"
                  style={pillStyle()}
                  onClick={() => openCreateModal(focusedDate)}
                >
                  为这一天新建事件
                </button>
              </div>

              {focusedDayEvents.length === 0 ? (
                <div className="rounded-[24px] border border-dashed px-4 py-5 text-[13px]" style={{ borderColor: "rgba(15,23,42,0.1)", color: "var(--t3)" }}>
                  这一天还没有安排。
                </div>
              ) : (
                focusedDayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => openEditModal(event)}
                    className="rounded-[24px] border px-4 py-4 text-left"
                    style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.92)" }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: event.color }} />
                      <span className="truncate text-[14px] font-semibold">{event.title}</span>
                    </div>
                    <div className="mt-2 text-[12px]" style={{ color: "var(--t3)" }}>
                      {new Date(event.start_at).toLocaleString()}
                    </div>
                  </button>
                ))
              )}

              <div className="mt-3 text-[12px] font-medium" style={{ color: "#64748b" }}>
                近期安排
              </div>
              {upcoming.length === 0 ? (
                <div className="rounded-[24px] border border-dashed px-4 py-5 text-[13px]" style={{ borderColor: "rgba(15,23,42,0.1)", color: "var(--t3)" }}>
                  暂时还没有未来日程。
                </div>
              ) : (
                upcoming.map((event) => (
                  <button
                    key={`upcoming-${event.id}`}
                    onClick={() => {
                      setFocusedDate(startOfDay(new Date(event.start_at)));
                      openEditModal(event);
                    }}
                    className="rounded-[24px] border px-4 py-4 text-left"
                    style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.92)" }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: event.color }} />
                      <span className="truncate text-[14px] font-semibold">{event.title}</span>
                    </div>
                    <div className="mt-2 text-[12px]" style={{ color: "var(--t3)" }}>
                      {new Date(event.start_at).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      </section>

      {modalOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="w-[520px] rounded-[28px] border bg-white p-5 shadow-2xl" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
            <div className="text-[20px] font-semibold">{draft.id ? "编辑事件" : "新建事件"}</div>
            <div className="mt-4 grid gap-3">
              <Field label="标题">
                <input value={draft.title} onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <DateTimeField
                  label="开始时间"
                  value={draft.start_at}
                  onChange={(value) =>
                    setDraft((prev) => {
                      const duration =
                        localDateTimeValue(prev.end_at) - localDateTimeValue(prev.start_at);
                      const safeDuration = duration > 0 ? duration / 60000 : 60;
                      return {
                        ...prev,
                        start_at: value,
                        end_at:
                          localDateTimeValue(prev.end_at) > localDateTimeValue(value)
                            ? prev.end_at
                            : addMinutesToLocalDateTime(value, safeDuration),
                      };
                    })
                  }
                />
                <DateTimeField
                  label="结束时间"
                  value={draft.end_at}
                  onChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      end_at: value,
                    }))
                  }
                />
              </div>
              <Field label="地点">
                <input value={draft.location} onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} />
              </Field>
              <Field label="描述">
                <textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} className="min-h-[100px] w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} />
              </Field>
              <div className="grid grid-cols-[1fr_160px] gap-3">
                <Field label="标签（逗号分隔）">
                  <input value={draft.tags} onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} />
                </Field>
                <Field label="颜色">
                  <div className="flex gap-2 rounded-2xl border px-3 py-2" style={fieldStyle}>
                    {EVENT_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setDraft((prev) => ({ ...prev, color }))}
                        className="h-6 w-6 rounded-full border-2"
                        style={{ background: color, borderColor: draft.color === color ? "#0f172a" : "transparent" }}
                      />
                    ))}
                  </div>
                </Field>
              </div>
              <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
                <input type="checkbox" checked={draft.all_day} onChange={(event) => setDraft((prev) => ({ ...prev, all_day: event.target.checked }))} />
                全天事件
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <div>
                {draft.id && (
                  <button
                    onClick={() => void deleteEvent(draft.id!)}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-medium"
                    style={{ background: "rgba(239,68,68,0.08)", color: "#b91c1c" }}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button className="rounded-full border px-4 py-2 text-[13px]" style={pillStyle()} onClick={() => setModalOpen(false)}>
                  取消
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-white"
                  style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)" }}
                  onClick={() => void saveEvent()}
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {draft.id ? "保存修改" : "创建事件"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-[12px] font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { datePart, timePart } = splitLocalDateTime(value);
  const [open, setOpen] = useState(false);
  const [panelMonth, setPanelMonth] = useState(() =>
    datePart ? new Date(`${datePart}T12:00:00`) : new Date(),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const today = startOfDay(new Date());
  const selectedDate = datePart ? new Date(`${datePart}T12:00:00`) : null;

  useEffect(() => {
    if (datePart) {
      setPanelMonth(new Date(`${datePart}T12:00:00`));
    }
  }, [datePart]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const panelStart = startOfMonthGrid(panelMonth);
  const panelEnd = endOfMonthGrid(panelMonth);
  const panelDays: Date[] = [];
  let current = panelStart;
  while (current <= panelEnd) {
    panelDays.push(current);
    current = addDays(current, 1);
  }

  const baseDatePart = datePart || dateKey(today);

  return (
    <div className="grid min-w-0 gap-2">
      <span className="text-[12px] font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </span>
      <div className="relative min-w-0" ref={rootRef}>
        <button
          type="button"
          className="flex w-full min-w-0 select-none items-center rounded-[10px] border px-3 py-2 text-left transition-colors"
          style={{
            borderColor: open ? "#1677ff" : "#d9d9d9",
            background: "#ffffff",
            boxShadow: open ? "0 0 0 2px rgba(22,119,255,0.14)" : "none",
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((currentOpen) => !currentOpen)}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px]" style={{ color: datePart ? "#0f172a" : "#94a3b8" }}>
              {datePart ? formatDateChip(datePart) : "请选择日期"}
            </div>
          </div>
          <div className="mx-2 h-5 w-px shrink-0" style={{ background: "rgba(15,23,42,0.08)" }} />
          <div className="w-[58px] shrink-0 text-[14px]" style={{ color: "#0f172a" }}>
            {timePart}
          </div>
          <Calendar size={14} color="#94a3b8" className="shrink-0" />
        </button>

        {open && (
          <div
            className="absolute left-0 top-[calc(100%+8px)] z-30 flex overflow-hidden rounded-2xl border bg-white shadow-2xl"
            style={{
              borderColor: "#f0f0f0",
              boxShadow: "0 12px 36px rgba(15,23,42,0.14)",
            }}
          >
            <div className="w-[286px] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-100"
                    onClick={() => setPanelMonth((currentMonth) => addMonths(currentMonth, -12))}
                  >
                    <ChevronLeft size={12} />
                    <ChevronLeft size={12} className="-ml-1.5" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-100"
                    onClick={() => setPanelMonth((currentMonth) => addMonths(currentMonth, -1))}
                  >
                    <ChevronLeft size={14} />
                  </button>
                </div>
                <div className="text-[14px] font-semibold">
                  {MONTH_LABELS[panelMonth.getMonth()]} {panelMonth.getFullYear()}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-100"
                    onClick={() => setPanelMonth((currentMonth) => addMonths(currentMonth, 1))}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-100"
                    onClick={() => setPanelMonth((currentMonth) => addMonths(currentMonth, 12))}
                  >
                    <ChevronRight size={12} />
                    <ChevronRight size={12} className="-ml-1.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-y-1 text-center text-[12px]" style={{ color: "#64748b" }}>
                {PICKER_WEEKDAY_LABELS.map((weekday) => (
                  <div key={weekday} className="pb-1">
                    {weekday}
                  </div>
                ))}
                {panelDays.map((day) => {
                  const inCurrentMonth = day.getMonth() === panelMonth.getMonth();
                  const isToday = sameDay(day, today);
                  const isSelected = selectedDate ? sameDay(day, selectedDate) : false;
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-[13px] transition-colors"
                      style={{
                        color: isSelected ? "#1677ff" : inCurrentMonth ? "#0f172a" : "#cbd5e1",
                        background: isSelected ? "rgba(22,119,255,0.14)" : "transparent",
                        border: isToday ? "1px solid rgba(22,119,255,0.28)" : "1px solid transparent",
                        fontWeight: isSelected ? 600 : 400,
                      }}
                      onClick={() => onChange(joinLocalDateTime(dateKey(day), timePart))}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="w-px" style={{ background: "#f0f0f0" }} />

            <div className="flex w-[180px]">
              <div className="flex-1 border-r px-1 py-2" style={{ borderColor: "#f0f0f0" }}>
                <div className="mb-1 px-2 text-[12px]" style={{ color: "#94a3b8" }}>
                  时
                </div>
                <div className="max-h-[256px] overflow-y-auto">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const label = String(hour).padStart(2, "0");
                    const selected = timePart.slice(0, 2) === label;
                    return (
                      <button
                        key={label}
                        type="button"
                        className="flex w-full rounded-md px-2 py-1.5 text-[13px] transition-colors"
                        style={{
                          background: selected ? "rgba(22,119,255,0.08)" : "transparent",
                          color: selected ? "#1677ff" : "#0f172a",
                        }}
                        onClick={() => onChange(joinLocalDateTime(baseDatePart, `${label}:${timePart.slice(3, 5)}`))}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 border-r px-1 py-2" style={{ borderColor: "#f0f0f0" }}>
                <div className="mb-1 px-2 text-[12px]" style={{ color: "#94a3b8" }}>
                  分
                </div>
                <div className="max-h-[256px] overflow-y-auto">
                  {["00", "15", "30", "45"].map((minute) => {
                    const selected = timePart.slice(3, 5) === minute;
                    return (
                      <button
                        key={minute}
                        type="button"
                        className="flex w-full rounded-md px-2 py-1.5 text-[13px] transition-colors"
                        style={{
                          background: selected ? "rgba(22,119,255,0.08)" : "transparent",
                          color: selected ? "#1677ff" : "#0f172a",
                        }}
                        onClick={() => onChange(joinLocalDateTime(baseDatePart, `${timePart.slice(0, 2)}:${minute}`))}
                      >
                        {minute}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 px-1 py-2">
                <div className="mb-1 px-2 text-[12px]" style={{ color: "#94a3b8" }}>
                  预设
                </div>
                <div className="max-h-[256px] overflow-y-auto">
                  {TIME_OPTIONS.map((option) => {
                    const selected = option === timePart;
                    return (
                      <button
                        key={option}
                        type="button"
                        className="flex w-full rounded-md px-2 py-1.5 text-[13px] transition-colors"
                        style={{
                          background: selected ? "rgba(22,119,255,0.08)" : "transparent",
                          color: selected ? "#1677ff" : "#0f172a",
                        }}
                        onClick={() => onChange(joinLocalDateTime(baseDatePart, option))}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t bg-white px-3 py-2"
              style={{ borderColor: "#f0f0f0" }}
            >
              <button
                type="button"
                className="text-[12px] font-medium"
                style={{ color: "#1677ff" }}
                onClick={() => {
                  const now = new Date();
                  onChange(joinLocalDateTime(dateKey(now), `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`));
                  setPanelMonth(now);
                }}
              >
                此刻
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-1 text-[12px] transition-colors hover:bg-slate-50"
                style={{ borderColor: "#d9d9d9", color: "#475569" }}
                onClick={() => setOpen(false)}
              >
                确定
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function pillStyle(active = false) {
  return {
    borderColor: active ? "rgba(37,99,235,0.18)" : "rgba(15,23,42,0.08)",
    background: active ? "rgba(37,99,235,0.08)" : "rgba(248,250,252,0.92)",
  } as const;
}

const fieldStyle = {
  borderColor: "rgba(15,23,42,0.08)",
  background: "rgba(248,250,252,0.92)",
};

function parseAssistantEvents(raw: string) {
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
    extractJsonSegment(raw),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === "object") {
        if (Array.isArray((parsed as { events?: unknown[] }).events)) {
          return (parsed as { events: unknown[] }).events;
        }
        if (Array.isArray((parsed as { items?: unknown[] }).items)) {
          return (parsed as { items: unknown[] }).items;
        }
        if (Array.isArray((parsed as { data?: unknown[] }).data)) {
          return (parsed as { data: unknown[] }).data;
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error("invalid-calendar-events");
}

function extractJsonSegment(raw: string) {
  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return raw.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return raw.slice(objectStart, objectEnd + 1);
  }

  return raw;
}
