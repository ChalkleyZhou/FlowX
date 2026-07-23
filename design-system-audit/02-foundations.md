# 基础规范审计

## Colors

**Evidence**：`apps/web/src/globals.css`、`apps/web/src/design-tokens.ts`、`apps/web/tailwind.config.ts`。

**Findings**：新 token 使用中性背景和深色导航，黑色承担亮色主题主操作，暗色主题反相为白色；青绿色、琥珀色和红色用于不同状态。亮暗主题均通过 CSS 变量切换。

**Gaps**：历史页面仍有 `text-slate-*`、裸变量和任意颜色，需逐步迁移到语义类。

## Typography

**Evidence**：`globals.css` 中的字号和系统字体栈、共享标题组件。

**Findings**：正文 14/20，辅助 13/18，页面标题 24/30，区块标题 18/26；标题不再依赖大字重和过度字距。

**Gaps**：部分登录页和详情页存在手写 line-height/letter-spacing，需要收敛。

## Spacing and layout

**Evidence**：Tailwind spacing 映射、`AppLayout`、`PageHeader`、`ListToolbar`。

**Findings**：4px 基础单位，页面容器 1440px，桌面 32px、移动 16px 内边距，列表模板分离标题、筛选和内容。

**Gaps**：少数页面仍使用独立的任意 gap，需按模板迁移。

## Shape, depth and motion

**Evidence**：token、Card、Button、页面 class。

**Findings**：卡片上限 8px 圆角，默认 1px 边框无阴影；阴影只保留给弹层和交互浮层；动效以 150ms 颜色过渡为主。

**Gaps**：旧页面明确写入的 `shadow-[...]` 和 `backdrop-blur` 仍需清理。

## Accessibility

**Evidence**：`AppLayout` 导航、Button、全局 `:focus-visible`。

**Findings**：主导航增加图标和 `aria-label`，全局焦点环统一，按钮和表单控件保持 40px 高度。

**Gaps**：还没有自动化 contrast、键盘流和屏幕阅读器回归检查。
