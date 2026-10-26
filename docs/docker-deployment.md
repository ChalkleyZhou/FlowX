# Docker 部署指南

这份文档整理了 FlowX 在服务器上的完整 Docker 部署方式，覆盖以下场景：

- 直接暴露前端 `4173` 和 API `3000`
- 使用 Nginx 反向代理，只暴露 `80`
- 使用 `mock` 执行器快速启动
- 在组织「AI 凭据」中保存密钥后使用在线 Codex / Cursor；未配置时在线 AI 不可用

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
| `AI_EXECUTOR_DEFAULT_PROVIDER`         | 不再决定在线 AI。在线默认执行器由组织「AI 凭据」里的优先项决定                                      | 否              |
| `CODEX_HOME`                           | Codex CLI 登录态目录                                                                  | `codex` 时建议设置  |
| `CODEX_READ_SANDBOX`                   | Codex 只读阶段沙箱模式，默认 `read-only`；仅在 Docker 内核不支持 `bwrap` 时临时改为 `danger-full-access` | 否              |
| `CODEX_WRITE_SANDBOX`                  | Codex 写入阶段沙箱模式，默认 `workspace-write`                                              | 否              |
| `OPENAI_API_KEY`                       | Codex/API 认证方式之一                                                                 | 否              |
| `CURSOR_API_KEY`                       | Cursor CLI 服务端认证                                                                 | `cursor` 时建议填写 |
| `OPENDESIGN_MCP_ENABLED`               | 设计阶段是否提示 agent 用 OpenDesign MCP 取材生成高保真 HTML 设计稿；需 host 预装 `od` 并 `od mcp install` | 否，默认关闭         |
| `CURSOR_NO_PROGRESS_TIMEOUT_MS`        | Cursor 进程无输出/无进展判定超时（毫秒）；设 `0` 关闭该判定                                            | 否，默认 `0`       |
| `FLOWX_IDEATION_STALE_HEARTBEAT_MS`    | 启动恢复时判定 RUNNING 会话“心跳过期”的阈值（毫秒）                                                | 否，默认 `120000`  |
| `FLOWX_CREDENTIAL_MASTER_KEY`          | 用户级 Cursor 凭据加密主密钥（BYO 模式）                                                       | 启用用户自有凭据时必填    |
| `FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL` | 已不再控制在线 AI。在线调用始终要求组织 Cursor 凭据                                              | 否              |
| `FLOWX_CODEX_REQUIRE_USER_CREDENTIAL`  | 已不再控制在线 AI。在线调用始终要求组织 Codex 凭据                                               | 否              |
| `FRONTEND_BUILD_MODE`                  | 前端构建模式：`nginx`、`direct`、`auto`                                                   | 建议填写           |
| `DIRECT_API_BASE_URL`                  | 直连模式下前端访问 API 的地址                                                                | `direct` 时建议填写 |
| `DINGTALK_APP_ID`                      | 钉钉登录 App ID                                                                      | 仅钉钉登录时必填       |
| `DINGTALK_APP_SECRET`                  | 钉钉登录 App Secret                                                                  | 仅钉钉登录时必填       |
| `DINGTALK_AGENT_ID`                    | 钉钉通知 Agent ID                                                                    | 仅钉钉通知时必填       |
| `YUNXIAO_WEBHOOK_SECRET`               | 云效 Webhook 专用 Secret，用于校验 `X-Projex-Signature`，不是个人 API Token                       | 启用云效通知时必填      |
| `YUNXIAO_PERSONAL_ACCESS_TOKEN`        | 云效个人访问令牌，通过 `Authorization: Bearer` / `X-Yunxiao-Token` 查询项目成员、组织成员和绑定信息；需手动关联 FlowX 用户 | 启用云效通知时推荐      |
| `YUNXIAO_ACCESS_KEY_ID`                | 云效 OpenAPI AccessKey ID，个人 Token 不可用时的兼容认证方式                                   | 否                    |
| `YUNXIAO_ACCESS_KEY_SECRET`            | 云效 OpenAPI AccessKey Secret                                                                  | 否                    |
| `YUNXIAO_REGION_ID`                    | 云效 OpenAPI 区域（AccessKey 兼容路径使用）                                                       | 否，默认 `cn-hangzhou` |
| `YUNXIAO_API_ENDPOINT`                 | 云效 OpenAPI 自定义 endpoint                                                                     | 否                      |
| `GIT_AUTHOR_NAME`                      | Git 提交用户名                                                                        | 建议填写           |
| `GIT_AUTHOR_EMAIL`                     | Git 提交邮箱                                                                         | 建议填写           |


说明：

- 钉钉变量是 `DINGTALK_APP_ID`，不是 `DINGTALK_APPID`
- 如果你现在只是自己使用，可以先不配置钉钉登录
- 使用“同步钉钉用户”前，还需在钉钉开放平台为应用开通通讯录部门和用户读取权限（至少包括 `qyapi_get_department_member`）；FlowX 只同步用户，不保存部门结构
- 在线 AI 只读取「AI 凭据」页保存的当前组织密钥，必须设置 `FLOWX_CREDENTIAL_MASTER_KEY`。未配置凭据时在线 AI 不可用
- 服务器上的 `OPENAI_API_KEY`、`CURSOR_API_KEY` 和 CLI 登录态不会再作为在线调用的回退
- `FRONTEND_BUILD_MODE=nginx` 表示前端走同源 `/api` 代理，不在构建时写死完整 API 域名
- `FRONTEND_BUILD_MODE=direct` 表示前端直接请求 `DIRECT_API_BASE_URL`
- 要让设计阶段接入 OpenDesign，需在运行 API 的同一环境安装 `od` CLI、对所用 agent 执行 `od mcp install codex|cursor`，并设置 `OPENDESIGN_MCP_ENABLED=1` 后重启；详见 [docs/opendesign-design-stage.md](opendesign-design-stage.md)

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

容器运行时还需设置 **API 对端侧可达的公网地址**（本机 `flowx-local` / MCP 回连用，必须是用户浏览器能打开的域名，不要写 `127.0.0.1` 或内网 IP）：

```bash
-e PUBLIC_API_BASE_URL="https://flowx.example.com/api"
```

未设置时，本地启动 redeem 会回退到 `http://127.0.0.1:$PORT`，只适合本机开发。Web 在浏览器侧会把相对路径 `/api` 解析为当前页面的 `origin + /api` 再交给 `flowx-local`。

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

### 5.2 启用在线 AI

在线 AI 只使用组织「AI 凭据」页保存的密钥。容器环境变量 `OPENAI_API_KEY`、`CURSOR_API_KEY` 和 `codex login` 不会让在线 AI 可用。启动前设置 `FLOWX_CREDENTIAL_MASTER_KEY`，用来加密这些组织密钥：

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev-current.db" \
  -e FLOWX_CREDENTIAL_MASTER_KEY="replace-with-a-long-random-string" \
  -e GIT_AUTHOR_NAME="FlowX Bot" \
  -e GIT_AUTHOR_EMAIL="flowx@example.com" \
  -v flowx-data:/data \
  flowx:latest
```

容器启动后登录 Web，进入「AI 凭据」，保存 Cursor 和/或 Codex API Key，并选择优先使用的在线 AI。没有配置任何凭据时，在线 AI 不可用。本地 Cursor、Codex 和 WorkBuddy 不使用这组密钥。

注意：

- 更换 `FLOWX_CREDENTIAL_MASTER_KEY` 后，已保存的组织密钥无法解密，需要重新保存
- `CODEX_READ_SANDBOX` 和 `CODEX_WRITE_SANDBOX` 仍作用于 Codex CLI 沙箱

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
- `YUNXIAO_WEBHOOK_SECRET`
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

- `/install`、`/install.ps1` 精确匹配，原样转发到 API（不做 `/api` 前缀 rewrite）
- `/api/*` 全部转发到 API
- 其他请求全部转发到前端页面服务

本地 Agent 一键安装脚本由 API 提供，Nginx 必须保留上述 `location = /install` 与 `location = /install.ps1` 规则。用户在本机执行：

```bash
curl -fsSL http://<host>/install | bash
```

Windows PowerShell：

```powershell
irm http://<host>/install.ps1 | iex
```

脚本会优先使用公网 `PUBLIC_API_BASE_URL`；若写成内网 IP / `127.0.0.1` 则忽略，改用当前请求的站点 origin + `/api`。Nginx 部署时请在 `.env.docker` 中设置与对外访问一致的地址，例如 `PUBLIC_API_BASE_URL=https://flowx.example.com/api`（见 §4.2）。

### 6.3 在线 AI 不使用服务器登录态

`AI_EXECUTOR_PROVIDER`、`CODEX_HOME` 和容器里的 `codex login` 不会启用在线 AI。在线调用只读取组织「AI 凭据」页保存的密钥，配置方式见下一节。`CODEX_READ_SANDBOX` 和 `CODEX_WRITE_SANDBOX` 仍作用于 Codex CLI 沙箱。本地 Cursor、Codex 和 WorkBuddy 由开发者本机 IDE 执行，不使用这组组织密钥。

钉钉登录回调地址也应配置为：

```text
http://YOUR_SERVER_HOST/api/auth/dingtalk/callback
```

说明：

- `docker-compose.nginx.yml` 会自动读取 `.env.docker`
- `.env.docker` 用来给容器注入运行时环境变量
- 如果 `.env.docker` 不存在，Compose 替换变量时会退回到文件里写的默认值

### 6.4 配置组织 AI 凭据

在线 AI 使用当前组织在「AI 凭据」页保存的密钥，不使用服务器实例密钥或 CLI 登录态。

1. 在 `.env.docker` 中设置 `FLOWX_CREDENTIAL_MASTER_KEY`（建议使用高强度随机字符串）
2. 重启服务
3. 登录后进入「AI 凭据」，保存 Cursor 和/或 Codex API Key，并选择优先使用的在线 AI

没有配置任何凭据时，在线 AI 不可用。本地 Cursor、Codex 和 WorkBuddy 不走这组密钥。

## 7. 数据库说明

当前推荐数据库路径：

```bash
DATABASE_URL="file:/data/dev-current.db"
```

原因：

- 这个仓库当前开发演进过程中已经从旧库迁到了 `dev-current.db`
- 容器启动脚本会在 `prisma db push` 前自动执行必要的 SQLite 数据迁移（例如为历史 Workspace 补充组织归属、将投递目标从工作区迁到项目、安全添加云效组织绑定和多人投递索引，以及删除 Spec & Plan 重构后已废弃的非空 `Task`/`Plan` 表），再同步 schema
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
- `/app/.flowx-data/code-review/workspaces` 是每日 Code Review 独立的 sandbox 克隆目录（可用 `CODE_REVIEW_REPOS_ROOT` 覆盖），与开发用的工作区仓库副本分离
- 如果不持久化 `/app/.flowx-data`，容器重建后执行阶段可能会因为找不到仓库目录而失败

### 7.1 只清业务数据（保留用户与登录态）

数据库在卷 `flowx-data` 的 `/data/dev-current.db`。镜像内已包含 `pnpm db:clean`，**无需在宿主机安装 pnpm**。

重新构建并拉起容器后，在部署目录执行：

```bash
sh docker/clean-business.sh
```

等价于：

```bash
docker exec flowx pnpm db:clean --mode=business --yes
```

说明：

- `business`（默认）：删除工作区、项目、需求、工作流、Issue/Bug 等业务数据，**保留 User、凭据、会话表以外的认证数据**
- 不删除 `/data/.codex`（Codex 登录态）和 `flowx-workdir`（仓库 clone）
- 若需只清工作流或只清登录会话：`sh docker/clean-business.sh workflows` / `sessions`

### 7.2 补齐组织管理员（老数据）

上线「首个成员为管理员」后，历史组织里可能所有人都是 `member`，导致无人能进用户管理。可执行**洗数据**（保留业务与用户，只补 `admin` 角色）：

```bash
# 预览将提拔谁
sh docker/backfill-organization-admins.sh --dry-run

# 执行（每个尚无 admin 的组织，把最早加入的成员设为 admin）
sh docker/backfill-organization-admins.sh
```

等价于：

```bash
docker exec flowx pnpm db:backfill-admins --yes
```

本地 SQLite（仓库根目录 `.env` 指向的库）：

```bash
pnpm db:backfill-admins --dry-run
pnpm db:backfill-admins --yes
```

说明：

- 已有 `admin` 的组织会跳过
- 无成员的组织会跳过
- 可重复执行（幂等）

### 7.3 回填云效成员绑定 ID（老数据）

如果此前已经手动关联过云效成员，新增身份字段后可以使用个人 Token 回填组织成员 ID、云效 `userId` 和阿里云账号绑定 ID：

```bash
# 先查询并预览，不写数据库
sh scripts/backfill-yunxiao-member-mappings.sh --dry-run

# 确认结果后执行回填
sh scripts/backfill-yunxiao-member-mappings.sh --yes
```

等价于：

```bash
docker exec flowx pnpm db:backfill-yunxiao-mappings --dry-run
docker exec flowx pnpm db:backfill-yunxiao-mappings --yes
```

脚本只更新已有绑定，不创建或删除绑定。无法通过 `ReadMemberByUser` 或 `GetBindInfo` 查到完整身份的记录会跳过并打印原因；也可以使用 `--organization=<organizationId>` 只处理一个 FlowX 组织。

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

- 当前组织是否已在「AI 凭据」保存 Codex 密钥，且该密钥仍有效
- `FLOWX_CREDENTIAL_MASTER_KEY` 是否与保存密钥时一致
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
2. 设置 `FLOWX_CREDENTIAL_MASTER_KEY`，在「AI 凭据」保存 Codex 或 Cursor 密钥并选择优先项
3. 确认工作流在线 AI 阶段能正常执行
4. 最后再启用 Nginx，对外只暴露 `80`

这样排障最清晰，不会把 Docker、Nginx、Codex、鉴权问题混在一起。

## 多仓分支交付版本升级

本次增加 `CodeBranchSubmission` 表与关联索引，对应 migration 为 `20261022070000_add_code_branch_submissions`。升级前备份 SQLite 与持久化目录；容器沿用现有启动脚本执行 schema 同步，无新增环境变量。非 Docker 环境先执行 `pnpm prisma:generate`，再按当前数据库管理方式应用 migration 或运行 `pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma`；不要对未纳入 migration 历史的旧库盲目执行全量 `migrate deploy`。

分支确认需要 API 宿主机可执行 Git 并读取所选仓库，沿用已有 Git 凭据配置。实际差异在系统临时目录的隔离 bare 仓库中读取，完成或失败后清理；不会在工作区仓库 checkout。读取过大差异或超时会提示失败并保留流程，不降级为没有真实 diff 的已确认交付。

## 需求变更版本升级

本次增加 `RequirementChange` 表、需求 `revision` 和工作流的新旧轮次关联，对应 migration 为 `20261023160000_add_requirement_changes`。升级前备份 SQLite，容器继续使用现有启动脚本同步 schema，无新增环境变量。非 Docker 环境重新生成 Prisma client，再按当前数据库管理方式应用本次 migration 或运行上述 `prisma db push`，随后重启 API。既有需求的修订从 0 开始，原始描述、流程与产物保留；上线前已领取的本地任务仍按原修订读取上下文。
