# 基础规范审计

## Colors

Evidence：`apps/web/src/globals.css`、`apps/web/src/design-tokens.ts`、`apps/web/tailwind.config.ts`。

Findings：实际主题是中性冷白背景、白色 surface、黑色 primary、灰色文本，并有 success、warning、danger、teal accent。状态色语义基本清楚，适合研发控制台。

Gaps：`docs/frontend-shadcn-design-spec.md` 声明“唯一主色：蓝色系”，但代码实际 primary 为黑色；必须选择代码或文档作为 source of truth，并做视觉回归。

历史页面仍可能存在硬编码颜色和 `dark:` 覆盖，应逐步迁移到语义类。

## Typography

Evidence：`globals.css` 使用 `Inter, ui-sans-serif, system-ui`；`design-tokens.ts` 定义 12/13/14/16/18/24px 尺寸和对应行高。

Findings：尺寸层级适合密集管理台，中文回退字体也已提供。

Gaps：前端规范写的是 Avenir Next，与代码不一致；标题、表格正文、辅助文本的实际采用度没有自动检查。

## Spacing and Layout

Evidence：token 使用 4px 到 64px 的间距；`AppLayout` 使用固定侧栏和受限主内容宽度；`docs/frontend-shadcn-design-spec.md` 定义列表页和详情页模板。

Findings：布局基础稳定，页面已有 `PageHeader`、`ListToolbar`、`Card` 等复用能力。

Gaps：工作流详情内容过长；列表筛选、分页和结果状态没有形成统一布局组件；窄屏导航改为顶部横向滚动，复杂页面仍需实际浏览器验证。

## Shape, Border and Shadow

Evidence：圆角为 4/6/8px，边框和轻阴影 token 已存在。

Findings：适合 B2B 控制台，不依赖重阴影。

Gaps：规范对卡片圆角的描述与实际 token 名称关系不够明确，页面仍有大量局部 class 组合，缺少组件采用度统计。

卡片默认应保持 1px 边框、无阴影；阴影仅用于弹层和脱离文档流的浮层。

## Motion and Feedback

Evidence：token 只有主题过渡；页面使用 Spinner、Toast、Dialog 和轮询。

Findings：已有基础反馈组件，工作流详情存在静默刷新和本地执行轮询。

Gaps：没有统一 skeleton、请求中保留布局、错误恢复、离线/连接断开和轮询更新时间模式。

## Iconography

Evidence：`lucide-react` 在导航和按钮中使用。

Findings：图标来源统一，导航语义清晰。

Gaps：复杂操作按钮仍以文字为主，危险操作和更多菜单的图标/tooltip 约定未形成公共组件。

## Accessibility and Localization

Evidence：全局有 `focus-visible` ring，部分图标按钮提供 `aria-label`，页面文案以中文为主。

Findings：基础焦点反馈和中文界面已有基础。

Gaps：分页、工作流阶段导航、状态变更和实时执行反馈的键盘/屏幕阅读器语义尚未统一；颜色不是唯一状态表达需要纳入验收。

当前目标为 WCAG 2.2 AA；点击目标建议至少 40px。
