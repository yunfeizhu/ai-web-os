"use client";

import { useEffect, useState } from "react";
import { FolderOpen, KeyRound, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { apiFetch } from "@/lib/backend";

interface ManagedSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  entrypoint: string;
  path: string;
  updated_at: string;
  skill_key?: string;
  primary_env?: string | null;
  primary_env_source?: "declared" | "inferred" | "none";
  has_api_key?: boolean;
}

const USER_SKILLS_ROOT = "~/.ai-web-os/skills/user";
const USER_SKILLS_CONFIG = "~/.ai-web-os/skills.json";

export function SkillManager() {
  const [skills, setSkills] = useState<ManagedSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiKeyMap, setApiKeyMap] = useState<Record<string, string>>({});
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [messageMap, setMessageMap] = useState<Record<string, string>>({});
  const [messageToneMap, setMessageToneMap] = useState<Record<string, "error" | "success">>({});

  const loadSkills = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ManagedSkill[]>("/skills");
      setSkills(data);
      setMessageMap({});
      setMessageToneMap({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取本地 Skills 失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills().catch(() => undefined);
  }, []);

  const updateSkill = (updated: ManagedSkill) => {
    setSkills((prev) => prev.map((skill) => (skill.id === updated.id ? updated : skill)));
  };

  const saveApiKey = async (skill: ManagedSkill, value: string, successMessage: string) => {
    setSavingMap((prev) => ({ ...prev, [skill.id]: true }));
    setMessageMap((prev) => ({ ...prev, [skill.id]: "" }));

    try {
      const updated = await apiFetch<ManagedSkill>(`/skills/${skill.id}/api-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: value }),
      });
      updateSkill(updated);
      setApiKeyMap((prev) => ({ ...prev, [skill.id]: "" }));
      setMessageToneMap((prev) => ({ ...prev, [skill.id]: "success" }));
      setMessageMap((prev) => ({ ...prev, [skill.id]: successMessage }));
    } catch (err) {
      setMessageToneMap((prev) => ({ ...prev, [skill.id]: "error" }));
      setMessageMap((prev) => ({
        ...prev,
        [skill.id]: err instanceof Error ? err.message : "保存 API Key 失败",
      }));
    } finally {
      setSavingMap((prev) => ({ ...prev, [skill.id]: false }));
    }
  };

  const renderMessage = (skillId: string) => {
    const message = messageMap[skillId];
    if (!message) return null;

    const tone = messageToneMap[skillId] === "error" ? inlineErrorStyle : inlineSuccessStyle;
    return (
      <div className="mt-2 rounded-xl px-3 py-2 text-[12px]" style={tone}>
        {message}
      </div>
    );
  };

  return (
    <div className="rounded-2xl p-4" style={panelStyle}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Sparkles size={15} />
            本地 Skills
          </div>
          <div className="mt-1 text-[13px]" style={{ color: "var(--t2)" }}>
            这里会自动扫描本地 Skill 目录，并展示当前已发现的 Skills。Skill 目录里除了
            <code className="mx-1 rounded bg-black/5 px-1 py-0.5 text-[12px]">SKILL.md</code>
            ，也可以包含脚本、模板、references 等附属文件。
          </div>
        </div>

        <button
          onClick={() => void loadSkills()}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3 text-[13px] leading-none whitespace-nowrap"
          style={{ background: "rgba(0,0,0,0.05)" }}
        >
          <span className="inline-flex items-center gap-1.5 leading-none">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            重新扫描
          </span>
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <InfoCard
          label="本地目录"
          value={USER_SKILLS_ROOT}
          helper="将每个 Skill 放在一个独立目录下，例如 ~/.ai-web-os/skills/user/my-skill/"
        />
        <InfoCard
          label="发现规则"
          value="读取 SKILL.md / workflow.md"
          helper="脚本、模板、references 等其他文件保留在同目录内，由 Skill 自己引用。"
        />
      </div>

      <div
        className="mb-3 rounded-xl px-3 py-2 text-[12px]"
        style={{ background: "rgba(0,122,255,0.06)", color: "var(--t2)" }}
      >
        当前 UI 只负责发现本地 Skill，并在 Skill 声明了所需环境变量时提供 API Key 注入入口，不负责创建、编辑、删除 Skill 文件本身。
      </div>

      <div
        className="mb-4 rounded-xl px-3 py-2 text-[12px]"
        style={{ background: "rgba(0,0,0,0.03)", color: "var(--t2)" }}
      >
        如果 Skill 在 frontmatter 里声明了 <code>metadata.openclaw.primaryEnv</code>，或正文中能明确识别出唯一的 API Key 环境变量，这里都会显示对应的密钥输入框。密钥只保存在本机的{" "}
        <code>{USER_SKILLS_CONFIG}</code>，运行时按需注入到进程环境变量中。
      </div>

      {error ? (
        <div className="mb-4 rounded-xl px-3 py-2 text-[13px]" style={errorBannerStyle}>
          {error}
        </div>
      ) : null}

      {skills.length > 0 ? (
        <div className="space-y-3">
          {skills.map((skill) => {
            const currentInput = apiKeyMap[skill.id] ?? "";
            const isSaving = Boolean(savingMap[skill.id]);
            const canSave = currentInput.trim().length > 0 && !isSaving;
            const canClear = Boolean(skill.has_api_key) && !isSaving;

            return (
              <div key={skill.id} className="rounded-2xl p-4" style={cardStyle}>
                <div className="mb-2 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{skill.name}</span>
                      <Badge label={skill.enabled ? "已启用" : "已禁用"} tone={skill.enabled ? "green" : "neutral"} />
                      <Badge label={skill.id} tone="neutral" />
                      {skill.primary_env ? <Badge label={skill.primary_env} tone="amber" /> : null}
                      {skill.primary_env_source === "inferred" ? (
                        <Badge label="正文推断" tone="neutral" />
                      ) : null}
                      {skill.has_api_key ? <Badge label="已保存密钥" tone="blue" /> : null}
                    </div>
                    <div className="mt-1 text-[13px]" style={{ color: "var(--t2)" }}>
                      {skill.description || "暂无描述"}
                    </div>
                  </div>
                  <span className="text-[12px]" style={{ color: "var(--t3)" }}>
                    {formatTimestamp(skill.updated_at)}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 text-[12px] md:grid-cols-2" style={{ color: "var(--t3)" }}>
                  <InfoRow label="目录" value={parentDir(skill.path)} />
                  <InfoRow label="入口" value={skill.entrypoint} />
                  <InfoRow label="Skill Key" value={skill.skill_key || skill.id} />
                  <InfoRow
                    label="环境变量"
                    value={
                      skill.primary_env
                        ? skill.primary_env_source === "declared"
                          ? `${skill.primary_env}（来自 metadata.openclaw.primaryEnv）`
                          : `${skill.primary_env}（从 Skill 内容推断）`
                        : "未检测到可注入的 API Key 环境变量"
                    }
                  />
                </div>

                <div className="mt-3 rounded-xl px-3 py-2 text-[12px]" style={pathBoxStyle}>
                  <div className="mb-1 flex items-center gap-1.5 font-medium">
                    <FolderOpen size={12} />
                    本地路径
                  </div>
                  <div style={{ wordBreak: "break-all" }}>{skill.path}</div>
                </div>

                {skill.primary_env ? (
                  <div className="mt-3 rounded-2xl p-3" style={apiKeyCardStyle}>
                    <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
                      <KeyRound size={14} />
                      API Key 注入
                    </div>
                    <div className="text-[12px]" style={{ color: "var(--t2)" }}>
                      该 Skill
                      {skill.primary_env_source === "declared" ? "声明了" : "推断需要"}
                      运行时环境变量 <code>{skill.primary_env}</code>。你可以在这里保存本机密钥，调用时会自动注入。
                    </div>

                    <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                      <input
                        type="password"
                        value={currentInput}
                        onChange={(event) =>
                          setApiKeyMap((prev) => ({ ...prev, [skill.id]: event.target.value }))
                        }
                        className="h-10 min-w-0 flex-1 rounded-xl px-3 text-[13px] outline-none"
                        style={inputStyle}
                        placeholder={
                          skill.has_api_key ? "已保存，重新输入可覆盖现有密钥" : `输入 ${skill.primary_env}`
                        }
                      />
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() =>
                            void saveApiKey(skill, currentInput.trim(), `已保存 ${skill.primary_env}`)
                          }
                          disabled={!canSave}
                          className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-[13px] font-medium text-white whitespace-nowrap"
                          style={{
                            background: canSave ? "#d97706" : "rgba(217,119,6,0.35)",
                            opacity: canSave ? 1 : 0.8,
                            cursor: canSave ? "pointer" : "not-allowed",
                          }}
                        >
                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : "保存密钥"}
                        </button>
                        <button
                          onClick={() => void saveApiKey(skill, "", `已清除 ${skill.primary_env}`)}
                          disabled={!canClear}
                          className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-[13px] whitespace-nowrap"
                          style={{
                            background: "rgba(0,0,0,0.05)",
                            color: "var(--t2)",
                            opacity: canClear ? 1 : 0.45,
                            cursor: canClear ? "pointer" : "not-allowed",
                          }}
                        >
                          清除密钥
                        </button>
                      </div>
                    </div>

                    {renderMessage(skill.id)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl p-4 text-[13px]" style={emptyStateStyle}>
          当前还没有发现本地 Skills。你可以直接在
          <code className="mx-1 rounded bg-black/5 px-1 py-0.5 text-[12px]">{USER_SKILLS_ROOT}</code>
          下新建目录并放入 <code className="rounded bg-black/5 px-1 py-0.5 text-[12px]">SKILL.md</code>
          ，然后回来点一次“重新扫描”。
        </div>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-xl p-3" style={cardStyle}>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div className="text-[13px] font-medium" style={{ color: "var(--t1)" }}>
        {value}
      </div>
      <div className="mt-1 text-[12px]" style={{ color: "var(--t2)" }}>
        {helper}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "rgba(0,0,0,0.03)" }}>
      <span className="font-medium">{label}：</span>
      <span>{value}</span>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "amber" | "blue" | "green" | "neutral";
}) {
  const style =
    tone === "green"
      ? { background: "rgba(16,185,129,0.10)", color: "#047857" }
      : tone === "blue"
        ? { background: "rgba(0,122,255,0.10)", color: "#0369a1" }
        : tone === "amber"
          ? { background: "rgba(217,119,6,0.12)", color: "#b45309" }
          : { background: "rgba(0,0,0,0.05)", color: "var(--t3)" };

  return (
    <span className="rounded-full px-2 py-0.5 text-[11px]" style={style}>
      {label}
    </span>
  );
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function parentDir(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : normalized;
}

const panelStyle = {
  background: "rgba(250,204,21,0.08)",
  border: "0.5px solid rgba(245,158,11,0.18)",
};

const cardStyle = {
  background: "var(--panel-bg-soft)",
  border: "0.5px solid var(--border)",
};

const apiKeyCardStyle = {
  background: "rgba(217,119,6,0.06)",
  border: "0.5px solid rgba(217,119,6,0.14)",
};

const inputStyle = {
  background: "var(--input-bg)",
  border: "0.5px solid var(--border)",
  color: "var(--t1)",
};

const pathBoxStyle = {
  background: "var(--panel-bg)",
  border: "0.5px solid var(--border-faint)",
  color: "var(--t2)",
};

const emptyStateStyle = {
  background: "var(--panel-bg-soft)",
  border: "0.5px solid var(--border)",
  color: "var(--t2)",
};

const errorBannerStyle = {
  background: "rgba(220,38,38,0.08)",
  border: "0.5px solid rgba(220,38,38,0.18)",
  color: "#b91c1c",
};

const inlineErrorStyle = {
  background: "rgba(220,38,38,0.08)",
  border: "0.5px solid rgba(220,38,38,0.16)",
  color: "#b91c1c",
};

const inlineSuccessStyle = {
  background: "rgba(16,185,129,0.10)",
  border: "0.5px solid rgba(16,185,129,0.18)",
  color: "#047857",
};
