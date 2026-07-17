# FlowX Web Agent Guide

## 项目概览

`apps/web` 是 FlowX 的管理控制台，基于 React + TypeScript + Vite + Tailwind，使用 Radix/shadcn 风格基础组件和 lucide-react 图标。它负责工作区、项目、需求、工作流、审查产物、缺陷、AI 凭据、项目简报、每日 Code Review、投递目标、排期和用户手册等页面。

本子项目的关键边界是 `src/api.ts`、共享类型、页面数据加载、工作流详情交互、简报/Code Review/投递目标交互、排期交互和认证路由。

## 常用命令

在仓库根目录执行：

```bash
pnpm --filter flowx-web dev
pnpm --filter flowx-web build
pnpm --filter flowx-web test
```

也可以使用根命令：

```bash
pnpm dev:web
pnpm build:web
pnpm check
```

默认 Vite dev server 监听 `127.0.0.1:4173`，`/api` 会代理到 `http://127.0.0.1:3000`。如需 HTTPS，本地设置 `VITE_DEV_HTTPS=true`。

## 目录结构

- `docs/design-system.md`：设计系统令牌与视觉红线（SSOT）；布局与页面模板另见仓库根目录 `docs/frontend-shadcn-design-spec.md`。
- `src/main.tsx`：React 入口，挂载 Router 和主题 provider。
- `src/App.tsx`：应用路由表和受保护页面布局。
- `src/api.ts`：前端 API 封装、请求去重、认证 token 注入和错误处理，属于高风险边界。
- `src/auth.tsx`：认证状态、登录态存取和上下文。
- `src/types.ts`：前端共享领域类型。
- `src/design-tokens.ts`：设计 token。
- `src/globals.css`：Tailwind 全局样式。
- `src/pages`：页面级组件。
- `src/components`：业务组件。
- `src/components/ui`：基础 UI 组件。
- `src/routes`：路由 guard 和布局包装。
- `src/utils`：UI 标签、工作流状态展示等工具函数。
- `src/lib/utils.ts`：通用工具，例如 `cn`。
- `src/assets`：Logo 和静态资源。
- `src/components/ProjectBriefingConfigPanel.tsx`、`src/pages/BriefingsPage.tsx`、`src/pages/BriefingDetailPage.tsx`、`src/pages/BriefingSourcesPage.tsx`：项目简报相关 UI（不含 Code Review）。
- `src/pages/CodeReviewsPage.tsx`（路由 `/code-reviews`）、`src/components/ProjectCodeReviewConfigPanel.tsx`、`src/pages/CodeReviewSourcesPage.tsx`（路由 `/settings/code-review-sources`）：独立的每日 Code Review 导航入口、调度配置面板和数据源设置，与简报页面解耦。
- `src/pages/DeliveryTargetsPage.tsx`、`src/components/DeliveryTargetList.tsx`：投递目标 UI，每个目标可分别开启「用于简报」「用于 Code Review」。
- `src/pages/ScheduleHubPage.tsx`、`src/components/ScheduleGantt.tsx`、`src/components/ScheduleAssignmentDialog.tsx`：排期 UI。

## 代码规范

- 使用函数组件和 TypeScript 类型；组件 props 明确建模，避免无约束对象透传。
- 优先复用 `src/components/ui`、`src/components` 和现有页面布局模式。
- 样式优先用 Tailwind class；组合 class 使用 `cn`。
- 图标优先用 `lucide-react`，按钮、状态、操作入口要有清晰语义和可访问名称。
- 页面数据加载集中通过 `src/api.ts` 的 helper；不要在页面里散落裸 `fetch`，除非是刻意隔离的例外。
- 保持前端类型与后端 API 返回一致；改 API 边界时同步检查 `src/types.ts` 和调用页面。
- 不要创建营销式 landing page；管理台页面应保持信息密度、可扫描、操作路径清晰。
- 避免把无关视觉重构混入功能或修复；保持组件 diff 小而可审查。

## 测试和构建

- 开发服务：`pnpm --filter flowx-web dev`。
- 构建：`pnpm --filter flowx-web build`，执行 `tsc -b` 和 `vite build`。
- 测试：`pnpm --filter flowx-web test`。
- Web 测试使用 Vitest，匹配 `src/**/*.test.ts` 和 `src/**/*.test.tsx`。
- 需要 DOM 的测试使用文件头 `// @vitest-environment jsdom`，参考现有页面/组件测试。
- 交付前如改动影响整个仓库，运行根目录 `pnpm check`。

## 提交前检查

至少按改动范围执行：

- 前端任意代码改动：`pnpm --filter flowx-web test`。
- 修改 `src/api.ts`：`pnpm --filter flowx-web test`。
- 修改页面数据加载、路由、认证流程或关键交互：`pnpm --filter flowx-web test`。
- 修改简报、Code Review、投递目标或排期页面/API helper：`pnpm --filter flowx-web test`。
- 修改共享类型或与 API 返回相关的 UI：同步检查后端契约，必要时运行 `pnpm --filter flowx-api test`。
- 修改样式或布局密集页面：运行 Web build，必要时启动 dev server 做浏览器检查。
- 最终交付前：`pnpm check`，如无法运行需说明原因。

## AI 修改代码注意事项

- 先读目标页面、相关组件、`src/api.ts`、`src/types.ts` 和已有测试，再修改。
- 修改 `src/api.ts` 或页面数据加载行为前，优先添加或更新测试。
- 不要绕过认证上下文或直接读写不一致的 token key。
- 不要在页面里复制复杂 API 类型；共享类型应放在 `src/types.ts` 或就近明确定义。
- 工作流详情页、需求详情页和 AI 凭据页交互复杂，修改时保持小步验证。
- 简报来源、Code Review 数据源/配置、投递目标和排期页面跨 API/Prisma 契约，修改时同步检查 `src/api.ts`、`src/types.ts` 和后端 DTO。
- 保持 UI 与现有管理台风格一致：克制、清晰、信息优先，避免无关装饰。
- 遇到已有未提交改动时，默认视为用户工作；不要回滚，必要时围绕现有改动继续。
