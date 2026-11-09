# 简化测试设计页交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将旧测试设计页收敛为“AI 设计来源 → 发起提测”的轻量页面，把范围删改、确认和人员分派统一留在提测详情。

**Architecture:** 保留现有 `TestDesign` API、状态轮询和提测创建链接。重写 `QualityTestDesignPage` 的展示层，只消费设计摘要、来源摘要、候选/冒烟统计和失败信息；移除 `QualityScopePanel` 在该页的挂载以及候选逐条操作。已有设计详情路由保持不变，已绑定提测继续提供详情入口。

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, React Router。

---

### Task 1: 重写测试设计页为 AI 来源摘要工作台

**Files:**
- Modify: `apps/web/src/pages/quality/QualityTestDesignPage.tsx`

- [ ] **Step 1: 删除旧页面状态和交互依赖**

移除候选分页、冒烟分页、`QualityScopePanel`、候选勾选、逐条 resolution、冒烟确认、覆盖确认和 `TestCaseDefinition`/`TestDesignCandidate` 编辑辅助函数；保留 `useQualityResource`、工作流查询、AI provider 状态、刷新和重新生成。

- [ ] **Step 2: 保留设计状态与来源数据的加载**

继续调用 `api.getTestDesign`、`api.getTestDesignWorkflows`，使用 `resource.data` 作为唯一页面数据源。页面需要读取：`status`、`revision`、`summary`、`sourceSummary`、`retrievalSummary`、`uncoveredItems`、`generationError`、`testRequest`、`project`、`projectVersion` 和 `requirements`（若类型中已有）。

- [ ] **Step 3: 实现新的页面结构**

按以下顺序渲染：

```tsx
<PageHeader title="AI 测试分析" ... />
<ol aria-label="提测流程">
  <li>1 AI 分析</li>
  <li>2 发起提测</li>
  <li>3 范围确认与分派</li>
  <li>4 执行与报告</li>
</ol>
<section aria-label="分析输入">需求、技术方案、Spec & Plan、研发提交记录、代码差异、代码库上下文</section>
<section aria-label="分析结果">功能候选、冒烟用例、未覆盖验收点、当前状态</section>
<section aria-label="下一步操作">发起提测或查看提测详情</section>
```

每个来源使用清晰的“已纳入/未提供/分析中”状态，禁止出现用例库选择、模块选择和分页控件。

- [ ] **Step 4: 根据状态控制主操作**

- `testRequest` 存在：显示“查看提测详情”。
- `CONFIRMED` 且未绑定提测：复用当前 `create=1` URL 参数进入提测创建。
- `GENERATING` 或 `NOT_STARTED`：主按钮禁用并显示“AI 分析中”。
- `GENERATION_FAILED`：保留“重新分析”按钮和诊断编号。
- 其他可发起状态：显示“发起提测”。

- [ ] **Step 5: 运行 TypeScript 检查**

Run: `pnpm --filter flowx-web exec tsc -b --pretty false`
Expected: PASS。

### Task 2: 更新测试设计页测试

**Files:**
- Modify: `apps/web/src/pages/quality/QualityTestDesignPage.test.tsx`

- [ ] **Step 1: 替换候选编辑测试为摘要行为测试**

删除依赖 `getTestDesignCandidates`、`getTestDesignSmokeCases`、`updateTestDesignCandidate` 和 `updateTestDesignSmoke` 的测试，新增断言：页面显示“AI 测试分析”“分析输入”“分析结果”“发起提测”，并显示功能候选与冒烟统计。

- [ ] **Step 2: 验证旧入口消失**

断言页面不包含“选择用例库”“选择用例范围”“处理建议与补选”“确认测试设计”“确认本页冒烟”“批量排除”，且页面没有 `input[type="checkbox"]` 和“下一页”按钮。

- [ ] **Step 3: 验证状态和导航**

覆盖三种场景：

1. `CONFIRMED` 且无 `testRequest` 时，点击“发起提测”后链接包含 `create=1`、`projectId`、`projectVersionId` 和已完成工作流 ID。
2. 有 `testRequest` 时，页面显示“查看提测详情”并链接到提测详情。
3. `GENERATION_FAILED` 时显示错误信息和“重新分析”，点击后调用 `api.generateTestDesign`。

- [ ] **Step 4: 运行页面测试**

Run: `pnpm --filter flowx-web exec vitest run src/pages/quality/QualityTestDesignPage.test.tsx`
Expected: 所有测试通过。

### Task 3: 同步用户文档和变更记录

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新测试准备说明**

将“测试设计页选择用例库、处理候选、确认设计”改为“AI 测试分析页查看分析输入与摘要，提测详情负责删除范围、确认和分派”。

- [ ] **Step 2: 同步手册镜像**

执行 `cp docs/user-manual.md apps/web/public/user-manual.md`，并用 `cmp -s docs/user-manual.md apps/web/public/user-manual.md` 验证一致。

- [ ] **Step 3: 更新 CHANGELOG**

在未发布条目增加本次用户可见变化，说明测试设计页改为 AI 来源摘要页，范围删改和分派集中到提测详情。

### Task 4: 最终验证与提交

**Files:**
- All files above

- [ ] **Step 1: 运行质量页面测试**

Run: `pnpm --filter flowx-web exec vitest run src/pages/quality/QualityPages.test.tsx src/pages/quality/QualityTestDesignPage.test.tsx`
Expected: PASS。

- [ ] **Step 2: 运行 Web build 和差异检查**

Run: `pnpm --filter flowx-web build && git diff --check`
Expected: build 成功，diff check 无输出。

- [ ] **Step 3: 提交变更**

```bash
git add apps/web/src/pages/quality/QualityTestDesignPage.tsx apps/web/src/pages/quality/QualityTestDesignPage.test.tsx docs/user-manual.md apps/web/public/user-manual.md CHANGELOG.md
git commit -m "简化测试设计页交互"
```
