# 项目需求与人员排期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不动工作流状态机的前提下，为 Project → Requirement 增加多人分工排期、工作日工时推算，并交付可供 M4 甘特图直接消费的 `GanttPayload` API 与 M2/M3 管理台 UI。

**Architecture:** 以 `RequirementAssignment` 为甘特条最小单位；`ScheduleService` 负责将 assignments 投影为 `lanes` + `bars`；需求模块负责 CRUD 与 `planningStatus` 联动；前端通过统一 `api.getScheduleGantt` 驱动表格排期与简易预览。

**Tech Stack:** NestJS, Prisma (SQLite), Vitest; React 19, Vite, Tailwind, shadcn/ui, Vitest jsdom.

**Spec:** [docs/superpowers/specs/2026-05-22-project-requirement-scheduling-design.md](../specs/2026-05-22-project-requirement-scheduling-design.md)

---

## File map

| Action | Path |
|--------|------|
| Modify | `prisma/schema.prisma` |
| Create | `apps/api/src/common/business-days.ts` |
| Create | `apps/api/src/common/business-days.spec.ts` |
| Modify | `apps/api/src/common/enums.ts` |
| Create | `apps/api/src/schedule/schedule.types.ts` |
| Create | `apps/api/src/schedule/schedule.service.ts` |
| Create | `apps/api/src/schedule/schedule.controller.ts` |
| Create | `apps/api/src/schedule/schedule.module.ts` |
| Create | `apps/api/src/schedule/schedule-gantt.spec.ts` |
| Create | `apps/api/src/requirements/requirement-assignments.service.ts` |
| Create | `apps/api/src/requirements/requirement-assignments.service.spec.ts` |
| Create | `apps/api/src/requirements/dto/upsert-requirement-assignment.dto.ts` |
| Create | `apps/api/src/requirements/dto/update-requirement.dto.ts` |
| Modify | `apps/api/src/requirements/requirements.controller.ts` |
| Modify | `apps/api/src/requirements/requirements.service.ts` |
| Modify | `apps/api/src/requirements/requirements.module.ts` |
| Modify | `apps/api/src/projects/projects.service.ts` |
| Modify | `apps/api/src/auth/auth.service.ts` |
| Modify | `apps/api/src/auth/auth.controller.ts` |
| Create | `apps/api/src/auth/auth-organization-members.spec.ts` |
| Modify | `apps/api/src/app.module.ts` |
| Modify | `apps/web/src/types.ts` |
| Modify | `apps/web/src/api.ts` |
| Create | `apps/web/src/utils/business-days.ts` |
| Create | `apps/web/src/utils/business-days.test.ts` |
| Create | `apps/web/src/components/RequirementSchedulingPanel.tsx` |
| Create | `apps/web/src/components/RequirementSchedulingPanel.test.tsx` |
| Create | `apps/web/src/components/SchedulePreview.tsx` |
| Create | `apps/web/src/pages/ProjectDetailPage.tsx` |
| Create | `apps/web/src/pages/ProjectDetailPage.test.tsx` |
| Modify | `apps/web/src/pages/RequirementDetailPage.tsx` |
| Modify | `apps/web/src/pages/RequirementsPage.tsx` |
| Modify | `apps/web/src/pages/ProjectsPage.tsx` |
| Modify | `apps/web/src/App.tsx` |

---

## Task 1: Prisma schema — RequirementAssignment

**Files:**
- Modify: `prisma/schema.prisma`
- Test: (migration applied via `db push` in Step 4)

- [ ] **Step 1: Add enums as string fields on models**

在 `Requirement` 上增加：

```prisma
  priority        String   @default("MEDIUM")
  planningStatus  String   @default("UNSCHEDULED")
  assignments     RequirementAssignment[]
```

新增 model：

```prisma
model RequirementAssignment {
  id                 String      @id @default(cuid())
  requirementId      String
  requirement        Requirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  userId             String
  user               User        @relation(fields: [userId], references: [id])
  role               String
  plannedStartDate   DateTime    @db.Date
  plannedEndDate     DateTime    @db.Date
  sortOrder          Int         @default(0)
  colorToken         String?
  note               String?
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  @@unique([requirementId, userId])
  @@index([requirementId, plannedStartDate])
  @@index([userId, plannedStartDate])
}
```

在 `User` 增加：`assignments RequirementAssignment[]`

- [ ] **Step 2: Generate client**

```bash
pnpm prisma:generate
```

Expected: Prisma Client generated without error.

- [ ] **Step 3: Push schema**

```bash
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

Expected: Database synced.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(prisma): add requirement assignments and planning fields"
```

---

## Task 2: Business days utility (TDD)

**Files:**
- Create: `apps/api/src/common/business-days.ts`
- Create: `apps/api/src/common/business-days.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/common/business-days.spec.ts
import { describe, expect, it } from 'vitest';
import { countBusinessDays, estimateHoursFromRange } from './business-days';

describe('countBusinessDays', () => {
  it('counts Mon-Fri inclusive', () => {
    expect(countBusinessDays('2026-05-18', '2026-05-22')).toBe(5);
  });

  it('returns 0 when end before start', () => {
    expect(countBusinessDays('2026-05-22', '2026-05-18')).toBe(0);
  });

  it('skips weekend in the middle', () => {
    expect(countBusinessDays('2026-05-22', '2026-05-25')).toBe(2);
  });
});

describe('estimateHoursFromRange', () => {
  it('multiplies business days by 8', () => {
    expect(estimateHoursFromRange('2026-05-18', '2026-05-22')).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter flowx-api exec vitest run src/common/business-days.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/common/business-days.ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseUtcDate(isoDate: string): Date {
  if (!DATE_RE.test(isoDate)) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function countBusinessDays(start: string, end: string): number {
  const from = parseUtcDate(start);
  const to = parseUtcDate(end);
  if (to < from) return 0;

  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    if (isWeekday(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function estimateHoursFromRange(start: string, end: string): number {
  return countBusinessDays(start, end) * 8;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter flowx-api exec vitest run src/common/business-days.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/business-days.ts apps/api/src/common/business-days.spec.ts
git commit -m "feat(api): add business day helpers for scheduling"
```

---

## Task 3: Domain enums

**Files:**
- Modify: `apps/api/src/common/enums.ts`

- [ ] **Step 1: Add enums**

```typescript
export enum RequirementPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RequirementPlanningStatus {
  UNSCHEDULED = 'UNSCHEDULED',
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum RequirementAssignmentRole {
  PM = 'PM',
  FRONTEND = 'FRONTEND',
  BACKEND = 'BACKEND',
  FULLSTACK = 'FULLSTACK',
  QA = 'QA',
  DESIGN = 'DESIGN',
  OTHER = 'OTHER',
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/common/enums.ts
git commit -m "feat(api): add requirement scheduling enums"
```

---

## Task 4: Organization members API (TDD)

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth-organization-members.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService.listOrganizationMembers', () => {
  it('returns members for organization', async () => {
    const prisma = {
      userOrganization: {
        findMany: vi.fn().mockResolvedValue([
          { user: { id: 'u1', displayName: 'Alice', avatarUrl: null } },
        ]),
      },
    } as any;
    const service = new AuthService(prisma);
    const result = await service.listOrganizationMembers('org1');
    expect(result).toEqual([{ id: 'u1', displayName: 'Alice', avatarUrl: null }]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter flowx-api exec vitest run src/auth/auth-organization-members.spec.ts
```

- [ ] **Step 3: Implement service + controller**

`auth.service.ts`:

```typescript
async listOrganizationMembers(organizationId: string) {
  const rows = await this.prisma.userOrganization.findMany({
    where: { organizationId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    id: row.user.id,
    displayName: row.user.displayName,
    avatarUrl: row.user.avatarUrl,
  }));
}
```

`auth.controller.ts`（放在 `@Get('session/me')` **之前**，避免路由冲突）：

```typescript
@Get('organization/members')
listOrganizationMembers(@Req() req: { authSession?: { organizationId?: string | null } }) {
  const organizationId = req.authSession?.organizationId;
  if (!organizationId) {
    return [];
  }
  return this.authService.listOrganizationMembers(organizationId);
}
```

确保 `SessionAuthGuard` 注入 `authSession`（与现有 `@Req()` 用法一致；若不存在则从 `getSession` 解析 token）。

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth-organization-members.spec.ts
git commit -m "feat(api): list organization members for scheduling"
```

---

## Task 5: Requirement assignments service (TDD)

**Files:**
- Create: `apps/api/src/requirements/dto/upsert-requirement-assignment.dto.ts`
- Create: `apps/api/src/requirements/requirement-assignments.service.ts`
- Create: `apps/api/src/requirements/requirement-assignments.service.spec.ts`
- Modify: `apps/api/src/requirements/requirements.module.ts`

- [ ] **Step 1: DTO with class-validator**

```typescript
import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { RequirementAssignmentRole } from '../common/enums';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class UpsertRequirementAssignmentDto {
  @IsString()
  userId!: string;

  @IsIn(Object.values(RequirementAssignmentRole))
  role!: RequirementAssignmentRole;

  @Matches(DATE)
  plannedStartDate!: string;

  @Matches(DATE)
  plannedEndDate!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  colorToken?: string;
}
```

- [ ] **Step 2: Write failing spec** — 覆盖：end < start 抛错、创建后 `planningStatus=SCHEDULED`、删除后 `UNSCHEDULED`、重复 user 抛冲突。

- [ ] **Step 3: Implement `RequirementAssignmentsService`**

关键方法：`list`, `create`, `update`, `remove`, `syncPlanningStatus(requirementId)`。

日期存库：`new Date(`${dto.plannedStartDate}T00:00:00.000Z`)`。

列表返回附加：

```typescript
{
  ...assignment,
  estimatedDays: countBusinessDays(startIso, endIso),
  estimatedHours: estimateHoursFromRange(startIso, endIso),
}
```

`startIso` 从 DB Date 格式化为 `YYYY-MM-DD`（UTC）。

- [ ] **Step 4: Wire controller routes on `RequirementsController`**

```typescript
@Get(':id/assignments')
listAssignments(@Param('id') id: string) {
  return this.assignmentsService.list(id);
}

@Post(':id/assignments')
createAssignment(@Param('id') id: string, @Body() dto: UpsertRequirementAssignmentDto) {
  return this.assignmentsService.create(id, dto);
}

@Patch(':id/assignments/:assignmentId')
updateAssignment(
  @Param('id') id: string,
  @Param('assignmentId') assignmentId: string,
  @Body() dto: UpsertRequirementAssignmentDto,
) {
  return this.assignmentsService.update(id, assignmentId, dto);
}

@Delete(':id/assignments/:assignmentId')
removeAssignment(@Param('id') id: string, @Param('assignmentId') assignmentId: string) {
  return this.assignmentsService.remove(id, assignmentId);
}
```

- [ ] **Step 5: Run spec**

```bash
pnpm --filter flowx-api exec vitest run src/requirements/requirement-assignments.service.spec.ts
```

- [ ] **Step 6: Commit**

---

## Task 6: PATCH requirement + project findOne enrichment

**Files:**
- Create: `apps/api/src/requirements/dto/update-requirement.dto.ts`
- Modify: `apps/api/src/requirements/requirements.service.ts`
- Modify: `apps/api/src/requirements/requirements.controller.ts`
- Modify: `apps/api/src/projects/projects.service.ts`

- [ ] **Step 1: `UpdateRequirementDto`** — optional `priority`, `planningStatus` with `@IsIn`.

- [ ] **Step 2: `RequirementsService.update(id, dto)`** — 仅更新允许字段。

- [ ] **Step 3: `findOne` / `findAll` include assignments** — 需求详情一次性加载排期。

- [ ] **Step 4: `ProjectsService.findOne`** — requirements 含 assignments + 聚合 `scheduleStart`/`scheduleEnd`/`totalEstimatedDays`。

- [ ] **Step 5: API spec smoke** — 扩展现有 requirements 相关 spec 或新增最小 integration spec。

- [ ] **Step 6: Commit**

---

## Task 7: Schedule gantt API (TDD)

**Files:**
- Create: `apps/api/src/schedule/schedule.types.ts`
- Create: `apps/api/src/schedule/schedule.service.ts`
- Create: `apps/api/src/schedule/schedule.controller.ts`
- Create: `apps/api/src/schedule/schedule.module.ts`
- Create: `apps/api/src/schedule/schedule-gantt.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write failing tests for `view=requirement` and `view=member`**

断言：
- 返回 lanes 含 `req:{id}`
- bars 的 `laneId` 正确
- 视口外 bar 被裁剪
- `estimatedDays` / `estimatedHours` 正确

- [ ] **Step 2: Implement `ScheduleService.buildGanttPayload(query)`**

查询：`prisma.requirementAssignment.findMany({ where: { requirement: { projectId } }, include: { requirement: true, user: true } })`。

默认颜色：按 role 映射 token（如 `FRONTEND` → `hsl(var(--chart-1))` 或语义 token 名）。

- [ ] **Step 3: Controller**

```typescript
@Controller('schedule')
export class ScheduleController {
  @Get('gantt')
  getGantt(@Query() query: GetScheduleGanttDto) {
    return this.scheduleService.buildGanttPayload(query);
  }
}
```

`GetScheduleGanttDto`：`view`, `projectId`, `from`, `to`, optional `userId`, `requirementId`。

- [ ] **Step 4: Register `ScheduleModule` in `app.module.ts`**

- [ ] **Step 5: Run tests**

```bash
pnpm --filter flowx-api exec vitest run src/schedule/schedule-gantt.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/schedule apps/api/src/app.module.ts
git commit -m "feat(api): add schedule gantt payload endpoint"
```

---

## Task 8: Web types + API client

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/utils/business-days.ts`
- Create: `apps/web/src/utils/business-days.test.ts`

- [ ] **Step 1: Add types**

```typescript
export interface RequirementAssignment {
  id: string;
  userId: string;
  role: string;
  plannedStartDate: string;
  plannedEndDate: string;
  sortOrder: number;
  colorToken?: string | null;
  note?: string | null;
  estimatedDays?: number;
  estimatedHours?: number;
  user?: { id: string; displayName: string; avatarUrl?: string | null };
}

export interface GanttPayload { /* mirror spec */ }
export interface OrganizationMember { id: string; displayName: string; avatarUrl?: string | null }
```

扩展 `Requirement`：`priority`, `planningStatus`, `assignments?`。

- [ ] **Step 2: api methods**

```typescript
getOrganizationMembers: () => request<OrganizationMember[]>('/auth/organization/members'),
getRequirementAssignments: (id: string) => request<RequirementAssignment[]>(`/requirements/${id}/assignments`),
createRequirementAssignment: (id: string, body: ...) => request(..., { method: 'POST', body }),
updateRequirementAssignment: (id: string, assignmentId: string, body: ...) => request(..., { method: 'PATCH', body }),
deleteRequirementAssignment: (id: string, assignmentId: string) => request(..., { method: 'DELETE' }),
updateRequirement: (id: string, body: { priority?: string; planningStatus?: string }) => request(..., { method: 'PATCH', body }),
getProject: (id: string) => request<Project>(`/projects/${id}`),
getScheduleGantt: (query: Record<string, string>) => request<GanttPayload>(`/schedule/gantt?${new URLSearchParams(query)}`),
```

- [ ] **Step 3: Mirror business-days in web utils + test**

- [ ] **Step 4: `pnpm --filter flowx-web test`**

- [ ] **Step 5: Commit**

---

## Task 9: RequirementSchedulingPanel (TDD)

**Files:**
- Create: `apps/web/src/components/RequirementSchedulingPanel.tsx`
- Create: `apps/web/src/components/RequirementSchedulingPanel.test.tsx`
- Modify: `apps/web/src/pages/RequirementDetailPage.tsx`

- [ ] **Step 1: Test** — mock api；渲染空状态「暂无排期」；有数据时显示人天。

- [ ] **Step 2: Implement panel**

- 成员 Select：`api.getOrganizationMembers()`
- 表格 + Dialog 表单
- 删除确认
- 回调 `onChanged` 刷新父级 requirement

- [ ] **Step 3: Embed in `RequirementDetailPage`** — 新 Section「人员排期」，与 Ideation 并列。

- [ ] **Step 4: Run tests**

```bash
pnpm --filter flowx-web exec vitest run src/components/RequirementSchedulingPanel.test.tsx
```

- [ ] **Step 5: Commit**

---

## Task 10: Requirements list columns

**Files:**
- Modify: `apps/web/src/pages/RequirementsPage.tsx`

- [ ] **Step 1: Extend list item** — 显示 `planningStatus`、`priority`、排期摘要（从 `assignments` 或 API 扩展字段）。

- [ ] **Step 2: Manual smoke** — dev server 创建排期后列表更新。

- [ ] **Step 3: Commit**

---

## Task 11: Project detail + schedule preview (TDD)

**Files:**
- Create: `apps/web/src/components/SchedulePreview.tsx`
- Create: `apps/web/src/pages/ProjectDetailPage.tsx`
- Create: `apps/web/src/pages/ProjectDetailPage.test.tsx`
- Modify: `apps/web/src/pages/ProjectsPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: `SchedulePreview`**

- props: `projectId`, `from`, `to`, `view` default `requirement`
- 调用 `api.getScheduleGantt`
- 用 flex + 相对定位 div 画条（验证契约，非完整甘特）

- [ ] **Step 2: `ProjectDetailPage`**

- 加载 `api.getProject(id)`
- 需求表格 + 链到 `/requirements/:id`
- 嵌入 `SchedulePreview`（默认本月视口）

- [ ] **Step 3: Routes**

```tsx
<Route path="/projects/:projectId" element={<ProjectDetailPage />} />
<Route path="/projects/:projectId/schedule" element={<ProjectSchedulePlaceholder />} />
<Route path="/projects/:projectId/schedule/members" element={<ProjectSchedulePlaceholder />} />
```

Placeholder 显示「甘特图 M4」+ 链回详情。

- [ ] **Step 4: `ProjectsPage` RecordListItem** — Link 到 `/projects/:id`。

- [ ] **Step 5: Tests + commit**

---

## Task 12: Verification

- [ ] **Step 1: API tests**

```bash
pnpm --filter flowx-api test
```

Expected: All pass.

- [ ] **Step 2: Web tests**

```bash
pnpm --filter flowx-web test
```

Expected: All pass.

- [ ] **Step 3: Full check (optional before handoff)**

```bash
pnpm check
```

---

## M4 follow-up (not in this plan’s tasks)

- 引入甘特库，消费现有 `GanttPayload`
- `/projects/:id/schedule` 与 `/schedule/members` 替换 Placeholder
- 视口缩放、拖拽 PATCH assignment 日期

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-project-requirement-scheduling.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每 Task 派生子 agent，任务间你做 review  
2. **Inline Execution** — 本会话用 executing-plans 按 Task 批量执行并设检查点  

**Which approach?**
