# FlowX

FlowX 是一个正在从 AI 研发流程编排 MVP 演进为端云协同 AI 产研平台的项目。

Cursor、Codex、OpenDesign、IDE、CLI 和自动化测试工具继续作为端侧专业执行环境；FlowX 负责组织级项目、上下文、流程、状态、证据、质量、交付和治理。

## Architecture

```mermaid
flowchart LR
    Roles["产品、设计、开发、测试、运维"] --> Entrances["FlowX Web / Cursor / Codex / OpenDesign / IDE / CI"]
    Entrances --> Edge["FlowX Edge Agent\n任务、上下文、Adapter、本地执行、Evidence"]
    Edge <--> Sync["Sync Gateway\n命令、事件、状态、Artifact"]
    Sync <--> Cloud["FlowX 云端控制平面\n项目、流程、AI 上下文、质量、发布、治理"]
    Cloud <--> Integrations["Git / CI/CD / 制品库 / 测试平台 / 可观测性 / 通知"]
    Cloud --> Thread["Project Digital Thread\n需求 → 设计 → 执行 → Commit → 测试 → 发布 → 反馈"]
```

完整目标架构、同步协议、数据模型和 90 天实施路线见 [FlowX 端云协同 AI 产研平台目标架构](docs/architecture/edge-cloud-ai-rd-platform.md)。

当前实现的高层架构图（Archify）：

![FlowX 当前实现高层架构图](docs/architecture/assets/flowx-architecture-archify.png)

![FlowX 端云协同 AI 产研平台架构图](docs/architecture/assets/flowx-edge-cloud-ai-rd-platform.png)

### 当前已具备的基础

1. `Workspace`、`Project`、`Requirement`、排期和项目简报。
2. 一条工作流内的产品构思、设计、Spec & Plan、执行、AI Review 和人工确认。
3. Codex、Cursor、Mock executor 抽象，以及 OpenDesign 本地设计会话。
4. Cursor Extension、`flowx-local`、本地执行交接、可靠 Outbox 和本地完成回传。
5. Workflow Repository、工作分支、Artifact 和本地预览。
6. ReviewFinding、Issue、Bug、每日 Code Review 和投递目标。
7. Git 凭据、AI 凭据、认证和组织用户管理。

### 目标演进方向

1. 将 `flowx-local` 演进为统一 FlowX Edge Agent。
2. 通过 Tool Adapter SPI 接入 Cursor、Codex、OpenDesign、测试 Runner 和设备节点。
3. 建立版本化、幂等、可追踪的端云同步协议。
4. 建立独立测试与质量中心以及统一 Artifact/Evidence Center。
5. 用 Project Digital Thread 串联需求、设计、执行、代码、测试、发布和运行反馈。
6. 在保持模块化单体的前提下，逐步引入 PostgreSQL、队列、对象存储和独立 Worker。

## Stack

- Backend: NestJS + TypeScript + Prisma + SQLite（当前 MVP）
- Frontend: React + shadcn/ui + Tailwind + Vite
- Local integration: Cursor Extension + `flowx-local` + OpenDesign Adapter
- AI integration: Codex / Cursor / Mock executor + OpenDesign
- Target infrastructure: PostgreSQL + Redis/BullMQ + MinIO/S3 + Workers

## Engineering guardrails

- Agent rules: `AGENTS.md`
- AI maintainability guide: `docs/architecture/ai-maintainability.md`
- Validation command: `pnpm check`

## Structure

- `docs/system-design.md`: 当前系统设计与目标演进索引
- `docs/architecture/edge-cloud-ai-rd-platform.md`: 端云协同目标架构、协议和实施路线
- `docs/superpowers/plans/2026-07-22-edge-cloud-foundation.md`: 第一阶段端云协同底座实施计划
- `docs/docker-deployment.md`: Docker 与 Nginx 部署指南
- `apps/api`: backend service
- `apps/web`: basic management UI
- `prisma`: Prisma schema

## Quick start

1. Create `.env` in the repository root:

```env
DATABASE_URL="file:./dev.db"
PORT=3000
VITE_API_BASE_URL="http://localhost:3000"
DINGTALK_APP_ID=""
DINGTALK_APP_SECRET=""
DINGTALK_AGENT_ID=""
YUNXIAO_WEBHOOK_SECRET=""
YUNXIAO_PERSONAL_ACCESS_TOKEN=""
YUNXIAO_ACCESS_KEY_ID=""
YUNXIAO_ACCESS_KEY_SECRET=""
YUNXIAO_REGION_ID="cn-hangzhou"
YUNXIAO_API_ENDPOINT=""
```

1. Install dependencies:

```bash
pnpm install
```

1. Generate Prisma client and sync schema:

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

1. Start both apps:

```bash
pnpm dev
```

### 本地 OpenDesign 设计

OpenDesign 跑在设计师本机，不必装到 API 主机：

```bash
curl -fsSL https://<当前站点>/install | bash
flowx-local login
```

安装后用 MCP 领取任务并提交构思 / 设计。详见 [本地 Agent 使用指南](docs/local-agent-guide.md)。贡献者可用 `pnpm --filter @flowx-ai/local build && pnpm flowx-local serve`。

## Docker deployment

完整部署说明见 [docs/docker-deployment.md](/Users/chalkley/workspace/FlowX/docs/docker-deployment.md)。

This repo includes a multi-stage `Dockerfile` that builds both the API and the web app.

Build the image:

```bash
docker build \
  --build-arg VITE_API_BASE_URL="/api" \
  -t flowx:latest .
```

Run the container:

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev.db" \
  -e AI_EXECUTOR_PROVIDER="mock" \
  -e OPENAI_API_KEY="your_openai_api_key" \
  -e CODEX_HOME="/data/.codex" \
  -e DINGTALK_APP_ID="your_app_id" \
  -e DINGTALK_APP_SECRET="your_app_secret" \
  -e DINGTALK_AGENT_ID="your_agent_id" \
  -e YUNXIAO_WEBHOOK_SECRET="your_webhook_secret" \
  -e YUNXIAO_PERSONAL_ACCESS_TOKEN="your_yunxiao_personal_access_token" \
  -e YUNXIAO_ACCESS_KEY_ID="your_yunxiao_access_key_id" \
  -e YUNXIAO_ACCESS_KEY_SECRET="your_yunxiao_access_key_secret" \
  -e GIT_AUTHOR_NAME="FlowX Bot" \
  -e GIT_AUTHOR_EMAIL="flowx@example.com" \
  -v flowx-data:/data \
  flowx:latest
```

Notes:

- API runs on `3000`
- Web runs on `4173`
- SQLite data is stored in `/data/dev.db`, so mounting `/data` is recommended
- The container startup script will run `prisma db push` automatically before starting services
- Before `db push`, it also applies idempotent SQLite pre-migrations (including assigning existing workspaces to an organization, adding Yunxiao integration indexes safely, and dropping obsolete `Task`/`Plan` and deploy integration tables)
- The runtime image now installs both Codex CLI and Cursor CLI
- Codex login state is stored under `/data/.codex` by default, so mounting `/data` will persist `codex login`
- `AI_EXECUTOR_DEFAULT_PROVIDER` can be set to `codex` or `cursor` as the default provider for new workflows
- If you want to use `AI_EXECUTOR_PROVIDER="codex"`, set `OPENAI_API_KEY` in the container
- If you want to use Cursor on the server, set `CURSOR_API_KEY` in the container and choose `Cursor CLI` when starting a workflow
- If you want each user to use their own Cursor API Key, set `FLOWX_CREDENTIAL_MASTER_KEY` and let users configure credentials in `AI 凭据` page
- If you want to enforce user-only Cursor credentials (no instance fallback), set `FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL=true`
- If you want each user to use their own Codex/OpenAI API Key, set `FLOWX_CREDENTIAL_MASTER_KEY` and let users configure credentials in `AI 凭据` page
- If you want to enforce user-only Codex credentials (no instance fallback), set `FLOWX_CODEX_REQUIRE_USER_CREDENTIAL=true`
- If you want workflow `提交并推送到远程` to work, the container must have:
  - reachable git remote credentials (SSH key or HTTPS token)
  - git identity configured, e.g. `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL`
- `AI_EXECUTOR_PROVIDER="codex"` still requires valid Codex authentication in the container; in server environments the simplest way is `OPENAI_API_KEY`
- If Docker/host kernel blocks Codex `read-only` sandbox with `bwrap: No permissions to create a new namespace`, set `CODEX_READ_SANDBOX="danger-full-access"`
- OpenDesign 推荐通过设计师本机的 `flowx-local` Adapter 接入；API 主机上的 `OPENDESIGN_MCP_ENABLED` 仅保留为旧服务端 AI 设计链路的兼容能力。见 [docs/opendesign-design-stage.md](/Users/chalkley/workspace/FlowX/docs/opendesign-design-stage.md)

### Using manual `codex login` in Docker

If you are still in a personal-use stage and prefer logging into Codex manually instead of configuring `OPENAI_API_KEY`, you can:

1. Start the container with `AI_EXECUTOR_PROVIDER="codex"` and mount `/data`
2. Enter the container once and run `codex login`
3. Keep using the same `/data` volume so `/data/.codex` persists across restarts

Example:

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev.db" \
  -e AI_EXECUTOR_PROVIDER="codex" \
  -e CODEX_HOME="/data/.codex" \
  -v flowx-data:/data \
  flowx:latest

docker exec -it flowx sh
codex login
```

After login succeeds once, the Codex auth state will stay in the mounted volume.

### Deploy behind Nginx

If you do not want to expose `3000` and `4173` directly, you can put Nginx in front and expose only port `80`.

1. Build the image with same-origin API requests:

```bash
docker build \
  --build-arg VITE_API_BASE_URL="/api" \
  -t flowx:latest .
```

1. Start with the provided compose file:

```bash
docker compose -f docker-compose.nginx.yml up -d
```

This setup will:

- expose only `80`
- proxy `/api/*` to the API container
- proxy all other paths to the web app

If you are using manual `codex login`, run it once after the containers start:

```bash
docker exec -it flowx sh
codex login
```

## Auth

- Built-in user system with extensible third-party provider abstraction.
- Supports account/password login and registration.
- DingTalk login is available at `/api/auth/dingtalk/*` when deployed behind Nginx.
- For real DingTalk OAuth, set `DINGTALK_APP_ID`, `DINGTALK_APP_SECRET`, and optionally override endpoints via:
  - `DINGTALK_AUTHORIZE_URL`
  - `DINGTALK_TOKEN_URL`
  - `DINGTALK_PROFILE_URL`
  - `DINGTALK_ORGS_URL`
- For personal stage completion notifications, also set `DINGTALK_AGENT_ID`.
- FlowX will try to notify only the current DingTalk login user who triggered the stage or confirmation, instead of broadcasting through a group robot.
- 钉钉组织管理员可在“用户管理”中同步通讯录用户。同步会新增或更新用户，并将已不在钉钉通讯录中的钉钉成员移出当前组织；用户账号和历史数据不会删除，但该组织下的会话和 Personal API Token 会失效。FlowX 不保存部门结构；钉钉应用需具备通讯录部门和用户读取权限，包括 `qyapi_get_department_member`。
- 每个组织保留一名主管理员；主管理员可以给多个成员分配或收回“子管理员”角色。子管理员可以执行组织内普通管理操作，但不能编辑、移除主管理员，也不能转让主管理员权限；只有主管理员可以分配子管理员和转让权限。
- 支持通过固定地址 `/api/yunxiao-webhooks` 接收云效自动化规则的原生工作项数据，并通过云效项目成员的 `memberId`、`userId` 和阿里云账号绑定 ID 与管理员手动关联的 FlowX 用户，向负责人、参与者、验证者和创建者发送去重后的钉钉个人通知。云效 Secret 通过 `X-Projex-Signature` 校验，服务端配置 `YUNXIAO_WEBHOOK_SECRET` 和 `YUNXIAO_PERSONAL_ACCESS_TOKEN`（也兼容 AccessKey），组织管理员可在“云效集成”页面绑定 `organizationIdentifier`、加载项目成员并一键启用或停用；未匹配人员会在页面保留记录。详见[云效 Webhook 钉钉通知接入](docs/yunxiao-webhook.md)。
- 组织管理员可以在“云效集成”页面清空当前组织的未匹配人员记录；该操作不会影响成员映射、已匹配投递记录或 Webhook 原始数据。
- 若升级前已有云效成员绑定，可执行 `pnpm db:backfill-yunxiao-mappings --dry-run` 预览并使用 `--yes` 回填三种云效身份 ID；脚本只更新已有绑定，不创建或删除绑定。

## MVP flow

1. Create requirement
2. Start workflow
3. Run repository grounding
4. Optionally run brainstorm and design (or skip)
5. Run Spec & Plan generation
6. Human confirm or reject Spec & Plan
7. Run execution
8. Run AI review
9. Human review and inspect full stage history
