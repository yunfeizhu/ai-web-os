"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Cookie,
  Globe,
  Loader2,
  Monitor,
  Plus,
  Play,
  RefreshCw,
  Save,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";

import {
  apiFetch,
  API_BASE,
  completeOnce,
  completeOnceStream,
} from "@/lib/backend";
import { useWindowStore } from "@/stores/windowStore";
import { useSettingsStore } from "@/stores/settingsStore";

const LIVE_BASE_FROM_ENV = (
  process.env.NEXT_PUBLIC_BROWSER_LIVE_BASE || ""
).replace(/\/$/, "");
const RUNTIME_BASE_FROM_ENV = (
  process.env.NEXT_PUBLIC_BROWSER_RUNTIME_BASE || ""
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
  status?: string;
  takeover_reason?: string | null;
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
  action_log?: { ts: string; action: string; detail: string }[];
}

interface ExtractResponse {
  title: string;
  url: string;
  content: string;
  truncated: boolean;
}

interface BrowserLoginProfile {
  id: string;
  label: string;
  site_url: string;
  site_host: string;
  cookie_count: number;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

interface BrowserSessionHistory {
  id: string;
  status: string;
  current_url: string;
  current_title: string;
  tab_count: number;
  takeover_reason: string | null;
  last_error: string | null;
  action_log: { ts: string; action: string; detail: string }[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
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
  intentKind?: BrowserIntent["kind"];
  researchQuery?: string;
}

interface BrowserAgentStepPlan {
  status: "continue" | "done" | "need_user";
  reply: string;
  action: BrowserAutomationAction | null;
}

type BrowserIntent =
  | { kind: "research_query"; query: string; answerMode: "synthesize" }
  | { kind: "page_question"; question: string }
  | { kind: "search_only"; query: string; followupPrompt?: string }
  | { kind: "navigate"; target: string; followupPrompt?: string }
  | { kind: "page_action"; actions: BrowserAutomationAction[] }
  | { kind: "browser_agent"; task: string };

const browserMarkdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const isBlock = !!match || String(children).includes("\n");

    if (isBlock) {
      const lang = match?.[1] ?? "text";
      const code = String(children).replace(/\n$/, "");
      return (
        <SyntaxHighlighter
          language={lang}
          style={oneLight}
          customStyle={{
            margin: "0.6em 0",
            padding: "0.8em 1em",
            fontSize: "0.92em",
            background: "rgba(15, 23, 42, 0.04)",
            borderRadius: 12,
            border: "1px solid rgba(18, 30, 56, 0.08)",
          }}
          codeTagProps={{
            style: { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
          }}
        >
          {code}
        </SyntaxHighlighter>
      );
    }

    return (
      <code
        className={className}
        style={{
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: "0.95em",
          background: "rgba(15, 23, 42, 0.06)",
          padding: "0.14em 0.42em",
          borderRadius: 6,
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
};

const BROWSER_AGENT_PLAN_TIMEOUT_MS = 30000;
const BROWSER_RESEARCH_SYNTHESIS_TIMEOUT_MS = 90000;

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

export function findBrowserRetryPrompt(
  messages: BrowserChatMessage[],
  assistantMessageId: string,
) {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId,
  );
  if (assistantIndex <= 0) return "";

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
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

  try {
    const parsed = JSON.parse(raw) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
  } catch {}

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
      ? `点击失败：未能在页面稳定后点击 ${target}。通常是页面刚刷新、列表重排、元素被顶开，或者这个元素已经变了。`
      : "点击失败：页面在超时前没有进入可点击状态，通常是页面仍在变化、元素被遮挡，或者目标已经改变。";
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

function resolveSearchTarget(rawQuery: string) {
  const query = rawQuery.trim().replace(/[。；;，,]+$/g, "");
  return query ? `https://www.baidu.com/s?wd=${encodeURIComponent(query)}` : "";
}

function cleanBrowserCommandText(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[。；;，,]+$/g, "");
}

function splitCommandAndFollowup(
  command: string,
): { head: string; followupPrompt?: string } {
  const match = command.match(/^(.+?)(?:[，。,;；]+|(?:然后|再)\s*)(.+)$/);
  if (!match) return { head: command };

  const head = cleanBrowserCommandText(match[1]);
  const followupPrompt = cleanBrowserCommandText(match[2]);
  return followupPrompt ? { head, followupPrompt } : { head };
}

function readCommandBody(command: string, prefixes: string[]) {
  const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    if (command.startsWith(prefix)) {
      const body = cleanBrowserCommandText(command.slice(prefix.length));
      if (body) return body;
    }
  }
  return "";
}

function parseChinesePageNumber(value: string) {
  const normalized = value.trim().replace(/\s+/g, "").replace(/两/g, "二");
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (digitMap[normalized]) return digitMap[normalized];
  if (normalized === "十") return 10;

  const tenMatch = normalized.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (!tenMatch) return null;

  const tens = tenMatch[1] ? digitMap[tenMatch[1]] : 1;
  const ones = tenMatch[2] ? digitMap[tenMatch[2]] : 0;
  return tens * 10 + ones;
}

function readTargetPageNumber(command: string) {
  const pageNumberPattern = "([0-9一二两三四五六七八九十]+)";
  const triggeredMatch =
    command.match(
      new RegExp(
        `(?:切到|翻到|跳到|打开|去|看|看看|点|点击)\\s*(?:第\\s*${pageNumberPattern}\\s*页|${pageNumberPattern}\\s*页)`,
      ),
    ) ||
    command.match(
      new RegExp(
        `^(?:第\\s*${pageNumberPattern}\\s*页|${pageNumberPattern}\\s*页)(?:看看|看一下|看下|看看下)?$`,
      ),
    );

  const rawNumber = triggeredMatch?.[1] || triggeredMatch?.[2] || "";
  const pageNumber = rawNumber ? parseChinesePageNumber(rawNumber) : null;
  return pageNumber && pageNumber > 0 ? pageNumber : null;
}

function hasCurrentPageCue(command: string) {
  return /(?:当前页面|这个页面|本页|这页|页面上|网页上|浏览器|右边|左边|上面|下面|这里|侧边栏|榜单|页面内容|网页内容)/.test(
    command,
  );
}

function hasSummaryCue(command: string) {
  return /(?:总结|概括|归纳|梳理|提炼|摘要|这个页面讲了什么|这页讲了什么|页面讲了什么|网页讲了什么|说说.*页面|页面.*内容)/.test(
    command,
  );
}

function startsWithExplicitRemoteTask(head: string, command: string) {
  if (hasCurrentPageCue(command)) return false;
  return Boolean(
    readCommandBody(head, [
      "百度一下",
      "搜一下",
      "搜一搜",
      "搜索",
      "查找",
      "查询",
      "帮我查一下",
      "帮我查查",
      "查一下",
      "查一查",
      "了解一下",
      "打开",
      "访问",
      "进入",
    ]),
  );
}

function isVisiblePageQuestion(command: string) {
  const asksVisibleContent =
    /(?:看下|看一下|看看|告诉我|列出|读一下|是什么|有哪些|前\s*\d+|前[一二两三四五六七八九十]+|排名|榜|热搜)/.test(
      command,
    );
  const baiduHotSearchQuestion =
    /(?:百度)?热搜.*(?:前\s*\d+|前[一二两三四五六七八九十]+|是什么|有哪些|榜|排名)/.test(
      command,
    ) || /百度热搜/.test(command);

  return (
    (hasCurrentPageCue(command) && (asksVisibleContent || hasSummaryCue(command))) ||
    baiduHotSearchQuestion ||
    hasSummaryCue(command)
  );
}

export function detectLocalBrowserIntent(input: string): BrowserIntent | null {
  const command = cleanBrowserCommandText(input);
  if (!command) return null;

  const { head, followupPrompt } = splitCommandAndFollowup(command);
  if (
    isVisiblePageQuestion(command) &&
    !startsWithExplicitRemoteTask(head, command)
  ) {
    return { kind: "page_question", question: command };
  }

  const searchQuery = readCommandBody(head, [
    "百度一下",
    "搜一下",
    "搜一搜",
    "搜索",
    "查找",
    "查询",
    "百度",
  ]);
  if (searchQuery) {
    return { kind: "search_only", query: searchQuery, followupPrompt };
  }

  const navigationTarget = readCommandBody(head, ["打开", "访问", "进入"]);
  if (navigationTarget) {
    return { kind: "navigate", target: navigationTarget, followupPrompt };
  }

  const clickMatch = command.match(/^(?:点击|点开|点一下)\s+(.+)$/);
  if (clickMatch) {
    return {
      kind: "page_action",
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
    return { kind: "page_action", actions };
  }

  if (/^(?:按回车|回车|enter)$/i.test(command)) {
    return { kind: "page_action", actions: [{ action: "press", key: "Enter" }] };
  }

  if (/^(?:按tab|tab)$/i.test(command)) {
    return { kind: "page_action", actions: [{ action: "press", key: "Tab" }] };
  }

  if (/^(?:按esc|esc|escape)$/i.test(command)) {
    return {
      kind: "page_action",
      actions: [{ action: "press", key: "Escape" }],
    };
  }

  if (/^(?:向下滚动|下滑|往下滚|下滚一点)$/.test(command)) {
    return { kind: "page_action", actions: [{ action: "wheel", delta_y: 900 }] };
  }

  if (/^(?:向上滚动|上滑|往上滚|上滚一点)$/.test(command)) {
    return { kind: "page_action", actions: [{ action: "wheel", delta_y: -900 }] };
  }

  const waitMatch = command.match(/^(?:等待|等)\s*(\d+)\s*秒$/);
  if (waitMatch) {
    return {
      kind: "page_action",
      actions: [
        { action: "wait_for", timeout_ms: Number(waitMatch[1]) * 1000 },
      ],
    };
  }

  const targetPageNumber = readTargetPageNumber(command);
  if (targetPageNumber) {
    return {
      kind: "page_action",
      actions: [
        { action: "click", selector: `text=${targetPageNumber}` },
        { action: "wait_for", timeout_ms: 1500 },
      ],
    };
  }

  if (
    /(?:下一页|下页|后一页|往后翻|向后翻|翻页|翻到下一页|切到下一页)/.test(
      command,
    )
  ) {
    return {
      kind: "page_action",
      actions: [
        { action: "click", selector: "text=下一页" },
        { action: "wait_for", timeout_ms: 1500 },
      ],
    };
  }

  if (
    /(?:上一页|上页|前一页|往前翻|向前翻|翻到上一页|切到上一页)/.test(
      command,
    )
  ) {
    return {
      kind: "page_action",
      actions: [
        { action: "click", selector: "text=上一页" },
        { action: "wait_for", timeout_ms: 1500 },
      ],
    };
  }

  const researchQuery = readCommandBody(command, [
    "帮我查一下",
    "帮我查查",
    "帮我看看",
    "查一下",
    "查一查",
    "了解一下",
    "看一下",
    "看看",
  ]);
  if (researchQuery) {
    return {
      kind: "research_query",
      query: researchQuery,
      answerMode: "synthesize",
    };
  }

  if (
    /(?:是什么|有哪些|多少|结果|赛程|排名|价格|天气|新闻|资料|攻略|时间|名单|比分|战绩|汇率|股价)/.test(
      command,
    )
  ) {
    return {
      kind: "research_query",
      query: command,
      answerMode: "synthesize",
    };
  }

  return null;
}

export function buildBrowserCommandFromIntent(
  intent: BrowserIntent,
): QuickBrowserCommandResult | null {
  switch (intent.kind) {
    case "search_only": {
      const url = resolveSearchTarget(intent.query);
      return url
        ? {
            actions: [{ action: "navigate", url }],
            followupPrompt: intent.followupPrompt,
            intentKind: intent.kind,
          }
        : null;
    }
    case "research_query": {
      const url = resolveSearchTarget(intent.query);
      return url
        ? {
            actions: [{ action: "navigate", url }],
            intentKind: intent.kind,
            researchQuery: intent.query,
          }
        : null;
    }
    case "page_question":
      return null;
    case "navigate":
      return {
        actions: [
          {
            action: "navigate",
            url: resolveNavigationTarget(intent.target),
          },
          ...(intent.followupPrompt
            ? [{ action: "wait_for", timeout_ms: 1800 } as BrowserAutomationAction]
            : []),
        ],
        followupPrompt: intent.followupPrompt,
        intentKind: intent.kind,
      };
    case "page_action":
      return { actions: intent.actions, intentKind: intent.kind };
    case "browser_agent":
      return null;
    default:
      return null;
  }
}

export function parseBrowserIntentClassification(
  raw: string,
  fallbackTask: string,
): BrowserIntent | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = fenced?.[1] ?? trimmed;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }

  const kind = typeof parsed.kind === "string" ? parsed.kind : "";
  const query = cleanBrowserCommandText(
    typeof parsed.query === "string" ? parsed.query : "",
  );
  const task = cleanBrowserCommandText(
    typeof parsed.task === "string" ? parsed.task : fallbackTask,
  );
  const question = cleanBrowserCommandText(
    typeof parsed.question === "string" ? parsed.question : fallbackTask,
  );

  if (kind === "research_query") {
    return {
      kind,
      query: query || cleanBrowserCommandText(fallbackTask),
      answerMode: "synthesize",
    };
  }
  if (kind === "page_question") {
    return { kind, question: question || cleanBrowserCommandText(fallbackTask) };
  }
  if (kind === "search_only" && query) {
    return { kind, query };
  }
  if (kind === "navigate") {
    const target = cleanBrowserCommandText(
      typeof parsed.target === "string"
        ? parsed.target
        : typeof parsed.url === "string"
          ? parsed.url
          : "",
    );
    return target ? { kind, target } : null;
  }
  if (kind === "browser_agent") {
    return { kind, task: task || fallbackTask };
  }

  return null;
}

function buildBrowserIntentPrompt(command: string) {
  return [
    "请把用户给浏览器助手的请求分类成一个 JSON 对象。",
    "只输出 JSON，不要 Markdown，不要解释。",
    "",
    "可选 kind：",
    '- research_query: 用户要查资料、查新闻、查天气、查结果、查价格、了解某件事，并希望得到回答。',
    "- page_question: 用户问当前浏览器页面、当前可见区域、页面右侧/左侧/上方/下方已有内容。",
    "- search_only: 用户只要求搜索关键词或打开搜索结果页。",
    "- navigate: 用户要求打开/访问某个网站或 URL。",
    "- page_action: 用户明确要求点击、输入、按键、滚动等当前页面动作。",
    "- browser_agent: 用户要求完成复杂网页流程，比如登录、填表、下单、多步操作。",
    "",
    "字段：",
    '{"kind":"research_query|page_question|search_only|navigate|page_action|browser_agent","query":"资料查询或搜索词","question":"当前页面问题","target":"网站或URL","task":"复杂任务原文"}',
    "",
    "示例：",
    '用户：查一下2026世界杯每一组的比赛结果 -> {"kind":"research_query","query":"2026世界杯每一组的比赛结果"}',
    '用户：看下右边的百度热搜前十名 -> {"kind":"page_question","question":"看下右边的百度热搜前十名"}',
    '用户：搜索杭州天气 -> {"kind":"search_only","query":"杭州天气"}',
    '用户：打开知乎 -> {"kind":"navigate","target":"知乎"}',
    '用户：点击登录 -> {"kind":"page_action"}',
    '用户：帮我登录网站并下载发票 -> {"kind":"browser_agent","task":"帮我登录网站并下载发票"}',
    "",
    `用户：${command}`,
  ].join("\n");
}

async function classifyBrowserIntentWithModel(command: string) {
  const result = await withBrowserTaskTimeout(
    completeOnce(
      buildBrowserIntentPrompt(command),
      "你是浏览器助手的意图分类器。你的任务是把用户输入分类成稳定 JSON，不能执行网页操作。",
    ),
    8000,
    "浏览器意图识别超过 8 秒。",
  );
  return parseBrowserIntentClassification(result.content, command);
}

export function parseQuickBrowserCommand(
  input: string,
): QuickBrowserCommandResult | null {
  const intent = detectLocalBrowserIntent(input);
  return intent ? buildBrowserCommandFromIntent(intent) : null;
}

function browserActionSignature(action: BrowserAutomationAction) {
  return JSON.stringify({
    action: action.action,
    url: action.url ? cleanBrowserCommandText(action.url) : "",
    selector: action.selector ? cleanBrowserCommandText(action.selector) : "",
    text: action.text ? cleanBrowserCommandText(action.text) : "",
    key: action.key ? cleanBrowserCommandText(action.key) : "",
    delta_x: action.delta_x ?? 0,
    delta_y: action.delta_y ?? 0,
    press_enter: Boolean(action.press_enter),
  });
}

export function shouldStopForRepeatedBrowserAction(
  previousActions: BrowserAutomationAction[],
  nextAction: BrowserAutomationAction,
  maxConsecutiveRepeats = 2,
) {
  const nextSignature = browserActionSignature(nextAction);
  let repeatCount = 1;

  for (let index = previousActions.length - 1; index >= 0; index -= 1) {
    if (browserActionSignature(previousActions[index]) !== nextSignature) break;
    repeatCount += 1;
  }

  return repeatCount > maxConsecutiveRepeats;
}

export function buildResearchFallbackAnswer(query: string, content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => cleanBrowserCommandText(line))
    .filter((line) => line.length >= 2)
    .filter((line) => !/^(查看更多|展开|收起|广告|登录|百度一下)$/.test(line));
  const uniqueLines = Array.from(new Set(lines)).slice(0, 10);

  if (uniqueLines.length === 0) {
    return [
      "搜索结果页已经打开，但页面可抽取文本不足，暂时没法整理出可靠答案。",
      `你可以在浏览器里查看当前搜索结果，或换个更具体的查询：${query}`,
    ].join("\n");
  }

  return [
    "资料整理超时了，我先把当前搜索结果页里能读取到的关键信息列出来：",
    "",
    ...uniqueLines.map((line) => `- ${line}`),
    "",
    "这不是最终归纳版答案，只是基于当前页面可见文本的快速摘录。",
  ].join("\n");
}

function buildPageQuestionFallbackAnswer(question: string, content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => cleanBrowserCommandText(line))
    .filter((line) => line.length >= 2)
    .filter((line) => !/^(查看更多|展开|收起|广告|登录|百度一下)$/.test(line));
  const uniqueLines = Array.from(new Set(lines)).slice(0, 12);

  if (uniqueLines.length === 0) {
    return [
      "我读取了当前页面，但可抽取文本不足，暂时没法从当前页面回答这个问题。",
      `问题：${question}`,
    ].join("\n");
  }

  return [
    "我先根据当前页面能读取到的内容列出来：",
    "",
    ...uniqueLines.map((line) => `- ${line}`),
    "",
    "如果你要更精确的某个区域，可以直接说“只看右侧榜单”。",
  ].join("\n");
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

export function withBrowserTaskTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "浏览器任务规划等待超时，请稍后重试。",
) {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolveLiveWebSocketPath(liveBase: string) {
  const fallbackOrigin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;

  try {
    const url = new URL(liveBase || "/", fallbackOrigin);
    const pathPrefix = url.pathname.replace(/^\/+|\/+$/g, "");
    return pathPrefix ? `${pathPrefix}/websockify` : "websockify";
  } catch {
    const pathPrefix = liveBase.replace(/^\/+|\/+$/g, "");
    return pathPrefix ? `${pathPrefix}/websockify` : "websockify";
  }
}

export function Browser({ appState, windowId }: BrowserProps) {
  const updateAppState = useWindowStore((state) => state.updateAppState);
  const browserWindow = useWindowStore((state) => state.windows[windowId]);
  const embeddingConfig = useSettingsStore((state) => state.embeddingConfig);

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
  const [notice, setNotice] = useState("");
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
  const [profilesDialogOpen, setProfilesDialogOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"profiles" | "history">("profiles");
  const [profileScope, setProfileScope] = useState<"current" | "all">("current");
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState<BrowserLoginProfile[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [applyingProfileId, setApplyingProfileId] = useState("");
  const [deletingProfileId, setDeletingProfileId] = useState("");
  const [historySessions, setHistorySessions] = useState<BrowserSessionHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "active" | "closed">("all");
  const [expandedHistoryId, setExpandedHistoryId] = useState("");
  const [switchingHistoryId, setSwitchingHistoryId] = useState("");
  const [reopeningHistoryId, setReopeningHistoryId] = useState("");
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const shouldPollSessions =
    Boolean(browserWindow?.isFocused) && browserWindow?.state !== "minimized";
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

  const runtimeBase = useMemo(() => {
    if (RUNTIME_BASE_FROM_ENV) return RUNTIME_BASE_FROM_ENV;
    if (typeof window === "undefined") return "http://localhost:18100";
    return `${window.location.protocol}//${window.location.hostname}:18100`;
  }, []);

  const liveWebSocketPath = useMemo(
    () => resolveLiveWebSocketPath(liveBase),
    [liveBase],
  );

  const liveUrl = useMemo(() => {
    if (!activeSessionId) return "";
    const params = new URLSearchParams({
      autoconnect: "1",
      scale: preciseControl ? "0" : "1",
      precise: preciseControl ? "1" : "0",
      view_only: "0",
      path: liveWebSocketPath,
      reconnect: "1",
      session_id: activeSessionId,
      api_base: runtimeBase,
    });
    return `${liveBase}/embedded_vnc.html?${params.toString()}`;
  }, [activeSessionId, liveBase, liveWebSocketPath, preciseControl, runtimeBase]);

  const liveFrameKey = useMemo(() => activeSessionId, [activeSessionId]);

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

  const resolveCurrentSiteUrl = () => {
    if (detail?.current_url && detail.current_url !== "about:blank") {
      return detail.current_url;
    }
    if (urlInput.trim() && urlInput.trim() !== "about:blank") {
      return urlInput.trim();
    }
    return "";
  };

  const openCookieDialog = () => {
    const nextSiteUrl = resolveCurrentSiteUrl();
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

  const loadProfiles = async (
    scope: "current" | "all" = profileScope,
    siteUrl?: string,
  ) => {
    const effectiveSiteUrl =
      scope === "current" ? siteUrl?.trim() || resolveCurrentSiteUrl() : "";
    if (scope === "current" && !effectiveSiteUrl) {
      setSavedProfiles([]);
      return [];
    }
    const query = effectiveSiteUrl
      ? `?site_url=${encodeURIComponent(effectiveSiteUrl)}`
      : "";
    const data = await apiFetch<BrowserLoginProfile[]>(`/browser/profiles${query}`);
    setSavedProfiles(data);
    return data;
  };

  const handleRefreshProfiles = async (
    scope: "current" | "all" = profileScope,
  ) => {
    setProfilesLoading(true);
    setSummaryError("");
    try {
      await loadProfiles(scope);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "读取已保存登录态失败。",
      );
    } finally {
      setProfilesLoading(false);
    }
  };

  const loadHistorySessions = async (
    status: "all" | "active" | "closed" = historyFilter,
  ) => {
    const query =
      status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
    const data = await apiFetch<BrowserSessionHistory[]>(
      `/browser/history-sessions${query}`,
    );
    setHistorySessions(data);
    return data;
  };

  const openLibraryDialog = async (
    initialTab: "profiles" | "history" = "profiles",
  ) => {
    setProfilesDialogOpen(true);
    setLibraryTab(initialTab);
    setSummaryError("");
    setNotice("");
    if (initialTab === "profiles") {
      const suggestedScope = resolveCurrentSiteUrl() ? "current" : "all";
      setProfileScope(suggestedScope);
      await handleRefreshProfiles(suggestedScope);
      return;
    }

    setHistoryLoading(true);
    try {
      await loadHistorySessions(initialTab === "history" ? historyFilter : "all");
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "读取历史会话失败。",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleChangeLibraryTab = async (nextTab: "profiles" | "history") => {
    setLibraryTab(nextTab);
    setSummaryError("");
    if (nextTab === "profiles" && savedProfiles.length === 0 && !profilesLoading) {
      await handleRefreshProfiles(profileScope);
      return;
    }

    if (nextTab === "history" && historySessions.length === 0 && !historyLoading) {
      setHistoryLoading(true);
      try {
        await loadHistorySessions();
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  const handleChangeProfileScope = async (nextScope: "current" | "all") => {
    if (nextScope === profileScope) return;
    setProfileScope(nextScope);
    await handleRefreshProfiles(nextScope);
  };

  const handleSaveLoginProfile = async () => {
    if (!activeSessionId) {
      setSummaryError("请先创建一个浏览器会话，再保存登录态。");
      return;
    }
    setSavingProfile(true);
    setSummaryError("");
    setNotice("");
    try {
      const data = await apiFetch<BrowserLoginProfile>(
        `/browser/sessions/${activeSessionId}/profiles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label:
              detail?.current_title && detail.current_title.trim()
                ? `${detail.current_title.trim()} 登录态`
                : undefined,
            site_url:
              detail?.current_url && detail.current_url !== "about:blank"
                ? detail.current_url
                : undefined,
          }),
        },
      );
      setNotice(`已保存登录态：${data.label}`);
      if (profilesDialogOpen && libraryTab === "profiles") {
        await loadProfiles(profileScope, data.site_url);
      }
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "保存登录态失败。",
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleApplyLoginProfile = async (profileId: string) => {
    if (!activeSessionId) return;
    setApplyingProfileId(profileId);
    setSummaryError("");
    setNotice("");
    try {
      const data = await apiFetch<{
        profile: BrowserLoginProfile;
        session: BrowserSessionDetail;
      }>(`/browser/sessions/${activeSessionId}/profiles/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId }),
      });
      setDetail(data.session);
      syncUrlInput(data.session.current_url || "", true);
      setNotice(`已恢复登录态，并已打开 ${data.profile.site_url || data.profile.label}`);
      await loadSessions();
      await loadProfiles(profileScope, data.profile.site_url);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "恢复登录态失败。",
      );
    } finally {
      setApplyingProfileId("");
    }
  };

  const handleDeleteLoginProfile = async (profileId: string) => {
    setDeletingProfileId(profileId);
    setSummaryError("");
    setNotice("");
    try {
      await apiFetch(`/browser/profiles/${profileId}`, {
        method: "DELETE",
      });
      setSavedProfiles((prev) => prev.filter((profile) => profile.id !== profileId));
      setNotice("已删除登录态资料。");
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "删除登录态资料失败。",
      );
    } finally {
      setDeletingProfileId("");
    }
  };

  const handleRefreshHistorySessions = async (
    status: "all" | "active" | "closed" = historyFilter,
  ) => {
    setHistoryLoading(true);
    setSummaryError("");
    try {
      await loadHistorySessions(status);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "读取历史会话失败。",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSwitchToHistorySession = async (sessionId: string) => {
    setSwitchingHistoryId(sessionId);
    setSummaryError("");
    setNotice("");
    try {
      setActiveSessionId(sessionId);
      const data = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${sessionId}/focus`,
        {
          method: "POST",
        },
      );
      setDetail(data);
      syncUrlInput(data.current_url || "", true);
      await loadSessions();
      setNotice("已切换到所选浏览器会话。");
      setProfilesDialogOpen(false);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "切换历史会话失败。",
      );
    } finally {
      setSwitchingHistoryId("");
    }
  };

  const handleReopenHistorySession = async (session: BrowserSessionHistory) => {
    if (!session.current_url || session.current_url === "about:blank") {
      setSummaryError("这个历史会话没有可重新打开的网址。");
      return;
    }
    setReopeningHistoryId(session.id);
    setSummaryError("");
    setNotice("");
    try {
      const created = await apiFetch<BrowserSessionDetail>("/browser/sessions", {
        method: "POST",
      });
      const reopened = await apiFetch<BrowserSessionDetail>(
        `/browser/sessions/${created.id}/navigate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: normalizeUrl(session.current_url) }),
        },
      );
      setActiveSessionId(reopened.id);
      setDetail(reopened);
      syncUrlInput(reopened.current_url || session.current_url, true);
      await loadSessions();
      setNotice("已按该历史会话的网址重新打开新会话。");
      setProfilesDialogOpen(false);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "重新打开历史会话失败。",
      );
    } finally {
      setReopeningHistoryId("");
    }
  };

  const ensureKnowledgeReady = async () => {
    const status = await apiFetch<{ initialized: boolean }>("/knowledge/status");
    if (status.initialized) return;

    if (
      !embeddingConfig?.apiKey ||
      !embeddingConfig.model ||
      !embeddingConfig.baseUrl
    ) {
      throw new Error(
        "知识库还没有初始化。请先到设置里的 Embedding / 知识库 页面完成配置后再试。",
      );
    }

    const response = await fetch(`${API_BASE}/knowledge/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embedder_model: embeddingConfig.model,
        embedder_api_key: embeddingConfig.apiKey,
        embedder_base_url: embeddingConfig.baseUrl,
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(raw || "知识库初始化失败。");
    }
  };

  const handleSavePageToKnowledge = async () => {
    if (!activeSessionId) {
      setSummaryError("请先创建一个浏览器会话，再保存页面内容。");
      return;
    }
    setSavingKnowledge(true);
    setSummaryError("");
    setNotice("");
    try {
      await ensureKnowledgeReady();
      const data = await apiFetch<{ title: string }>(
        `/browser/sessions/${activeSessionId}/save-page`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:
              detail?.current_title && detail.current_title.trim()
                ? detail.current_title.trim()
                : undefined,
            max_chars: 12000,
          }),
        },
      );
      setNotice(`已存入知识库：${data.title}`);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "保存页面到知识库失败。",
      );
    } finally {
      setSavingKnowledge(false);
    }
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
      setSummaryError("");
    } catch (error) {
      if (isNoActiveTabError(error)) {
        try {
          await sleep(280);
          const retryData = await apiFetch<BrowserSessionDetail>(
            `/browser/sessions/${sessionId}`,
          );
          setDetail(retryData);
          syncUrlInput(retryData.current_url || "");
          setSummaryError("");
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

  const focusSessionLive = async (sessionId: string) => {
    const data = await apiFetch<BrowserSessionDetail>(
      `/browser/sessions/${sessionId}/focus`,
      {
        method: "POST",
      },
    );
    setDetail(data);
    syncUrlInput(data.current_url || "", true);
    setSummaryError("");
    return data;
  };

  useEffect(() => {
    void loadRuntime();
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    setSummaryError("");
    void focusSessionLive(activeSessionId).catch(() => {
      void loadDetail(activeSessionId);
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (!shouldPollSessions) return;

    void loadSessions();
    if (activeSessionId) {
      void loadDetail(activeSessionId);
    }

    const timer = window.setInterval(() => {
      void loadSessions();
      if (activeSessionId) {
        void loadDetail(activeSessionId);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeSessionId, shouldPollSessions]);

  useEffect(() => {
    if (!profilesDialogOpen || libraryTab !== "history") return;
    void handleRefreshHistorySessions(historyFilter);
  }, [historyFilter]);

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
          await apiFetch(`/browser/sessions/${sessionId}/wait-for`, {
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
      onNeedHuman?: (reason: string) => Promise<void> | void;
    },
  ) => {
    let finalReply = "";
    let requiresHuman = false;
    const stepLogs: string[] = [];
    const plannedActions: BrowserAutomationAction[] = [];

    callbacks?.onStatus?.("正在读取当前页面");

    for (let step = 1; step <= 6; step += 1) {
      callbacks?.onStatus?.(`正在规划第 ${step} 步`);
      const browserState = await fetchBrowserState(sessionId);
      const pageContext = await readSessionContext(sessionId);
      const planResult = await withBrowserTaskTimeout(
        completeOnce(
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
          "你是 AI-Web OS 的浏览器任务代理。目标是安全、稳妥地完成网页任务。",
        ),
        BROWSER_AGENT_PLAN_TIMEOUT_MS,
        "浏览器任务规划超过 30 秒，可能是模型响应太慢。请稍后重试，或者换成更直接的指令。",
      );

      const plan = parseBrowserAgentStep(planResult.content);
      if (
        plan.status === "done" ||
        plan.status === "need_user" ||
        !plan.action
      ) {
        finalReply = plan.reply.trim();
        if (plan.status === "need_user") {
          requiresHuman = true;
          callbacks?.onStatus?.("需要你补充信息后我才能继续");
          await callbacks?.onNeedHuman?.(
            finalReply || "需要你手动完成当前网页步骤后，我再继续。",
          );
        }
        break;
      }

      if (shouldStopForRepeatedBrowserAction(plannedActions, plan.action)) {
        finalReply =
          "我检测到浏览器代理正在重复执行同一个动作，已经先停下来，避免继续把同样内容输入到页面里。你可以换个更具体的目标，或者直接让我打开搜索结果页。";
        callbacks?.onStatus?.("已停止重复动作");
        break;
      }
      plannedActions.push(plan.action);

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

    return {
      reply: finalReply,
      requiresHuman,
    };
  };

  const resolveBrowserIntentForTask = async (
    command: string,
    callbacks?: {
      onStatus?: (status: string) => void;
      onClassifierFallback?: (message: string) => void;
    },
  ): Promise<BrowserIntent> => {
    const localIntent = detectLocalBrowserIntent(command);
    if (localIntent) return localIntent;

    callbacks?.onStatus?.("正在识别任务意图");
    try {
      const modelIntent = await classifyBrowserIntentWithModel(command);
      if (modelIntent) return modelIntent;
    } catch (error) {
      callbacks?.onClassifierFallback?.(
        formatBrowserErrorMessage(error, "意图识别失败，改用浏览器代理。"),
      );
    }

    return { kind: "browser_agent", task: command };
  };

  const synthesizeResearchAnswer = async (
    sessionId: string,
    query: string,
    callbacks?: {
      onToken?: (token: string) => void;
    },
  ) => {
    const pageContext = await readSessionContext(sessionId);
    const prompt = [
      `用户要查询：${query}`,
      "",
      "下面是当前浏览器搜索结果页或网页正文预览：",
      pageContext.content.slice(0, 2500),
      "",
      "请基于上面的网页内容用中文回答用户。",
      "如果内容不足以得出结论，请明确说明还需要打开更多结果，不要编造。",
      "如果问题涉及实时或未来事件，请说明回答依据当前搜索结果页内容。",
    ].join("\n");
    const systemPrompt =
      "你是浏览器助手的信息整理器。你只能依据给定网页内容回答，不能编造没有依据的事实。";
    let streamedContent = "";
    let acceptsStreamTokens = true;

    try {
      if (callbacks?.onToken) {
        const result = await withBrowserTaskTimeout(
          completeOnceStream(prompt, systemPrompt, (token) => {
            if (!acceptsStreamTokens) return;
            streamedContent += token;
            callbacks.onToken?.(token);
          }),
          BROWSER_RESEARCH_SYNTHESIS_TIMEOUT_MS,
          "资料整理超过 90 秒，可能是模型响应太慢。请稍后重试。",
        );
        return (
          (result.content || streamedContent).trim() ||
          buildResearchFallbackAnswer(query, pageContext.content)
        );
      }

      const result = await withBrowserTaskTimeout(
        completeOnce(prompt, systemPrompt),
        BROWSER_RESEARCH_SYNTHESIS_TIMEOUT_MS,
        "资料整理超过 90 秒，可能是模型响应太慢。请稍后重试。",
      );

      return (
        result.content.trim() ||
        buildResearchFallbackAnswer(query, pageContext.content)
      );
    } catch {
      acceptsStreamTokens = false;
      const fallback = buildResearchFallbackAnswer(query, pageContext.content);
      if (callbacks?.onToken && streamedContent.trim()) {
        callbacks.onToken(`\n\n${fallback}`);
        return `${streamedContent.trim()}\n\n${fallback}`;
      }
      return fallback;
    }
  };

  const answerCurrentPageQuestion = async (
    sessionId: string,
    question: string,
    callbacks?: {
      onToken?: (token: string) => void;
    },
  ) => {
    const pageContext = await readSessionContext(sessionId);
    const prompt = [
      `用户想了解当前浏览器页面里的内容：${question}`,
      "",
      `当前页面标题：${pageContext.title || "未知"}`,
      `当前页面地址：${pageContext.url || "about:blank"}`,
      "",
      "当前页面可抽取文本：",
      pageContext.content.slice(0, 3200),
      "",
      "请只依据当前页面文本回答用户，不要主动改写成搜索任务，也不要编造页面里没有的信息。",
      "如果用户问某个榜单或列表的前几名，请尽量按当前页面文本中的顺序列出。",
      "如果当前页面文本不足以回答，请明确说当前页面没有读取到足够信息。",
    ].join("\n");
    const systemPrompt =
      "你是浏览器助手的当前页面阅读器。你的职责是回答当前浏览器页面里已经出现的内容，不能主动搜索或编造。";
    let streamedContent = "";
    let acceptsStreamTokens = true;

    try {
      if (callbacks?.onToken) {
        const result = await withBrowserTaskTimeout(
          completeOnceStream(prompt, systemPrompt, (token) => {
            if (!acceptsStreamTokens) return;
            streamedContent += token;
            callbacks.onToken?.(token);
          }),
          BROWSER_RESEARCH_SYNTHESIS_TIMEOUT_MS,
          "当前页面内容整理超过 90 秒，可能是模型响应太慢。请稍后重试。",
        );
        return (
          (result.content || streamedContent).trim() ||
          buildPageQuestionFallbackAnswer(question, pageContext.content)
        );
      }

      const result = await withBrowserTaskTimeout(
        completeOnce(prompt, systemPrompt),
        BROWSER_RESEARCH_SYNTHESIS_TIMEOUT_MS,
        "当前页面内容整理超过 90 秒，可能是模型响应太慢。请稍后重试。",
      );
      return (
        result.content.trim() ||
        buildPageQuestionFallbackAnswer(question, pageContext.content)
      );
    } catch {
      acceptsStreamTokens = false;
      const fallback = buildPageQuestionFallbackAnswer(
        question,
        pageContext.content,
      );
      if (callbacks?.onToken && streamedContent.trim()) {
        callbacks.onToken(`\n\n${fallback}`);
        return `${streamedContent.trim()}\n\n${fallback}`;
      }
      return fallback;
    }
  };

  const handleClearBrowserChat = () => {
    if (chatLoading) return;
    setChatMessages([]);
    setChatInput("");
    setSummaryError("");
  };

  const handleAskPage = async (retryPrompt?: string) => {
    if (chatLoading) return;

    const content = (retryPrompt ?? chatInput).trim();
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
      const intent = await resolveBrowserIntentForTask(content, {
        onStatus: (status) => setAssistantStatus(assistantId, status),
        onClassifierFallback: (message) => pushAssistantEvent(assistantId, message),
      });
      const quickCommand = buildBrowserCommandFromIntent(intent);
      let assistantReply = "";
      let assistantNeedsHuman = false;
      let assistantReplyAlreadyVisible = false;

      if (intent.kind === "page_question") {
        setAssistantStatus(assistantId, "正在读取当前页面");
        await loadDetail(activeSessionId);
        setAssistantStatus(assistantId, "正在流式整理当前页面");
        let streamedPageReply = false;
        assistantReply = await answerCurrentPageQuestion(
          activeSessionId,
          intent.question,
          {
            onToken: (token) => {
              streamedPageReply = true;
              appendAssistantContent(assistantId, token);
            },
          },
        );
        assistantReplyAlreadyVisible = streamedPageReply;
      } else if (intent.kind === "research_query" && quickCommand?.actions.length) {
        setAssistantStatus(assistantId, "正在打开搜索结果");
        for (const action of quickCommand.actions) {
          pushAssistantEvent(assistantId, describeBrowserAction(action));
          const actionMessage = await executeAutomationAction(activeSessionId, action);
          pushAssistantEvent(assistantId, actionMessage);
        }
        setAssistantStatus(assistantId, "正在读取搜索结果");
        await loadDetail(activeSessionId);
        await loadSessions();
        setAssistantStatus(assistantId, "正在流式整理资料");
        let streamedResearchReply = false;
        assistantReply = await synthesizeResearchAnswer(
          activeSessionId,
          intent.query,
          {
            onToken: (token) => {
              streamedResearchReply = true;
              appendAssistantContent(assistantId, token);
            },
          },
        );
        assistantReplyAlreadyVisible = streamedResearchReply;
      } else if (quickCommand?.actions.length) {
        setAssistantStatus(assistantId, "正在执行快捷网页操作");
        for (const action of quickCommand.actions) {
          pushAssistantEvent(assistantId, describeBrowserAction(action));
          const actionMessage = await executeAutomationAction(activeSessionId, action);
          pushAssistantEvent(assistantId, actionMessage);
        }
        setAssistantStatus(assistantId, "正在刷新页面状态");
        await loadDetail(activeSessionId);
        await loadSessions();

        const followupResult = quickCommand.followupPrompt
          ? await runBrowserTaskAgent(activeSessionId, quickCommand.followupPrompt, {
              onStatus: (status) => setAssistantStatus(assistantId, status),
              onActionStart: (message) => pushAssistantEvent(assistantId, message),
              onActionFinish: (message) => pushAssistantEvent(assistantId, message),
              onNeedHuman: async (reason) => {
                const normalizedReason =
                  reason.trim() || "请直接在左侧浏览器继续处理这个步骤。";
                pushAssistantEvent(assistantId, normalizedReason);
              },
            })
          : { reply: "已完成网页操作。", requiresHuman: false };
        assistantReply = followupResult.reply;
        if (followupResult.requiresHuman) {
          assistantNeedsHuman = true;
          setAssistantStatus(assistantId, "需要你继续操作");
        }
      } else {
        const agentTask = intent.kind === "browser_agent" ? intent.task : content;
        const taskResult = await runBrowserTaskAgent(activeSessionId, agentTask, {
          onStatus: (status) => setAssistantStatus(assistantId, status),
          onActionStart: (message) => pushAssistantEvent(assistantId, message),
          onActionFinish: (message) => pushAssistantEvent(assistantId, message),
          onNeedHuman: async (reason) => {
            const normalizedReason =
              reason.trim() || "请直接在左侧浏览器继续处理这个步骤。";
            pushAssistantEvent(assistantId, normalizedReason);
          },
        });
        assistantReply = taskResult.reply;
        if (taskResult.requiresHuman) {
          assistantNeedsHuman = true;
          setAssistantStatus(assistantId, "需要你继续操作");
        }
      }

      if (!assistantNeedsHuman && !assistantReplyAlreadyVisible) {
        setAssistantStatus(assistantId, "正在整理回复");
      }
      if (!assistantReplyAlreadyVisible) {
        await streamAssistantText(assistantId, assistantReply);
      }
      finalizeAssistantMessage(
        assistantId,
        assistantNeedsHuman ? "需要你继续操作" : "本轮任务已完成",
      );
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

  const handleRetryBrowserMessage = (assistantMessageId: string) => {
    const retryPrompt = findBrowserRetryPrompt(chatMessages, assistantMessageId);
    if (!retryPrompt || chatLoading) return;
    void handleAskPage(retryPrompt);
  };

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{
        background: "var(--window-content-bg)",
        color: "var(--t1)",
      }}
    >
      <div
        className="border-b px-4 py-2"
        style={{
          borderColor: "rgba(18, 30, 56, 0.08)",
          background:
            "linear-gradient(180deg, rgba(250,251,253,0.88) 0%, rgba(241,244,249,0.82) 100%)",
          backdropFilter: "blur(24px)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div
            className="flex items-center gap-2.5 text-[12px]"
            style={{ color: "var(--t2)" }}
          >
            <span
              className="font-medium"
              style={{ color: "var(--t1)" }}
            >
              浏览器
            </span>
            <span
              className="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px]"
              style={{
                background: runtime.ready
                  ? "rgba(52, 199, 89, 0.13)"
                  : "rgba(255, 149, 0, 0.13)",
                color: runtime.ready ? "#16884a" : "#a85f00",
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
            <div
              className="inline-flex h-7 items-center overflow-hidden rounded-[9px] border"
              style={{
                borderColor: "rgba(18, 30, 56, 0.1)",
                background: "rgba(255,255,255,0.64)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.78), 0 1px 2px rgba(18, 30, 56, 0.04)",
              }}
            >
              <button
                type="button"
                onClick={() => setPreciseControl((current) => !current)}
                title={
                  preciseControl
                    ? "关闭精准点击"
                    : "开启精准点击，适合点小按钮和表单"
                }
                className="inline-flex h-7 w-8 items-center justify-center border-r transition-colors"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  background: preciseControl ? "rgba(0, 122, 255, 0.1)" : "transparent",
                  color: preciseControl ? "#0a63d8" : "#5f6b7d",
                }}
              >
                <Globe size={13} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => void loadRuntime()}
                title="刷新状态"
                className="inline-flex h-7 w-8 items-center justify-center border-r transition-colors"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  color: "#5f6b7d",
                }}
              >
                <RefreshCw
                  size={13}
                  strokeWidth={1.9}
                  className={runtimeLoading ? "animate-spin" : ""}
                />
              </button>
              <button
                type="button"
                onClick={openCookieDialog}
                disabled={!activeSessionId}
                title="导入 Cookie"
                className="inline-flex h-7 w-8 items-center justify-center border-r transition-colors disabled:opacity-40"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  color: "#5f6b7d",
                }}
              >
                <Cookie size={13} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => void handleSaveLoginProfile()}
                disabled={!activeSessionId || savingProfile}
                title="保存登录态"
                className="inline-flex h-7 w-8 items-center justify-center border-r transition-colors disabled:opacity-40"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  color: "#5f6b7d",
                }}
              >
                {savingProfile ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Save size={13} strokeWidth={1.9} />
                )}
              </button>
              <button
                type="button"
                onClick={() => void openLibraryDialog("profiles")}
                title="资料库"
                className="inline-flex h-7 w-8 items-center justify-center border-r transition-colors"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  color: "#5f6b7d",
                }}
              >
                <BookOpen size={13} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => void handleSavePageToKnowledge()}
                disabled={!activeSessionId || savingKnowledge}
                title="存入知识库"
                className="inline-flex h-7 w-8 items-center justify-center transition-colors disabled:opacity-40"
                style={{
                  color: activeSessionId ? "#0a63d8" : "#8f99a8",
                }}
              >
                {savingKnowledge ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <BookOpen size={13} strokeWidth={1.9} />
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleCreateSession()}
              disabled={!runtime.ready || creating}
              title="新建会话"
              className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-[12px] font-medium"
              style={{
                background: "linear-gradient(180deg, #1684ff 0%, #0870e8 100%)",
                color: "#fff",
                opacity: !runtime.ready || creating ? 0.6 : 1,
                boxShadow:
                  "0 4px 10px rgba(0, 112, 232, 0.22), inset 0 1px 0 rgba(255,255,255,0.28)",
              }}
            >
              {creating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              {creating ? "创建中" : "新建"}
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

        {notice ? (
          <div
            className="mb-3 rounded-2xl px-3 py-3 text-[13px] leading-6"
            style={{
              background: "rgba(16, 185, 129, 0.1)",
              color: "#0f8c68",
            }}
          >
            {notice}
          </div>
        ) : null}

        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void runSessionAction("back")}
            disabled={!activeSessionId || reloading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border"
            style={{
              borderColor: "var(--border)",
              background: "var(--control-bg)",
              color: activeSessionId ? "var(--t1)" : "var(--t3)",
            }}
          >
            <ArrowLeft size={14} />
          </button>

          <button
            type="button"
            onClick={() => void runSessionAction("forward")}
            disabled={!activeSessionId || reloading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border"
            style={{
              borderColor: "var(--border)",
              background: "var(--control-bg)",
              color: activeSessionId ? "var(--t1)" : "var(--t3)",
            }}
          >
            <ArrowRight size={14} />
          </button>

          <button
            type="button"
            onClick={() => void runSessionAction("reload")}
            disabled={!activeSessionId || reloading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border"
            style={{
              borderColor: "var(--border)",
              background: "var(--control-bg)",
              color: activeSessionId ? "var(--t1)" : "var(--t3)",
            }}
          >
            {reloading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
          <form
            onSubmit={handleNavigate}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <div
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--input-bg)",
              }}
            >
              <Globe size={13} style={{ color: "var(--t3)", flexShrink: 0 }} />
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
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                style={{ color: "var(--t1)" }}
                disabled={!activeSessionId}
              />
            </div>
            <button
              type="submit"
              disabled={!activeSessionId || navigating}
              className="inline-flex h-8 items-center justify-center rounded-xl px-3 text-[12px] font-medium"
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
                          : "var(--control-bg)",
                      color:
                        session.id === activeSessionId ? "#0f56cf" : "var(--t2)",
                      border: "1px solid var(--border)",
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
                borderColor: "var(--border)",
                background: "var(--surface-solid)",
                boxShadow: "var(--shadow-window)",
              }}
            >
              {activeSessionId && detail ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div
                    className="flex shrink-0 items-end justify-between gap-2 border-b px-2.5 pt-1.5 pb-0"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--panel-bg)",
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
                              ? "var(--surface-solid)"
                              : "var(--control-bg)",
                            color: tab.is_active ? "var(--t1)" : "var(--t2)",
                            border: "1px solid var(--border)",
                            borderBottomColor: tab.is_active
                              ? "var(--surface-solid)"
                              : "var(--border)",
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
                                color: "var(--t3)",
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
                          borderColor: "var(--border)",
                          background: "var(--control-bg)",
                          color: "var(--t2)",
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
                      background: "var(--panel-bg-soft)",
                    }}
                  >
                    <div
                      className="relative h-full overflow-hidden rounded-[20px]"
                      style={{
                        background: "#ffffff",
                        boxShadow: viewportFocused
                          ? "0 0 0 2px rgba(22, 119, 255, 0.22), 0 22px 44px rgba(21, 33, 57, 0.16)"
                          : "0 22px 44px rgba(21, 33, 57, 0.12)",
                      }}
                    >
                      {liveUrl ? (
                        <iframe
                          key={liveFrameKey}
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
                  <Monitor size={34} style={{ color: "var(--t3)" }} />
                  <div
                    className="text-[16px] font-semibold"
                    style={{ color: "var(--t1)" }}
                  >
                    还没有打开浏览器
                  </div>
                  <p
                    className="max-w-[420px] text-[13px] leading-6"
                    style={{ color: "var(--t2)" }}
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
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border"
              style={{
                borderColor: "var(--border)",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,247,252,0.88) 100%)",
                backdropFilter: "blur(28px)",
                boxShadow:
                  "0 22px 58px rgba(20, 31, 52, 0.14), inset 0 1px 0 rgba(255,255,255,0.92)",
              }}
            >
              <div
                className="shrink-0 px-5 pb-3 pt-4"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center">
                    <div className="min-w-0">
                      <div
                        className="truncate text-[15px] font-semibold"
                        style={{ color: "var(--t1)" }}
                      >
                        浏览器助手
                      </div>
                      <div className="mt-0.5 truncate text-[12px]" style={{ color: "var(--t2)" }}>
                        用对话驱动真实浏览器
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <div
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                      style={{
                        background: activeSessionId
                          ? "rgba(16, 185, 129, 0.1)"
                          : "rgba(148, 163, 184, 0.14)",
                        color: activeSessionId
                          ? "#0f8c68"
                          : "#64748b",
                      }}
                    >
                      {activeSessionId ? "已连接" : "未连接"}
                    </div>
                    <button
                      type="button"
                      onClick={handleClearBrowserChat}
                      disabled={chatLoading || chatMessages.length === 0}
                      title="清空对话"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                      style={{
                        background: "rgba(15, 23, 42, 0.05)",
                        color:
                          chatLoading || chatMessages.length === 0
                            ? "#b3bdcb"
                            : "#66748a",
                        border: "1px solid rgba(18, 30, 56, 0.06)",
                        opacity: chatLoading || chatMessages.length === 0 ? 0.72 : 1,
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(249,251,255,0.38) 0%, rgba(237,241,248,0.64) 100%)",
                  }}
                >
                  <div
                    ref={chatScrollRef}
                    className="browser-chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-3 pt-4"
                  >
                    <div className="min-w-0 space-y-5">
                      {chatMessages.length > 0 ? (
                        chatMessages.map((message) =>
                          message.role === "user" ? (
                            <div
                              key={message.id}
                              className="min-w-0 flex justify-end"
                            >
                              <div
                                className="min-w-0 max-w-[78%] rounded-[20px] rounded-tr-[7px] px-4 py-3"
                                style={{
                                  background:
                                    "linear-gradient(180deg, #dbe9ff 0%, #c9dcfb 100%)",
                                  border: "1px solid rgba(94, 141, 210, 0.18)",
                                  boxShadow:
                                    "0 12px 28px rgba(61, 93, 143, 0.14), inset 0 1px 0 rgba(255,255,255,0.72)",
                                }}
                              >
                                <div
                                  className="whitespace-pre-wrap break-words text-[14px] leading-6"
                                  style={{
                                    color: "#18253b",
                                    overflowWrap: "anywhere",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {message.content}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div key={message.id} className="min-w-0 flex gap-3">
                              <div
                                className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]"
                                style={{
                                  background:
                                    "linear-gradient(145deg, #6d8ef7 0%, #4666dd 100%)",
                                  border: "1px solid rgba(84, 119, 220, 0.2)",
                                  boxShadow:
                                    "0 14px 24px rgba(72, 96, 190, 0.22), inset 0 1px 0 rgba(255,255,255,0.24)",
                                  color: "#ffffff",
                                }}
                              >
                                <Sparkles size={14} strokeWidth={1.9} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="mb-1.5 flex min-w-0 items-center gap-2">
                                  <span
                                    className="min-w-0 truncate text-[12px] font-medium"
                                    style={{ color: "#31405b" }}
                                  >
                                    浏览器助手
                                  </span>
                                  {message.status ? (
                                    <div
                                      className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                                      style={{
                                        background: message.streaming
                                          ? "rgba(65, 105, 225, 0.1)"
                                          : "rgba(116, 129, 151, 0.11)",
                                        color: message.streaming ? "#3a5ed7" : "#6b7890",
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
                                  {message.status === "执行失败" ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRetryBrowserMessage(message.id)
                                      }
                                      disabled={
                                        chatLoading ||
                                        !findBrowserRetryPrompt(
                                          chatMessages,
                                          message.id,
                                        )
                                      }
                                      title="重试上一条任务"
                                      className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium"
                                      style={{
                                        background: "rgba(15, 23, 42, 0.05)",
                                        color: chatLoading ? "#a7b1c1" : "#60708f",
                                        border: "1px solid rgba(18, 30, 56, 0.06)",
                                      }}
                                    >
                                      <RefreshCw size={11} />
                                      重试
                                    </button>
                                  ) : null}
                                </div>

                                {message.events?.length ? (
                                  <div
                                    className="browser-agent-timeline mb-3 ml-1 min-w-0 space-y-2.5 border-l pl-3"
                                    style={{
                                      borderColor: "rgba(122, 145, 178, 0.22)",
                                    }}
                                  >
                                    {message.events.map((event, index) => (
                                      <div
                                        key={`${message.id}-event-${index}`}
                                        className="browser-agent-timeline-item relative min-w-0 whitespace-pre-wrap break-words text-[12px] leading-5"
                                        style={{
                                          color:
                                            index === message.events!.length - 1 && message.streaming
                                              ? "#516aa3"
                                              : "#7a8799",
                                          overflowWrap: "anywhere",
                                          wordBreak: "break-word",
                                        }}
                                      >
                                        <span
                                          className="absolute left-[-16px] top-[7px] h-1.5 w-1.5 rounded-full"
                                          style={{
                                            background:
                                              index === message.events!.length - 1 && message.streaming
                                                ? "#4f6feb"
                                                : "#a9b5c8",
                                            boxShadow:
                                              index === message.events!.length - 1 && message.streaming
                                                ? "0 0 0 4px rgba(79,111,235,0.12)"
                                                : "none",
                                          }}
                                        />
                                        {event}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}

                                {message.content ? (
                                  <div
                                    className="markdown min-w-0 break-words rounded-[20px] rounded-tl-[7px] border px-4 py-3 text-[14px] leading-6"
                                    style={{
                                      color: "#202b3d",
                                      borderColor: "rgba(18, 30, 56, 0.08)",
                                      background: "rgba(255,255,255,0.78)",
                                      boxShadow:
                                        "0 14px 32px rgba(31, 44, 67, 0.1), inset 0 1px 0 rgba(255,255,255,0.86)",
                                      overflowWrap: "anywhere",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={browserMarkdownComponents}
                                    >
                                      {message.content}
                                    </ReactMarkdown>
                                    {message.streaming ? (
                                      <span
                                        className="browser-agent-caret ml-0.5 inline-block h-5 w-[2px] align-[-3px]"
                                        style={{ background: "var(--t3)" }}
                                      />
                                    ) : null}
                                  </div>
                                ) : message.streaming ? (
                                  <div
                                    className="inline-flex rounded-[18px] rounded-tl-[7px] border px-4 py-3 text-[14px] leading-6"
                                    style={{
                                      color: "#657186",
                                      borderColor: "rgba(18, 30, 56, 0.08)",
                                      background: "rgba(255,255,255,0.72)",
                                    }}
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
                          className="mx-auto mt-8 max-w-[320px] px-3 text-center"
                          style={{
                            color: "var(--t2)",
                          }}
                        >
                          <div className="flex flex-col items-center">
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px]"
                              style={{
                                background:
                                  "linear-gradient(145deg, rgba(109,142,247,0.16), rgba(70,102,221,0.12))",
                                border: "1px solid rgba(84, 119, 220, 0.16)",
                                boxShadow:
                                  "0 12px 24px rgba(61, 80, 145, 0.12), inset 0 1px 0 rgba(255,255,255,0.78)",
                              }}
                            >
                              <Sparkles size={16} style={{ color: "#526edb" }} />
                            </div>
                            <div className="mt-3 min-w-0">
                              <div
                                className="text-[13px] font-medium"
                                style={{ color: "#344154" }}
                              >
                                可以直接交给浏览器助手
                              </div>
                              <div
                                className="mt-1 text-[12px] leading-5"
                                style={{ color: "var(--t2)" }}
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
                    className="shrink-0 px-4 pb-3 pt-1.5"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(237,241,248,0) 0%, rgba(237,241,248,0.96) 38%, rgba(237,241,248,0.98) 100%)",
                    }}
                  >
                    {summaryError ? (
                      <div
                        className="mb-3 rounded-[16px] px-3 py-3 text-[12px] leading-5"
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
                      className="rounded-[22px] border px-3 pb-2 pt-2.5"
                      style={{
                        borderColor: "rgba(18, 30, 56, 0.09)",
                        background: "rgba(255,255,255,0.86)",
                        boxShadow:
                          "0 16px 34px rgba(31, 44, 67, 0.12), inset 0 1px 0 rgba(255,255,255,0.92)",
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
                        className="min-h-[44px] max-h-[120px] w-full resize-none border-0 bg-transparent px-1.5 py-1 text-[14px] leading-6 outline-none"
                        style={{
                          color: "#202b3d",
                        }}
                      />

                      <div className="mt-1 flex items-center justify-between gap-3">
                        <div
                          className="text-[11px]"
                          style={{ color: "var(--t3)" }}
                        >
                          Enter 发送，Shift + Enter 换行
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleAskPage()}
                          disabled={!chatInput.trim() || chatLoading}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium"
                          style={{
                            background:
                              !chatInput.trim() || chatLoading
                                ? "rgba(15, 23, 42, 0.06)"
                                : "linear-gradient(180deg, #3f65f0 0%, #2d52d8 100%)",
                            color:
                              !chatInput.trim() || chatLoading ? "#a0a9b8" : "#fff",
                            boxShadow:
                              !chatInput.trim() || chatLoading
                                ? "none"
                                : "0 12px 22px rgba(63, 101, 240, 0.24), inset 0 1px 0 rgba(255,255,255,0.3)",
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

      {profilesDialogOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center px-5 py-6"
          style={{
            background: "rgba(232, 238, 247, 0.5)",
            backdropFilter: "blur(14px)",
          }}
          onClick={() => {
            if (
              !savingProfile &&
              !profilesLoading &&
              !historyLoading &&
              !applyingProfileId &&
              !deletingProfileId &&
              !switchingHistoryId &&
              !reopeningHistoryId
            ) {
              setProfilesDialogOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-[720px] rounded-[28px] border p-5"
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
                  资料库
                </div>
                <div
                  className="mt-1 text-[20px] font-semibold tracking-[0.02em]"
                  style={{ color: "#1d2b42" }}
                >
                  登录态与历史会话
                </div>
                <div
                  className="mt-2 max-w-[460px] text-[12px] leading-5"
                  style={{ color: "#60708f" }}
                >
                  这里可以查看已保存登录态、恢复到当前会话，也可以回看最近的浏览器历史操作记录。
                </div>
              </div>

              <button
                type="button"
                onClick={() => setProfilesDialogOpen(false)}
                disabled={
                  savingProfile ||
                  profilesLoading ||
                  historyLoading ||
                  Boolean(applyingProfileId) ||
                  Boolean(deletingProfileId) ||
                  Boolean(switchingHistoryId) ||
                  Boolean(reopeningHistoryId)
                }
                className="inline-flex h-9 w-9 items-center justify-center rounded-full"
                style={{
                  background: "rgba(15, 23, 42, 0.05)",
                  color:
                    savingProfile ||
                    profilesLoading ||
                    historyLoading ||
                    applyingProfileId ||
                    deletingProfileId ||
                    switchingHistoryId ||
                    reopeningHistoryId
                      ? "#b2bdd0"
                      : "#64748b",
                  border: "1px solid rgba(18, 30, 56, 0.06)",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div
                className="inline-flex rounded-[18px] border p-1"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  background: "rgba(244, 247, 252, 0.88)",
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleChangeLibraryTab("profiles")}
                  className="inline-flex h-9 items-center justify-center rounded-[14px] px-3 text-[12px] font-medium"
                  style={{
                    background:
                      libraryTab === "profiles"
                        ? "linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(10,87,214,0.1) 100%)"
                        : "transparent",
                    color: libraryTab === "profiles" ? "#0f56cf" : "#60708f",
                  }}
                >
                  已保存登录态
                </button>
                <button
                  type="button"
                  onClick={() => void handleChangeLibraryTab("history")}
                  className="inline-flex h-9 items-center justify-center rounded-[14px] px-3 text-[12px] font-medium"
                  style={{
                    background:
                      libraryTab === "history"
                        ? "linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(10,87,214,0.1) 100%)"
                        : "transparent",
                    color: libraryTab === "history" ? "#0f56cf" : "#60708f",
                  }}
                >
                  历史会话
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  void (libraryTab === "profiles"
                    ? handleRefreshProfiles()
                    : handleRefreshHistorySessions())
                }
                className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl px-3 text-[12px]"
                style={{
                  background: "rgba(15, 23, 42, 0.05)",
                  color: "#52627d",
                  border: "1px solid rgba(18, 30, 56, 0.06)",
                }}
              >
                <RefreshCw size={13} />
                刷新列表
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div
                className="rounded-[20px] border px-4 py-3"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(246,249,255,0.86) 100%)",
                }}
              >
                <div
                  className="text-[11px] font-semibold tracking-[0.08em]"
                  style={{ color: "#8a9ab5" }}
                >
                  已保存登录态
                </div>
                <div
                  className="mt-1 text-[24px] font-semibold"
                  style={{ color: "#1d2b42" }}
                >
                  {savedProfiles.length}
                </div>
                <div
                  className="mt-1 text-[12px] leading-5"
                  style={{ color: "#60708f" }}
                >
                  {profileScope === "current"
                    ? "当前站点可直接恢复的登录资料"
                    : "你保存过的全部站点登录资料"}
                </div>
              </div>

              <div
                className="rounded-[20px] border px-4 py-3"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(246,249,255,0.86) 100%)",
                }}
              >
                <div
                  className="text-[11px] font-semibold tracking-[0.08em]"
                  style={{ color: "#8a9ab5" }}
                >
                  历史会话
                </div>
                <div
                  className="mt-1 text-[24px] font-semibold"
                  style={{ color: "#1d2b42" }}
                >
                  {historySessions.length}
                </div>
                <div
                  className="mt-1 text-[12px] leading-5"
                  style={{ color: "#60708f" }}
                >
                  当前筛选条件下可回看的浏览器会话记录
                </div>
              </div>

              <div
                className="rounded-[20px] border px-4 py-3"
                style={{
                  borderColor: "rgba(18, 30, 56, 0.08)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(246,249,255,0.86) 100%)",
                }}
              >
                <div
                  className="text-[11px] font-semibold tracking-[0.08em]"
                  style={{ color: "#8a9ab5" }}
                >
                  当前目标站点
                </div>
                <div
                  className="mt-1 truncate text-[14px] font-medium"
                  style={{ color: "#1d2b42" }}
                >
                  {resolveCurrentSiteUrl() || "尚未打开具体网页"}
                </div>
                <div
                  className="mt-1 text-[12px] leading-5"
                  style={{ color: "#60708f" }}
                >
                  保存或恢复登录态时会优先参考这个地址
                </div>
              </div>
            </div>

            <div className="mt-5">
              {libraryTab === "profiles" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleChangeProfileScope("current")}
                        className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12px] font-medium"
                        style={{
                          background:
                            profileScope === "current"
                              ? "rgba(22,119,255,0.12)"
                              : "rgba(15, 23, 42, 0.05)",
                          color:
                            profileScope === "current" ? "#0f56cf" : "#60708f",
                        }}
                      >
                        当前站点
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleChangeProfileScope("all")}
                        className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12px] font-medium"
                        style={{
                          background:
                            profileScope === "all"
                              ? "rgba(22,119,255,0.12)"
                              : "rgba(15, 23, 42, 0.05)",
                          color: profileScope === "all" ? "#0f56cf" : "#60708f",
                        }}
                      >
                        全部登录态
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSaveLoginProfile()}
                      disabled={!activeSessionId || savingProfile}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[12px] font-medium"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(10,87,214,0.1) 100%)",
                        color: activeSessionId ? "#0f56cf" : "#9ba8bd",
                        border: "1px solid rgba(17, 92, 214, 0.08)",
                        opacity: !activeSessionId || savingProfile ? 0.7 : 1,
                      }}
                    >
                      {savingProfile ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      保存当前会话登录态
                    </button>
                  </div>

                  <div
                    className="rounded-[18px] border px-3.5 py-3 text-[12px] leading-5"
                    style={{
                      borderColor: "rgba(18, 30, 56, 0.08)",
                      color: "#60708f",
                      background: "rgba(255,255,255,0.72)",
                    }}
                  >
                    {profileScope === "current"
                      ? resolveCurrentSiteUrl()
                        ? "这里优先展示和当前网页域名匹配的登录态，恢复后会直接写入当前浏览器会话。"
                        : "当前还没有明确站点地址，所以建议切到“全部登录态”查看你之前保存过的资料。"
                      : "这里会列出所有已保存的登录态资料，你可以直接恢复到当前浏览器会话。"}
                  </div>

                  {profilesLoading ? (
                    <div
                      className="flex items-center justify-center gap-2 rounded-[22px] border px-4 py-10 text-[13px]"
                      style={{
                        borderColor: "rgba(18, 30, 56, 0.08)",
                        color: "#60708f",
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(246,249,255,0.84) 100%)",
                      }}
                    >
                      <Loader2 size={16} className="animate-spin" />
                      正在读取已保存登录态…
                    </div>
                  ) : savedProfiles.length > 0 ? (
                    <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                    {savedProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="rounded-[22px] border px-4 py-3"
                        style={{
                          borderColor: "rgba(18, 30, 56, 0.08)",
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(246,249,255,0.86) 100%)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div
                              className="truncate text-[14px] font-medium"
                              style={{ color: "#1d2b42" }}
                            >
                              {profile.label}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                              <span
                                className="rounded-full px-2.5 py-1"
                                style={{
                                  background: "rgba(22,119,255,0.12)",
                                  color: "#0f56cf",
                                }}
                              >
                                {profile.site_host || "未识别域名"}
                              </span>
                            </div>
                            <div
                              className="mt-1 text-[12px]"
                              style={{
                                color: "#60708f",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                              }}
                            >
                              {profile.site_url}
                            </div>
                            <div
                              className="mt-2 text-[11px]"
                              style={{ color: "#8a9ab5" }}
                            >
                              {profile.cookie_count} 个 Cookie
                              {profile.last_used_at
                                ? ` · 最近使用 ${new Date(profile.last_used_at).toLocaleString()}`
                                : ` · 保存于 ${new Date(profile.created_at).toLocaleString()}`}
                              {profile.source_session_id
                                ? ` · 来源会话 ${profile.source_session_id.slice(0, 8)}`
                                : ""}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleApplyLoginProfile(profile.id)}
                              disabled={
                                !activeSessionId || applyingProfileId === profile.id
                              }
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium"
                              style={{
                                background:
                                  "linear-gradient(135deg, #1677ff 0%, #0a57d6 100%)",
                                color: "#fff",
                                opacity:
                                  !activeSessionId || applyingProfileId === profile.id
                                    ? 0.7
                                    : 1,
                              }}
                            >
                              {applyingProfileId === profile.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <RefreshCw size={14} />
                              )}
                              恢复到当前会话
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteLoginProfile(profile.id)}
                              disabled={deletingProfileId === profile.id}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px]"
                              style={{
                                background: "rgba(248, 113, 113, 0.08)",
                                color: "#dc2626",
                                border: "1px solid rgba(248, 113, 113, 0.12)",
                                opacity: deletingProfileId === profile.id ? 0.7 : 1,
                              }}
                            >
                              {deletingProfileId === profile.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="rounded-[22px] border border-dashed px-4 py-10 text-center text-[13px] leading-6"
                    style={{
                      borderColor: "rgba(18, 30, 56, 0.1)",
                      color: "#60708f",
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(247,250,255,0.82) 100%)",
                    }}
                  >
                    {profileScope === "current"
                      ? "当前站点还没有已保存的登录态资料。你可以先登录，再点“保存当前会话登录态”，或者切到“全部登录态”查看其他站点。"
                      : "当前还没有可恢复的登录态资料。"}
                  </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    className="rounded-[18px] border px-3.5 py-3 text-[12px] leading-5"
                    style={{
                      borderColor: "rgba(18, 30, 56, 0.08)",
                      color: "#60708f",
                      background: "rgba(255,255,255,0.72)",
                    }}
                  >
                    进行中的会话可以直接切回去继续操作；已经关闭的会话可以按当时的网址重新打开一个新会话。
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: "all", label: "全部" },
                      { id: "active", label: "进行中" },
                      { id: "closed", label: "已关闭" },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          setHistoryFilter(
                            item.id as "all" | "active" | "closed",
                          )
                        }
                        className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12px] font-medium"
                        style={{
                          background:
                            historyFilter === item.id
                              ? "rgba(22,119,255,0.12)"
                              : "rgba(15, 23, 42, 0.05)",
                          color: historyFilter === item.id ? "#0f56cf" : "#60708f",
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  {historyLoading ? (
                    <div
                      className="flex items-center justify-center gap-2 rounded-[22px] border px-4 py-10 text-[13px]"
                      style={{
                        borderColor: "rgba(18, 30, 56, 0.08)",
                        color: "#60708f",
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(246,249,255,0.84) 100%)",
                      }}
                    >
                      <Loader2 size={16} className="animate-spin" />
                      正在读取历史会话…
                    </div>
                  ) : historySessions.length > 0 ? (
                    <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                      {historySessions.map((session) => {
                        const expanded = expandedHistoryId === session.id;
                        const statusColor =
                          session.status === "closed"
                              ? "#64748b"
                              : "#0f8c68";
                        const statusBg =
                          session.status === "closed"
                              ? "rgba(148,163,184,0.14)"
                              : "rgba(16,185,129,0.1)";

                        return (
                          <div
                            key={session.id}
                            className="rounded-[22px] border px-4 py-3"
                            style={{
                              borderColor: "rgba(18, 30, 56, 0.08)",
                              background:
                                "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(246,249,255,0.86) 100%)",
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div
                                  className="truncate text-[14px] font-medium"
                                  style={{ color: "#1d2b42" }}
                                >
                                  {session.current_title || "未命名页面"}
                                </div>
                                <div
                                  className="mt-1 text-[12px]"
                                  style={{
                                    color: "#60708f",
                                    overflowWrap: "anywhere",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {session.current_url || "about:blank"}
                                </div>
                                <div
                                  className="mt-2 flex flex-wrap items-center gap-2 text-[11px]"
                                  style={{ color: "#8a9ab5" }}
                                >
                                  <span
                                    className="rounded-full px-2.5 py-1"
                                    style={{ background: statusBg, color: statusColor }}
                                  >
                                    {session.status === "closed"
                                        ? "已关闭"
                                        : "进行中"}
                                  </span>
                                  <span>{session.tab_count} 个标签页</span>
                                  <span>
                                    最近更新 {new Date(session.updated_at).toLocaleString()}
                                  </span>
                                  <span>创建于 {new Date(session.created_at).toLocaleString()}</span>
                                </div>
                                {session.last_error ? (
                                  <div
                                    className="mt-2 text-[12px] leading-5"
                                    style={{ color: "#d83b3b" }}
                                  >
                                    最近错误：{session.last_error}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                {session.status !== "closed" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleSwitchToHistorySession(session.id)
                                    }
                                    disabled={switchingHistoryId === session.id}
                                    className="inline-flex h-9 items-center justify-center gap-2 rounded-full px-3 text-[12px] font-medium"
                                    style={{
                                      background:
                                        "linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(10,87,214,0.1) 100%)",
                                      color: "#0f56cf",
                                      opacity:
                                        switchingHistoryId === session.id ? 0.7 : 1,
                                    }}
                                  >
                                    {switchingHistoryId === session.id ? (
                                      <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                      <Monitor size={13} />
                                    )}
                                    {session.id === activeSessionId
                                      ? "当前会话"
                                      : "切换到该会话"}
                                  </button>
                                ) : null}

                                {session.current_url &&
                                session.current_url !== "about:blank" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleReopenHistorySession(session)
                                    }
                                    disabled={reopeningHistoryId === session.id}
                                    className="inline-flex h-9 items-center justify-center gap-2 rounded-full px-3 text-[12px]"
                                    style={{
                                      background: "rgba(15, 23, 42, 0.05)",
                                      color: "#52627d",
                                      opacity:
                                        reopeningHistoryId === session.id ? 0.7 : 1,
                                    }}
                                  >
                                    {reopeningHistoryId === session.id ? (
                                      <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                      <Play size={13} />
                                    )}
                                    按此网址新开
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedHistoryId(expanded ? "" : session.id)
                                  }
                                  className="inline-flex h-9 items-center justify-center rounded-full px-3 text-[12px]"
                                  style={{
                                    background: "rgba(15, 23, 42, 0.05)",
                                    color: "#52627d",
                                  }}
                                >
                                  {expanded ? "收起详情" : "查看详情"}
                                </button>
                              </div>
                            </div>

                            {expanded ? (
                              <div
                                className="mt-3 rounded-[18px] border px-3.5 py-3"
                                style={{
                                  borderColor: "rgba(18, 30, 56, 0.08)",
                                  background:
                                    "linear-gradient(180deg, rgba(249,251,255,0.92) 0%, rgba(244,247,252,0.88) 100%)",
                                }}
                              >
                                <div
                                  className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
                                  style={{ color: "#8a9ab5" }}
                                >
                                  最近动作
                                </div>
                                <div
                                  className="mb-2 text-[11px]"
                                  style={{ color: "#8a9ab5" }}
                                >
                                  会话 ID：{session.id}
                                  {session.closed_at
                                    ? ` · 关闭于 ${new Date(session.closed_at).toLocaleString()}`
                                    : ""}
                                  {session.action_log?.length
                                    ? ` · 共记录 ${session.action_log.length} 条动作`
                                    : ""}
                                </div>
                                {session.action_log?.length ? (
                                  <div className="space-y-2">
                                    {session.action_log.slice(0, 10).map((item, index) => (
                                      <div
                                        key={`${session.id}-log-${index}`}
                                        className="rounded-[14px] px-3 py-2"
                                        style={{
                                          background: "rgba(255,255,255,0.74)",
                                          border: "1px solid rgba(18, 30, 56, 0.06)",
                                        }}
                                      >
                                        <div
                                          className="text-[11px] font-medium"
                                          style={{ color: "#52627d" }}
                                        >
                                          {item.action} · {new Date(item.ts).toLocaleString()}
                                        </div>
                                        <div
                                          className="mt-1 text-[12px] leading-5"
                                          style={{
                                            color: "#60708f",
                                            overflowWrap: "anywhere",
                                            wordBreak: "break-word",
                                          }}
                                        >
                                          {item.detail}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div
                                    className="text-[12px]"
                                    style={{ color: "#60708f" }}
                                  >
                                    暂时还没有记录到动作详情。
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="rounded-[22px] border border-dashed px-4 py-10 text-center text-[13px] leading-6"
                      style={{
                        borderColor: "rgba(18, 30, 56, 0.1)",
                        color: "#60708f",
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(247,250,255,0.82) 100%)",
                      }}
                    >
                      还没有可查看的历史会话记录。
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
