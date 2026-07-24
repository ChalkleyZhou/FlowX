# OpenDesign API Token + 构思→设计无缝衔接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用用户级长期 Personal API Token 做本机主鉴权，并让 OpenDesign 在提交构思后同一会话可直接拉设计 handoff / 提交，无需第二次 Web「打开本地 OpenDesign」。

**Architecture:** 双轨兼容。新增 `PersonalApiToken`（hash 存储、可撤销、不过期、与登录同权），Guard 统一解析 Session 或 PAT。`flowx-local` 写入 `~/.flowx/credentials.json` + `current-workflow.json`；MCP 鉴权顺序 env → credentials → active-design。`getLocalDesignHandoff` / `getLocalBrainstormHandoff` 在无活跃 session 时惰性 `claim*`；brainstorm complete 响应扩展 `next`。Web 一键启动与短期 token 路径保持绿。

**Tech Stack:** NestJS + Prisma + Vitest（`apps/api`）、React + Vitest（`apps/web`）、`packages/flowx-local` / `flowx-mcp` / `flowx-protocol`、现有 Bearer SessionAuthGuard

**Spec:** `docs/superpowers/specs/2026-07-24-opendesign-api-token-seamless-design.md`

**Locked open points:**
- Login v1：`flowx-local login [--token]`（参数或交互粘贴 Web 生成的 PAT）写入 credentials；不做设备码（可后续加）
- 独立 MCP 工具 `flowx_bind_workflow`
- Design/brainstorm session 惰性创建挂在 **local-handoff**（内部调 `claimLocal*`）

---

## File map

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | `PersonalApiToken` model + User/Organization relations |
| `apps/api/src/auth/personal-api-token.service.ts` | 创建/列表/撤销/按明文解析（sha256 hash） |
| `apps/api/src/auth/personal-api-token.service.spec.ts` | Token 生命周期测试 |
| `apps/api/src/auth/auth.service.ts` | `resolveBearerAuth`：UserSession 或 PAT → 统一 session 形状 |
| `apps/api/src/auth/session-auth.guard.ts` | 调用 `resolveBearerAuth` |
| `apps/api/src/auth/personal-api-token.controller.ts` | CRUD HTTP |
| `apps/api/src/auth/auth.module.ts` | 注册 service/controller |
| `apps/web/src/pages/PersonalApiTokensPage.tsx` | 用户设置 UI |
| `apps/web/src/api.ts` / `types.ts` / `App.tsx` / `AppLayout.tsx` | 路由与 API |
| `packages/flowx-local/src/credentials.ts` | 读写 `~/.flowx/credentials.json` |
| `packages/flowx-local/src/workflow-binding.ts` | 读写 `~/.flowx/current-workflow.json` |
| `packages/flowx-local/src/mcp.ts` | 鉴权顺序、bind 工具、submit 后更新 binding |
| `packages/flowx-local/src/index.ts` | `login` / `logout` CLI |
| `packages/flowx-mcp/src/*` | 同步鉴权/bind/list 行为（若仍被使用） |
| `apps/api/src/workflow/workflow.service.ts` | handoff 惰性 claim；brainstorm complete `next` |
| `apps/api/src/edge/edge-tasks.service.ts` | list 含 brainstorm/design 候选 |
| `docs/opendesign-design-stage.md` 等 | 推荐路径文档 |

---

### Task 1: Prisma — `PersonalApiToken`

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `pnpm prisma:generate`（及必要时 `db push` / migrate）

- [ ] **Step 1: Add model**

在 `UserSession` 附近加入：

```prisma
model PersonalApiToken {
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  tokenHash      String        @unique
  tokenPrefix    String
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([userId, organizationId])
}
```

在 `User` 增加 `personalApiTokens PersonalApiToken[]`；在 `Organization` 增加 `personalApiTokens PersonalApiToken[]`。

- [ ] **Step 2: Generate client**

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

Expected: 成功，无 schema 错误。

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(prisma): add PersonalApiToken model"
```

---

### Task 2: API — Personal API Token service (TDD)

**Files:**
- Create: `apps/api/src/auth/personal-api-token.service.ts`
- Create: `apps/api/src/auth/personal-api-token.service.spec.ts`
- Reference: `apps/api/src/auth/auth.service.ts`（`createToken`）、`apps/api/src/prisma/prisma.service.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PersonalApiTokenService } from './personal-api-token.service';

function hashToken(raw: string) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

describe('PersonalApiTokenService', () => {
  it('creates a token, stores only hash, returns plaintext once', async () => {
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'pat-1',
      name: data.name,
      tokenPrefix: data.tokenPrefix,
      tokenHash: data.tokenHash,
      userId: data.userId,
      organizationId: data.organizationId,
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
    }));
    const prisma = { personalApiToken: { create, findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() } };
    const service = new PersonalApiTokenService(prisma as never);
    const result = await service.createToken({
      userId: 'user-1',
      organizationId: 'org-1',
      name: 'laptop',
    });
    expect(result.token).toMatch(/^fxpat_/);
    expect(result.token.startsWith(result.tokenPrefix)).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenHash: hashToken(result.token),
          name: 'laptop',
        }),
      }),
    );
  });

  it('resolves a valid token and rejects revoked', async () => {
    const raw = `fxpat_${randomBytes(24).toString('hex')}`;
    const row = {
      id: 'pat-1',
      tokenHash: hashToken(raw),
      revokedAt: null,
      userId: 'user-1',
      organizationId: 'org-1',
      user: { id: 'user-1', email: null, displayName: 'A', avatarUrl: null },
      organization: { id: 'org-1', name: 'Org', providerOrganizationId: 'p1' },
    };
    const findFirst = vi.fn().mockResolvedValue(row);
    const update = vi.fn().mockResolvedValue(row);
    const prisma = { personalApiToken: { findFirst, update, create: vi.fn(), findMany: vi.fn() } };
    const service = new PersonalApiTokenService(prisma as never);
    const resolved = await service.resolveToken(raw);
    expect(resolved.user.id).toBe('user-1');
    expect(resolved.organization.id).toBe('org-1');

    findFirst.mockResolvedValue({ ...row, revokedAt: new Date() });
    await expect(service.resolveToken(raw)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter flowx-api exec vitest run src/auth/personal-api-token.service.spec.ts
```

Expected: 模块不存在或 FAIL。

- [ ] **Step 3: Implement service**

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PREFIX = 'fxpat_';

@Injectable()
export class PersonalApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  static hashToken(raw: string) {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  async createToken(input: { userId: string; organizationId: string; name: string }) {
    const secret = randomBytes(24).toString('hex');
    const token = `${PREFIX}${secret}`;
    const tokenPrefix = token.slice(0, 12);
    const row = await this.prisma.personalApiToken.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        name: input.name.trim() || 'default',
        tokenHash: PersonalApiTokenService.hashToken(token),
        tokenPrefix,
      },
    });
    return {
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      token,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listTokens(userId: string, organizationId: string) {
    const rows = await this.prisma.personalApiToken.findMany({
      where: { userId, organizationId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async revokeToken(userId: string, organizationId: string, tokenId: string) {
    const existing = await this.prisma.personalApiToken.findFirst({
      where: { id: tokenId, userId, organizationId, revokedAt: null },
    });
    if (!existing) throw new NotFoundException('API token not found.');
    await this.prisma.personalApiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async resolveToken(raw: string) {
    const token = raw.trim();
    if (!token.startsWith(PREFIX)) {
      throw new UnauthorizedException('Invalid API token.');
    }
    const row = await this.prisma.personalApiToken.findFirst({
      where: { tokenHash: PersonalApiTokenService.hashToken(token) },
      include: { user: true, organization: true },
    });
    if (!row || row.revokedAt) {
      throw new UnauthorizedException('Invalid API token.');
    }
    await this.prisma.personalApiToken.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      kind: 'personal_api_token' as const,
      tokenId: row.id,
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        avatarUrl: row.user.avatarUrl,
      },
      organization: {
        id: row.organization.id,
        name: row.organization.name,
        providerOrganizationId: row.organization.providerOrganizationId,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter flowx-api exec vitest run src/auth/personal-api-token.service.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/personal-api-token.service.ts apps/api/src/auth/personal-api-token.service.spec.ts
git commit -m "feat(api): add PersonalApiTokenService with hash storage"
```

---

### Task 3: API — Guard 接受 PAT（与 Session 同权）

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/session-auth.guard.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Create or extend: `apps/api/src/auth/auth.service.spec.ts`（或新建 `resolve-bearer-auth.spec.ts`）

- [ ] **Step 1: Failing test — Bearer PAT resolves like session**

```typescript
it('resolveBearerAuth accepts personal API tokens', async () => {
  const patService = {
    resolveToken: vi.fn().mockResolvedValue({
      kind: 'personal_api_token',
      tokenId: 'pat-1',
      user: { id: 'u1', email: null, displayName: 'A', avatarUrl: null },
      organization: { id: 'o1', name: 'Org', providerOrganizationId: 'p1' },
    }),
  };
  // wire AuthService with mocked prisma + patService
  const session = await authService.resolveBearerAuth('fxpat_abc');
  expect(session.user.id).toBe('u1');
  expect(session.organization?.id).toBe('o1');
  expect(session.authKind).toBe('personal_api_token');
});
```

- [ ] **Step 2: Implement `resolveBearerAuth`**

在 `AuthService` 注入 `PersonalApiTokenService`：

```typescript
async resolveBearerAuth(bearerToken: string) {
  const token = bearerToken.trim();
  if (token.startsWith('fxpat_')) {
    const pat = await this.personalApiTokenService.resolveToken(token);
    const role = await this.getOrganizationRole(pat.organization.id, pat.user.id);
    return {
      token,
      expiresAt: null as Date | null,
      authKind: 'personal_api_token' as const,
      user: pat.user,
      organization: { ...pat.organization, role },
    };
  }
  const session = await this.getSession(token);
  return { ...session, authKind: 'user_session' as const };
}
```

`SessionAuthGuard` 改为：

```typescript
const session = await this.authService.resolveBearerAuth(token);
request.user = session.user;
request.authSession = session;
```

注意：现有代码若假设 `expiresAt: Date`，对 PAT 用 `null` 或远未来；检查 `auth/session/me` 与前端类型，必要时 `expiresAt` 省略或返回极大值。推荐 `expiresAt: null` 并在 me 响应中可空。

- [ ] **Step 3: Register module providers/exports；跑相关 auth 测试**

```bash
pnpm --filter flowx-api exec vitest run src/auth/
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): accept Personal API Token in SessionAuthGuard"
```

---

### Task 4: API — Token CRUD endpoints + Web settings page

**Files:**
- Create: `apps/api/src/auth/personal-api-token.controller.ts`
- Create: `apps/api/src/auth/dto/create-personal-api-token.dto.ts`
- Modify: `apps/web/src/api.ts`, `apps/web/src/types.ts`
- Create: `apps/web/src/pages/PersonalApiTokensPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/AppLayout.tsx`
- Test: 控制器单测或 e2e 风格 service+controller；Web 页面可补轻量 test

- [ ] **Step 1: Controller**

```typescript
@Controller('auth/personal-api-tokens')
export class PersonalApiTokenController {
  constructor(private readonly tokens: PersonalApiTokenService) {}

  @Get()
  list(@Req() req: { authSession: { user: { id: string }; organization: { id: string } | null } }) {
    if (!req.authSession.organization) throw new BadRequestException('Organization required.');
    return this.tokens.listTokens(req.authSession.user.id, req.authSession.organization.id);
  }

  @Post()
  create(
    @Req() req: { authSession: { user: { id: string }; organization: { id: string } | null } },
    @Body() body: CreatePersonalApiTokenDto,
  ) {
    if (!req.authSession.organization) throw new BadRequestException('Organization required.');
    return this.tokens.createToken({
      userId: req.authSession.user.id,
      organizationId: req.authSession.organization.id,
      name: body.name,
    });
  }

  @Delete(':id')
  revoke(
    @Req() req: { authSession: { user: { id: string }; organization: { id: string } | null } },
    @Param('id') id: string,
  ) {
    if (!req.authSession.organization) throw new BadRequestException('Organization required.');
    return this.tokens.revokeToken(req.authSession.user.id, req.authSession.organization.id, id);
  }
}
```

DTO：`name` string min 1 max 80。

- [ ] **Step 2: Web API helpers + page**

仿 `AiCredentialsPage`：名称输入 → 创建 → **仅一次**展示完整 token（复制按钮）→ 列表显示 `tokenPrefix…` + 撤销。路由 `/settings/api-tokens`，导航「API Token」。

`api.ts`：

```typescript
listPersonalApiTokens: () => request<PersonalApiTokenMeta[]>('/auth/personal-api-tokens'),
createPersonalApiToken: (body: { name: string }) =>
  request<PersonalApiTokenCreated>('/auth/personal-api-tokens', { method: 'POST', body }),
revokePersonalApiToken: (id: string) =>
  request<{ ok: boolean }>(`/auth/personal-api-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Run**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-web test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add personal API token settings UI and CRUD API"
```

---

### Task 5: flowx-local — credentials + login/logout

**Files:**
- Create: `packages/flowx-local/src/credentials.ts`
- Create: `packages/flowx-local/src/credentials.test.ts`
- Modify: `packages/flowx-local/src/index.ts`
- Modify: `packages/flowx-local/src/mcp.ts`（鉴权顺序）
- Modify: `packages/flowx-local/src/config.ts` 若需共用 home 路径 helper

- [ ] **Step 1: Failing credentials tests**

```typescript
it('writes credentials.json with mode 0o600 and reads token', async () => {
  const home = mkdtempSync(join(tmpdir(), 'flowx-cred-'));
  await writeCredentials({ apiBaseUrl: 'http://127.0.0.1:3000', apiToken: 'fxpat_x' }, home);
  const creds = await readCredentials(home);
  expect(creds?.apiToken).toBe('fxpat_x');
  expect((await stat(join(home, '.flowx', 'credentials.json'))).mode & 0o777).toBe(0o600);
});
```

- [ ] **Step 2: Implement**

`~/.flowx/credentials.json`：

```json
{
  "apiBaseUrl": "http://127.0.0.1:3000",
  "apiToken": "fxpat_...",
  "updatedAt": "ISO-8601"
}
```

`resolveApiAuth(home)`：

1. `process.env.FLOWX_API_TOKEN` + `FLOWX_API_BASE_URL`（或 credentials / active-design 补 baseUrl）
2. `readCredentials`
3. `readActiveDesignSession` → `accessToken` / `apiBaseUrl`

CLI：

```text
flowx-local login [--api-base-url URL] [--token TOKEN]
flowx-local logout
```

无 `--token` 时用 `readline` 提示粘贴（隐藏回显可选）。login 成功可 `GET /auth/session/me` 校验。logout 删除 credentials 文件（不调用 revoke API；可打印提示去 Web 撤销）。

- [ ] **Step 3: Wire MCP `resolveSession` 使用 `resolveApiAuth`**

错误文案：无凭据时提示 `flowx-local login` 或配置 `FLOWX_API_TOKEN`。

- [ ] **Step 4: Test + commit**

```bash
pnpm --filter @flowx-ai/local test
git commit -m "feat(local): add credentials.json and login/logout CLI"
```

---

### Task 6: flowx-local — workflow binding + `flowx_bind_workflow`

**Files:**
- Create: `packages/flowx-local/src/workflow-binding.ts`
- Create: `packages/flowx-local/src/workflow-binding.test.ts`
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-mcp/src/tools.ts`（若需行为一致）

- [ ] **Step 1: Binding file shape**

`~/.flowx/current-workflow.json`：

```json
{
  "workflowRunId": "wr_...",
  "stage": "brainstorm",
  "boundAt": "ISO-8601",
  "requirementTitle": "optional"
}
```

`stage`: `'brainstorm' | 'design'`。

- [ ] **Step 2: MCP tools**

注册 `flowx_bind_workflow`：

```typescript
inputSchema: z.object({
  workflowRunId: z.string(),
  stage: z.enum(['brainstorm', 'design']),
  requirementTitle: z.string().optional(),
})
```

写入 binding，返回确认 JSON。

更新 `flowx_get_active_design_session`：无 active-design 时返回：

```json
{
  "authKind": "personal_api_token",
  "hasCredentials": true,
  "binding": { "workflowRunId": "...", "stage": "design" },
  "message": "No short-lived active-design session; using credentials + binding."
}
```

更新 `get_*_handoff` / `submit_*`：参数优先 → binding → 明确错误「先 flowx_list_tasks 并 flowx_bind_workflow」。

- [ ] **Step 3: `submit_brainstorm` 成功后**

若响应含 `next.stage === 'design'` 或 `workflowStatus === 'DESIGN_PENDING'`，自动 `writeWorkflowBinding({ ..., stage: 'design' })`。

- [ ] **Step 4: Test + commit**

```bash
pnpm --filter @flowx-ai/local test
git commit -m "feat(local): add workflow binding and flowx_bind_workflow"
```

---

### Task 7: API — list tasks 含构思/设计候选

**Files:**
- Modify: `apps/api/src/edge/edge-tasks.service.ts`
- Modify: `apps/api/src/edge/edge-tasks.service.spec.ts`（或新建）
- Modify: MCP tool description for `flowx_list_tasks`

- [ ] **Step 1: Extend `EdgeTaskItem`（或并行返回 `openDesignTasks`）**

推荐在现有 list 响应增加字段，避免破坏：

```typescript
type OpenDesignAction = 'brainstorm' | 'design';

// 每个可本地 OpenDesign 的 workflow run：
{
  kind: 'opendesign-workflow';
  workflowRunId: string;
  requirementId: string;
  title: string;
  status: string; // BRAINSTORM_PENDING | DESIGN_PENDING
  suggestedAction: OpenDesignAction;
}
```

查询：当前用户 org 可见、status in (`BRAINSTORM_PENDING`, `DESIGN_PENDING`) 的 `WorkflowRun`（含 requirement title）。可与现有 requirement/bug 列表并列返回：

```typescript
return { tasks: EdgeTaskItem[]; openDesignWorkflows: OpenDesignWorkflowItem[] };
```

若现客户端假定数组根，则保持 `GET /cursor-local/tasks` 返回数组、另加 `GET /cursor-local/opendesign-tasks` —— **本计划选用扩展对象** `{ tasks, openDesignWorkflows }`，并更新 MCP `flowx_list_tasks` 消费方；检查 Extension 是否依赖纯数组，若有则保持数组兼容并加 query `?includeOpenDesign=1` 或第二端点。

**锁定：** 新增 `GET /edge/opendesign-tasks`（及 `/cursor-local/opendesign-tasks` 别名），避免破坏现有数组契约。MCP `flowx_list_tasks` 并行请求两个端点并合并展示。

- [ ] **Step 2: Tests for status filter + suggestedAction**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): list OpenDesign brainstorm/design candidate workflows"
```

---

### Task 8: API — handoff 惰性 claim + brainstorm `next`

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow-local-design.spec.ts`（及 brainstorm 相关 spec）
- Modify: edge controller 若需把 `authSession` 传入 claim（claimedByUserId）

- [ ] **Step 1: Failing tests**

```typescript
it('getLocalDesignHandoff claims a design session when none is active', async () => {
  // workflow DESIGN_PENDING, findActiveOpenDesignSession → null
  // expect claimLocalDesign path / executionSession.create called
  // returns handoff with executionSessionId
});

it('completeLocalBrainstormSession includes next design pointer', async () => {
  const result = await service.completeLocalBrainstormSession('session-b', report, scope);
  expect(result.workflowStatus).toBe('DESIGN_PENDING');
  expect(result.next).toEqual({
    stage: 'design',
    hint: 'call flowx_get_design_handoff',
  });
  expect(result.workflowRunId).toBe(result.workflow.id);
});
```

- [ ] **Step 2: Implement handoff lazy claim**

```typescript
async getLocalDesignHandoff(
  id: string,
  notifyRecipient?: WorkflowNotificationSession,
): Promise<OpenDesignHandoff> {
  const workflow = await this.getWorkflowOrThrow(id);
  let session = await this.findActiveOpenDesignSession(id, 'DESIGN');
  if (!session) {
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.DESIGN_PENDING) {
      throw new BadRequestException(
        `Workflow status ${workflow.status} does not allow design handoff.`,
      );
    }
    const claimed = await this.claimLocalDesign(id, notifyRecipient);
    return claimed.handoff;
  }
  return this.buildOpenDesignHandoff(workflow, session);
}
```

对 `getLocalBrainstormHandoff` 同样惰性 `claimLocalBrainstorm`。

Controller 从 `request.authSession` 构造 `notifyRecipient`（若尚未传入）。

- [ ] **Step 3: Extend complete brainstorm return**

```typescript
return {
  workflow: updated,
  handoff: this.buildOpenDesignBrainstormHandoff(updated, session),
  workflowRunId: updated.id,
  workflowStatus: 'DESIGN_PENDING',
  next: { stage: 'design' as const, hint: 'call flowx_get_design_handoff' },
};
```

幂等已完成分支同样带上 `next`（若 workflow 已是 DESIGN_PENDING）。

- [ ] **Step 4: Run workflow local design/brainstorm specs**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-design.spec.ts
# plus any brainstorm complete specs
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): lazy-claim OpenDesign handoff and brainstorm next pointer"
```

---

### Task 9: MCP 金路径衔接 + 兼容回归

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts` / tests
- Modify: `packages/flowx-mcp/src/tools.ts` / `tools.test.ts`（如仍维护）
- Optional: `packages/flowx-local/src/adapters/open-design-adapter.ts` 启动时写 binding

- [ ] **Step 1: Integration-style unit test（mock fetch）**

无 `active-design.json`、仅有 credentials + binding：

1. `get_brainstorm_handoff` → OK
2. `submit_brainstorm` → 响应含 `next` → binding.stage === `design`
3. `get_design_handoff` → OK

- [ ] **Step 2: 保留旧路径测试**

仅 active-design 短期 token、无 credentials：handoff/submit 仍绿。

- [ ] **Step 3: Web launch 写 binding（可选小改）**

`OpenDesignAdapter.launch` 成功后 `writeWorkflowBinding({ workflowRunId, stage })`，方便混用。

- [ ] **Step 4: Commit**

```bash
git commit -m "test(local): cover PAT brainstorm-to-design path without active-design"
```

---

### Task 10: Docs + handbook mirrors

**Files:**
- Modify: `docs/opendesign-design-stage.md`
- Modify: `docs/local-agent-guide.md` + `apps/web/public/local-agent-guide.md`
- Modify: `docs/user-manual.md` + `apps/web/public/user-manual.md`
- Optional: `README.md` 一句

- [ ] **Step 1: 推荐路径改为**

1. Web 设置生成 PAT 或 `flowx-local login --token`
2. MCP `flowx_list_tasks` → 确认 → `flowx_bind_workflow`
3. 构思 → submit → **同一会话** design handoff → submit
4. Web「打开本地…」标为可选兜底

- [ ] **Step 2: cmp mirrors**

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
git diff --check
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: document personal API token OpenDesign golden path"
```

---

### Task 11: 全仓验证

- [ ] **Step 1: Run**

```bash
pnpm --filter flowx-api test
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp test
pnpm --filter flowx-web test
pnpm check
```

- [ ] **Step 2: Manual smoke（可选）**

1. 创建 PAT → login
2. bind brainstorm run → submit brainstorm
3. 不点 Web，直接 design handoff → submit
4. Web 见 `DESIGN_WAITING_CONFIRMATION`
5. 旧路径：无 PAT，Web 打开构思仍可用

- [ ] **Step 3: Update spec status to Implemented（或留 Approved until merge）**

---

## Spec coverage checklist

| Spec 要求 | Task |
| --- | --- |
| PersonalApiToken hash/不过期/同权 | 1–3 |
| Web 生成/撤销 + login/logout | 4–5 |
| credentials 鉴权顺序 | 5 |
| list → bind → binding 缓存 | 6–7 |
| submit brainstorm `next` + binding→design | 6, 8 |
| handoff 惰性 ExecutionSession | 8 |
| 旧短期 session 兼容 | 9 |
| 文档 | 10 |
| 金路径验收 | 9, 11 |

## Out of scope (do not implement in this plan)

- 设备码 OAuth 式 login
- Token scopes / TTL
- 删除 active-design 协议
- Cursor/Codex 开发阶段强制 PAT
