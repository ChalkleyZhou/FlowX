# Docker 部署指南

这份文档整理了 FlowX 在服务器上的完整 Docker 部署方式，覆盖以下场景：

- 直接暴露前端 `4173` 和 API `3000`
- 使用 Nginx 反向代理，只暴露 `80`
- 使用 `mock` 执行器快速启动
- 使用 `codex` 执行器，并通过手动 `codex login` 持久化登录态

## 1. 部署前准备

服务器需要具备：

- Docker
- Docker Compose Plugin
- 可访问目标 Git 仓库的网络

建议先准备一个项目目录，例如：

```bash
mkdir -p /opt/flowx
cd /opt/flowx
```

然后把仓库代码放到这个目录中。

## 2. 关键端口和组件

FlowX 容器内部包含两个服务：

- API：`3000`
- 前端静态服务：`4173`

如果不加 Nginx，通常会直接映射：

- `3000:3000`
- `4173:4173`

如果加了 Nginx：

- 外部只暴露 `80`
- Nginx 把 API 路径转发到 `flowx:3000`
- 其他页面请求转发到 `flowx:4173`

## 3. 关键环境变量

常用环境变量如下：


| 变量                                     | 说明                                                                               | 是否必填           |
| -------------------------------------- | -------------------------------------------------------------------------------- | -------------- |
| `PORT`                                 | API 监听端口，默认 `3000`                                                               | 否              |
| `WEB_PORT`                             | 前端静态服务端口，默认 `4173`                                                               | 否              |
| `DATABASE_URL`                         | SQLite 数据库路径                                                                     | 是              |
| `AI_EXECUTOR_PROVIDER`                 | `mock`、`codex` 或 `cursor`                                                        | 是              |
| `AI_EXECUTOR_DEFAULT_PROVIDER`         | 新工作流默认执行器，`codex` 或 `cursor`                                                     | 否              |
| `CODEX_HOME`                           | Codex CLI 登录态目录                                                                  | `codex` 时建议设置  |
| `CODEX_READ_SANDBOX`                   | Codex 只读阶段沙箱模式，默认 `read-only`；仅在 Docker 内核不支持 `bwrap` 时临时改为 `danger-full-access` | 否              |
| `CODEX_WRITE_SANDBOX`                  | Codex 写入阶段沙箱模式，默认 `workspace-write`                                              | 否              |
| `OPENAI_API_KEY`                       | Codex/API 认证方式之一                                                                 | 否              |
| `CURSOR_API_KEY`                       | Cursor CLI 服务端认证                                                                 | `cursor` 时建议填写 |
| `CURSOR_DEMO_WALL_TIMEOUT_MS`          | Demo 生成最大墙钟超时（毫秒），有持续进度时允许长跑                                                     | 否，默认 `1200000` |
| `CURSOR_NO_PROGRESS_TIMEOUT_MS`        | Cursor 进程无输出/无进展判定超时（毫秒）；设 `0` 关闭该判定                                            | 否，默认 `0`       |
| `FLOWX_DEMO_GENERATION_TIMEOUT_MS`     | 需求服务层 Demo 生成总超时（毫秒）                                                            | 否，默认 `1200000` |
| `FLOWX_DEMO_INCLUDE_COMPONENT_CONTEXT` | Demo 生成时是否注入完整组件上下文（关闭后仅传轻量仓库结构摘要）                                          | 否，默认 `false`   |
| `FLOWX_IDEATION_STALE_HEARTBEAT_MS`    | 启动恢复时判定 RUNNING 会话“心跳过期”的阈值（毫秒）                                                | 否，默认 `120000`  |
| `FLOWX_CREDENTIAL_MASTER_KEY`          | 用户级 Cursor 凭据加密主密钥（BYO 模式）                                                       | 启用用户自有凭据时必填    |
| `FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL` | 是否强制仅允许用户级 Cursor 凭据（禁用实例级/登录态回退）                                                | 否，默认 `false`   |
| `FLOWX_CODEX_REQUIRE_USER_CREDENTIAL`  | 是否强制仅允许用户级 Codex 凭据（禁用实例级/登录态回退）                                                 | 否，默认 `false`   |
| `FRONTEND_BUILD_MODE`                  | 前端构建模式：`nginx`、`direct`、`auto`                                                   | 建议填写           |
| `DIRECT_API_BASE_URL`                  | 直连模式下前端访问 API 的地址                                                                | `direct` 时建议填写 |
| `DINGTALK_APP_ID`                      | 钉钉登录 App ID                                                                      | 仅钉钉登录时必填       |
| `DINGTALK_APP_SECRET`                  | 钉钉登录 App Secret                                                                  | 仅钉钉登录时必填       |
| `DINGTALK_AGENT_ID`                    | 钉钉通知 Agent ID                                                                    | 仅钉钉通知时必填       |
| `GIT_AUTHOR_NAME`                      | Git 提交用户名                                                                        | 建议填写           |
| `GIT_AUTHOR_EMAIL`                     | Git 提交邮箱                                                                         | 建议填写           |


说明：

- 钉钉变量是 `DINGTALK_APP_ID`，不是 `DINGTALK_APPID`
- 如果你现在只是自己使用，可以先不配置钉钉登录
- 如果你要用手动 `codex login`，可以不填 `OPENAI_API_KEY`
- 如果要启用“每个用户使用自己的 Cursor API Key”，必须设置 `FLOWX_CREDENTIAL_MASTER_KEY`，用于服务端加密存储用户凭据
- 若希望彻底禁用共享身份回退，可设置 `FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL=true`
- 若希望 Codex 也彻底禁用共享身份回退，可设置 `FLOWX_CODEX_REQUIRE_USER_CREDENTIAL=true`
- `FRONTEND_BUILD_MODE=nginx` 表示前端走同源 `/api` 代理，不在构建时写死完整 API 域名
- `FRONTEND_BUILD_MODE=direct` 表示前端直接请求 `DIRECT_API_BASE_URL`

## 4. 构建镜像

### 4.1 直接暴露 3000 和 4173

如果前端直接访问 API 地址，构建时把 API 地址写进去：

```bash
docker build \
  --build-arg VITE_API_BASE_URL="http://YOUR_SERVER_IP:3000" \
  -t flowx:latest .
```

如果你使用域名，也可以这样：

```bash
docker build \
  --build-arg VITE_API_BASE_URL="https://flowx.example.com/api" \
  -t flowx:latest .
```

### 4.2 使用 Nginx 同源代理

如果你准备使用仓库里提供的 Nginx 方案，前端应走同源 `/api` 请求：

```bash
docker build \
  --build-arg VITE_API_BASE_URL="/api" \
  -t flowx:latest .
```

## 5. 方案一：直接运行单容器

### 5.1 使用 mock 执行器

这是最适合首次部署验证的方案：

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev-current.db" \
  -e AI_EXECUTOR_PROVIDER="mock" \
  -e GIT_AUTHOR_NAME="FlowX Bot" \
  -e GIT_AUTHOR_EMAIL="flowx@example.com" \
  -v flowx-data:/data \
  flowx:latest
```

访问地址：

- Web：`http://YOUR_SERVER_IP:4173`
- API：`http://YOUR_SERVER_IP:3000`

### 5.2 使用 codex 执行器，并手动登录

如果你当前仍是个人使用阶段，最简单的是手动登录一次 Codex：

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev-current.db" \
  -e AI_EXECUTOR_PROVIDER="codex" \
  -e CODEX_HOME="/data/.codex" \
  -e GIT_AUTHOR_NAME="FlowX Bot" \
  -e GIT_AUTHOR_EMAIL="flowx@example.com" \
  -v flowx-data:/data \
  flowx:latest
```

容器启动后，进入容器执行：

```bash
docker exec -it flowx sh
codex login
```

注意：

- 登录态默认保存在 `/data/.codex`
- 只要 `flowx-data` 卷还在，重启容器后登录态仍会保留
- 如果你删除了容器和数据卷，就需要重新登录

### 5.3 使用 codex 执行器，并通过 API Key

如果你后面不想再手动登录，也可以改为：

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev-current.db" \
  -e AI_EXECUTOR_PROVIDER="codex" \
  -e OPENAI_API_KEY="your_openai_api_key" \
  -e CODEX_HOME="/data/.codex" \
  -e GIT_AUTHOR_NAME="FlowX Bot" \
  -e GIT_AUTHOR_EMAIL="flowx@example.com" \
  -v flowx-data:/data \
  flowx:latest
```

## 6. 方案二：Nginx 反向代理部署

仓库已经提供了：

- [docker-compose.nginx.yml](/Users/chalkley/workspace/FlowX/docker-compose.nginx.yml)
- [docker/nginx/flowx.conf](/Users/chalkley/workspace/FlowX/docker/nginx/flowx.conf)
- [.env.docker.example](/Users/chalkley/workspace/FlowX/.env.docker.example)

这个方案下，对外只暴露一个端口：

- `80`

### 6.1 启动步骤

先准备环境变量文件：

```bash
cp .env.docker.example .env.docker
```

然后按你的实际情况修改 `.env.docker`，例如：

- `AI_EXECUTOR_PROVIDER=codex` 或 `mock`
- `DINGTALK_APP_ID`
- `DINGTALK_APP_SECRET`
- `DINGTALK_AGENT_ID`
- `OPENAI_API_KEY`
- `GIT_AUTHOR_NAME`
- `GIT_AUTHOR_EMAIL`

注意：

- `.env.docker` 会被 shell 直接读取
- 如果变量值里有空格，必须加引号
- 例如：`GIT_AUTHOR_NAME="FlowX Bot"`

建议把 `.env.docker` 里的前端构建模式设为：

```env
FRONTEND_BUILD_MODE=auto
```

然后直接执行更新脚本，它会自动在 Nginx 模式下把前端构建成同源 `/api` 访问：

```bash
./scripts/deploy-update.sh
```

如果你想手工构建，等价命令是：

```bash
docker build \
  --build-arg VITE_API_BASE_URL="/api" \
  -t flowx:latest .
```

再启动：

```bash
docker compose -f docker-compose.nginx.yml up -d
```

如果你的服务器没有 `docker compose` 子命令，而是老版本的独立命令，就改用：

```bash
docker-compose -f docker-compose.nginx.yml up -d
```

启动后访问：

- `http://YOUR_SERVER_IP/`

### 6.2 当前 Nginx 路由规则

Nginx 规则现在是：

- `/api/*` 全部转发到 API
- 其他请求全部转发到前端页面服务

### 6.3 配置 Codex 登录

如果 `docker-compose.nginx.yml` 中使用的是：

```yaml
AI_EXECUTOR_PROVIDER: "codex"
CODEX_HOME: "/data/.codex"
CODEX_READ_SANDBOX: "read-only"
CODEX_WRITE_SANDBOX: "workspace-write"
```

那么启动之后，执行一次：

```bash
docker exec -it flowx sh
codex login
```

钉钉登录回调地址也应配置为：

```text
http://YOUR_SERVER_HOST/api/auth/dingtalk/callback
```

说明：

- `docker-compose.nginx.yml` 会自动读取 `.env.docker`
- `.env.docker` 用来给容器注入运行时环境变量
- 如果 `.env.docker` 不存在，Compose 替换变量时会退回到文件里写的默认值

### 6.4 启用用户自有 Cursor 凭据（BYO）

如果你希望每个登录用户都使用自己的 Cursor API Key（而不是共享服务端 `CURSOR_API_KEY`）：

1. 在 `.env.docker` 中设置 `FLOWX_CREDENTIAL_MASTER_KEY`（建议使用高强度随机字符串）
2. 重启服务
3. 用户登录后进入“AI 凭据”页面，配置个人 Cursor API Key

执行优先级为：

- 用户凭据
- 实例级 `CURSOR_API_KEY`
- 容器内 `agent login` / `cursor agent login` 登录态

若设置 `FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL=true`：

- 未配置用户凭据的请求会直接失败（返回 `CURSOR_USER_CREDENTIAL_REQUIRED`）
- 不再回退实例级 `CURSOR_API_KEY` 或登录态

### 6.5 启用用户自有 Codex 凭据（BYO）

如果你希望每个登录用户都使用自己的 Codex/OpenAI API Key（而不是共享服务端 `OPENAI_API_KEY`）：

1. 在 `.env.docker` 中设置 `FLOWX_CREDENTIAL_MASTER_KEY`（与 Cursor 共用加密主密钥）
2. 重启服务
3. 用户登录后进入“AI 凭据”页面，配置个人 Codex/OpenAI API Key

执行优先级为：

- 用户凭据
- 实例级 `OPENAI_API_KEY`
- 容器内 `codex login` 登录态

若设置 `FLOWX_CODEX_REQUIRE_USER_CREDENTIAL=true`：

- 未配置用户凭据的请求会直接失败（返回 `CODEX_USER_CREDENTIAL_REQUIRED`）
- 不再回退实例级 `OPENAI_API_KEY` 或登录态

## 7. 数据库说明

当前推荐数据库路径：

```bash
DATABASE_URL="file:/data/dev-current.db"
```

原因：

- 这个仓库当前开发演进过程中已经从旧库迁到了 `dev-current.db`
- 容器启动脚本会自动执行 `prisma db push`
- 建议把 `/data` 挂成 volume，避免容器删除后数据库丢失
- Nginx compose 部署还会默认持久化 `/app/.flowx-data`，用于保存工作区仓库和 workflow 副本

如果你要把本地已经迁好的数据库带到服务器，可以先把数据库文件上传到宿主机，例如：

```bash
mkdir -p /opt/flowx-data
scp dev-current.db user@server:/opt/flowx-data/dev-current.db
```

然后运行容器时挂载：

```bash
-v /opt/flowx-data:/data
```

说明：

- `/data` 主要保存数据库和 Codex 登录态
- `/app/.flowx-data` 主要保存工作区仓库、本地副本和 workflow 仓库副本
- 如果不持久化 `/app/.flowx-data`，容器重建后执行阶段可能会因为找不到仓库目录而失败

## 8. Git 与仓库操作要求

如果工作流里需要：

- 拉取仓库
- 提交代码
- 推送远程

那容器里还需要具备这些条件：

- 可以访问远程 Git 仓库
- 有 SSH Key 或 HTTPS Token
- 已设置 Git 身份

至少建议配置：

```bash
-e GIT_AUTHOR_NAME="FlowX Bot"
-e GIT_AUTHOR_EMAIL="flowx@example.com"
```

如果你使用 SSH 拉代码，compose 现在默认会把宿主机的 SSH 目录直接挂进去：

```bash
/root/.ssh:/root/.ssh:ro
```

如果你的服务器不是用 `root` 运行 Docker，或者 SSH 目录不在 `/root/.ssh`，就直接修改 [docker-compose.nginx.yml](/Users/chalkley/workspace/FlowX/docker-compose.nginx.yml) 里的这一行映射。

## 9. 常用运维命令

### 9.1 使用更新脚本

仓库里提供了一个更新脚本：

- [scripts/deploy-update.sh](/Users/chalkley/workspace/FlowX/scripts/deploy-update.sh)

默认按 Nginx 模式更新：

```bash
sh scripts/deploy-update.sh
```

等价于：

- `git pull --ff-only`
- 重新 `docker build`
- 执行 `docker compose -f docker-compose.nginx.yml up -d --force-recreate`

脚本会自动兼容：

- `docker compose`
- `docker-compose`

执行前建议先确认 `.env.docker` 已经存在并填写完成。

如果你之前是单容器部署，后来想切到 Nginx，脚本会先检查是否存在冲突的旧容器 `flowx`。

这时你可以手工删除旧容器：

```bash
docker rm -f flowx
sh scripts/deploy-update.sh
```

也可以让脚本自动删掉冲突容器：

```bash
AUTO_REMOVE_CONFLICT_CONTAINER=1 sh scripts/deploy-update.sh nginx
```

如果你是单容器部署：

```bash
sh scripts/deploy-update.sh single
```

如果你是单容器直连部署，建议在 `.env.docker` 里配置：

```env
FRONTEND_BUILD_MODE=direct
DIRECT_API_BASE_URL=http://YOUR_SERVER_IP:3000
```

这个脚本默认：

- 保留 `flowx-data` 卷
- 保留 `flowx-workdir` 卷
- 不删除数据库
- 不清理 `/data/.codex`

如果你想覆盖默认值，可以在执行前传环境变量，例如：

```bash
IMAGE_NAME="flowx:latest" \
BUILD_API_BASE_URL="" \
AI_EXECUTOR_PROVIDER="codex" \
sh scripts/deploy-update.sh nginx
```

查看容器：

```bash
docker ps
```

查看日志：

```bash
docker logs -f flowx
```

查看 Nginx 日志：

```bash
docker logs -f flowx-nginx
```

进入容器：

```bash
docker exec -it flowx sh
```

停止并删除容器：

```bash
docker stop flowx
docker rm flowx
```

使用 compose 停止：

```bash
docker compose -f docker-compose.nginx.yml down
```

如果要连 volume 一起删：

```bash
docker compose -f docker-compose.nginx.yml down -v
```

注意：

- `down -v` 会删除数据库和 Codex 登录态
- 执行前一定确认你不再需要保留 `/data`

## 10. 启动后验证

### 10.1 单容器模式

验证 API：

```bash
curl http://127.0.0.1:3000/auth/providers
```

验证前端：

```bash
curl http://127.0.0.1:4173
```

### 10.2 Nginx 模式

验证站点：

```bash
curl http://127.0.0.1/
```

验证 API 是否通过 Nginx 转发：

```bash
curl http://127.0.0.1/api/auth/providers
```

### 10.3 受保护接口

像 `/api/projects` 这样的接口需要登录态或 bearer token。

直接访问：

```bash
curl -i http://127.0.0.1/api/projects
```

返回 `401` 是符合预期的，不表示服务没起来。

## 11. 常见问题

### 11.1 `curl` 不通

先检查：

- 容器是否真的启动成功
- 宿主机端口是否已映射
- API 是否监听 `0.0.0.0`
- 是否被防火墙拦截

排查命令：

```bash
docker ps
docker logs -f flowx
```

### 11.2 `projects` 接口访问失败

先区分两种情况：

- `401 Missing bearer token`：说明服务是通的，只是没登录
- 连接超时或拒绝连接：才是服务、网络或端口问题

### 11.3 Codex 阶段执行失败

优先检查：

- 是否已经执行过 `codex login`
- `CODEX_HOME` 是否持久化到了 `/data/.codex`
- 是否误删了 volume
- 是否有可访问 Git 仓库的凭证

### 11.4 钉钉登录不可用

确认配置的是：

```bash
DINGTALK_APP_ID
DINGTALK_APP_SECRET
```

不是：

```bash
DINGTALK_APPID
```

## 12. 推荐部署顺序

如果你现在还是自己使用阶段，建议按这个顺序：

1. 先用 `mock` 模式把 Docker 跑通
2. 再切到 `codex`，并手动执行一次 `codex login`
3. 确认工作流 AI 阶段能正常执行
4. 最后再启用 Nginx，对外只暴露 `80`

这样排障最清晰，不会把 Docker、Nginx、Codex、鉴权问题混在一起。