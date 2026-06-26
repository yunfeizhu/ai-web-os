import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MailApp } from "./MailApp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("MailApp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/mail/accounts/acc-1/messages")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/mail/accounts")) {
          return new Response(
            JSON.stringify([
              {
                id: "acc-1",
                label: "同花顺邮箱",
                email: "wangxuyang2@myhexin.com",
                imap_host: "imap.example.com",
                imap_port: 993,
                imap_username: "wangxuyang2@myhexin.com",
                imap_password: "secret",
                imap_ssl: true,
                smtp_host: "smtp.example.com",
                smtp_port: 465,
                smtp_username: "wangxuyang2@myhexin.com",
                smtp_password: "secret",
                smtp_ssl: true,
              },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the mail client with a macOS-style sidebar and icon toolbar", async () => {
    await act(async () => {
      root.render(<MailApp />);
    });

    await act(async () => {});

    const shell = container.querySelector<HTMLElement>('[data-testid="mail-macos-shell"]');
    const sidebar = container.querySelector<HTMLElement>('[data-testid="mail-sidebar"]');
    const kicker = container.querySelector<HTMLElement>('[data-testid="mail-sidebar-kicker"]');
    const title = container.querySelector<HTMLElement>('[data-testid="mail-sidebar-title"]');
    const composeButton = container.querySelector<HTMLElement>('button[aria-label="写邮件"]');
    const addAccountButton = container.querySelector<HTMLElement>('button[aria-label="新增邮箱账户"]');
    const accountRow = container.querySelector<HTMLElement>('[data-testid="mail-account-row"]');
    const messageColumn = container.querySelector<HTMLElement>(
      '[data-testid="mail-message-list-column"]',
    );

    expect(shell).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(kicker?.textContent).toBe("收件中心");
    expect(title?.textContent).toBe("邮件");
    expect(sidebar?.style.backdropFilter).toContain("blur");
    expect(composeButton).not.toBeNull();
    expect(composeButton?.textContent).not.toContain("写邮件");
    expect(composeButton?.querySelector("svg")).not.toBeNull();
    expect(addAccountButton).not.toBeNull();
    expect(addAccountButton?.textContent).not.toContain("新增");
    expect(addAccountButton?.querySelector("svg")).not.toBeNull();
    expect(accountRow?.style.borderRadius).toBe("10px");
    expect(messageColumn?.style.width).toBe("330px");
  });
});
