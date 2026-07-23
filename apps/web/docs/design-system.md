# FlowX Web Design System

## 定位

FlowX 是 AI 研发流程管理控制台，不是营销站点。界面需要让用户快速回答三件事：现在处于哪一步、有哪些风险、下一步可以执行什么。视觉风格使用中性画布 + 黑色主操作 + 深色导航 + 语义状态色，优先保证扫描、比较和确认。

## Token 使用

唯一 CSS token 来源是 `src/globals.css`，编程式使用同步读取 `src/design-tokens.ts`。业务代码使用 `bg-background`、`bg-card`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary` 等语义类；禁止在新代码中写 `text-slate-*`、`bg-white`、裸 hex 和任意 rgba 阴影。

| 类别 | 规则 |
| --- | --- |
| 颜色 | `primary` 使用黑色（暗色主题反相为白色）承担主操作和活动态；`success/warning/danger` 表示状态；`muted` 表示次要信息 |
| 字体 | 正文 14/20，辅助 13/18，页面标题 24/30，区块标题 18/26 |
| 间距 | 4px 基础单位；页面常用 16/24/32px |
| 圆角 | 4/6/8px；徽标可用圆形胶囊 |
| 边界 | 1px `border-border`；卡片默认无阴影 |
| 动效 | 150ms 颜色/透明度过渡，不使用大幅位移动效 |

## 页面模板

列表页按 `PageHeader`（标题和主 CTA）→ 指标（可选）→ `ListToolbar`（搜索与筛选）→ 列表排列。详情页按 `PageHeader` → 摘要/状态 → 主内容 → 辅助记录排列。页面容器由 `AppLayout` 控制，最大宽度 1440px，桌面内边距 32px，移动端 16px。

## 组件规则

基础交互进入 `src/components/ui`，业务组合进入 `src/components`，页面只负责数据和业务流程。Button、Input、Select 保持 40px 高度；按钮图标使用 `lucide-react`；图标按钮必须有可访问名称。不要把筛选、创建、退出等不同层级动作堆在同一个视觉容器中。

## 禁止项

- 不新增渐变背景、装饰性光晕或营销式 hero。
- 不使用 12px 以上圆角包裹卡片或页面区块。
- 不把每个段落都包成浮卡，不做卡片嵌套卡片。
- 不用颜色单独表达错误、成功或工作流阶段。
- 不在页面复制基础控件的 padding、边框、focus 样式。

## 质量门槛

改动共享组件后运行 `pnpm --filter flowx-web test` 和 `pnpm --filter flowx-web build`。涉及页面布局时检查 1440px、1024px、390px 三种宽度，确认标题、按钮、表格和空状态不溢出或重叠。
