# App Skills Architecture

## 背景

项目原先在 `apps_registry/*` 下使用 `workflow.md` 描述每个 App 的操作策略。为了和主流 Agent Skills 生态保持一致，现统一收敛为标准化的 `SKILL.md` 方案。

本项目采用的分层原则是：

- `manifest.json`：声明 App 是什么、能做什么、有哪些权限和工具
- `SKILL.md`：声明 Agent 应该如何使用这个 App
- `tools`：执行具体动作

这让桌面 App、Agent 技能和底层工具三者职责清晰，不再互相混淆。

## 目录结构

```text
apps_registry/
  file-manager/
    manifest.json
    SKILL.md
  browser/
    manifest.json
    SKILL.md
```

## manifest.json 职责

`manifest.json` 只负责结构化元数据：

- `id` / `name` / `version` / `description`
- `category`
- `permissions`
- `tools`
- `mcp`
- `skill`

推荐的 `skill` 字段如下：

```json
{
  "skill": {
    "entrypoint": "SKILL.md",
    "format": "skill-md"
  }
}
```

其中：

- `entrypoint` 指向 App 自带的技能主文件
- `format` 当前固定为 `skill-md`

## SKILL.md 职责

`SKILL.md` 是 App 级 Skill，负责告诉 Agent：

- 什么时候应该使用这个 App
- 使用这个 App 时的操作准则
- 这个 App 当前阶段的能力边界
- 风险动作的处理方式

推荐结构：

```md
---
name: file-manager
description: Use the File Manager app to browse directories and perform filesystem operations.
app_id: file-manager
---

# File Manager

## When to use

- 用户要浏览目录、定位文件或执行文件操作时

## Guidelines

1. 先确认目标路径，再执行写操作。
2. 删除、覆盖前优先确认范围。
```

建议：

- frontmatter 保持轻量，优先使用 `name`、`description`、`app_id`
- 正文尽量写“何时使用”和“如何使用”
- 不要把实现细节、接口文档或长篇背景知识塞进 `SKILL.md`

## 运行时加载策略

当前项目已经完成：

- `apps_registry/*/workflow.md` 迁移为 `SKILL.md`
- App Registry 同步 `skill.entrypoint` / `skill.format`
- API 暴露 App skill 元数据与 `GET /api/v1/apps/{app_id}/skill`
- AI Chat / Terminal 已按当前入口 App 自动注入对应 `SKILL.md`
- 已实现第一版规则式多 Skill 选择：保留入口 App，并根据用户消息额外补充 1 到 2 个相关 Skills
- 已实现规则增强版语义路由：输出 `primary_skill`、`secondary_skills` 和冲突消解规则，再合并注入上下文

下一步目标：

1. 将当前规则增强版路由升级为更稳定的语义理解
2. 支持更细粒度的多 Skill 冲突裁决和阶段式执行
3. 支持跨 App 任务的组合规划，而不只是组合注入
4. 再进行工具选择和执行

当前路由器的行为是：

- 先识别意图类别，例如文件浏览、文本编辑、笔记写作、网页导航、系统配置
- 为本次请求选出一个 `primary_skill`
- 选择 0 到 2 个 `secondary_skills`
- 生成冲突消解规则，例如“终端只约束外壳风格，不得覆盖 Notes 的 Markdown 结构要求”

这使得多 Skill 不再只是并排拼接，而是具备初步的优先级语义。

这样可以避免把所有 App 的操作说明一次性注入模型。

## 与 skills.sh 的关系

本方案主动对齐 `skills.sh` 推动的 `SKILL.md` 生态，但不会把系统运行时完全绑定到某一个外部 CLI。

兼容策略如下：

- 文件格式层：使用标准化的 `SKILL.md`
- 应用注册层：继续由本项目的 `App Registry` 管理
- 协议层：未来可以映射到 MCP prompts / resources

换句话说，本项目采用的是：

- 本地存储格式兼容主流 Agent Skills 生态
- 系统运行时保持自己的 App / Window / Tool 架构

## 迁移说明

从现在开始：

- 新增 App 时，默认创建 `manifest.json + SKILL.md`
- 不再新增 `workflow.md`
- 旧 `workflow.md` 仅作为兼容回退入口，后续可逐步移除
