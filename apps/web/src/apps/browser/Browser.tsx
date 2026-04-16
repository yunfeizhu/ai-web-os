"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cookie,
  Globe,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { apiFetch, completeOnce } from "@/lib/backend";
import { useWindowStore } from "@/stores/windowStore";

const LIVE_BASE_FROM_ENV = (
  process.env.NEXT_PUBLIC_BROWSER_LIVE_BASE || ""
).replace(/\/$/, "");

interface BrowserProps {
  appState?: Record<string, unknown>;
  windowId: string;
}

interface BrowserRuntime {
  ready: boolean;
  error: string | null;
}

interface BrowserSessionSummary {
  id: string;
  current_url: string;
  current_title: string;
  created_at: string;
  updated_at: string;
  tab_count: number;
  last_error: string | null;
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  is_active: boolean;
}

interface BrowserSessionDetail extends BrowserSessionSummary {
  tabs: BrowserTab[];
}

interface ExtractResponse {
  title: string;
  url: string;
  content: string;
  truncated: boolean;
}

interface BrowserChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  events?: string[];
  status?: string;
  streaming?: boolean;
}

interface BrowserAutomationAction {
  action:
    | "navigate"
    | "click"
    | "type"
    | "type_text"
    | "press"
    | "wait_for"
    | "wheel";
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  timeout_ms?: number;
  delta_x?: number;
  delta_y?: number;
  press_enter?: boolean;
}

interface QuickBrowserCommandResult {
  actions: BrowserAutomationAction[];
  followupPrompt?: string;
}

interface BrowserAgentStepPlan {
  status: "continue" | "done" | "need_user";
  reply: string;
  action: BrowserAutomationAction | null;
}

function normalizeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isNoActiveTabError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message.includes("No active browser tab is available.");
}

function readChatMessages(value: unknown): BrowserChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id === "string" &&
      (candidate.role === "user" || candidate.role === "assistant") &&
      typeof candidate.content === "string"
    ) {
      return [
        {
          id: candidate.id,
          role: candidate.role,
          content: candidate.content,
          events: Array.isArray(candidate.events)
            ? candidate.events.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : undefined,
          status:
            typeof candidate.status === "string" ? candidate.status : undefined,
          streaming:
            typeof candidate.streaming === "boolean"
              ? candidate.streaming
              : undefined,
        } satisfies BrowserChatMessage,
      ];
    }
    return [];
  });
}

function formatBrowserErrorMessage(
  error: unknown,
  fallback = "浏览器操作失败。",
) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!raw.trim()) return fallback;

  const textMatch = raw.match(/get_by_text\("([^"]+)"\)/);
  const selectorMatch =
    raw.match(/selector[:=]\s*([^\n]+)/i) ||
    raw.match(/locator resolved to\s*<([^>]+)>/i);
  const target = textMatch?.[1] || selectorMatch?.[1] || "";

  if (raw.includes("Locator.click: Timeout")) {
    if (raw.includes("subtree intercepts pointer events")) {
      return target
        ? `点击失败：${target} 当前被其他元素遮挡，暂时无法点击。`
        : "点击失败：目标元素当前被其他内容遮挡，暂时无法点击。";
    }
    return target
      ? `点击失败：未能在页面稳定后点击 ${target}。`
      : "点击失败：页面在超时前没有进入可点击状态。";
  }

  if (raw.includes("Timeout") && raw.includes("wait")) {
    return "页面等待超时，目标内容可能还没有出现，或者页面还没有稳定下来。";
  }

  if (raw.includes("No session") || raw.includes("not found")) {
    return "当前浏览器会话已失效，请重新创建或切换会话后再试。";
  }

  if (raw.includes("navigation")) {
    return "打开页面失败，目标地址可能无法访问，或者页面加载超时。";
  }

  return raw.length > 160 ? `${raw.slice(0, 160)}...` : raw;
}

function parseBrowserAgentStep(raw: string): BrowserAgentStepPlan {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = fenced?.[1] ?? trimmed;
  const parsed = JSON.parse(payload) as {
    status?: string;
    reply?: string;
    action?: BrowserAutomationAction | null;
  };

  return {
    status:
      parsed.status === "continue" ||
      parsed.status === "need_user" ||
      parsed.status === "done"
        ? parsed.status
        : "done",
    reply: typeof parsed.reply === "string" ? parsed.reply : "",
    action:
      parsed.action && typeof parsed.action === "object" ? parsed.action : null,
  };
}
function resolveNavigationTarget(rawTarget: string) {
  const cleaned = rawTarget.trim().replace(/[。；;，,]+$/g, "");
  const knownTargets: Record<string, string> = {
    虎扑: "https://www.hupu.com",
    虎扑官网: "https://www.hupu.com",
    知乎: "https://www.zhihu.com",
    知乎官网: "https://www.zhihu.com",
    微博: "https://weibo.com",
    微博官网: "https://weibo.com",
    百度: "https://www.baidu.com",
    百度官网: "https://www.baidu.com",
    GitHub: "https://github.com",
    github: "https://github.com",
    github官网: "https://github.com",
    B站: "https://www.bilibili.com",
    b站: "https://www.bilibili.com",
    哔哩哔哩: "https://www.bilibili.com",
    哔哩哔哩官网: "https://www.bilibili.com",
    淘宝: "https://www.taobao.com",
    淘宝官网: "https://www.taobao.com",
    京东: "https://www.jd.com",
    京东官网: "https://www.jd.com",
  };

  if (knownTargets[cleaned]) return knownTargets[cleaned];
  if (
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(cleaned) ||
    /^[\w-]+\.[\w.-]+/.test(cleaned)
  ) {
    return cleaned;
  }
  return `https://www.baidu.com/s?wd=${encodeURIComponent(cleaned)}`;
}

function parseQuickBrowserCommand(
  input: string,
): QuickBrowserCommandResult | null {
  const command = input.trim();
  if (!command) return null;

  const openAndAskMatch = command.match(
    /^(?:打开|访问|进入)\s+(.+?)(?:[，。,\s]+|然后\s*|再\s*)(.+)$/,
  );
  if (openAndAskMatch) {
    return {
      actions: [
        {
          action: "navigate",
          url: resolveNavigationTarget(openAndAskMatch[1].trim()),
        },
        { action: "wait_for", timeout_ms: 1800 },
      ],
      followupPrompt: openAndAskMatch[2].trim(),
    };
  }

  const openMatch = command.match(/^(?:打开|访问|进入)\s+(.+)$/);
  if (openMatch) {
    return {
      actions: [
        {
          action: "navigate",
          url: resolveNavigationTarget(openMatch[1].trim()),
        },
      ],
    };
  }

  const clickMatch = command.match(/^(?:点击|点开|点一下)\s+(.+)$/);
  if (clickMatch) {
    return {
      actions: [{ action: "click", selector: `text=${clickMatch[1].trim()}` }],
    };
  }

  const typeTextMatch = command.match(/^输入\s+(.+?)(并回车)?$/);
  if (typeTextMatch) {
    const actions: BrowserAutomationAction[] = [
      { action: "type_text", text: typeTextMatch[1].trim() },
    ];
    if (typeTextMatch[2]) {
      actions.push({ action: "press", key: "Enter" });
    }
    return { actions };
  }

  if (/^(?:按回车|回车|enter)$/i.test(command)) {
    return { actions: [{ action: "press", key: "Enter" }] };
  }

  if (/^(?:按tab|tab)$/i.test(command)) {
    return { actions: [{ action: "press", key: "Tab" }] };
  }

  if (/^(?:按esc|esc|escape)$/i.test(command)) {
    return { actions: [{ action: "press", key: "Escape" }] };
  }

  if (/^(?:向下滚动|下滑|往下滚|下滚一点)$/.test(command)) {
    return { actions: [{ action: "wheel", delta_y: 900 }] };
  }

  if (/^(?:向上滚动|上滑|往上滚|上滚一点)$/.test(command)) {
    return { actions: [{ action: "wheel", delta_y: -900 }] };
  }

  const waitMatch = command.match(/^(?:等待|等)\s*(\d+)\s*秒$/);
  if (waitMatch) {
    return {
      actions: [
        { action: "wait_for", timeout_ms: Number(waitMatch[1]) * 1000 },
      ],
    };
  }

  return null;
}

function formatSelectorLabel(selector?: string | null) {
  if (!selector) return "页面元素";
  if (selector.startsWith("text=")) {
    return selector.slice(5).trim() || "页面文本";
  }
  return selector;
}

function describeBrowserAction(action: BrowserAutomationAction) {
  switch (action.action) {
    case "navigate":
      return `正在打开 ${action.url ?? "目标页面"}`;
    case "click":
      return `正在点击 ${formatSelectorLabel(action.selector)}`;
    case "type":
      return `正在向 ${formatSelectorLabel(action.selector)} 输入内容`;
    case "type_text":
      return "正在把内容输入到当前焦点区域";
    case "press":
      return `正在按下 ${action.key ?? "Enter"}`;
    case "wait_for":
      return action.selector
        ? `正在等待 ${formatSelectorLabel(action.selector)} 出现`
        : "正在等待页面稳定下来";
    case "wheel":
      return (action.delta_y ?? 0) >= 0 ? "正在向下滚动页面" : "正在向上滚动页面";
    default:
      return "正在执行网页操作";
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function Browser({ appState, windowId }: BrowserProps) {
  const updateAppState = useWindowStore((state) => state.updateAppState);

  const [runtime, setRuntime] = useState<BrowserRuntime>({
    ready: false,
    error: null,
  });
  const [sessions, setSessions] = useState<BrowserSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(
    typeof appState?.activeSessionId === "string"
      ? appState.activeSessionId
      : "",
  );
  const [detail, setDetail] = useState<BrowserSessionDetail | null>(null);
  const [urlInput, setUrlInput] = useState(
    typeof appState?.urlInput === "string" ? appState.urlInput : "",
  );
  const [chatMessages, setChatMessages] = useState<BrowserChatMessage[]>(
    readChatMessages(appState?.chatMessages),
  );
  const [chatInput, setChatInput] = useState(
    typeof appState?.chatInput === "string" ? appState.chatInput : "",
  );
  const [summaryError, setSummaryError] = useState(
    typeof appState?.summaryError === "string" ? appState.summaryError : "",
  );
  const [chatLoading, setChatLoading] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [viewportFocused, setViewportFocused] = useState(false);
  const [preciseControl, setPreciseControl] = useState(
    typeof appState?.preciseControl === "boolean"
      ? appState.preciseControl
      : false,
  );
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
  const [cookieImportMode, setCookieImportMode] = useState<"header" | "json">(
    "header",
  );
  const [cookieSiteUrl, setCookieSiteUrl] = useState("");
  const [cookieHeader, setCookieHeader] = useState("");
  const [cookieJsonInput, setCookieJsonInput] = useState("");
  const [cookieLoading, setCookieLoading] = useState(false);
  const isEditingUrlRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    updateAppState(windowId, {
      activeSessionId,
      chatInput,
      chatMessages,
      preciseControl,
      summaryError,
      urlInput,
    });
  }, [
    activeSessionId,
    chatInput,
    chatMessages,
    preciseControl,
    summaryError,
    updateAppState,
    urlInput,
    windowId,
  ]);

  useEffect(() => {
    const container = chatScrollRef.current;
    const bottom = chatBottomRef.current;
    if (!container || !bottom) return;

    bottom.scrollIntoView({
      behavior: chatLoading ? "smooth" : "auto",
      block: "end",
    });
  }, [chatLoading, chatMessages]);

  const liveBase = useMemo(() => {
    if (LIVE_BASE_FROM_ENV) return LIVE_BASE_FROM_ENV;
    if (typeof window === "undefined") return "http://localhost:16080";
    return `${window.location.protocol}//${window.location.hostname}:16080`;
  }, []);

  const liveUrl = useMemo(() => {
    if (!activeSessionId) return "";
    const apiBase =
      typeof window === "undefined"
        ? "http://localhost:18100"
        : `${window.location.protocol}//${window.location.hostname}:18100`;
    return `${liveBase}/embedded_vnc.html?autoconnect=1&scale=${preciseControl ? 0 : 1}&precise=${preciseControl ? 1 : 0}&path=websockify&reconnect=1&session_id=${encodeURIComponent(activeSessionId)}&api_base=${encodeURIComponent(apiBase)}`;
  }, [activeSessionId, liveBase, preciseControl]);

  const updateChatMessage = (
    messageId: string,
    updater: (message: BrowserChatMessage) => BrowserChatMessage,
  ) => {
    setChatMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
    );
  };

  const setAssistantStatus = (messageId: string, status: string) => {
    updateChatMessage(messageId, (message) => ({
      ...message,
      status,
    }));
  };

  const pushAssistantEvent = (messageId: string, event: string) => {
    updateChatMessage(messageId, (message) => ({
      ...message,
      events: [...(message.events ?? []), event],
    }));
  };

  const appendAssistantContent = (messageId: string, chunk: string) => {
    if (!chunk) return;
    updateChatMessage(messageId, (message) => ({
      ...message,
      content: `${message.content}${chunk}`,
    }));
  };

  const finalizeAssistantMessage = (
    messageId: string,
    status: string,
    streaming = false,
  ) => {
    updateChatMessage(messageId, (message) => ({
      ...message,
      status,
      streaming,
    }));
  };

  const streamAssistantText = async (messageId: string, text: string) => {
    const normalized = text.trim();
    if (!normalized) return;

    const prefix = (current: string) =>
      current.trim().length > 0 ? "\n\n" : "";

    updateChatMessage(messageId, (message) => ({
      ...message,
      content: `${message.content}${prefix(message.content)}`,
    }));

    const chunkSize = normalized.length > 180 ? 6 : 3;
    for (let index = 0; index < normalized.length; index += chunkSize) {
      appendAssistantContent(
        messageId,
        normalized.slice(index, index + chunkSize),
      );
      await sleep(18);
    }
  };

  const syncUrlInput = (nextUrl: string, force = false) => {
    if (force || !isEditingUrlRef.current) {
      setUrlInput(nextUrl);
    }
  };

  const openCookieDialog = () => {
    const nextSiteUrl =
      detail?.current_url && detail.current_url !== "about:blank"
        ? detail.current_url
        : urlInput.trim();
    setCookieImportMode("header");
    setCookieSiteUrl(nextSiteUrl);
    setCookieHeader("");
    setCookieJsonInput("");
    setCookieDialogOpen(true);
  };

  const closeCookieDialog = () => {
    if (cookieLoading) return;
    setCookieDialogOpen(false);
  };

  const handleImportCookieHeader = async () => {
    if (!activeSessionId) {
      setSummaryError("请先创建一个浏览器会话，再导入 Cookie。");
      return;
    }

    if (!cookieSiteUrl.trim() || !cookieHeader.trim()) {
      setSummaryError("请输入站点地址和 Cookie 字符串。");
      return;
    }

    setCookieLoading(true);
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/cookies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            site_url: cookieSiteUrl.trim(),
            cookie_header: cookieHeader.trim(),
          }),
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
      setCookieDialogOpen(false);
      setCookieHeader("");
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "导入 Cookie 失败。",
      );
    } finally {
      setCookieLoading(false);
    }
  };

  const handleImportCookieJson = async () => {
    if (!activeSessionId) {
      setSummaryError("请先创建一个浏览器会话，再导入 Cookie。");
      return;
    }

    if (!cookieSiteUrl.trim() || !cookieJsonInput.trim()) {
      setSummaryError("请输入站点地址和 Cookie JSON。");
      return;
    }

    let cookieJsonPayload: unknown;
    try {
      cookieJsonPayload = JSON.parse(cookieJsonInput.trim());
    } catch {
      setSummaryError("Cookie JSON 格式不完整，请检查后再试。");
      return;
    }

    setCookieLoading(true);
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/cookies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            site_url: cookieSiteUrl.trim(),
            cookie_header: null,
            cookie_json: cookieJsonPayload,
          }),
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
      setCookieDialogOpen(false);
      setCookieJsonInput("");
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "导入 Cookie 失败。",
      );
    } finally {
      setCookieLoading(false);
    }
  };

  const loadRuntime = async () => {
    setRuntimeLoading(true);
    try {
      const data = await apiFetch<BrowserRuntime>("/browser/runtime");
      setRuntime(data);
    } catch (error) {
      setRuntime({
        ready: false,
        error:
          error instanceof Error ? error.message : "浏览器运行时状态获取失败。",
      });
    } finally {
      setRuntimeLoading(false);
    }
  };

  const loadSessions = async () => {
    try {
      const data = await apiFetch<BrowserSessionSummary[]>("/browser/sessions");
      setSessions(data);

      if (data.length === 0) {
        setActiveSessionId("");
        setDetail(null);
        syncUrlInput("", true);
        return;
      }

      if (!activeSessionId || !data.some((item) => item.id === activeSessionId)) {
        setActiveSessionId(data[0].id);
        syncUrlInput(data[0].current_url || "", true);
      }
    } catch {}
  };

  const loadDetail = async (sessionId: string) => {
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${sessionId}`,
      );
      setDetail(data);
      syncUrlInput(data.current_url || "");
    } catch (error) {
      if (isNoActiveTabError(error)) {
        try {
          await sleep(280);
          const retryData = await apiFetch<BrowserSessionDetail>(
            `/browser/sessions/${sessionId}`,
          );
          setDetail(retryData);
          syncUrlInput(retryData.current_url || "");
          return;
        } catch (retryError) {
          if (isNoActiveTabError(retryError)) {
            return;
          }
          error = retryError;
        }
      }
      setDetail(null);
      setSummaryError(
        error instanceof Error ? error.message : "浏览器会话读取失败。",
      );
    }
  };

  useEffect(() => {
    void loadRuntime();
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadDetail(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSessions();
      if (activeSessionId) {
        void loadDetail(activeSessionId);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeSessionId]);

  const fetchPageText = async (sessionId: string, maxChars = 4000) => {
    return apiFetch<ExtractResponse>(`/browser/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_chars: maxChars }),
    });
  };

  const fetchBrowserState = async (sessionId: string) => {
    const response = await apiFetch<{ state: string }>(
      `/browser/sessions/${sessionId}/state`,
    );
    return response.state;
  };

  const readSessionContext = async (sessionId: string) => {
    return fetchPageText(sessionId, 4000);
  };

  const runSessionAction = async (path: "back" | "forward" | "reload") => {
    if (!activeSessionId) return;
    setReloading(true);
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/${path}`,
        {
          method: "POST",
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "浏览器操作失败。",
      );
    } finally {
      setReloading(false);
    }
  };

  const handleCreateSession = async () => {
    setCreating(true);
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>("/browser/sessions", {
        method: "POST",
      });
      setActiveSessionId(data.id);
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "创建浏览器会话失败。",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleNavigate = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!activeSessionId) return;

    const normalized = normalizeUrl(urlInput);
    if (!normalized) return;

    setNavigating(true);
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/navigate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: normalized }),
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || normalized, true);
      await loadSessions();
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "网页打开失败。",
      );
    } finally {
      setNavigating(false);
    }
  };
  const handleActivateTab = async (tabId: string) => {
    if (!activeSessionId) return;
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/activate-tab`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tab_id: tabId }),
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "切换标签页失败。",
      );
    }
  };

  const handleCreateTab = async () => {
    if (!activeSessionId) return;
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/tabs`,
        {
          method: "POST",
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "新建标签页失败。",
      );
    }
  };

  const handleCloseTab = async (tabId: string) => {
    if (!activeSessionId) return;
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${activeSessionId}/tabs/${tabId}`,
        {
          method: "DELETE",
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "关闭标签页失败。",
      );
    }
  };

  const handleSelectSession = async (session: BrowserSessionSummary) => {
    setActiveSessionId(session.id);
    syncUrlInput(session.current_url || "", true);
    setSummaryError("");
    try {
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${session.id}/focus`,
        {
          method: "POST",
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "Browser session focus failed.",
      );
    }
  };

  const handleCloseSession = async () => {
    if (!activeSessionId) return;
    setClosing(true);
    setSummaryError("");
    try {
      await apiFetch(`/browser/sessions/${activeSessionId}`, {
        method: "DELETE",
      });
      setActiveSessionId("");
      setDetail(null);
      syncUrlInput("", true);
      await loadSessions();
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "关闭浏览器会话失败。",
      );
    } finally {
      setClosing(false);
    }
  };

  const executeAutomationAction = async (
    sessionId: string,
    action: BrowserAutomationAction,
  ) => {
    try {
      switch (action.action) {
        case "navigate":
          if (!action.url) throw new Error("缺少导航地址。");
          await apiFetch(`/browser/sessions/${sessionId}/navigate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: normalizeUrl(action.url) }),
          });
          return `已打开 ${action.url}`;
        case "click":
          await apiFetch(`/browser/sessions/${sessionId}/click`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selector: action.selector ?? null,
              timeout_ms: action.timeout_ms ?? 10000,
            }),
          });
          return action.selector
            ? `已点击 ${action.selector}`
            : "已点击页面元素";
        case "type":
          await apiFetch(`/browser/sessions/${sessionId}/type`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selector: action.selector ?? null,
              text: action.text ?? "",
              press_enter: Boolean(action.press_enter),
              timeout_ms: action.timeout_ms ?? 10000,
            }),
          });
          return action.selector
            ? `已在 ${action.selector} 输入内容`
            : "已输入内容";
        case "type_text":
          await apiFetch(`/browser/sessions/${sessionId}/type-text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: action.text ?? "" }),
          });
          return `已输入 ${action.text ?? ""}`;
        case "press":
          await apiFetch(`/browser/sessions/${sessionId}/press`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: action.key ?? "Enter" }),
          });
          return `已按下 ${action.key ?? "Enter"}`;
        case "wait_for":
          await apiFetch(`/browser/sessions/${sessionId}/wait`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selector: action.selector ?? null,
              timeout_ms: action.timeout_ms ?? 10000,
            }),
          });
          return action.selector
            ? `已等待 ${action.selector}`
            : "已等待页面稳定";
        case "wheel":
          await apiFetch(`/browser/sessions/${sessionId}/wheel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              delta_x: action.delta_x ?? 0,
              delta_y: action.delta_y ?? 0,
            }),
          });
          return `已滚动页面 (${action.delta_x ?? 0}, ${action.delta_y ?? 0})`;
        default:
          throw new Error("不支持的浏览器动作。");
      }
    } catch (error) {
      throw new Error(formatBrowserErrorMessage(error));
    }
  };

  const runBrowserTaskAgent = async (
    sessionId: string,
    goal: string,
    callbacks?: {
      onStatus?: (status: string) => void;
      onActionStart?: (message: string) => void;
      onActionFinish?: (message: string) => void;
    },
  ) => {
    let finalReply = "";
    const stepLogs: string[] = [];

    callbacks?.onStatus?.("正在读取当前页面");

    for (let step = 1; step <= 6; step += 1) {
      callbacks?.onStatus?.(`正在规划第 ${step} 步`);
      const browserState = await fetchBrowserState(sessionId);
      const pageContext = await readSessionContext(sessionId);
      const planResult = await completeOnce(
        [
          "你是一个浏览器任务代理，需要在真实浏览器中逐步完成用户目标。",
          `用户目标：${goal}`,
          `当前步骤：${step}/6`,
          stepLogs.length > 0
            ? `已执行步骤：\n${stepLogs.join("\n")}`
            : "已执行步骤：暂无",
          "",
          "当前页面状态 JSON：",
          browserState,
          "",
          "当前页面正文预览：",
          pageContext.content,
          "",
          "请只输出 JSON，不要输出 Markdown，不要输出解释。",
          "JSON 结构：",
          '{"status":"continue|done|need_user","reply":"给用户看的中文说明","action":{"action":"navigate|click|type|type_text|press|wait_for|wheel","url":"可选","selector":"可选","text":"可选","key":"可选","timeout_ms":10000,"delta_x":0,"delta_y":900,"press_enter":false}}',
          "",
          "规则：",
          '1. 如果要点文本按钮或链接，selector 优先写成 "text=文字"。',
          "2. 每次只给一个 action。",
          "3. 如果任务已经完成，status=done，action=null。",
          "4. 如果遇到登录、验证码、支付、人工确认等，status=need_user。",
          "5. 如果页面正文里已经能回答用户问题，也可以直接 done。",
        ].join("\n"),
        "你是 AI-Native OS 的浏览器任务代理。目标是安全、稳妥地完成网页任务。",
      );

      const plan = parseBrowserAgentStep(planResult.content);
      if (
        plan.status === "done" ||
        plan.status === "need_user" ||
        !plan.action
      ) {
        finalReply = plan.reply.trim();
        if (plan.status === "need_user") {
          callbacks?.onStatus?.("需要你补充信息后我才能继续");
        }
        break;
      }

      callbacks?.onActionStart?.(
        `第 ${step} 步 · ${describeBrowserAction(plan.action)}`,
      );
      const actionMessage = await executeAutomationAction(sessionId, plan.action);
      stepLogs.push(`${step}. ${actionMessage}`);
      callbacks?.onActionFinish?.(actionMessage);
      callbacks?.onStatus?.("正在同步最新页面状态");
      await loadDetail(sessionId);
      await loadSessions();
    }

    if (!finalReply) {
      finalReply =
        "我已经执行了一轮浏览器任务，但还没拿到明确结论。你可以再补一句更具体的目标，或者让我继续。";
    }

    return finalReply;
  };

  const handleAskPage = async () => {
    const content = chatInput.trim();
    if (!content) return;

    if (!activeSessionId) {
      setSummaryError("请先创建一个浏览器会话，再通过对话控制网页。");
      return;
    }
    const userMessage: BrowserChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };
    const assistantId = `assistant-${Date.now()}`;

    setChatMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        events: [],
        status: "正在理解你的请求",
        streaming: true,
      },
    ]);
    setChatInput("");
    setChatLoading(true);
    setSummaryError("");

    try {
      const quickCommand = parseQuickBrowserCommand(content);
      let assistantReply = "";

      if (quickCommand?.actions.length) {
        setAssistantStatus(assistantId, "正在执行快捷网页操作");
        for (const action of quickCommand.actions) {
          pushAssistantEvent(assistantId, describeBrowserAction(action));
          const actionMessage = await executeAutomationAction(activeSessionId, action);
          pushAssistantEvent(assistantId, actionMessage);
        }
        setAssistantStatus(assistantId, "正在刷新页面状态");
        await loadDetail(activeSessionId);
        await loadSessions();

        assistantReply = quickCommand.followupPrompt
          ? await runBrowserTaskAgent(activeSessionId, quickCommand.followupPrompt, {
              onStatus: (status) => setAssistantStatus(assistantId, status),
              onActionStart: (message) => pushAssistantEvent(assistantId, message),
              onActionFinish: (message) => pushAssistantEvent(assistantId, message),
            })
          : "已完成网页操作。";
      } else {
        assistantReply = await runBrowserTaskAgent(activeSessionId, content, {
          onStatus: (status) => setAssistantStatus(assistantId, status),
          onActionStart: (message) => pushAssistantEvent(assistantId, message),
          onActionFinish: (message) => pushAssistantEvent(assistantId, message),
        });
      }

      setAssistantStatus(assistantId, "正在整理回复");
      await streamAssistantText(assistantId, assistantReply);
      finalizeAssistantMessage(assistantId, "本轮任务已完成");
    } catch (error) {
      const errorMessage = formatBrowserErrorMessage(error, "网页任务执行失败。");
      updateChatMessage(assistantId, (message) => ({
        ...message,
        status: "执行失败",
        content: message.content.trim()
          ? `${message.content}\n\n${errorMessage}`
          : errorMessage,
        streaming: false,
      }));
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, rgba(246,248,252,0.98) 0%, rgba(235,241,248,0.98) 100%)",
        color: "#172033",
      }}
    >
      <div
        className="border-b px-4 py-2.5"
        style={{
          borderColor: "rgba(18, 30, 56, 0.08)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(243,247,251,0.96) 100%)",
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div
            className="flex items-center gap-2.5 text-[12px]"
            style={{ color: "#60708f" }}
          >
            <span
              className="font-medium tracking-[0.06em]"
              style={{ color: "#24324a" }}
            >
              浏览器
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
              style={{
                background: runtime.ready
                  ? "rgba(34, 197, 94, 0.12)"
                  : "rgba(255, 159, 10, 0.12)",
                color: runtime.ready ? "#0a8f4d" : "#b86a00",
              }}
            >
              <Monitor size={12} />
              {runtime.ready ? "在线" : "未连接"}
            </span>
            {runtimeLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreciseControl((current) => !current)}
              title={
                preciseControl
                  ? "已开启精准点击，更适合点小按钮和表单"
                  : "开启后点击定位会更准确，适合处理细小控件"
              }
              className="inline-flex h-9 items-center justify-center rounded-2xl px-3 text-[13px]"
              style={{
                background: preciseControl
                  ? "rgba(17, 92, 214, 0.12)"
                  : "rgba(255,255,255,0.82)",
                color: preciseControl ? "#0f56cf" : "#4c5d79",
                border: "1px solid rgba(18, 30, 56, 0.08)",
              }}
            >
              {preciseControl ? "精准点击开" : "精准点击"}
            </button>
            <button
              type="button"
              onClick={() => void loadRuntime()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl px-3 text-[13px]"
              style={{
                background: "rgba(17, 92, 214, 0.08)",
                color: "#0f56cf",
              }}
            >
              <RefreshCw size={13} />
              刷新状态
            </button>
            <button
              type="button"
              onClick={openCookieDialog}
              disabled={!activeSessionId}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl px-3 text-[13px]"
              style={{
                background: "rgba(15, 23, 42, 0.06)",
                color: activeSessionId ? "#4c5d79" : "#9ba8bd",
                border: "1px solid rgba(18, 30, 56, 0.08)",
              }}
            >
              <Cookie size={13} />
              导入 Cookie
            </button>
            <button
              type="button"
              onClick={() => void handleCreateSession()}
              disabled={!runtime.ready || creating}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl px-3 text-[13px] font-medium"
              style={{
                background: "linear-gradient(135deg, #1677ff 0%, #0a57d6 100%)",
                color: "#fff",
                opacity: !runtime.ready || creating ? 0.6 : 1,
              }}
            >
              {creating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} />
              )}
              {creating ? "创建中…" : "新建会话"}
            </button>
          </div>
        </div>

        {runtime.error ? (
          <div
            className="mb-3 rounded-2xl px-3 py-3 text-[13px] leading-6"
            style={{ background: "rgba(255, 159, 10, 0.12)", color: "#b86a00" }}
          >
            {runtime.error}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runSessionAction("back")}
            disabled={!activeSessionId || reloading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border"
            style={{
              borderColor: "rgba(18, 30, 56, 0.08)",
              background: "rgba(255,255,255,0.96)",
              color: activeSessionId ? "#1f2a44" : "#a2aec3",
            }}
          >
            <ArrowLeft size={16} />
          </button>

          <button
            type="button"
            onClick={() => void runSessionAction("forward")}
            disabled={!activeSessionId || reloading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border"
            style={{
              borderColor: "rgba(18, 30, 56, 0.08)",
              background: "rgba(255,255,255,0.96)",
              color: activeSessionId ? "#1f2a44" : "#a2aec3",
            }}
          >
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            onClick={() => void runSessionAction("reload")}
            disabled={!activeSessionId || reloading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border"
            style={{
              borderColor: "rgba(18, 30, 56, 0.08)",
              background: "rgba(255,255,255,0.96)",
              color: activeSessionId ? "#1f2a44" : "#a2aec3",
            }}
          >
            {reloading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
          </button>
          <form
            onSubmit={handleNavigate}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <div
              className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3"
              style={{
                borderColor: "rgba(18, 30, 56, 0.08)",
                background: "rgba(255,255,255,0.98)",
              }}
            >
              <Globe size={15} style={{ color: "#7a88a5", flexShrink: 0 }} />
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                onFocus={() => {
                  isEditingUrlRef.current = true;
                }}
                onBlur={() => {
                  isEditingUrlRef.current = false;
                  syncUrlInput(detail?.current_url || "");
                }}
                placeholder={
                  activeSessionId
                    ? "输入网址，例如 example.com"
                    : "先新建浏览器会话"
                }
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                style={{ color: "#172033" }}
                disabled={!activeSessionId}
              />
            </div>
            <button
              type="submit"
              disabled={!activeSessionId || navigating}
              className="inline-flex h-10 items-center justify-center rounded-2xl px-4 text-[13px] font-medium"
              style={{
                background: "linear-gradient(135deg, #1677ff 0%, #0a57d6 100%)",
                color: "#fff",
                opacity: !activeSessionId || navigating ? 0.65 : 1,
              }}
            >
              {navigating ? "打开中…" : "前往"}
            </button>
          </form>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3">
        <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
            {sessions.length > 1 ? (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void handleSelectSession(session)}
                    className="inline-flex h-8 shrink-0 items-center rounded-full px-3 text-left text-[12px] transition-all"
                    style={{
                      background:
                        session.id === activeSessionId
                          ? "linear-gradient(135deg, rgba(20,101,255,0.18) 0%, rgba(86,143,255,0.18) 100%)"
                          : "rgba(255,255,255,0.76)",
                      color:
                        session.id === activeSessionId ? "#0f56cf" : "#55637f",
                      border: "1px solid rgba(18, 30, 56, 0.08)",
                      boxShadow:
                        session.id === activeSessionId
                          ? "0 10px 24px rgba(20,101,255,0.14)"
                          : "0 8px 18px rgba(21,33,57,0.04)",
                    }}
                  >
                    <span
                      className="mr-2 h-1.5 w-1.5 rounded-full"
                      style={{
                        background:
                          session.id === activeSessionId ? "#1677ff" : "#94a3b8",
                      }}
                    />
                    <span className="max-w-[160px] truncate font-medium">
                      {session.current_title || `会话 ${session.id.slice(0, 8)}`}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div
              className="relative min-h-0 flex-1 overflow-hidden rounded-[30px] border"
              style={{
                borderColor: "rgba(18, 30, 56, 0.08)",
                background:
                  "radial-gradient(circle at top left, rgba(80,138,255,0.12) 0%, rgba(255,255,255,0.96) 28%, rgba(241,246,252,0.98) 100%)",
                boxShadow: "0 26px 60px rgba(33, 48, 76, 0.14)",
              }}
            >
              {activeSessionId && detail ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div
                    className="flex shrink-0 items-end justify-between gap-2 border-b px-2.5 pt-1.5 pb-0"
                    style={{
                      borderColor: "rgba(18, 30, 56, 0.08)",
                      background:
                        "linear-gradient(180deg, rgba(252,253,255,0.96) 0%, rgba(244,247,252,0.92) 100%)",
                      backdropFilter: "blur(18px)",
                    }}
                  >
                    <div className="min-w-0 flex flex-1 items-end gap-1 overflow-x-auto pb-0.5">
                      {detail.tabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => void handleActivateTab(tab.id)}
                          className="group relative max-w-[220px] shrink-0 rounded-t-[12px] px-3 py-1.5 text-left text-[12px]"
                          style={{
                            background: tab.is_active
                              ? "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,252,255,0.98) 100%)"
                              : "linear-gradient(180deg, rgba(233,239,247,0.95) 0%, rgba(225,232,242,0.92) 100%)",
                            color: tab.is_active ? "#1f2a44" : "#60708f",
                            border: "1px solid rgba(18, 30, 56, 0.08)",
                            borderBottomColor: tab.is_active
                              ? "rgba(255,255,255,0.96)"
                              : "rgba(18, 30, 56, 0.08)",
                            boxShadow: tab.is_active
                              ? "0 10px 18px rgba(21,33,57,0.08)"
                              : "none",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1 truncate font-medium">
                              {tab.title || "未命名标签页"}
                            </div>
                            <span
                              role="button"
                              aria-label="关闭标签页"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (detail.tabs.length <= 1) return;
                                void handleCloseTab(tab.id);
                              }}
                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                              style={{
                                color: "rgba(96, 112, 143, 0.9)",
                                opacity: detail.tabs.length > 1 ? 0.9 : 0.4,
                                cursor:
                                  detail.tabs.length > 1 ? "pointer" : "not-allowed",
                              }}
                            >
                              <X size={11} />
                            </span>
                          </div>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => void handleCreateTab()}
                        className="mb-[1px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
                        style={{
                          borderColor: "rgba(18, 30, 56, 0.08)",
                          background: "rgba(255,255,255,0.8)",
                          color: "#60708f",
                        }}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleCloseSession()}
                      disabled={closing}
                      className="mb-1 inline-flex h-7 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-medium"
                      style={{
                        background: "rgba(239, 68, 68, 0.08)",
                        color: "#d83939",
                        opacity: closing ? 0.65 : 1,
                      }}
                    >
                      {closing ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      关闭
                    </button>
                  </div>

                  <div
                    className="min-h-0 flex-1 p-2"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(241,245,250,0.95) 0%, rgba(235,240,247,0.95) 100%)",
                    }}
                  >
                    <div
                      className="h-full overflow-hidden rounded-[20px]"
                      style={{
                        background: "#ffffff",
                        boxShadow: viewportFocused
                          ? "0 0 0 2px rgba(22, 119, 255, 0.22), 0 22px 44px rgba(21, 33, 57, 0.16)"
                          : "0 22px 44px rgba(21, 33, 57, 0.12)",
                      }}
                    >
                      {liveUrl ? (
                        <iframe
                          key={activeSessionId}
                          src={liveUrl}
                          title="Live Browser Control"
                          className="h-full w-full border-0"
                          style={{ background: "#f8fafc", display: "block" }}
                          onLoad={() => setViewportFocused(false)}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                  <Monitor size={34} style={{ color: "#7a88a5" }} />
                  <div
                    className="text-[16px] font-semibold"
                    style={{ color: "#172033" }}
                  >
                    还没有打开浏览器
                  </div>
                  <p
                    className="max-w-[420px] text-[13px] leading-6"
                    style={{ color: "#6e7c98" }}
                  >
                    点击下面的按钮后，会启动一个真实浏览器。打开成功后，这里会显示浏览器画面，你也可以直接在右侧让 AI 帮你操作网页。
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCreateSession()}
                      disabled={!runtime.ready || creating}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl px-4 text-[13px] font-medium"
                      style={{
                        background:
                          "linear-gradient(135deg, #1677ff 0%, #0a57d6 100%)",
                        color: "#fff",
                        opacity: !runtime.ready || creating ? 0.6 : 1,
                      }}
                    >
                      {creating ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Plus size={14} />
                      )}
                      {creating ? "打开中…" : "打开浏览器"}
                    </button>
                    {!runtime.ready ? (
                      <button
                        type="button"
                        onClick={() => void loadRuntime()}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl px-4 text-[13px]"
                        style={{
                          background: "rgba(17, 92, 214, 0.08)",
                          color: "#0f56cf",
                        }}
                      >
                        <RefreshCw size={14} />
                        刷新状态
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="min-h-0 min-w-0">
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border"
              style={{
                borderColor: "rgba(15, 23, 42, 0.08)",
                background:
                  "linear-gradient(180deg, rgba(250,252,255,0.92) 0%, rgba(244,247,252,0.9) 100%)",
                backdropFilter: "blur(28px)",
                boxShadow:
                  "0 28px 60px rgba(16, 24, 40, 0.14), inset 0 1px 0 rgba(255,255,255,0.75)",
              }}
            >
              <div
                className="shrink-0 border-b px-4 py-3"
                style={{
                  borderColor: "rgba(15, 23, 42, 0.08)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(247,250,255,0.4) 100%)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center">
                    <div className="min-w-0">
                      <div
                        className="truncate text-[13px] font-semibold tracking-[0.08em]"
                        style={{ color: "#1e293b" }}
                      >
                        浏览器助手
                      </div>
                      <div className="truncate text-[11px]" style={{ color: "#7c8aa5" }}>
                        用对话驱动真实浏览器
                      </div>
                    </div>
                  </div>
                  <div
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      background: activeSessionId
                        ? "rgba(16, 185, 129, 0.1)"
                        : "rgba(148, 163, 184, 0.14)",
                      color: activeSessionId ? "#0f8c68" : "#64748b",
                    }}
                  >
                    {activeSessionId ? "已连接" : "未连接"}
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div
                  className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border"
                  style={{
                    borderColor: "rgba(15, 23, 42, 0.08)",
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(248,250,255,0.76) 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.85), 0 16px 34px rgba(148, 163, 184, 0.14)",
                  }}
                >
                  <div
                    ref={chatScrollRef}
                    className="browser-chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2.5"
                  >
                    <div className="min-w-0 space-y-3">
                      {chatMessages.length > 0 ? (
                        chatMessages.map((message) =>
                          message.role === "user" ? (
                            <div
                              key={message.id}
                              className="min-w-0 flex justify-end gap-2.5"
                            >
                              <div
                                className="min-w-0 max-w-[76%] rounded-[18px] px-3.5 py-2.5"
                                style={{
                                  background:
                                    "linear-gradient(180deg, rgba(218,231,255,0.96) 0%, rgba(204,222,255,0.92) 100%)",
                                  border: "1px solid rgba(96, 141, 255, 0.18)",
                                  boxShadow:
                                    "0 12px 24px rgba(111, 145, 204, 0.16), inset 0 1px 0 rgba(255,255,255,0.68)",
                                }}
                              >
                                <div
                                  className="whitespace-pre-wrap break-words text-[13px] leading-6"
                                  style={{
                                    color: "#1c5fd4",
                                    overflowWrap: "anywhere",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {message.content}
                                </div>
                              </div>
                              <div
                                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                                style={{
                                  background:
                                    "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(226,237,255,0.92) 100%)",
                                  border: "1px solid rgba(96, 141, 255, 0.18)",
                                  boxShadow:
                                    "0 10px 18px rgba(111, 145, 204, 0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
                                  color: "#4f7fe8",
                                }}
                              >
                                <UserRound size={14} strokeWidth={1.9} />
                              </div>
                            </div>
                          ) : (
                            <div key={message.id} className="min-w-0 flex gap-2.5">
                              <div
                                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px]"
                                style={{
                                  background:
                                    "radial-gradient(circle at top left, rgba(137,180,255,0.95) 0%, rgba(92,135,233,0.92) 45%, rgba(64,105,204,0.96) 100%)",
                                  border: "1px solid rgba(78, 119, 213, 0.18)",
                                  boxShadow:
                                    "0 12px 20px rgba(78, 119, 213, 0.22), inset 0 1px 0 rgba(255,255,255,0.24)",
                                  color: "#ffffff",
                                }}
                              >
                                <Sparkles size={14} strokeWidth={1.9} />
                              </div>
                              <div
                                className="min-w-0 flex-1 rounded-[18px] border px-3.5 py-3"
                                style={{
                                  borderColor: "rgba(15, 23, 42, 0.08)",
                                  background:
                                    "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(247,249,253,0.92) 100%)",
                                  boxShadow:
                                    "0 16px 28px rgba(148, 163, 184, 0.16), inset 0 1px 0 rgba(255,255,255,0.88)",
                                }}
                              >
                                <div className="flex min-w-0 items-center justify-between gap-3">
                                  <div
                                    className="min-w-0 truncate text-[10px] uppercase tracking-[0.08em]"
                                    style={{ color: "#8090aa" }}
                                  >
                                    浏览器助手
                                  </div>
                                  {message.status ? (
                                    <div
                                      className="shrink-0 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium"
                                      style={{
                                        background: message.streaming
                                          ? "rgba(59, 130, 246, 0.1)"
                                          : "rgba(148, 163, 184, 0.14)",
                                        color: message.streaming ? "#2563eb" : "#64748b",
                                      }}
                                    >
                                      {message.streaming ? (
                                        <span
                                          className="browser-agent-pulse h-1.5 w-1.5 rounded-full"
                                          style={{ background: "currentColor" }}
                                        />
                                      ) : null}
                                      {message.status}
                                    </div>
                                  ) : null}
                                </div>

                                {message.events?.length ? (
                                  <div
                                    className="mt-3 min-w-0 rounded-[16px] border px-2.5 py-2.5"
                                    style={{
                                      borderColor: "rgba(96, 165, 250, 0.14)",
                                      background:
                                        "linear-gradient(180deg, rgba(244,248,255,0.92) 0%, rgba(239,244,252,0.76) 100%)",
                                    }}
                                  >
                                    <div
                                      className="mb-2 text-[10px] uppercase tracking-[0.08em]"
                                      style={{ color: "#94a3b8" }}
                                    >
                                      实时进展
                                    </div>
                                    <div className="min-w-0 space-y-2">
                                      {message.events.map((event, index) => (
                                        <div
                                          key={`${message.id}-event-${index}`}
                                          className="min-w-0 flex gap-2"
                                        >
                                          <span
                                            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{
                                              background:
                                                index === message.events!.length - 1 && message.streaming
                                                  ? "#3b82f6"
                                                  : "#a3b2c7",
                                            }}
                                          />
                                          <div
                                            className="min-w-0 whitespace-pre-wrap break-words text-[11px] leading-5"
                                            style={{
                                              color: "#5d6d86",
                                              overflowWrap: "anywhere",
                                              wordBreak: "break-word",
                                            }}
                                          >
                                            {event}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                {message.content ? (
                                  <div
                                    className="mt-3 min-w-0 whitespace-pre-wrap break-words text-[13px] leading-6"
                                    style={{
                                      color: "#22324c",
                                      overflowWrap: "anywhere",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {message.content}
                                    {message.streaming ? (
                                      <span
                                        className="browser-agent-caret ml-0.5 inline-block h-5 w-[2px] align-[-3px]"
                                        style={{ background: "#7c8aa5" }}
                                      />
                                    ) : null}
                                  </div>
                                ) : message.streaming ? (
                                  <div
                                    className="mt-3 text-[13px] leading-6"
                                    style={{ color: "#7c8aa5" }}
                                  >
                                    正在生成响应
                                    <span className="browser-agent-ellipsis ml-1 inline-flex">
                                      <span>.</span>
                                      <span>.</span>
                                      <span>.</span>
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ),
                        )
                      ) : (
                        <div
                          className="rounded-[16px] border border-dashed px-3.5 py-3"
                          style={{
                            borderColor: "rgba(15, 23, 42, 0.12)",
                            background:
                              "linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(245,248,253,0.7) 100%)",
                            color: "#64748b",
                          }}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                              style={{
                                background:
                                  "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(233,239,248,0.95) 100%)",
                                border: "1px solid rgba(15, 23, 42, 0.08)",
                                boxShadow:
                                  "0 6px 14px rgba(148, 163, 184, 0.1), inset 0 1px 0 rgba(255,255,255,0.9)",
                              }}
                            >
                              <Monitor size={14} style={{ color: "#7c8aa5" }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div
                                className="text-[10px] uppercase tracking-[0.08em]"
                                style={{ color: "#94a3b8" }}
                              >
                                可以开始
                              </div>
                              <div
                                className="mt-0.5 text-[12px] leading-5"
                                style={{ color: "#60708f" }}
                              >
                                直接说“打开知乎”或“在当前页面帮我总结重点”。
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={chatBottomRef} />
                    </div>
                  </div>

                  <div
                    className="shrink-0 border-t px-2 py-2"
                    style={{
                      borderColor: "rgba(15, 23, 42, 0.08)",
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(248,250,255,0.9) 100%)",
                    }}
                  >
                    {summaryError ? (
                      <div
                        className="mb-3 rounded-[18px] px-3 py-3 text-[12px] leading-5"
                        style={{
                          background: "rgba(255, 92, 92, 0.08)",
                          color: "#d83b3b",
                          border: "1px solid rgba(248, 113, 113, 0.15)",
                        }}
                      >
                        {summaryError}
                      </div>
                    ) : null}

                    <div
                      className="rounded-[22px] border p-1.5"
                      style={{
                        borderColor: "rgba(15, 23, 42, 0.08)",
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(246,249,255,0.84) 100%)",
                        boxShadow:
                          "inset 0 1px 0 rgba(255,255,255,0.92), 0 10px 24px rgba(148, 163, 184, 0.12)",
                      }}
                    >
                      <textarea
                        value={chatInput}
                        onChange={(event) => setChatInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void handleAskPage();
                          }
                        }}
                        placeholder="告诉浏览器你想做什么"
                        className="min-h-[68px] w-full resize-none rounded-[18px] border-0 bg-transparent px-3 py-2.5 text-[13px] outline-none"
                        style={{
                          color: "#172033",
                        }}
                      />

                      <div className="mt-1.5 flex items-center justify-between gap-3 px-1.5 pb-0.5">
                        <div
                          className="text-[11px]"
                          style={{ color: "#94a3b8" }}
                        >
                          Enter 发送，Shift + Enter 换行
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleAskPage()}
                          disabled={!chatInput.trim() || chatLoading}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium"
                          style={{
                            background:
                              "linear-gradient(180deg, #1e80ff 0%, #0f6ae6 100%)",
                            color: "#fff",
                            opacity: !chatInput.trim() || chatLoading ? 0.65 : 1,
                            boxShadow:
                              "0 14px 24px rgba(30, 128, 255, 0.24), inset 0 1px 0 rgba(255,255,255,0.28)",
                          }}
                        >
                          {chatLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <SendHorizontal size={14} />
                          )}
                          {chatLoading ? "执行中…" : "发送任务"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <style>{`
              .browser-chat-scroll::-webkit-scrollbar {
                width: 10px;
              }

              .browser-chat-scroll::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.42);
                border-radius: 999px;
                border: 2px solid transparent;
                background-clip: padding-box;
              }

              .browser-chat-scroll::-webkit-scrollbar-track {
                background: transparent;
              }

              .browser-agent-caret {
                animation: browserCaretBlink 1s steps(1) infinite;
              }

              .browser-agent-pulse {
                animation: browserPulse 1.4s ease-in-out infinite;
              }

              .browser-agent-ellipsis span {
                animation: browserDot 1.2s ease-in-out infinite;
                display: inline-block;
              }

              .browser-agent-ellipsis span:nth-child(2) {
                animation-delay: 0.18s;
              }

              .browser-agent-ellipsis span:nth-child(3) {
                animation-delay: 0.36s;
              }

              @keyframes browserCaretBlink {
                0%, 48% {
                  opacity: 1;
                }

                50%, 100% {
                  opacity: 0;
                }
              }

              @keyframes browserPulse {
                0%, 100% {
                  transform: scale(0.9);
                  opacity: 0.55;
                }

                50% {
                  transform: scale(1.15);
                  opacity: 1;
                }
              }

              @keyframes browserDot {
                0%, 80%, 100% {
                  transform: translateY(0);
                  opacity: 0.35;
                }

                40% {
                  transform: translateY(-2px);
                  opacity: 1;
                }
              }
            `}</style>
          </aside>
        </div>
      </div>

      {cookieDialogOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center px-5 py-6"
          style={{
            background: "rgba(232, 238, 247, 0.5)",
            backdropFilter: "blur(14px)",
          }}
          onClick={closeCookieDialog}
        >
          <div
            className="w-full max-w-[460px] rounded-[28px] border p-5"
            style={{
              borderColor: "rgba(18, 30, 56, 0.08)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(245,248,253,0.95) 100%)",
              boxShadow:
                "0 32px 60px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div
                  className="text-[12px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: "#8a9ab5" }}
                >
                  导入 Cookie
                </div>
                <div
                  className="mt-1 text-[20px] font-semibold tracking-[0.02em]"
                  style={{ color: "#1d2b42" }}
                >
                  导入站点 Cookie
                </div>
                <div
                  className="mt-2 max-w-[360px] text-[12px] leading-5"
                  style={{ color: "#60708f" }}
                >
                  字符串和 JSON 分开导入，避免两种模式互相干扰。字符串模式更快，JSON 模式更完整。
                </div>
              </div>

              <button
                type="button"
                onClick={closeCookieDialog}
                disabled={cookieLoading}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full"
                style={{
                  background: "rgba(15, 23, 42, 0.05)",
                  color: cookieLoading ? "#b2bdd0" : "#64748b",
                  border: "1px solid rgba(18, 30, 56, 0.06)",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div
                className="inline-flex rounded-[18px] border p-1"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  background: "rgba(244, 247, 252, 0.88)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setCookieImportMode("header")}
                  className="inline-flex h-9 items-center justify-center rounded-[14px] px-3 text-[12px] font-medium"
                  style={{
                    background:
                      cookieImportMode === "header"
                        ? "linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(10,87,214,0.1) 100%)"
                        : "transparent",
                    color: cookieImportMode === "header" ? "#0f56cf" : "#60708f",
                  }}
                >
                  字符串
                </button>
                <button
                  type="button"
                  onClick={() => setCookieImportMode("json")}
                  className="inline-flex h-9 items-center justify-center rounded-[14px] px-3 text-[12px] font-medium"
                  style={{
                    background:
                      cookieImportMode === "json"
                        ? "linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(10,87,214,0.1) 100%)"
                        : "transparent",
                    color: cookieImportMode === "json" ? "#0f56cf" : "#60708f",
                  }}
                >
                  JSON
                </button>
              </div>

              <label className="block">
                <div
                  className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "#8a9ab5" }}
                >
                  站点地址
                </div>
                <input
                  value={cookieSiteUrl}
                  onChange={(event) => setCookieSiteUrl(event.target.value)}
                  placeholder="https://www.zhihu.com"
                  className="h-11 w-full rounded-[18px] border bg-transparent px-4 text-[13px] outline-none"
                  style={{
                    borderColor: "rgba(18, 30, 56, 0.08)",
                    color: "#172033",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.84)",
                  }}
                />
              </label>

              <label className="block">
                <div
                  className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "#8a9ab5" }}
                >
                  {cookieImportMode === "header"
                    ? "Cookie 字符串"
                    : "Cookie JSON"}
                </div>
                <textarea
                  value={
                    cookieImportMode === "header" ? cookieHeader : cookieJsonInput
                  }
                  onChange={(event) => {
                    if (cookieImportMode === "header") {
                      setCookieHeader(event.target.value);
                    } else {
                      setCookieJsonInput(event.target.value);
                    }
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void (cookieImportMode === "header"
                        ? handleImportCookieHeader()
                        : handleImportCookieJson());
                    }
                  }}
                  placeholder={
                    cookieImportMode === "header"
                      ? "name=value; token=xxx"
                      : '[{"name":"u","value":"...","domain":".hupu.com"}]'
                  }
                  className="min-h-[160px] w-full resize-none rounded-[20px] border bg-transparent px-4 py-3 text-[13px] leading-6 outline-none"
                  style={{
                    borderColor: "rgba(18, 30, 56, 0.08)",
                    color: "#172033",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.84)",
                  }}
                />
              </label>

              <div
                className="rounded-[18px] border px-3.5 py-3 text-[12px] leading-5"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.06)",
                  background:
                    "linear-gradient(180deg, rgba(247,250,255,0.92) 0%, rgba(241,246,252,0.88) 100%)",
                  color: "#60708f",
                }}
              >
                {cookieImportMode === "header"
                  ? "字符串模式会按当前站点地址写入 Cookie，适合快速恢复最基本的登录态。"
                  : "JSON 模式会尽量保留原始的 `domain / path / secure / httpOnly / sameSite / expires`，适合要求更严格的网站。"}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={closeCookieDialog}
                disabled={cookieLoading}
                className="inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px]"
                style={{
                  background: "rgba(15, 23, 42, 0.06)",
                  color: cookieLoading ? "#9ba8bd" : "#52627d",
                  border: "1px solid rgba(18, 30, 56, 0.08)",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() =>
                  void (cookieImportMode === "header"
                    ? handleImportCookieHeader()
                    : handleImportCookieJson())
                }
                disabled={
                  cookieLoading ||
                  !cookieSiteUrl.trim() ||
                  (cookieImportMode === "header"
                    ? !cookieHeader.trim()
                    : !cookieJsonInput.trim())
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium"
                style={{
                  background: "linear-gradient(135deg, #1677ff 0%, #0a57d6 100%)",
                  color: "#fff",
                  opacity:
                    cookieLoading ||
                    !cookieSiteUrl.trim() ||
                    (cookieImportMode === "header"
                      ? !cookieHeader.trim()
                      : !cookieJsonInput.trim())
                      ? 0.6
                      : 1,
                  boxShadow:
                    "0 14px 24px rgba(30, 128, 255, 0.22), inset 0 1px 0 rgba(255,255,255,0.24)",
                }}
              >
                {cookieLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Cookie size={14} />
                )}
                {cookieLoading ? "导入中…" : "导入 Cookie"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
