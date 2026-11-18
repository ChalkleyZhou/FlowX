# 需求详情页工作项化重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统一 `WorkItem` 详情入口中实现需求内容优先的双栏布局、版本工作台需求修改摘要，以及负责人/优先级/发布版本快速编辑，同时为问题和缺陷后续迁移保留共享边界。

**Architecture:** `/work-items/:id` 继续由 `WorkItemDetailPage` 承载，根据 `workItem.kind` 渲染共享标题与元信息区和类型专属内容。新增 `WorkItemMetaPanel` 负责快速编辑，新增 `RequirementChangesSummary` 负责只读摘要；完整需求修改、执行计划、排期和工作流能力继续复用现有组件。基础快速编辑统一调用 `api.updateWorkItem`，需求专属 `updateRequirement` 仅补齐 `ownerUserId` 以兼容旧组件和测试。

**Tech Stack:** React 18、TypeScript、React Router、Tailwind CSS、Radix/shadcn UI、NestJS、Prisma、Vitest。

---

## 文件地图

- 创建：`apps/web/src/components/WorkItemMetaPanel.tsx`，共享工作项元信息只读/编辑区。
- 创建：`apps/web/src/components/WorkItemMetaPanel.test.tsx`，快速编辑交互测试。
- 创建：`apps/web/src/components/RequirementChangesSummary.tsx`，需求修改项右侧摘要。
- 创建：`apps/web/src/components/RequirementChangesSummary.test.tsx`，摘要加载、空态、失败和重试测试。
- 修改：`apps/web/src/pages/WorkItemDetailPage.tsx`，统一入口的需求内容优先布局和类型专属区域。
- 修改：`apps/web/src/pages/WorkItemDetailPage.test.tsx`（若当前不存在则创建），统一入口回归测试。
- 修改：`apps/web/src/api.ts`，补充需求更新的 `ownerUserId` 类型，并复用工作项更新返回值。
- 修改：`apps/web/src/types.ts`，补齐共享工作项和需求摘要所需的可选字段类型。
- 修改：`apps/api/src/requirements/dto/update-requirement.dto.ts`，增加负责人字段校验。
- 修改：`apps/api/src/requirements/requirements.service.ts`，需求专属更新支持负责人校验、清空和返回 `ownerUser`。
- 修改：`apps/api/src/requirements/requirements-create.spec.ts` 或新增同目录更新测试，验证 DTO 字段。
- 创建：`apps/api/src/requirements/requirements.service.spec.ts`（若实现前发现已有同名测试则合并到该文件），验证组织归属和清空负责人。
- 修改：`CHANGELOG.md`，记录实现后的用户可见变化。
- 检查：`README.md`、`docs/user-manual.md`、`apps/web/public/user-manual.md`，只有新增用户操作说明时才同步内容。

### Task 1: 补齐需求更新 API 的负责人契约

**Files:**
- Modify: `apps/api/src/requirements/dto/update-requirement.dto.ts`
- Modify: `apps/api/src/requirements/requirements.service.ts:204-279`
- Test: `apps/api/src/requirements/requirements-create.spec.ts`
- Test: `apps/api/src/requirements/requirements.service.spec.ts`

- [ ] **Step 1: 写 DTO 失败测试**

在 DTO 验证测试中加入：

```ts
it('UpdateRequirementDto 接受负责人 ID 和 null', async () => {
  await expect(validate(Object.assign(new UpdateRequirementDto(), { ownerUserId: 'user-1' }))).resolves.toEqual([]);
  await expect(validate(Object.assign(new UpdateRequirementDto(), { ownerUserId: null }))).resolves.toEqual([]);
  await expect(validate(Object.assign(new UpdateRequirementDto(), { ownerUserId: 123 }))).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({ property: 'ownerUserId' }),
  ]));
});
```

- [ ] **Step 2: 运行 DTO 测试确认失败**

运行：`pnpm --filter flowx-api test -- requirements-create.spec.ts`

预期：新增断言因 `UpdateRequirementDto` 没有 `ownerUserId` 而失败。

- [ ] **Step 3: 实现 DTO 和 Service 更新**

在 DTO 增加：

```ts
@IsOptional()
@ValidateIf((_, value) => value !== null)
@IsString()
@IsNotEmpty()
ownerUserId?: string | null;
```

在 `RequirementsService.update` 中：

```ts
if (dto.ownerUserId) {
  await this.assertUserInOrganization(dto.ownerUserId, existing.project.workspace.organizationId);
}
```

并在 Prisma `data` 中加入 `...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {})`，在返回查询中加入 `ownerUser: { select: { id: true, displayName: true, avatarUrl: true } }`。`null` 必须清空负责人，非空 ID 必须复用现有组织校验。

- [ ] **Step 4: 写 Service 行为测试并通过**

使用现有 Prisma mock 断言以下三种调用：合法 ID 先校验组织并写入；`null` 写入 `ownerUserId: null`；组织外 ID 抛出 `ForbiddenException` 且不执行更新。

运行：`pnpm --filter flowx-api test -- requirements-create.spec.ts requirements.service.spec.ts`

预期：PASS。

- [ ] **Step 5: 提交 API 契约变更**

```bash
git add apps/api/src/requirements/dto/update-requirement.dto.ts apps/api/src/requirements/requirements.service.ts apps/api/src/requirements/requirements-create.spec.ts apps/api/src/requirements/requirements.service.spec.ts CHANGELOG.md
git commit -m "补齐需求负责人更新契约"
```

### Task 2: 实现共享工作项元信息快速编辑区

**Files:**
- Create: `apps/web/src/components/WorkItemMetaPanel.tsx`
- Create: `apps/web/src/components/WorkItemMetaPanel.test.tsx`
- Modify: `apps/web/src/api.ts:362-370`
- Modify: `apps/web/src/types.ts:320-365`

- [ ] **Step 1: 写组件失败测试**

覆盖以下交互：只读状态展示负责人、优先级和版本；点击“编辑”显示三个控件；负责人使用 `getOrganizationMembers({ status: 'ACTIVE' })` 的 `PagedSelect`；选择负责人并保存调用：

```ts
expect(api.updateWorkItem).toHaveBeenCalledWith('work-item-1', {
  ownerUserId: 'user-2',
  priority: 'HIGH',
  versionId: 'version-2',
});
```

另外覆盖取消不调用 API、清空负责人传 `null`、API 失败保留编辑态并显示错误。

- [ ] **Step 2: 运行组件测试确认失败**

运行：`pnpm --filter flowx-web test -- WorkItemMetaPanel.test.tsx`

预期：因组件和导出不存在而失败。

- [ ] **Step 3: 实现最小组件**

组件 props 固定为：

```ts
type Props = {
  workItem: Pick<WorkItem, 'id' | 'priority' | 'versionId' | 'version' | 'ownerUser' | 'projectId' | 'workspaceId'>;
  onSaved: (updated: Partial<WorkItem>) => void;
};
```

只读状态显示三行字段和“编辑”；编辑态用 `Select`、两个 `PagedSelect`、保存/取消按钮。保存时一次调用 `api.updateWorkItem`，payload 同时包含三个字段；成功调用 `onSaved`，失败保留 draft 和 `role="alert"`。所有控件使用现有 `components/ui` 和 `PagedSelect`，不在组件内复制组织权限逻辑。

- [ ] **Step 4: 运行组件测试确认通过**

运行：`pnpm --filter flowx-web test -- WorkItemMetaPanel.test.tsx`

预期：PASS。

- [ ] **Step 5: 提交共享快速编辑组件**

```bash
git add apps/web/src/components/WorkItemMetaPanel.tsx apps/web/src/components/WorkItemMetaPanel.test.tsx apps/web/src/api.ts apps/web/src/types.ts CHANGELOG.md
git commit -m "新增工作项元信息快速编辑"
```

### Task 3: 实现需求修改项摘要

**Files:**
- Create: `apps/web/src/components/RequirementChangesSummary.tsx`
- Create: `apps/web/src/components/RequirementChangesSummary.test.tsx`
- Modify: `apps/web/src/types.ts`（仅在现有 `RequirementChange` 类型缺字段时）

- [ ] **Step 1: 写摘要失败测试**

使用 `api.getRequirementChanges` mock 覆盖：首次以 `{ page: 1, pageSize: 3 }` 请求；按 revision 倒序最多展示 3 条；无记录显示空态；加载失败显示错误和“重试”；点击“查看全部修改”触发 `onViewAll`；存在 `hasPendingChanges` 时显示待同步提示。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter flowx-web test -- RequirementChangesSummary.test.tsx`

预期：因组件不存在而失败。

- [ ] **Step 3: 实现摘要组件**

组件 props 为：

```ts
type Props = {
  requirementId: string;
  onViewAll: () => void;
  onCreateChange: () => void;
};
```

使用 `useEffect` 加载一次，组件卸载时忽略迟到结果；保留 `loading/error/data` 三态。摘要只读展示 revision、content、createdByName、createdAt、mode、restartStatus，不复制提交/重启逻辑。按钮分别调用 `onViewAll` 和 `onCreateChange`，由父页滚动到完整 `RequirementChangesPanel` 或展开其提交区。

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter flowx-web test -- RequirementChangesSummary.test.tsx`

预期：PASS。

- [ ] **Step 5: 提交摘要组件**

```bash
git add apps/web/src/components/RequirementChangesSummary.tsx apps/web/src/components/RequirementChangesSummary.test.tsx apps/web/src/types.ts CHANGELOG.md
git commit -m "增加需求修改项摘要"
```

### Task 4: 重排统一工作项详情页

**Files:**
- Modify: `apps/web/src/pages/WorkItemDetailPage.tsx`
- Create or modify: `apps/web/src/pages/WorkItemDetailPage.test.tsx`

- [ ] **Step 1: 写页面失败测试**

以 `Requirement` 类型的 `WorkItem` fixture 渲染 `/work-items/:id`，断言：

1. 需求描述、验收标准、功能模块、风险&影响、产品需求文档、备注出现在左侧主内容区。
2. `WorkItemMetaPanel`、`RequirementChangesSummary` 出现在右侧辅助区。
3. 非需求 `ISSUE`/`BUG` 不渲染需求修改摘要和排期专属区，但渲染各自专属字段。
4. 快速编辑保存后页面合并返回的负责人、优先级、版本，不触发整页 loading。
5. `RequirementChangesSummary` 的“查看全部修改”能滚动或定位到完整修改区。

- [ ] **Step 2: 运行页面测试确认失败**

运行：`pnpm --filter flowx-web test -- WorkItemDetailPage.test.tsx`

预期：当前页面没有需求内容优先双栏结构和摘要组件，断言失败。

- [ ] **Step 3: 实现页面布局**

保留当前详情加载、返回路径、启动工作流和执行计划逻辑；将主体改成：

```tsx
<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
  <div className="space-y-5">{/* 需求正文 / 类型专属内容 */}</div>
  <aside className="space-y-5">{/* WorkItemMetaPanel / 需求摘要 / 排期摘要 */}</aside>
</div>
```

需求类型左栏按“需求描述、验收标准、功能模块、风险&影响、产品需求文档、备注”展示；问题/缺陷左栏保留现有专属字段。需求类型右栏挂载 `WorkItemMetaPanel` 和 `RequirementChangesSummary`。完整 `RequirementChangesPanel` 放到推进与历史区，并通过 `id="requirement-changes"` 提供定位。执行计划仍使用 `ExecutionPlanPanel`，原型导入、工作流、历史和排期只在对应 kind/数据存在时显示。

快速编辑成功时使用返回的 `WorkItem` 合并 `workItem` state，并以 silent 方式刷新详情；不清空已有内容，不重复弹出加载错误。为 `WorkItemMetaPanel` 的摘要按钮提供滚动到完整修改区和打开提交区的回调。

- [ ] **Step 4: 运行页面回归测试**

运行：`pnpm --filter flowx-web test -- WorkItemDetailPage.test.tsx RequirementDetailPage.test.tsx`

预期：PASS；需求旧专属测试仍可验证需求修改、工作流、删除和排期入口不回归。

- [ ] **Step 5: 提交详情页重排**

```bash
git add apps/web/src/pages/WorkItemDetailPage.tsx apps/web/src/pages/WorkItemDetailPage.test.tsx CHANGELOG.md
git commit -m "重排需求工作项详情布局"
```

### Task 5: 同步文档并完成跨边界验证

**Files:**
- Modify: `CHANGELOG.md`
- Check: `README.md`
- Check: `docs/user-manual.md`
- Check: `apps/web/public/user-manual.md`

- [ ] **Step 1: 更新变更记录**

在 2026-11-18 未发布条目中记录：需求详情页以需求内容为首要阅读内容，支持在详情页快速修改负责人、优先级和版本，并提供版本工作台需求修改项摘要；问题和缺陷继续使用共享工作项字段但保持各自专属区域。

- [ ] **Step 2: 判断用户手册是否需要同步**

若手册已有需求详情或工作项编辑说明，补充“详情页右侧快速编辑”和“需求修改项摘要”操作；修改 `docs/user-manual.md` 后执行：

```bash
cp docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
```

若没有对应章节，在交付记录中说明无需新增手册内容，不修改镜像文件。

- [ ] **Step 3: 运行完整 Web/API 检查**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm --filter flowx-web build
git diff --check
```

预期：API 测试、Web 测试、Web build 和 diff 检查全部通过；如果环境阻塞某项，记录准确的失败命令和剩余风险。

- [ ] **Step 4: 提交最终文档和验证记录**

```bash
git add CHANGELOG.md docs/user-manual.md apps/web/public/user-manual.md
git commit -m "补充需求详情工作项化变更记录"
```

## 自检结果

- 需求内容优先、双栏布局、窄屏单列、修改项摘要、快速编辑、完整修改记录和排期均有对应任务。
- 问题/缺陷共享壳层边界有 Task 4 的 kind 分支测试，未扩大本轮页面迁移范围。
- 负责人 API 的合法 ID、`null` 清空、组织隔离和返回关系有 Task 1 覆盖。
- 竞态、silent refresh、错误保留草稿和分页/轮询回归有 Task 2-4 覆盖。
- 计划中的组件接口、实现入口和验证命令均已明确；实现入口以当前实际路由 `WorkItemDetailPage` 为准。
