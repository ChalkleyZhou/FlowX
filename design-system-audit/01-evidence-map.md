# 证据地图

| 路径 | 平台 | 类型 | 置信度 | 备注 |
| --- | --- | --- | --- | --- |
| `apps/web/src/globals.css` | Web | CSS token/theme | High | 当前 CSS source of truth，已重定义为 Control Room token |
| `apps/web/src/design-tokens.ts` | Web | 编程式 token | High | 与 CSS 同步的 TS token |
| `apps/web/tailwind.config.ts` | Web | 样式映射 | High | 将语义 token 映射到 Tailwind |
| `apps/web/src/components/ui/*` | Web | 基础组件 | High | Button/Card/Input/Select/Tabs 等 |
| `apps/web/src/components/AppLayout.tsx` | Web | App Shell | High | 侧栏导航、页面容器、设置弹层 |
| `apps/web/src/components/PageHeader.tsx` | Web | 页面模板 | High | 列表和详情页标题区 |
| `apps/web/src/components/MetricCard.tsx` | Web | 数据展示 | High | 多个列表/详情页复用 |
| `apps/web/src/components/RecordListItem.tsx` | Web | 列表模板 | High | 项目、需求、问题项等复用 |
| `docs/frontend-shadcn-design-spec.md` | Web | 设计约定 | High | 声明了页面骨架和组件边界 |
| `apps/web/AGENTS.md` | Web | 工程约束 | High | 声明缺失的 `apps/web/docs/design-system.md` |
| `.cursor/rules/flowx-web-design-system.mdc` | Web | Agent 规则 | High | 依赖上述缺失文档，现已补齐 |
| Storybook / Figma / 截图 | Web | 外部 artifact | Unknown | 未在仓库发现，无法作为视觉事实 |

高层结论的来源：颜色/排版/间距来自 `globals.css` 和 `design-tokens.ts`；组件 API 来自 `components/ui`；页面结构来自 `AppLayout`、`PageHeader`、`ListToolbar` 和 `docs/frontend-shadcn-design-spec.md`；问题清单来自源码中的硬编码 class 搜索结果。
