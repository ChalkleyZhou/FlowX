# 组件清单

## Navigation

| 组件 | 路径 | 现状 | 缺口 |
| --- | --- | --- | --- |
| App shell / sidebar | `apps/web/src/components/AppLayout.tsx` | 固定侧栏，窄屏横向导航，设置入口弹窗 | 缺少工作队列入口和任务计数；业务分组较弱 |
| FlowXLogo | `apps/web/src/components/FlowXLogo.tsx` | 有品牌 lockup 和 icon 资源 | 品牌渐变属于例外，需要单独记录品牌规范 |
| PageHeader | `apps/web/src/components/PageHeader.tsx` | 标题、说明、图标、操作 | 可继续作为统一页面头 |
| DetailHeader | `apps/web/src/components/DetailHeader.tsx` | 详情标题和操作 | 工作流需要扩展为 sticky ActionBar |

## Data display

| 组件 | 路径 | 现状 | 缺口 |
| --- | --- | --- | --- |
| RecordListItem | `apps/web/src/components/RecordListItem.tsx` | 适合简单业务列表项 | 缺少列配置、密度、选择和分页配套 |
| MetricCard | `apps/web/src/components/MetricCard.tsx` | 展示少量统计 | 不应承担列表查询反馈 |
| StatPill / Badge | `apps/web/src/components/StatPill.tsx`, `components/ui/badge.tsx` | 状态和统计表达 | 需要统一业务状态文案、颜色和 aria label |
| EmptyState | `apps/web/src/components/EmptyState.tsx` | 空数据占位 | 需区分无数据、无匹配、错误和权限 |

基础控件已有 `Button`（default/secondary/outline/ghost/destructive，含 sm/md/lg/icon）、`Input`（40px、focus）、`Select`（Radix、键盘）、`Tabs`（Radix）和 `Card`（默认边框无阴影）。它们仍需补 loading、error、selected 和无数据等状态示例。

## Input and feedback

| 组件 | 路径 | 现状 | 缺口 |
| --- | --- | --- | --- |
| ListToolbar / FilterBar | `apps/web/src/components/{ListToolbar,FilterBar}.tsx` | 统一容器，支持 search 和 filters | 缺少清除筛选、结果计数、保存视图和状态同步 |
| Dialog / Alert / Toast | `apps/web/src/components/ui/*` | 基础弹层和提示已存在 | 高风险工作流动作仍有 `window.confirm` |
| Spinner | `apps/web/src/components/ui/spinner.tsx` | 加载图标 | 缺少列表 skeleton 和局部 pending 模式 |

## Workflow domain

| 组件 | 路径 | 现状 | 缺口 |
| --- | --- | --- | --- |
| WorkflowSteps | `apps/web/src/components/WorkflowSteps.tsx` | 8 阶段网格卡片，可点击 | 应改为紧凑 StageRail，支持 URL、键盘和当前任务突出 |
| StageCard | `apps/web/src/components/StageCard.tsx` | 阶段标题、状态、动作 | 动作编排散落在页面，缺少单主动作约束 |
| WorkflowReviewSidebar | `apps/web/src/components/WorkflowReviewSidebar.tsx` | 反馈输入和工作区动作侧栏 | 应升级为统一 DecisionPanel / ActionBar |
| DiffFileListPanel / DiffViewerPanel | `apps/web/src/components/*Diff*` | Diff 文件和查看器 | 适合迁移到“变更与审查”工作区 |
| ReviewFindingCard | `apps/web/src/components/ReviewFindingCard.tsx` | 展示 findings 和处置动作 | 需要批量处理、分组和决策门禁 |

## Missing foundation components

- `Pagination`
- `ListQueryState`
- `DataListLayout`
- `StatusBadge`
- `WorkflowActionBar`
- `WorkflowStageRail`
- `DecisionPanel`
- `AuditTimeline`
- `Skeleton`
