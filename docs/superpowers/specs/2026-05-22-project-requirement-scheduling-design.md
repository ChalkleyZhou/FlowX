# 项目需求与人员排期 — 设计规格

**日期：** 2026-05-22  
**状态：** 已确认  
**范围：** 项目管理与人员排期（不含 Sprint/迭代、不含工作流状态机改动）

---

## 1. 背景与目标

FlowX 已有 `Workspace → Project → Requirement` 数据层级，但需求层缺少面向 PM 的排期能力：无法为一条需求配置多人分工与计划周期，也无法为后续甘特图提供稳定数据源。

### 1.1 本波目标（M1–M3）

- 需求录入后，支持**多人分工排期**（成员、角色、计划起止日）
- **工时由日期推算**（工作日 × 8 小时），不单独维护人天字段
- 提供**甘特图统一数据契约 API**（M4 前端甘特组件直接消费）
- 项目详情页作为排期汇总入口
- **不改动**工作流并行、状态机、多 WorkflowRun 规则

### 1.2 后续目标（M4–M5，本 spec 仅预留）

- 需求维度甘特图、个人维度甘特图（项目内）
- 拖拽改期、依赖箭头、冲突提示（可选）

---

## 2. 领域模型

### 2.1 实体关系

```text
Workspace
└─ Project
   └─ Requirement
        └─ RequirementAssignment[]   // 人员在需求上的一段排期
```

### 2.2 `RequirementAssignment`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | cuid | 主键 |
| `requirementId` | FK | 所属需求 |
| `userId` | FK | 排期人员（`User`） |
| `role` | string enum | 分工角色 |
| `plannedStartDate` | string 存库为 Date `@db.Date` 或 ISO date | 计划开始（含当天） |
| `plannedEndDate` | string | 计划结束（含当天） |
| `sortOrder` | int | 同需求下展示顺序，默认 0 |
| `colorToken` | string? | 甘特条颜色 token，可选 |
| `note` | string? | 备注 |
| `createdAt` / `updatedAt` | DateTime | |

**多人多条：** 同一需求下同一成员可有多条排期记录（不同角色或时间段）；以 `RequirementAssignment.id` 区分。

**级联：** 删除 `Requirement` 时删除其 assignments。

### 2.3 `Requirement` 补充字段

| 字段 | 默认 | 说明 |
|------|------|------|
| `priority` | `MEDIUM` | `LOW` / `MEDIUM` / `HIGH`，与 Issue 对齐 |
| `planningStatus` | `UNSCHEDULED` | 业务排期状态，与工作流状态分离 |

`planningStatus` 枚举：

- `UNSCHEDULED` — 无排期记录
- `SCHEDULED` — 至少一条 assignment
- `IN_PROGRESS` — 手动标记或后续规则
- `DONE` — 手动标记

**自动规则（M1）：** 创建/删除 assignment 后，若存在 ≥1 条记录则设为 `SCHEDULED`；若 0 条则 `UNSCHEDULED`。`IN_PROGRESS` / `DONE` 仅通过 PATCH 需求更新。

### 2.4 角色枚举 `RequirementAssignmentRole`

`PM` | `FRONTEND` | `BACKEND` | `FULLSTACK` | `QA` | `DESIGN` | `OTHER`

### 2.5 工时推算（不落库）

```text
工作日天数 = countBusinessDays(plannedStartDate, plannedEndDate)  // 周一至周五，含首尾
预估工时(小时) = 工作日天数 × 8
预估人天 = 工作日天数
```

**甘特条绘制：** 横轴按**自然日**显示 `plannedStartDate` ~ `plannedEndDate`（含结束日）。  
**人天/工时展示：** 仍按**工作日**计算，避免周末拉长条形但工时为 0 的矛盾由 UI 文案说明。

实现位置：`apps/api/src/common/business-days.ts`（纯函数，带单元测试）。

---

## 3. API 设计

### 3.1 组织成员（排期选人）

`GET /auth/organization/members`

- 鉴权：Bearer session
- 范围：当前 session 的 `organizationId` 下 `UserOrganization` 成员
- 返回：`{ id, displayName, avatarUrl? }[]`
- 无组织时返回 `[]` 或 400（实现时与现有 session 行为一致）

### 3.2 需求排期 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/requirements/:id/assignments` | 列表，含 user 摘要 + 推算工时 |
| POST | `/requirements/:id/assignments` | 创建 |
| PATCH | `/requirements/:id/assignments/:assignmentId` | 更新 |
| DELETE | `/requirements/:id/assignments/:assignmentId` | 删除 |

**POST/PATCH body：**

```json
{
  "userId": "cuid",
  "role": "FRONTEND",
  "plannedStartDate": "2026-05-22",
  "plannedEndDate": "2026-05-28",
  "note": "optional",
  "sortOrder": 0,
  "colorToken": "role-frontend"
}
```

**校验：**

- `plannedEndDate >= plannedStartDate`
- `userId` 须为组织成员
- `requirementId` 存在

### 3.3 需求元数据

`PATCH /requirements/:id`

```json
{
  "priority": "HIGH",
  "planningStatus": "IN_PROGRESS"
}
```

不允许通过此接口修改 ideation / workflow 字段。

### 3.4 甘特统一契约（M1 实现，M4 UI 消费）

`GET /schedule/gantt`

| Query | 必填 | 说明 |
|-------|------|------|
| `view` | 是 | `requirement` \| `member` |
| `projectId` | 是 | 项目范围 |
| `from` | 是 | `YYYY-MM-DD` 视口开始 |
| `to` | 是 | `YYYY-MM-DD` 视口结束 |
| `userId` | 否 | 个人视图筛选单人 |
| `requirementId` | 否 | 需求视图筛选单需求 |

**Response：**

```typescript
interface GanttPayload {
  view: 'requirement' | 'member';
  range: { from: string; to: string };
  lanes: GanttLane[];
  bars: GanttBar[];
}

interface GanttLane {
  id: string;           // 如 "req:{id}" | "user:{id}"
  kind: 'requirement' | 'member';
  parentLaneId?: string;
  label: string;
  meta: Record<string, string | undefined>;
}

interface GanttBar {
  id: string;           // assignment id
  laneId: string;
  label: string;
  start: string;        // YYYY-MM-DD
  end: string;
  estimatedDays: number;
  estimatedHours: number;
  color?: string;
  meta: {
    projectId: string;
    requirementId: string;
    userId: string;
    role: string;
  };
}
```

**`view=requirement`：**

- 每个需求一条父 lane（`kind=requirement`）
- 每条 assignment 一条子 bar，`laneId` 指向父 lane `req:{requirementId}`
- 父 lane 可选聚合 bar：`start=min(assignments)`, `end=max(assignments)`，`id=req:{id}:aggregate`

**`view=member`：**

- 每个用户一条 lane（`kind=member`）
- 每条 assignment 一条 bar，`laneId=user:{userId}`，`label` 含需求标题与角色

**裁剪：** 仅返回与 `[from, to]` 有交集的 bar（`bar.end >= from && bar.start <= to`）。

### 3.5 项目详情

扩展 `GET /projects/:id`：

- `requirements` 含 `assignments`、推算汇总字段（`assignmentCount`, `scheduleStart`, `scheduleEnd`, `totalEstimatedDays`）
- 或单独 `GET /projects/:id/schedule-summary`（实现计划采用扩展 `findOne` 减少往返）

---

## 4. 前端设计

### 4.1 路由

| 路由 | 阶段 | 说明 |
|------|------|------|
| `/projects/:id` | M3 | 项目详情 + 需求列表 + 简易条形预览 |
| `/projects/:id/schedule` | M4 | 需求维度甘特（占位路由可先 404 或 Coming soon） |
| `/projects/:id/schedule/members` | M4 | 个人维度甘特 |
| `/requirements/:id` | M2 | 增加「人员排期」Card |

### 4.2 需求详情 — 人员排期 Card

- 表格：成员、角色、开始、结束、工作日、人天、操作
- 添加/编辑 Dialog：成员 Select（organization members）、角色、日期、备注
- 展示总预估人天（assignments 工作日之和）
- `priority` / `planningStatus` 可编辑（Select）

### 4.3 项目详情页

- `PageHeader`：项目名、工作区、描述
- 需求表格：标题、planningStatus、priority、排期人数、周期跨度、总人天
- **SchedulePreview**：调用 `GET /schedule/gantt?view=requirement&...` 用 div 画简易条（M3 验证契约）

### 4.4 需求列表增强

列：排期摘要（「张三 等 3 人」）、计划周期、planningStatus

### 4.5 甘特组件（M4，不在 M1–M3 实现）

- 库选型留到 M4（Frappe Gantt / vis-timeline 等），只依赖 `GanttPayload`
- 需求视图：`view=requirement`
- 个人视图：`view=member`
- 视口 `from` / `to` 与周/月缩放

---

## 5. 模块划分

| 模块 | 路径 | 职责 |
|------|------|------|
| Prisma | `prisma/schema.prisma` | 模型与迁移 |
| 工作日工具 | `apps/api/src/common/business-days.ts` | 纯函数 + spec |
| 排期服务 | `apps/api/src/schedule/` | 甘特 payload 组装 |
| 需求排期 | `apps/api/src/requirements/` | assignments CRUD、PATCH 需求 |
| 认证成员 | `apps/api/src/auth/` | organization members |
| Web API | `apps/web/src/api.ts` | 新方法 |
| Web 组件 | `RequirementSchedulingPanel`, `SchedulePreview`, `ProjectDetailPage` | UI |

`ScheduleModule` 注册于 `app.module.ts`。

---

## 6. 分期交付

| 里程碑 | 交付物 |
|--------|--------|
| **M1** | Schema 迁移、enums、business-days、assignments CRUD、members API、`GET /schedule/gantt`、PATCH requirement |
| **M2** | 需求详情排期面板、需求列表列、api/types/tests |
| **M3** | 项目详情页、SchedulePreview、项目列表跳转 |
| **M4** | 甘特图页面（需求 + 个人视图） |
| **M5** | 拖拽改期、依赖、冲突（可选） |

---

## 7. 非目标

- Sprint / 迭代 / 里程碑实体
- 工作流状态机、多 WorkflowRun 并行
- 独立工时输入字段
- Issue/Bug assignee 与需求排期双向同步
- 跨项目个人甘特 `/schedule/me`（二期）

---

## 8. 测试策略

- `business-days.spec.ts`：边界日期、周末、跨月
- `requirement-assignments.spec.ts`：CRUD、唯一约束、日期校验、planningStatus 自动更新
- `schedule-gantt.spec.ts`：两种 view、日期裁剪、聚合 meta
- `auth-organization-members.spec.ts`：成员列表
- Web：`RequirementSchedulingPanel.test.tsx`、`ProjectDetailPage.test.tsx`（jsdom）

---

## 9. 已确认决策

| 决策 | 结论 |
|------|------|
| 组织层级 | 项目 → 需求，无迭代 |
| 排期粒度 | 多人分工，每人一条 assignment |
| 工时 | 开始/结束日期推算工作日 × 8h |
| 甘特条时间轴 | 自然日显示 |
| 人天计算 | 工作日 |
| 个人甘特 | 每人一泳道，多 bar 并列 |
| 数据方案 | 独立 `RequirementAssignment` 表 + 统一 `GanttPayload` API |
