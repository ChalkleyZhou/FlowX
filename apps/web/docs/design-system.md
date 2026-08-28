# FlowX Web Design System

> 本文件是 `apps/web` 唯一的日常设计与实现规范。全仓库设计入口见根目录 `DESIGN.md`，审计证据见 `design-system-audit/`。

## 定位

FlowX 是 AI 研发流程管理控制台，不是营销站点。界面需要让用户快速回答：现在处于哪一步、有哪些风险、下一步可以执行什么。视觉方向是中性画布、黑色主操作、深色导航、语义状态色和较高信息密度。

## Token 与视觉基线

### Source of truth

- [`src/globals.css`](../src/globals.css) 是唯一 CSS token 来源，包含主题变量、应用语义变量和全局 reset。
- [`src/design-tokens.ts`](../src/design-tokens.ts) 是与 CSS 同步的编程式 token 来源。
- [`tailwind.config.ts`](../tailwind.config.ts) 只负责把语义 token 映射为 Tailwind class，不新增平行色板。

业务代码优先使用 `bg-background`、`bg-card`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary` 等语义类。新代码禁止使用 `text-slate-*`、`bg-white`、裸 hex 和任意 rgba 阴影。

### 颜色

| 类别 | 规则 |
| --- | --- |
| `primary` | 亮色主题为黑色 `hsl(0 0% 7%)`，暗色主题反相为白色 `hsl(0 0% 96%)`；用于主按钮、活动态和少量交互强调 |
| `background` / `surface` | 中性冷白画布、白色 surface；暗色主题使用深色中性背景 |
| `success` / `warning` / `danger` | 只表达成功、提醒、错误/风险和破坏性操作 |
| `muted` / `accent` | 次要信息和有限的辅助强调，不替代主操作色 |

颜色不能作为错误、成功或工作流阶段的唯一表达，必须同时提供文案、图标或结构变化。

### 排版、间距与形状

| 类别 | 规则 |
| --- | --- |
| 字体 | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` |
| 字号 | 正文 14/20，辅助 13/18，页面标题 24/30，区块标题 18/26 |
| 间距 | 4px 基础单位；页面常用 16/24/32px；同类列表保持一致节奏 |
| 圆角 | `sm` 4px、`md` 6px、`lg` 8px；只有 badge 等特殊标签可使用 `rounded-full` |
| 边框 | 默认 1px `border-border`；hover 使用边框和浅背景变化 |
| 阴影 | 普通卡片默认无阴影；模态框和脱离文档流的浮层才使用阴影 |
| 动效 | 150ms 颜色/透明度过渡；不使用大幅位移或装饰性动效 |

## 布局与页面模板

`AppLayout` 负责左侧导航、主内容区和响应式壳层。页面最大宽度为 1440px，桌面内边距 32px，移动端 16px；窄屏导航可切换为顶部横向布局，复杂表格和 Diff 使用分层视图而不是强行压缩桌面布局。

### 列表页

```text
PageHeader（标题 + 唯一主 CTA）
Metrics（可选）
ListToolbar（search + filters）
RecordList
Pagination（需要分页时）
```

搜索、筛选、排序和分页进入 URL。筛选控件使用稳定宽度，空间不足时自然换行；新增按钮放在 `PageHeader` 或 `SectionHeader.extra`，不与筛选条混在一起。列表必须覆盖加载、空数据、无匹配、错误和权限不足状态。

### 详情页与工作流页

```text
DetailHeader
Summary / Status
Current Stage / Main Content
Context / History
```

工作流每个状态只保留一个明确主动作，其他动作降为次级或更多菜单。运行、失败、待确认、人工审查和完成态必须提供不同且可恢复的反馈；高风险操作使用 `Dialog`，说明影响范围。

## 组件层级

- `src/components/ui/*`：唯一基础 UI 层。优先复用 `Button`、`Input`、`Select`、`Textarea`、`Dialog`、`Card`、`Badge`、`Tabs`、`Spinner`、`Toast` 等。
- `src/components/*`：业务组合层。优先复用 `PageHeader`、`DetailHeader`、`ListToolbar`、`FilterBar`、`MetricCard`、`RecordListItem`、`EmptyState`、`WorkflowSteps`、`StageCard` 等。
- `src/pages/*`：页面层，只组织模块、数据请求和业务状态，不重新定义基础控件或卡片视觉体系。

按钮、输入框和选择框保持约 40px 高度；按钮图标使用 `lucide-react`；图标按钮必须有 `aria-label` 或 tooltip。新的基础交互能力进入 `components/ui`，新的业务模式先判断是否可以扩展现有组合组件。

## 样式边界

- `globals.css`：主题变量、Tailwind base layer、全局 reset 和必要的全局语义。
- 组件文件：组件自己的布局、Tailwind class 和状态样式。
- 页面文件：页面专属网格、分栏和区域布局。

不新增平行 CSS 框架，不把单页表单、Diff viewer、局部 spacing 或组件细节提升为全局样式，不在页面复制基础控件的 padding、边框和 focus 样式。

## 可访问性与质量门槛

- 所有按钮、状态和图标入口有清晰语义；键盘可访问导航、分页、阶段和对话框。
- 焦点状态清晰，点击目标至少 40px；加载、错误、空数据和权限状态有可读文本。
- 共享组件或页面布局变更后运行 `pnpm --filter flowx-web test`；共享组件和布局变更再运行 `pnpm --filter flowx-web build`。
- 页面布局至少检查 1440px、1024px、390px，确认标题、按钮、表格和空状态不溢出、不重叠。

## 相关文档

- 全仓库设计入口：[`DESIGN.md`](../../../DESIGN.md)
- 设计系统审计：[`design-system-audit/00-executive-summary.md`](../../../design-system-audit/00-executive-summary.md)
- 产品与交互方案：[`docs/product-ux-review.md`](../../../docs/product-ux-review.md)
