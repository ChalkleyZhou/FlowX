# 证据地图

| 路径 | 平台 | 类型 | 可信度 | 结论 |
| --- | --- | --- | --- | --- |
| `apps/web/src/globals.css` | Web | 主题 token | High | 实际使用 Inter、黑色主色、中性背景、success/warning/danger 语义色 |
| `apps/web/src/design-tokens.ts` | Web | 编程式 token | High | 颜色、字体尺寸、4px 间距、4/6/8px 圆角、阴影和过渡 |
| `apps/web/tailwind.config.ts` | Web | 样式映射 | High | 将语义 token 映射到 Tailwind |
| `apps/web/docs/design-system.md` | Web | 设计系统 SSOT | High | 明确 Control Room 视觉、token、页面模板、组件规则和质量门槛 |
| `docs/frontend-shadcn-design-spec.md` | Web | 设计规范 | High | 定义 `PageHeader + ListToolbar + RecordList + Pagination` 和工作流页面骨架，但部分值与代码冲突 |
| `apps/web/src/components/ui/*` | Web | 基础组件 | High | Button、Input、Select、Dialog、Card、Badge、Tabs、Spinner 等 |
| `apps/web/src/components/AppLayout.tsx` | Web | App Shell | High | 侧栏导航、页面容器、设置弹层和响应式导航 |
| `apps/web/src/components/MetricCard.tsx` | Web | 数据展示 | High | 多个列表/详情页复用的统计卡 |
| `apps/web/src/components/{PageHeader,ListToolbar,FilterBar,RecordListItem,EmptyState}.tsx` | Web | 业务组合组件 | High | 列表页和空态的现有组合模式 |
| `apps/web/src/components/{WorkflowSteps,StageCard,WorkflowReviewSidebar}.tsx` | Web | 工作流组件 | High | 阶段导航、阶段内容和审查侧栏的现有模式 |
| `apps/web/src/pages/WorkflowRunsPage.tsx` | Web | 页面实现 | High | 全量加载工作流；按 URL 筛选但无分页和服务端过滤 |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | Web | 页面实现 | High | 超过 3000 行，集中管理阶段、执行、审查、部署等多类任务 |
| `apps/web/src/pages/IssuesPage.tsx` | Web | 页面实现 | High | 有固定 8 条的前端分页，筛选和页码为 React state |
| `apps/web/src/pages/BugsPage.tsx` | Web | 页面实现 | High | 有固定 8 条的前端分页，筛选和页码为 React state |
| `apps/web/src/pages/{Requirements,Projects,OrganizationUsers}Page.tsx` | Web | 页面实现 | High | 全量请求后本地过滤，未统一分页 |
| `apps/web/src/utils/briefings-page-preferences.ts` | Web | 偏好存储 | High | 仅简报页有页面级 localStorage 偏好 |
| `apps/web/src/api.ts` | Web/API boundary | API helper | High | 多数列表 helper 返回数组；参数和返回结构没有统一分页模型 |
| `apps/api/src/workflow/workflow.controller.ts` | API | Controller | High | 工作流列表只有 `runType` query |
| `apps/api/src/workflow/workflow.service.ts` | API | Service | High | `findAll` 直接 `findMany`，没有 `skip/take/count` |
| `apps/api/src/requirements/requirements.controller.ts` | API | Controller | High | 需求列表无 query 参数 |
| `apps/api/src/requirements/requirements.service.ts` | API | Service | High | 需求列表直接按创建时间全量返回且包含大量关系 |
| `docs/product-ux-review.md` | Cross-platform | 产品方案 | High | 基于以上证据形成的信息架构、列表和工作流改造建议 |
| `apps/web/AGENTS.md` | Web | 工程约束 | High | 规定基础组件、页面模板、测试和文档边界 |
| `.cursor/rules/flowx-web-design-system.mdc` | Web | Agent 规则 | High | 依赖前端设计系统文档，需确认文档路径和内容同步 |

未发现可访问的 Figma、Storybook、设计导出物或独立移动端资源；视觉判断以源码和文档为准，建议后续补充桌面宽度 1280/1440/1920 及窄屏截图。
