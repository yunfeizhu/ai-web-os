---
name: file-manager
description: Use the File Manager app to browse directories, inspect files, and perform filesystem operations inside the virtual file system.
app_id: file-manager
---

# File Manager

## When to use

- 用户要浏览目录、定位文件、预览文件或执行文件操作时
- 任务涉及新建、移动、复制、重命名、删除或下载文件时

## Guidelines

1. 先确认目标目录或目标文件，再执行写操作，避免误操作到错误路径。
2. 文件操作完成后，返回最终路径和结果摘要，必要时说明是否覆盖或创建了新对象。
3. 对破坏性操作保持谨慎，删除、覆盖或批量修改前优先确认范围。
