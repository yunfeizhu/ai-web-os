# Development And Deployment Modes

## Development Mode

本地开发时，建议前后端都直接在宿主机运行，不走镜像重建流程。

### API

```bash
cd apps/api
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Web

```bash
cd apps/web
pnpm dev
```

### Notes

- Web 默认请求 `http://localhost:8000/api/v1`
- 本地开发时，`stdio MCP` 依赖开发机本地运行时
- 推荐本地准备好 `Node.js + npm/npx + Python + uv`
- 前端 API 地址可通过 `NEXT_PUBLIC_API_BASE` 覆盖

## Deployment Mode

部署时，建议前后端都走镜像，运行环境固定下来。

### Compose

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

### Ports

- Web: `http://localhost:13000`
- API: `http://localhost:18000`

### Runtime Baseline

API 镜像内固定内置以下运行时：

- Node.js
- npm / npx
- Python
- uv

这意味着当前部署模式下，`stdio MCP` 暂仅建议接入 Node/Python 类服务。

## Environment Variables

### Common

- `DATABASE_URL`
- `REDIS_URL`
- `MINIO_ENDPOINT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`
- `SECRET_KEY`
- `AI_NATIVE_OS_HOME`

### Frontend

- `NEXT_PUBLIC_API_BASE`

### Defaults

- 本地开发默认值：`http://localhost:8000/api/v1`
- Compose 部署默认值：`http://localhost:18000/api/v1`

如果后续部署在真实域名或反向代理之后，请在构建 Web 镜像时覆盖 `NEXT_PUBLIC_API_BASE`。
