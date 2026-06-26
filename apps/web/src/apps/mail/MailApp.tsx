"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  MailPlus,
  Paperclip,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";

import { apiFetch, buildApiUrl, completeOnce } from "@/lib/backend";

type MailFolderId = "inbox" | "sent" | "drafts";

interface MailAccount {
  id: string;
  label: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_ssl: boolean;
}

interface MailAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  inline: boolean;
  content_id?: string | null;
}

interface MailMessage {
  id: string;
  account_id: string;
  folder: MailFolderId | string;
  uid: string;
  message_id?: string | null;
  subject: string;
  sender: string;
  recipients: string;
  sent_at?: string | null;
  snippet: string;
  body_text: string;
  body_html?: string | null;
  seen: boolean;
  metadata?: Record<string, unknown>;
  attachments?: MailAttachment[];
}

interface AccountDraft {
  id?: string;
  label: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_ssl: boolean;
}

interface ComposeDraft {
  id?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

interface MailAppProps {
  appState?: Record<string, unknown>;
}

const MAIL_FOLDERS: Array<{ id: MailFolderId; label: string; emptyText: string }> = [
  { id: "inbox", label: "收件箱", emptyText: "当前收件箱还没有缓存邮件，点击上方“同步”即可拉取最新内容。" },
  { id: "sent", label: "已发送", emptyText: "这里会显示本地已发送记录，以及同步到的远端已发送邮件。" },
  { id: "drafts", label: "草稿箱", emptyText: "这里会显示你保存的本地草稿，以及同步到的远端草稿。" },
];

function emptyAccountDraft(): AccountDraft {
  return {
    label: "",
    email: "",
    imap_host: "",
    imap_port: 993,
    imap_username: "",
    imap_password: "",
    imap_ssl: true,
    smtp_host: "",
    smtp_port: 465,
    smtp_username: "",
    smtp_password: "",
    smtp_ssl: true,
  };
}

function emptyComposeDraft(): ComposeDraft {
  return { to: "", cc: "", bcc: "", subject: "", body: "" };
}

function isMailFolderId(value: unknown): value is MailFolderId {
  return value === "inbox" || value === "sent" || value === "drafts";
}

function pickDownloadFileName(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const plainMatch = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
  return plainMatch?.[1] || fallback;
}

export function MailApp({ appState }: MailAppProps) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeFolder, setActiveFolder] = useState<MailFolderId>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountDraft, setAccountDraft] = useState<AccountDraft>(emptyAccountDraft());
  const [savingAccount, setSavingAccount] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft>(emptyComposeDraft());
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [replyDrafting, setReplyDrafting] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [summaryText, setSummaryText] = useState("");

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) || null,
    [accounts, activeAccountId],
  );
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) || null,
    [messages, selectedMessageId],
  );
  const selectedAttachments = selectedMessage?.attachments || [];

  useEffect(() => {
    if (!appState) return;
    if (isMailFolderId(appState.activeFolder)) {
      setActiveFolder(appState.activeFolder);
    }
    if (appState.source === "ai-chat") {
      setStatusText("已从 AI 助手打开邮件。点击同步可刷新收件箱、已发送和草稿箱。");
    }
  }, [appState]);

  const loadAccounts = async (preferId?: string) => {
    const data = await apiFetch<MailAccount[]>("/mail/accounts");
    setAccounts(data);
    const nextId =
      preferId && data.some((item) => item.id === preferId)
        ? preferId
        : data[0]?.id || "";
    setActiveAccountId((current) => (current && data.some((item) => item.id === current) ? current : nextId));
  };

  const loadMessages = async (accountId: string, folder: MailFolderId) => {
    if (!accountId) {
      setMessages([]);
      setSelectedMessageId("");
      return;
    }

    setLoading(true);
    setSummaryText("");
    try {
      const data = await apiFetch<MailMessage[]>(
        `/mail/accounts/${accountId}/messages?folder=${folder}`,
      );
      setMessages(data);
      setSelectedMessageId((current) =>
        data.some((message) => message.id === current) ? current : data[0]?.id || "",
      );
    } catch {
      setStatusText("邮件列表读取失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts().catch(() => {
      setStatusText("账户列表读取失败。");
    });
  }, []);

  useEffect(() => {
    if (!activeAccountId) {
      setMessages([]);
      setSelectedMessageId("");
      return;
    }
    void loadMessages(activeAccountId, activeFolder);
  }, [activeAccountId, activeFolder]);

  useEffect(() => {
    setSummaryText("");
  }, [selectedMessageId, activeFolder]);

  const syncAllFolders = async () => {
    if (!activeAccount) return;
    setSyncing(true);
    setStatusText("");
    try {
      const syncedLabels: string[] = [];
      const failedLabels: string[] = [];

      for (const folder of MAIL_FOLDERS) {
        try {
          const data = await apiFetch<MailMessage[]>(
            `/mail/local/sync?folder=${folder.id}&limit=30`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(activeAccount),
            },
          );

          syncedLabels.push(folder.label);

          if (folder.id === activeFolder) {
            setMessages(data);
            setSelectedMessageId((current) =>
              data.some((message) => message.id === current) ? current : data[0]?.id || "",
            );
          }
        } catch {
          failedLabels.push(folder.label);
        }
      }

      if (failedLabels.length === 0) {
        setStatusText(`已同步${syncedLabels.join("、")}。`);
      } else if (syncedLabels.length === 0) {
        setStatusText("邮件同步失败，请检查邮箱配置。");
      } else {
        setStatusText(
          `已同步${syncedLabels.join("、")}；${failedLabels.join("、")}同步失败。`,
        );
      }
    } finally {
      setSyncing(false);
    }
  };

  const saveAccount = async () => {
    setSavingAccount(true);
    setStatusText("");
    try {
      const path = accountDraft.id ? `/mail/accounts/${accountDraft.id}` : "/mail/accounts";
      const account = await apiFetch<MailAccount>(path, {
        method: accountDraft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountDraft),
      });
      await loadAccounts(account.id);
      setAccountModalOpen(false);
      setStatusText("账户已保存到本地配置文件。");
    } catch {
      setStatusText("账户保存失败。");
    } finally {
      setSavingAccount(false);
    }
  };

  const deleteAccount = async () => {
    if (!accountDraft.id) return;
    try {
      await apiFetch(`/mail/accounts/${accountDraft.id}`, { method: "DELETE" });
      await loadAccounts();
      setMessages([]);
      setSelectedMessageId("");
      setAccountModalOpen(false);
      setStatusText("本地账户已删除。");
    } catch {
      setStatusText("账户删除失败。");
    }
  };

  const openAccountEditor = (account?: MailAccount) => {
    if (!account) {
      setAccountDraft(emptyAccountDraft());
      setAccountModalOpen(true);
      return;
    }

    setAccountDraft({
      id: account.id,
      label: account.label,
      email: account.email,
      imap_host: account.imap_host,
      imap_port: account.imap_port,
      imap_username: account.imap_username,
      imap_password: account.imap_password,
      imap_ssl: account.imap_ssl,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
      smtp_username: account.smtp_username,
      smtp_password: account.smtp_password,
      smtp_ssl: account.smtp_ssl,
    });
    setAccountModalOpen(true);
  };

  const openNewCompose = () => {
    setComposeDraft(emptyComposeDraft());
    setComposeOpen(true);
  };

  const openDraftComposer = (message: MailMessage) => {
    setComposeDraft({
      id: message.id,
      to: splitStoredEmails(message.recipients),
      cc: metadataString(message, "cc"),
      bcc: metadataString(message, "bcc"),
      subject: message.subject,
      body: message.body_text || "",
    });
    setComposeOpen(true);
  };

  const sendMail = async () => {
    if (!activeAccount) {
      setStatusText("请先配置一个邮箱账户。");
      return;
    }

    setSending(true);
    setStatusText("");
    try {
      const response = await apiFetch<{ status: string; message: MailMessage }>(
        "/mail/local/send",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: activeAccount,
            message: {
              to: splitEmails(composeDraft.to),
              cc: splitEmails(composeDraft.cc),
              bcc: splitEmails(composeDraft.bcc),
              subject: composeDraft.subject,
              body: composeDraft.body,
              draft_id: composeDraft.id,
            },
          }),
        },
      );
      setComposeOpen(false);
      setComposeDraft(emptyComposeDraft());
      setActiveFolder("sent");
      setStatusText("邮件已发送。");
      await loadMessages(activeAccount.id, "sent");
      setSelectedMessageId(response.message.id);
    } catch {
      setStatusText("发送失败，请检查发件服务器配置。");
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async () => {
    if (!activeAccount) {
      setStatusText("请先配置一个邮箱账户。");
      return;
    }

    setSavingDraft(true);
    setStatusText("");
    try {
      const draft = await apiFetch<MailMessage>("/mail/local/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: activeAccount,
          draft: {
            id: composeDraft.id,
            to: splitEmails(composeDraft.to),
            cc: splitEmails(composeDraft.cc),
            bcc: splitEmails(composeDraft.bcc),
            subject: composeDraft.subject,
            body: composeDraft.body,
          },
        }),
      });
      setComposeOpen(false);
      setComposeDraft(emptyComposeDraft());
      setActiveFolder("drafts");
      setStatusText("草稿已保存。");
      await loadMessages(activeAccount.id, "drafts");
      setSelectedMessageId(draft.id);
    } catch {
      setStatusText("草稿保存失败。");
    } finally {
      setSavingDraft(false);
    }
  };

  const summarizeMessage = async () => {
    if (!selectedMessage) return;
    setSummarizing(true);
    setSummaryText("");
    try {
      const result = await completeOnce(
        `请总结下面这封邮件，输出 3 到 5 条高价值要点。\n\n主题：${selectedMessage.subject}\n发件人：${selectedMessage.sender}\n正文：\n${selectedMessage.body_text || selectedMessage.snippet}`,
        "你是邮件总结助手，请直接输出简洁中文要点。",
      );
      setSummaryText(result.content);
    } catch {
      setStatusText("邮件总结失败。");
    } finally {
      setSummarizing(false);
    }
  };

  const draftReply = async () => {
    if (!selectedMessage) return;
    setReplyDrafting(true);
    try {
      const result = await completeOnce(
        `请基于下面这封邮件内容，写一封专业、简洁、礼貌的中文回复草稿。\n\n主题：${selectedMessage.subject}\n发件人：${selectedMessage.sender}\n正文：\n${selectedMessage.body_text || selectedMessage.snippet}`,
        "你是邮件助手，只输出可直接发送的回复正文。",
      );
      setComposeDraft({
        to: extractAddress(selectedMessage.sender),
        cc: "",
        bcc: "",
        subject: selectedMessage.subject.startsWith("Re:")
          ? selectedMessage.subject
          : `Re: ${selectedMessage.subject}`,
        body: result.content,
      });
      setComposeOpen(true);
    } catch {
      setStatusText("智能回复草稿生成失败。");
    } finally {
      setReplyDrafting(false);
    }
  };

  const markMessageSeen = async (messageId: string) => {
    if (!activeAccount) return;
    try {
      await apiFetch<MailMessage>("/mail/local/messages/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: activeAccount,
          message_id: messageId,
        }),
      });
    } catch {
      setStatusText("邮件已读状态同步失败。");
    }
  };

  useEffect(() => {
    if (!selectedMessageId || activeFolder !== "inbox") {
      return;
    }

    const current = messages.find((message) => message.id === selectedMessageId);
    if (!current || current.seen) {
      return;
    }

    setMessages((prev) =>
      prev.map((message) =>
        message.id === selectedMessageId ? { ...message, seen: true } : message,
      ),
    );
    void markMessageSeen(selectedMessageId);
  }, [activeFolder, activeAccount, messages, selectedMessageId]);

  const downloadAttachment = async (attachment: MailAttachment) => {
    if (!activeAccount || !selectedMessage) return;
    try {
      const response = await fetch(buildApiUrl("/mail/local/attachments/download"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: activeAccount,
          message_id: selectedMessage.id,
          attachment_id: attachment.id,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const fileName = pickDownloadFileName(
        response.headers.get("Content-Disposition"),
        attachment.filename,
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setStatusText("附件下载失败。");
    }
  };

  return (
    <div
      data-testid="mail-macos-shell"
      data-desktop-blocker="true"
      className="flex h-full min-w-0 overflow-hidden"
      style={{
        color: "var(--t1)",
        background:
          "linear-gradient(180deg, rgba(247,247,249,0.96), rgba(239,240,244,0.98))",
      }}
    >
      <aside
        data-testid="mail-sidebar"
        className="flex w-[258px] shrink-0 flex-col border-r px-3 py-3"
        style={{
          borderColor: "rgba(0,0,0,0.08)",
          background: "rgba(237,238,242,0.74)",
          backdropFilter: "blur(28px) saturate(170%)",
          WebkitBackdropFilter: "blur(28px) saturate(170%)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              data-testid="mail-sidebar-kicker"
              className="text-[12px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              收件中心
            </div>
            <div
              data-testid="mail-sidebar-title"
              className="mt-0.5 truncate text-[24px] font-semibold leading-tight"
            >
              邮件
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              aria-label="写邮件"
              title="写邮件"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[9px]"
              style={toolbarIconButtonStyle}
              onClick={openNewCompose}
            >
              <MailPlus size={16} />
            </button>
            <button
              aria-label="邮箱设置"
              title="邮箱设置"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[9px]"
              style={toolbarIconButtonStyle}
              onClick={() => openAccountEditor(activeAccount || undefined)}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div className="text-[12px] font-medium" style={{ color: "var(--t2)" }}>
            邮箱账户
          </div>
          <button
            aria-label="新增邮箱账户"
            title="新增邮箱账户"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px]"
            style={toolbarIconButtonStyle}
            onClick={() => openAccountEditor()}
          >
            <Plus size={15} />
          </button>
        </div>

        <div
          className="mt-2 overflow-hidden rounded-[12px] border"
          style={{ borderColor: "rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.66)" }}
        >
          {accounts.length === 0 ? (
            <div
              className="px-3 py-4 text-[13px] leading-6"
              style={{ color: "var(--t3)" }}
            >
              还没有邮箱账户。先填写收件与发信服务器信息，就可以同步和发送邮件。
            </div>
          ) : (
            accounts.map((account) => (
              <button
                key={account.id}
                data-testid="mail-account-row"
                onClick={() => setActiveAccountId(account.id)}
                className="w-full px-3 py-2.5 text-left transition-colors"
                style={{
                  borderRadius: "10px",
                  borderTop: account === accounts[0] ? undefined : "0.5px solid rgba(0,0,0,0.055)",
                  color: "var(--t1)",
                  background:
                    account.id === activeAccountId
                      ? "rgba(0,122,255,0.12)"
                      : "transparent",
                }}
              >
                <div className="truncate text-[14px] font-semibold">{account.label}</div>
                <div className="mt-1 truncate text-[12px]" style={{ color: "var(--t3)" }}>
                  {account.email}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="mt-auto pt-4 text-[12px]" style={{ color: "var(--t3)" }}>
          {statusText || "账户配置保存在本地配置文件中，支持收件箱、已发送、草稿箱切换。"}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1">
        <div
          data-testid="mail-message-list-column"
          className="flex shrink-0 flex-col border-r"
          style={{ width: 330, borderColor: "rgba(0,0,0,0.08)", background: "rgba(250,250,252,0.78)" }}
        >
          <div
            className="border-b px-3 py-2.5"
            style={{ borderColor: "rgba(0,0,0,0.07)", background: "rgba(255,255,255,0.68)" }}
          >
            <div className="flex items-center gap-2">
              {MAIL_FOLDERS.map((folder) => (
                <button
                  key={folder.id}
                  className="rounded-[9px] border px-2.5 py-1.5 text-[12px] font-medium"
                  style={pillStyle(activeFolder === folder.id)}
                  onClick={() => setActiveFolder(folder.id)}
                >
                  {folder.label}
                </button>
              ))}
              <button
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[9px] border text-[12px]"
                style={pillStyle()}
                onClick={() => void syncAllFolders()}
                disabled={!activeAccountId || syncing}
                aria-label="同步邮件"
                title="同步"
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-3 text-[13px]" style={{ color: "var(--t3)" }}>
                <Loader2 size={16} className="animate-spin" />
                正在读取邮件...
              </div>
            ) : messages.length === 0 ? (
              <div
                className="rounded-[12px] border border-dashed px-3 py-4 text-[13px] leading-6"
                style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--t3)", background: "rgba(255,255,255,0.5)" }}
              >
                {MAIL_FOLDERS.find((folder) => folder.id === activeFolder)?.emptyText}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    onClick={() => setSelectedMessageId(message.id)}
                    className="rounded-[12px] border px-3 py-2.5 text-left"
                    style={{
                      borderColor:
                        message.id === selectedMessageId ? "rgba(0,122,255,0.18)" : "rgba(0,0,0,0.075)",
                      background:
                        message.id === selectedMessageId
                          ? "rgba(0,122,255,0.09)"
                          : "rgba(255,255,255,0.82)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                        {message.subject || "(无主题)"}
                      </span>
                      {!message.seen && activeFolder === "inbox" && (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
                      )}
                    </div>
                    <div className="mt-1 truncate text-[12px]" style={{ color: "var(--t3)" }}>
                      {activeFolder === "sent" ? (message.recipients || "未填写收件人") : message.sender || "未知发件人"}
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[13px] leading-5" style={{ color: "var(--t2)" }}>
                      {message.snippet || "暂无摘要"}
                    </div>
                    {!!message.attachments?.length && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]" style={{ background: "rgba(15,23,42,0.06)", color: "var(--t2)" }}>
                        <Paperclip size={11} />
                        {message.attachments.length} 个附件
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 px-5 py-4">
          {!selectedMessage ? (
            <div
              className="flex h-full items-center justify-center rounded-[14px] border border-dashed text-[14px]"
              style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--t3)", background: "rgba(255,255,255,0.56)" }}
            >
              选择一封邮件查看详情。
            </div>
          ) : (
            <div
              className="flex h-full flex-col overflow-hidden rounded-[14px] border"
              style={{ borderColor: "rgba(0,0,0,0.075)", background: "rgba(255,255,255,0.86)" }}
            >
                <div className="border-b px-5 py-4" style={{ borderColor: "rgba(0,0,0,0.07)" }}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[22px] font-semibold">{selectedMessage.subject || "(无主题)"}</div>
                    <div className="mt-2 text-[13px]" style={{ color: "var(--t3)" }}>
                      发件人：{selectedMessage.sender || "-"}
                    </div>
                    <div className="mt-1 text-[13px]" style={{ color: "var(--t3)" }}>
                      收件人：{selectedMessage.recipients || activeAccount?.email || "-"}
                    </div>
                      <div className="mt-1 text-[13px]" style={{ color: "var(--t3)" }}>
                        时间：{selectedMessage.sent_at ? new Date(selectedMessage.sent_at).toLocaleString() : "-"}
                      </div>
                    </div>
                  </div>
                </div>

              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-h-0 overflow-y-auto px-5 py-5">
                  {!!selectedAttachments.length && (
                    <div className="mb-5">
                      <div className="mb-2 text-[12px] font-medium" style={{ color: "var(--t3)" }}>
                        附件
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedAttachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href="#"
                            onClick={(event) => {
                              event.preventDefault();
                              void downloadAttachment(attachment);
                            }}
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[12px]"
                            style={pillStyle()}
                          >
                            <Paperclip size={13} />
                            <span className="max-w-[180px] truncate">{attachment.filename}</span>
                            <span style={{ color: "var(--t3)" }}>{formatAttachmentSize(attachment.size)}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedMessage.body_html ? (
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: selectedMessage.body_html }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap text-[14px] leading-7">{selectedMessage.body_text || selectedMessage.snippet}</pre>
                  )}
                </div>

                <aside
                  className="border-l px-4 py-4"
                  style={{ borderColor: "rgba(0,0,0,0.07)", background: "rgba(246,247,249,0.86)" }}
                >
                  <div className="text-[12px] font-medium" style={{ color: "var(--t2)" }}>
                    智能助手
                  </div>
                  <div className="mt-2 text-[18px] font-semibold">
                    {activeFolder === "drafts" ? "草稿处理" : "邮件处理"}
                  </div>
                  {activeFolder === "drafts" ? (
                    <button
                      onClick={() => openDraftComposer(selectedMessage)}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-white"
                      style={primaryActionStyle}
                    >
                      <PencilLine size={15} />
                      继续编辑草稿
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => void summarizeMessage()}
                        disabled={summarizing}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-white"
                        style={{ ...primaryActionStyle, opacity: summarizing ? 0.7 : 1 }}
                      >
                        {summarizing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                        总结这封邮件
                      </button>
                      <button
                        onClick={() => void draftReply()}
                        disabled={replyDrafting}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[10px] border px-4 py-2.5 text-[13px] font-medium"
                        style={{ ...pillStyle(), opacity: replyDrafting ? 0.7 : 1 }}
                      >
                        {replyDrafting ? <Loader2 size={15} className="animate-spin" /> : <PencilLine size={15} />}
                        生成回复草稿
                      </button>
                    </>
                  )}

                  <div
                    className="mt-5 rounded-[12px] border px-4 py-4 text-[13px] leading-6"
                    style={{ borderColor: "rgba(0,0,0,0.075)", background: "rgba(255,255,255,0.78)" }}
                  >
                    {summaryText ? (
                      <div
                        className="prose prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-slate-800 prose-headings:text-slate-800"
                        style={{ color: "var(--t2)" }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryText}</ReactMarkdown>
                      </div>
                    ) : (
                      "这里会显示邮件摘要，或者草稿的下一步建议。"
                    )}
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      </section>

      {accountModalOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="w-[620px] rounded-[28px] border bg-white p-5 shadow-2xl" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
            <div className="text-[20px] font-semibold">{accountDraft.id ? "编辑邮箱账户" : "新增邮箱账户"}</div>
            <div className="mt-4 grid gap-3">
              <div
                className="rounded-[20px] border px-3 py-3 text-[12px] leading-6"
                style={{ borderColor: "rgba(0,122,255,0.12)", background: "rgba(0,122,255,0.06)", color: "var(--t2)" }}
              >
                邮箱配置只保存在本机 `~/.ai-web-os/mail.json`，不会写入服务器数据库。
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="显示名称"><input value={accountDraft.label} onChange={(e) => setAccountDraft((prev) => ({ ...prev, label: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
                <Field label="邮箱地址"><input value={accountDraft.email} onChange={(e) => setAccountDraft((prev) => ({ ...prev, email: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              </div>
              <div className="grid grid-cols-[1fr_100px_1fr] gap-3">
                <Field label="收件服务器地址"><input value={accountDraft.imap_host} onChange={(e) => setAccountDraft((prev) => ({ ...prev, imap_host: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
                <Field label="端口"><input type="number" value={accountDraft.imap_port} onChange={(e) => setAccountDraft((prev) => ({ ...prev, imap_port: Number(e.target.value) || 993 }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
                <Field label="用户名"><input value={accountDraft.imap_username} onChange={(e) => setAccountDraft((prev) => ({ ...prev, imap_username: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              </div>
              <Field label="收件服务密码"><input type="password" value={accountDraft.imap_password} onChange={(e) => setAccountDraft((prev) => ({ ...prev, imap_password: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              <div className="grid grid-cols-[1fr_100px_1fr] gap-3">
                <Field label="发件服务器地址"><input value={accountDraft.smtp_host} onChange={(e) => setAccountDraft((prev) => ({ ...prev, smtp_host: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
                <Field label="端口"><input type="number" value={accountDraft.smtp_port} onChange={(e) => setAccountDraft((prev) => ({ ...prev, smtp_port: Number(e.target.value) || 465 }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
                <Field label="用户名"><input value={accountDraft.smtp_username} onChange={(e) => setAccountDraft((prev) => ({ ...prev, smtp_username: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              </div>
              <Field label="发件服务密码"><input type="password" value={accountDraft.smtp_password} onChange={(e) => setAccountDraft((prev) => ({ ...prev, smtp_password: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div>
                {accountDraft.id && (
                  <button onClick={() => void deleteAccount()} className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-medium" style={{ background: "rgba(239,68,68,0.08)", color: "#b91c1c" }}>
                    <Trash2 size={14} />
                    删除账户
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button className="rounded-full border px-4 py-2 text-[13px]" style={pillStyle()} onClick={() => setAccountModalOpen(false)}>
                  取消
                </button>
                <button className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-white" style={primaryActionStyle} onClick={() => void saveAccount()}>
                  {savingAccount ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  保存账户
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {composeOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="w-[780px] rounded-[28px] border bg-white p-5 shadow-2xl" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
            <div className="flex items-center gap-2 text-[20px] font-semibold">
              <MailPlus size={18} />
              {composeDraft.id ? "编辑草稿" : "撰写邮件"}
            </div>
            <div className="mt-4 grid gap-3">
              <Field label="收件人"><input value={composeDraft.to} onChange={(e) => setComposeDraft((prev) => ({ ...prev, to: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="抄送"><input value={composeDraft.cc} onChange={(e) => setComposeDraft((prev) => ({ ...prev, cc: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
                <Field label="密送"><input value={composeDraft.bcc} onChange={(e) => setComposeDraft((prev) => ({ ...prev, bcc: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              </div>
              <Field label="主题"><input value={composeDraft.subject} onChange={(e) => setComposeDraft((prev) => ({ ...prev, subject: e.target.value }))} className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none" style={fieldStyle} /></Field>
              <Field label="正文"><textarea value={composeDraft.body} onChange={(e) => setComposeDraft((prev) => ({ ...prev, body: e.target.value }))} className="min-h-[240px] w-full rounded-2xl border px-3 py-3 text-[13px] outline-none" style={fieldStyle} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-full border px-4 py-2 text-[13px]" style={pillStyle()} onClick={() => setComposeOpen(false)}>
                取消
              </button>
              <button className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium" style={pillStyle()} onClick={() => void saveDraft()} disabled={savingDraft || sending}>
                {savingDraft ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                保存草稿
              </button>
              <button className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-white" style={primaryActionStyle} onClick={() => void sendMail()} disabled={sending || savingDraft}>
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function splitEmails(value: string) {
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitStoredEmails(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(", ");
}

function extractAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return match?.[1] || value;
}

function metadataString(message: MailMessage, key: string) {
  const value = message.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function folderLabel(folder: MailFolderId) {
  return MAIL_FOLDERS.find((item) => item.id === folder)?.label || "当前文件夹";
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

function pillStyle(active = false) {
  return {
    borderColor: active ? "rgba(0,122,255,0.18)" : "rgba(0,0,0,0.08)",
    background: active ? "rgba(0,122,255,0.09)" : "rgba(255,255,255,0.72)",
    color: active ? "var(--accent)" : "var(--t2)",
  } as const;
}

const fieldStyle = {
  borderColor: "rgba(0,0,0,0.08)",
  background: "rgba(255,255,255,0.78)",
};

const toolbarIconButtonStyle = {
  border: "0.5px solid rgba(0,0,0,0.08)",
  background: "rgba(255,255,255,0.66)",
  color: "var(--t2)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
} as const;

const primaryActionStyle = {
  background: "var(--accent)",
  color: "#fff",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.24)",
} as const;
