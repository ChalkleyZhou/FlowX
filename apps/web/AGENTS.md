# FlowX Web Agent Guide

本文件适用于 `apps/web`。同时遵守仓库根目录 `AGENTS.md`；根规则与本文件冲突时，以本文件对前端的具体规则为准。

## 项目范围

`apps/web` 是 FlowX 的 React + TypeScript + Vite + Tailwind 管理控制台，使用 Radix/shadcn 风格基础组件和 `lucide-react` 图标，负责工作区、项目、需求、工作流、审查产物、缺陷、AI 凭据、项目简报、每日 Code Review、投递目标、排期和用户手册。

关键边界：

- `src/api.ts`：API 封装、认证 token 注入、请求去重和错误处理。
- `src/types.ts`：前后端共享的前端领域类型。
- `src/App.tsx`、`src/routes`：路由、认证保护和页面布局。
- `src/pages`、`src/components`：页面级视图和业务组件。
- `src/components/ui`：基础 UI 组件，优先复用。
- `src/design-tokens.ts`、`src/globals.css`、`docs/design-system.md`：设计令牌和视觉规范。
- `public/user-manual.md`、`public/local-agent-guide.md`：平台内嵌手册镜像，源文件位于根目录 `docs`。

## 常用命令

在仓库根目录执行：

```bash
pnpm --filter flowx-web dev
pnpm --filter flowx-web build
pnpm --filter flowx-web test
```

等价根命令：

```bash
pnpm dev:web
pnpm build:web
```

默认 Vite dev server 监听 `127.0.0.1:4173`，`/api` 代理到 `http://127.0.0.1:3000`；需要 HTTPS 时设置 `VITE_DEV_HTTPS=true`。

## 前端开发规范

- 使用函数组件和明确建模的 TypeScript props，避免无约束对象透传。
- 页面数据加载集中通过 `src/api.ts` helper；不要在页面中散落裸 `fetch`，除非是刻意隔离的例外。
- 保持 `src/api.ts`、`src/types.ts`、后端 DTO 和页面调用方一致；不要在页面复制复杂 API 类型。
- 优先复用现有页面布局、业务组件、`src/components/ui` 和 `cn`。
- 样式优先使用 Tailwind class；组合 class 使用 `cn`。
- 图标优先使用 `lucide-react`；按钮、状态和操作入口提供清晰语义与可访问名称。
- 管理台保持信息密度、可扫描和操作路径清晰，不创建无关的营销式 landing page 或视觉重构。
- 认证流程使用现有认证上下文和 token key，不绕过 guard 或直接读写不一致的登录态。
- 工作流详情、需求详情、AI 凭据、简报/Code Review、投递目标和排期页面属于复杂交互，修改时保持窄 diff。

## 测试与文档

- 前端代码改动至少运行 `pnpm --filter flowx-web test`。
- 修改 `src/api.ts`、共享类型、页面数据加载、路由、认证流程或关键交互时，优先更新相关测试。
- 修改简报、每日 Code Review、投递目标或排期页面/API helper 时，检查后端 DTO、`src/api.ts` 和 `src/types.ts`，并运行 Web 测试。
- 修改样式或布局密集页面时运行 Web build；必要时启动 dev server 做浏览器检查。
- API 契约或用户可见页面变更时，同步检查根 `README.md`、`docs/user-manual.md` 和相关专题文档。
- 修改 `docs/user-manual.md` 或 `docs/local-agent-guide.md` 后，同步更新 `public` 镜像，并执行根规则中的 `cmp` 校验。
- 无法运行必要检查时，在交付说明中写明原因和剩余风险。

## 修改流程与边界

- 开始前检查 `git status --short`，把已有未提交改动视为用户工作；不要回滚、覆盖或格式化无关文件。
- 先读目标页面、组件、`src/api.ts`、`src/types.ts`、已有测试和相关文档，再做最小修改。
- 组件 props、API 返回和加载状态要显式建模；同时覆盖 loading、error、empty、success 和权限状态。
- 不修改 `dist/`、生成物、本地数据库或 `.flowx-data`。
- 不把无关视觉重构混入功能或修复；保持 UI 与现有管理台设计系统一致。
- 交付前运行受影响 Web test/build；跨越整个仓库时运行根目录 `pnpm check`。
