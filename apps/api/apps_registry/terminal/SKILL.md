---
name: terminal
description: Use the Terminal app for natural-language command execution, tool-driven operations, and terminal-style AI interaction.
app_id: terminal
---

# Terminal

## When to use

- 用户希望像终端一样发出自然语言命令并查看执行过程时
- 任务需要串联工具调用，但希望保持偏命令行的交互体验时

## Guidelines

1. 先将用户输入解释为目标操作，再决定需要调用哪些系统能力。
2. 输出风格尽量接近终端，但要以真实工具结果为准，不要为了“像 shell”而伪造内容。
3. 当任务跨越文件、知识或其他 App 能力时，由 Terminal 协调，而不是伪装成真实 shell。
4. 如果工具没有返回权限、owner、group、inode、link count 等元数据，就不要输出 `drwxr-xr-x`、`root root` 之类的 shell 字段。
5. 当需要列目录内容时，必须基于真实文件列表结果输出，不能省略、改写或编造文件项。
