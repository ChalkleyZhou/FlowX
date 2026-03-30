# AI R&D Orchestration MVP

This repository contains a staged, interruptible, human-confirmable AI研发调度系统 MVP.

## Architecture

```mermaid
flowchart LR
    U["用户 / 管理员"] --> W["Web 控制台\nReact + shadcn/ui + Tailwind + Vite"]
    W --> A["API 服务\nNestJS + TypeScript"]
    A --> DB["SQLite / Prisma"]

    subgraph Orchestration["工作流编排层"]
      REQ["Requirement\n需求"]
      WF["WorkflowRun\n工作流"]
      ST["StageExecution\n阶段执行"]
      RF["ReviewFinding / Issue / Bug\n审查沉淀"]
    end

    A --> REQ
    A --> WF
    A --> ST
    A --> RF

    subgraph RepoLayer["代码库上下文层"]
      WS["Workspace"]
      RP["Repositories\n基线仓库"]
      WR["Workflow Repositories\n工作流副本 / 工作分支"]
    end

    A --> WS
    WS --> RP
    WF --> WR
    RP --> WR

    subgraph AI["AI 执行器层"]
      EX["AIExecutor 抽象"]
      CX["Codex Executor"]
      MX["Mock Executor"]
      PT["Prompt Templates"]
    end

    A --> EX
    EX --> CX
    EX --> MX
    CX --> PT
    MX --> PT

    WR --> CX
    ST --> CX
    CX --> ST
    ST --> RF
```

### Flow at a glance

1. 在 `Workspace` 下登记代码库，系统拉取基线仓库并维护当前分支。
2. 创建 `Requirement` 后发起 `WorkflowRun`。
3. 工作流会为每个仓库准备独立的 workflow 副本和工作分支。
4. `Task Split -> Technical Plan -> Execution -> AI Review` 按阶段推进，关键节点必须人工确认。
5. 执行与审查结果结构化落库，并可沉淀为 `ReviewFinding / Issue / Bug`。

## Stack

- Backend: NestJS + TypeScript + Prisma + SQLite
- Frontend: React + shadcn/ui + Tailwind + Vite
- AI integration: provider abstraction with Codex / Mock executor

## Structure

- `docs/system-design.md`: MVP system design
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
```

2. Install dependencies:

```bash
pnpm install
```

3. Generate Prisma client and sync schema:

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

4. Start both apps:

```bash
pnpm dev
```

## Docker deployment

This repo includes a multi-stage `Dockerfile` that builds both the API and the web app.

Build the image:

```bash
docker build \
  --build-arg VITE_API_BASE_URL="http://YOUR_SERVER_IP:3000" \
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
  -e DINGTALK_APP_ID="your_app_id" \
  -e DINGTALK_APP_SECRET="your_app_secret" \
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
- If you want workflow `提交并推送到远程` to work, the container must have:
  - reachable git remote credentials (SSH key or HTTPS token)
  - git identity configured, e.g. `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL`
- `AI_EXECUTOR_PROVIDER="codex"` is only available when your runtime image really has Codex CLI and its auth/context configured
- The current `Dockerfile` does **not** install Codex CLI by default, so server deployments should usually start with `AI_EXECUTOR_PROVIDER="mock"` unless you are building a custom runtime image

## Auth

- Built-in user system with extensible third-party provider abstraction.
- Supports account/password login and registration.
- DingTalk login is available at `/auth/dingtalk/*`.
- For real DingTalk OAuth, set `DINGTALK_APP_ID`, `DINGTALK_APP_SECRET`, and optionally override endpoints via:
  - `DINGTALK_AUTHORIZE_URL`
  - `DINGTALK_TOKEN_URL`
  - `DINGTALK_PROFILE_URL`
  - `DINGTALK_ORGS_URL`

## MVP flow

1. Create requirement
2. Start workflow
3. Run task split
4. Human confirm or reject task split
5. Run technical plan
6. Human confirm or reject plan
7. Run execution
8. Run AI review
9. Inspect full stage history
