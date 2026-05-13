# 生产环境 Docker 部署流程

这套生产配置不会影响现有开发用的 `docker/docker-compose.yml`。

生产环境使用独立的 `docker/docker-compose.prod.yml`，并通过容器内的 Nginx gateway 统一入口。服务器外部只需要开放一个端口：

```text
http://SERVER_IP:14000
```

gateway 会在 Docker 内网里转发：

```text
/                  -> web:3000
/api/              -> api:8000/api/
/ws                -> api:8000/ws
/browser-live/     -> browser-runtime:6080/
/browser-runtime/  -> browser-runtime:18100/
```

外部不需要开放 `18000`、`18100`、`16080`、`15432`、`16379`、`19000`、`19001`、`16333`、`16334`。

## 从 git pull 开始部署

假设项目在服务器目录 `/opt/AI-Native-OS`，如果你的目录不同，把命令里的路径换成实际路径。

```bash
cd /opt/AI-Native-OS
git status
git pull --ff-only
```

如果 `git pull --ff-only` 报错，说明服务器本地可能有改动或分支历史不一致。先处理 Git 状态，不建议直接强制覆盖。

## 创建生产环境变量

`docker/.env.prod` 被 `.gitignore` 忽略，不会通过 `git pull` 拉下来。服务器上需要手动创建一次。

练习项目可以直接使用下面这组简单配置：

```bash
cat > docker/.env.prod <<'EOF'
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=ainative

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_BUCKET=ainative-files

SECRET_KEY=practice-only-secret-key-change-before-real-deploy
APP_TIMEZONE=Asia/Shanghai
EOF
```

如果以后用于真实公开环境，请把 `POSTGRES_PASSWORD`、`MINIO_ROOT_PASSWORD`、`SECRET_KEY` 换成强密码或随机长字符串。

## 检查 Compose 配置

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml config
```

如果这一步能输出完整配置并且没有报错，说明环境变量和 Compose 文件可以正常解析。

## 构建并启动

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d --build
```

这会启动以下容器：

```text
ainative-prod-gateway
ainative-prod-web
ainative-prod-api
ainative-prod-browser-runtime
ainative-prod-postgres
ainative-prod-redis
ainative-prod-minio
ainative-prod-qdrant
```

只有 `ainative-prod-gateway` 会把宿主机 `14000` 暴露出来。

## 查看容器状态

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml ps
```

正常情况下服务应处于 `running` 或 `healthy`。如果 API 或 browser-runtime 还在 `starting`，等几十秒后再看一次。

## 查看日志

查看 gateway：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml logs -f gateway
```

查看 API：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml logs -f api
```

查看所有服务：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml logs -f
```

## 健康检查

检查 gateway：

```bash
curl http://127.0.0.1:14000/healthz
```

正常返回：

```text
ok
```

检查 API 容器自身：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml exec api curl -fsS http://127.0.0.1:8000/health
```

正常返回类似：

```json
{"status":"ok","version":"0.2.0"}
```

通过 gateway 检查应用 API：

```bash
curl http://127.0.0.1:14000/api/v1/settings
```

如果这一步能返回 JSON，说明 gateway、API、数据库链路基本正常。

## 放开服务器端口

如果服务器使用 `ufw`：

```bash
sudo ufw allow 14000/tcp
sudo ufw status
```

如果是云服务器，还需要在云控制台的安全组里放开 `14000/tcp`。

## 浏览器访问

在本机浏览器打开：

```text
http://SERVER_IP:14000
```

例如：

```text
http://1.2.3.4:14000
```

## 后续更新

以后服务器更新代码，执行：

```bash
cd /opt/AI-Native-OS
git status
git pull --ff-only
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d --build
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml ps
```

如果只是重启服务，不重新构建：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml restart
```

## 停止服务

停止服务但保留数据：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml down
```

不要随便执行：

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml down -v
```

`down -v` 会删除 Postgres、Redis、MinIO、Qdrant、API home、browser-state 等数据卷，相当于清空练习项目里的持久化数据。
