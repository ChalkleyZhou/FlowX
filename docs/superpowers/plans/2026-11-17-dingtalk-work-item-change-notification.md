# 工作项负责人和状态钉钉通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 工作项负责人或状态发生实际变化后，异步向符合规则的负责人发送一条可一键查看工作项的钉钉 Markdown 通知，并保证通知失败不影响保存。

**Architecture:** 在 API 的 `WorkItemsService.update` 中复用已有更新前快照和组织校验，更新成功后计算负责人/状态差异，并按接收人合并通知。新增 Web 公网地址解析 helper 和 `DingTalkNotificationService.sendWorkItemChangeMarkdown`，复用现有钉钉身份解析、Access Token 缓存和个人 Markdown 发送链路；通知通过后台异步任务执行。同步更新部署配置、用户手册和 CHANGELOG，Web、本地 Agent、MCP、CLI、协议无需新增适配。

**Tech Stack:** NestJS、TypeScript、Prisma、Vitest、React/Vite（仅执行 Web 回归检查）、Markdown、Docker 环境变量。

---

### Task 1: 公网 Web 地址解析

**Files:**
- Create: `apps/api/src/common/public-web-base-url.ts`
- Test: `apps/api/src/common/public-web-base-url.spec.ts`
- Modify: `.env.docker.example`
- Modify: `docs/docker-deployment.md`
- Modify: `README.md`

- [x] **Step 1: Write the failing tests**

在 `public-web-base-url.spec.ts` 中覆盖以下输入输出：

```ts
import { describe, expect, it } from 'vitest';
import { resolvePublicWebBaseUrl } from './public-web-base-url';

describe('resolvePublicWebBaseUrl', () => {
  it('优先读取 FLOWX_PUBLIC_WEB_URL 并去除末尾斜杠', () => {
    expect(resolvePublicWebBaseUrl({
      FLOWX_PUBLIC_WEB_URL: ' https://flowx.example.com/// ',
      PUBLIC_WEB_URL: 'https://fallback.example.com',
    })).toBe('https://flowx.example.com');
  });

  it('未配置时返回 null，避免生成 localhost 链接', () => {
    expect(resolvePublicWebBaseUrl({})).toBeNull();
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter flowx-api exec vitest run src/common/public-web-base-url.spec.ts`

Expected: FAIL because `public-web-base-url.ts` and `resolvePublicWebBaseUrl` do not exist.

- [x] **Step 3: Implement the helper**

创建 `resolvePublicWebBaseUrl(env = process.env): string | null`，读取 `FLOWX_PUBLIC_WEB_URL`（可兼容读取 `PUBLIC_WEB_URL` 作为回退），trim 后移除所有末尾 `/`；空值返回 `null`。不回退到 localhost。

- [x] **Step 4: Run the focused test**

Run: `pnpm --filter flowx-api exec vitest run src/common/public-web-base-url.spec.ts`

Expected: PASS。

- [x] **Step 5: Update deployment documentation**

在 `.env.docker.example` 增加 `FLOWX_PUBLIC_WEB_URL=`；在 `docs/docker-deployment.md` 环境变量表、说明和 Nginx 启动示例中说明它是钉钉“查看工作项”链接使用的 Web 公网根地址，例如 `https://flowx.example.com`，不要填写 `127.0.0.1` 或内网地址；在 `README.md` Docker 环境变量/部署说明中同步一条简短说明。

- [x] **Step 6: Commit**

```bash
git add apps/api/src/common/public-web-base-url.ts apps/api/src/common/public-web-base-url.spec.ts .env.docker.example docs/docker-deployment.md README.md
git commit -m "增加钉钉通知的公网 Web 地址配置"
```

### Task 2: 工作项变更 Markdown 通知服务

**Files:**
- Modify: `apps/api/src/notifications/dingtalk-notification.service.ts`
- Modify: `apps/api/src/notifications/dingtalk-notification.service.personal.spec.ts`

- [x] **Step 1: Add focused service tests**

扩展现有 spec，使用现有 `createService` mock，调用新增入口并断言 `sendPersonalMarkdown` 使用的请求体。测试输入至少包含：

```ts
{
  recipient: { flowxUserId: 'user-2', displayName: '张三', providerOrganizationId: 'corp-1' },
  item: { id: 'item/1', displayCode: 'REQ-001', title: '统一登录', projectName: 'FlowX' },
  actorName: '产品甲',
  ownerChange: { from: null, to: '张三' },
  statusChange: { from: 'ACTIVE', to: 'CLOSED' },
  publicWebBaseUrl: 'https://flowx.example.com///',
}
```

断言标题为 `FlowX 工作项发生变更`，Markdown 包含 `REQ-001`、项目、变更人、`未指定 → 张三`、`进行中 → 已关闭` 和 `[查看工作项](https://flowx.example.com/work-items/item%2F1)`。补充只改变状态、未知状态保留原值、缺少公网地址不生成错误 localhost 链接的测试。

- [x] **Step 2: Run focused tests and verify the new tests fail**

Run: `pnpm --filter flowx-api exec vitest run src/notifications/dingtalk-notification.service.personal.spec.ts`

Expected: FAIL because the new notification method and status formatter do not exist。

- [x] **Step 3: Implement typed input and formatting**

在 service 中新增明确的 `WorkItemChangeNotificationInput` 类型和 `sendWorkItemChangeMarkdown(input)` 方法：
1. 若 `isEnabled()` 为 false，记录 warning 并返回，不抛出。
2. 按 `recipient.flowxUserId + recipient.providerOrganizationId` 调用既有 `sendPersonalMarkdown`；异常捕获并记录 warning。
3. 用 `resolvePublicWebBaseUrl` 拼接 `/work-items/${encodeURIComponent(item.id)}`，只在地址存在时加入链接。
4. 状态标签映射覆盖 `ACTIVE`、`OPEN`、`IN_PROGRESS`、`RESOLVED`、`CLOSED`、`WONT_FIX`、`CONFIRMED`、`FIXING`、`FIXED`、`VERIFIED`；未知值原样保留；空负责人显示“未指定”。
5. Markdown 只输出存在的负责人/状态变化行，标题、工作项编号、项目、变更人始终输出。

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter flowx-api exec vitest run src/notifications/dingtalk-notification.service.personal.spec.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add apps/api/src/notifications/dingtalk-notification.service.ts apps/api/src/notifications/dingtalk-notification.service.personal.spec.ts
git commit -m "增加工作项变更钉钉消息格式"
```

### Task 3: 工作项更新接入负责人和状态通知

**Files:**
- Modify: `apps/api/src/work-items/work-items.module.ts`
- Modify: `apps/api/src/work-items/work-items.service.ts`
- Test: `apps/api/src/work-items/work-items.service.notification.spec.ts`

- [x] **Step 1: Write service-level failing tests**

新建专门 spec，mock Prisma 的 `workItem.findUnique`、`workItem.updateMany`、`workItem.findUniqueOrThrow`、`userOrganization.findFirst`，mock `DingTalkNotificationService.sendWorkItemChangeMarkdown`，构造包含 `project.workspace.organizationId`、`project.workspace.organization.providerOrganizationId`、`ownerUser`、`project.name` 的工作项。覆盖：

```ts
it('负责人从 A 改为 B 时异步通知 B')
it('负责人清空时不发送负责人通知')
it('任意状态变化通知更新后的负责人并保留中文转换输入')
it('同时修改负责人和状态时同一接收人只发送一次且合并两种变化')
it('无负责人、未配置钉钉或发送异常时 update 仍成功')
it('负责人和状态未变化时不发送')
```

使用 `vi.useFakeTimers()` 或 flush microtask 等待后台任务，并断言 update 返回结果不受通知 Promise 影响。

- [x] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter flowx-api exec vitest run src/work-items/work-items.service.notification.spec.ts`

Expected: FAIL because `WorkItemsService` 尚未注入通知服务，也没有更新后通知逻辑。

- [x] **Step 3: Inject the notification service**

在 `WorkItemsModule` imports 增加 `NotificationsModule`；在 `WorkItemsService` 构造函数注入 `DingTalkNotificationService`。保持现有可选 AI 依赖行为不变。

- [x] **Step 4: Capture update snapshots and schedule merged notifications**

在 `update` 中保留现有权限、校验和乐观锁顺序：
1. 从 `existing` 保存旧负责人 ID/名称、旧状态，以及项目名、工作项编号、标题、组织 provider ID。
2. 更新成功后使用更新返回的 owner/version，并根据 `dto.ownerUserId`、`dto.status` 判断实际差异；没有实际差异不安排任务。
3. 负责人从任意值变为新负责人时加入新负责人接收人；清空负责人不加入负责人通知。
4. 状态变化时仅向更新后的当前负责人加入状态通知。
5. 按负责人 ID + 组织 provider ID 合并变化，调用 `sendWorkItemChangeMarkdown`；通知任务用 `void Promise.resolve().then(...).catch(...)` 或等价后台方式，不能阻塞 PATCH，且日志不泄露凭据。
6. 更新查询需包含 `ownerUser`、`version`，必要时在 `findOne` 的 workspace include 中读取 organization 的 `providerOrganizationId`，避免跨组织查询。

- [x] **Step 5: Run focused tests**

Run: `pnpm --filter flowx-api exec vitest run src/work-items/work-items.service.notification.spec.ts`

Expected: PASS。

- [x] **Step 6: Run existing work-item tests**

Run: `pnpm --filter flowx-api exec vitest run src/work-items/work-items.service.spec.ts`

Expected: PASS。

- [x] **Step 7: Commit**

```bash
git add apps/api/src/work-items/work-items.module.ts apps/api/src/work-items/work-items.service.ts apps/api/src/work-items/work-items.service.notification.spec.ts
git commit -m "接入工作项负责人和状态变更钉钉通知"
```

### Task 4: 用户文档和变更记录

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Document user-visible behavior**

在用户手册钉钉/工作项相关章节增加：负责人变更通知新负责人、状态变化通知当前负责人、消息中的“查看工作项”链接需要 `FLOWX_PUBLIC_WEB_URL`；通知异常不影响保存。在 Web 镜像保持逐字一致。

- [x] **Step 2: Add CHANGELOG entry**

在未发布/当前日期条目增加用户可见变化和配置说明，明确本次只复用现有钉钉个人消息，不新增站内通知中心或本地 Agent 工具。

- [x] **Step 3: Validate mirror and diff**

Run: `cmp -s docs/user-manual.md apps/web/public/user-manual.md && git diff --check`

Expected: exit code 0。

- [x] **Step 4: Commit**

```bash
git add docs/user-manual.md apps/web/public/user-manual.md CHANGELOG.md
git commit -m "补充工作项钉钉通知文档"
```

### Task 5: 全量验证和最终交付

**Files:**
- No source changes expected; only fix issues found by checks.

- [x] **Step 1: Run API tests and build**

Run: `pnpm --filter flowx-api test && pnpm --filter flowx-api build`

Expected: all API tests pass and API build exits 0。

- [x] **Step 2: Run Web tests and build**

Run: `pnpm --filter flowx-web test && pnpm --filter flowx-web build`

Expected: all Web tests pass and Web build exits 0。

- [x] **Step 3: Run repository checks**

Run: `pnpm check`

Expected: exit 0；if it reports unrelated pre-existing failures, record exact command/output and do not alter unrelated code.

- [x] **Step 4: Verify docs and working tree**

Run: `cmp -s docs/user-manual.md apps/web/public/user-manual.md && git diff --check && git status --short`

Expected: docs match, no whitespace errors, only intentional changes remain。

- [x] **Step 5: Push**

```bash
git push origin main
```

Expected: all commits for this feature are present on `origin/main`; report commit hashes and verification results。
