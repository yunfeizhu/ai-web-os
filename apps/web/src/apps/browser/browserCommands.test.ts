import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildBrowserCommandFromIntent,
  buildResearchFallbackAnswer,
  detectLocalBrowserIntent,
  findBrowserRetryPrompt,
  parseBrowserIntentClassification,
  parseQuickBrowserCommand,
  shouldStopForRepeatedBrowserAction,
  withBrowserTaskTimeout,
} from "./Browser";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseQuickBrowserCommand", () => {
  it("routes simple search commands directly to Baidu results", () => {
    const intent = detectLocalBrowserIntent("搜索杭州天气");
    const command = intent ? buildBrowserCommandFromIntent(intent) : null;

    expect(command?.actions).toEqual([
      {
        action: "navigate",
        url: "https://www.baidu.com/s?wd=%E6%9D%AD%E5%B7%9E%E5%A4%A9%E6%B0%94",
      },
    ]);
    expect(command?.followupPrompt).toBeUndefined();
  });

  it("keeps spaces inside search queries", () => {
    const intent = detectLocalBrowserIntent("搜索 tailwind css");
    const command = intent ? buildBrowserCommandFromIntent(intent) : null;

    expect(command?.actions).toEqual([
      {
        action: "navigate",
        url: "https://www.baidu.com/s?wd=tailwind%20css",
      },
    ]);
    expect(command?.followupPrompt).toBeUndefined();
  });

  it("supports search commands with a follow-up task", () => {
    const intent = detectLocalBrowserIntent("搜索杭州天气然后总结一下");
    const command = intent ? buildBrowserCommandFromIntent(intent) : null;

    expect(command?.actions).toEqual([
      {
        action: "navigate",
        url: "https://www.baidu.com/s?wd=%E6%9D%AD%E5%B7%9E%E5%A4%A9%E6%B0%94",
      },
    ]);
    expect(command?.followupPrompt).toBe("总结一下");
  });

  it("recognizes lookup requests as research instead of page typing", () => {
    expect(detectLocalBrowserIntent("查一下2026世界杯每一组的比赛结果")).toEqual({
      kind: "research_query",
      query: "2026世界杯每一组的比赛结果",
      answerMode: "synthesize",
    });
  });

  it("answers visible page questions without opening a search", () => {
    const visibleHotSearchIntent = detectLocalBrowserIntent(
      "看下浏览器右边的百度热搜前十名",
    );
    expect(visibleHotSearchIntent).toEqual({
      kind: "page_question",
      question: "看下浏览器右边的百度热搜前十名",
    });
    expect(
      visibleHotSearchIntent
        ? buildBrowserCommandFromIntent(visibleHotSearchIntent)
        : null,
    ).toBeNull();

    expect(detectLocalBrowserIntent("百度热搜前十名是什么")).toEqual({
      kind: "page_question",
      question: "百度热搜前十名是什么",
    });
  });

  it("summarizes the current page without invoking browser planning", () => {
    for (const command of [
      "总结一下这个页面的内容",
      "总结一下呢",
      "这个页面讲了什么",
      "概括一下当前页面",
    ]) {
      expect(detectLocalBrowserIntent(command)).toEqual({
        kind: "page_question",
        question: command,
      });
    }
  });

  it("recognizes pagination requests locally", () => {
    expect(detectLocalBrowserIntent("切到第二页看看下")).toEqual({
      kind: "page_action",
      actions: [
        { action: "click", selector: "text=2" },
        { action: "wait_for", timeout_ms: 1500 },
      ],
    });

    expect(detectLocalBrowserIntent("翻到第三页")).toEqual({
      kind: "page_action",
      actions: [
        { action: "click", selector: "text=3" },
        { action: "wait_for", timeout_ms: 1500 },
      ],
    });

    expect(detectLocalBrowserIntent("翻页")).toEqual({
      kind: "page_action",
      actions: [
        { action: "click", selector: "text=下一页" },
        { action: "wait_for", timeout_ms: 1500 },
      ],
    });
  });

  it("parses structured model intent classifications", () => {
    expect(
      parseBrowserIntentClassification(
        '{"kind":"research_query","query":"2026世界杯每一组的比赛结果","answerMode":"synthesize"}',
        "查一下2026世界杯每一组的比赛结果",
      ),
    ).toEqual({
      kind: "research_query",
      query: "2026世界杯每一组的比赛结果",
      answerMode: "synthesize",
    });
  });

  it("keeps the old quick command facade for direct actions", () => {
    expect(parseQuickBrowserCommand("点击 登录")?.actions).toEqual([
      { action: "click", selector: "text=登录" },
    ]);
  });

  it("stops before repeating the same browser action too many times", () => {
    expect(
      shouldStopForRepeatedBrowserAction(
        [
          { action: "type_text", text: "2026世界杯小组赛结果" },
          { action: "type_text", text: "2026世界杯小组赛结果" },
        ],
        { action: "type_text", text: "2026世界杯小组赛结果" },
      ),
    ).toBe(true);
  });

  it("builds a fallback answer from extracted search result text", () => {
    expect(
      buildResearchFallbackAnswer(
        "2026世界杯每一组的比赛结果",
        [
          "A组（已全部结束）",
          "意大利 2-0 厄瓜多尔",
          "韩国 1-0 韩国（次轮）",
          "",
          "查看更多",
        ].join("\n"),
      ),
    ).toContain("A组（已全部结束）");
  });

  it("finds the previous user message for retry", () => {
    expect(
      findBrowserRetryPrompt(
        [
          { id: "u1", role: "user", content: "查一下杭州天气" },
          {
            id: "a1",
            role: "assistant",
            content: "执行失败",
            status: "执行失败",
          },
        ],
        "a1",
      ),
    ).toBe("查一下杭州天气");
  });

  it("rejects browser task planning when it takes too long", async () => {
    vi.useFakeTimers();
    const task = withBrowserTaskTimeout(
      new Promise<string>(() => {}),
      30000,
      "规划超时",
    );
    const assertion = expect(task).rejects.toThrow("规划超时");

    await vi.advanceTimersByTimeAsync(30000);

    await assertion;
  });
});
