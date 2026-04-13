## Context

FlowX 前端（`apps/web`）当前使用混合样式体系：shadcn/ui 的 HSL CSS 自定义属性（`globals.css`）与传统十六进制 CSS 变量（`App.css`）并存。组件和页面不统一地引用其中一个或两个系统，部分甚至在 JSX 中硬编码颜色/间距值。Tailwind 的 `darkMode: ['class']` 已配置但无暗色主题值，也无主题切换。结果是组件间视觉漂移、调整外观时维护成本高。

当前技术栈：React 19 + Vite + Tailwind CSS v3 + shadcn/ui 基础组件 + `tailwindcss-animate`。

`App.css` 包含约 500 行自定义样式，涵盖导航布局、品牌标识、Toast、分页、阶段展示等，均使用传统 CSS 变量和 `@media` 断点。

## Goals / Non-Goals

**Goals:**

- 所有视觉令牌的单一来源：`globals.css` 中的 HSL CSS 自定义属性，遵循 DTCG 命名规范
- 完整的亮色 + 暗色主题，带可用的切换（系统偏好 + 手动覆盖）
- 所有自定义组件仅使用令牌——无硬编码颜色、字号或魔法数字
- 一致的间距/排版/圆角/阴影比例，映射到 Tailwind 工具类
- 对现有视觉外观最小化干扰（迁移，而非重设计）

**Non-Goals:**

- 重新设计 UI 布局或组件结构
- 添加新页面或功能
- Storybook 或组件文档工具（本变更范围外）
- 服务端主题渲染或超出 `localStorage` 的每用户主题持久化
- 移动端优先的响应式重设计（仅修复令牌使用）

## Decisions

### 1. 合并为 HSL CSS 自定义属性体系（非十六进制变量）

**选择**：扩展现有 `globals.css` HSL 令牌体系为唯一来源；废弃 `App.css` 十六进制变量。

**理由**：Tailwind 和 shadcn/ui 已消费 HSL 令牌。`App.css` 的十六进制系统以不同格式重复了相同值。维护两套系统必然漂移。HSL 令牌也更容易操作（透明度、暗色模式）。

**备选方案**：
- 保留双系统并添加映射层——增加间接层，不解决漂移问题
- 迁移到 CSS-in-JS（styled-components、vanilla-extract）——对代码库规模过于 disruptive；Tailwind 在此工作良好

### 2. 使用轻量级 ThemeProvider（自定义 React 上下文）而非 `next-themes`

**选择**：实现约 40 行的 `ThemeProvider`，使用 React 上下文、`localStorage` 持久化和 `matchMedia` 系统偏好检测。

**理由**：`next-themes` 增加依赖且面向 Next.js 路由。FlowX 是 Vite SPA。实现极简，保持依赖树最小。

**备选方案**：
- `next-themes`——比需要的更重，面向 Next.js
- 无 Provider，仅切换 `.dark` 类——丢失持久化和系统偏好检测

### 3. 仅使用语义颜色令牌——组件代码中不使用原始调色板令牌

**选择**：定义语义令牌（`--primary`、`--success`、`--warning`、`--danger`、`--surface` 等）映射到调色板 HSL 值。组件仅使用语义令牌。原始调色板值（如 `--blue-600`）在 `globals.css` 中存在供参考，但不被组件代码直接消费。

**理由**：语义令牌允许暗色模式重映射含义（如 `--surface` 从白色翻转为深灰色）而不改变任何组件代码。原始调色板令牌会将亮色模式假设泄漏到组件中。

**备选方案**：
- 直接使用调色板值加条件暗色变体——Tailwind 类数量翻倍
- CSS-in-JS 主题对象——HSL + Tailwind 下不必要

### 4. 排版和间距令牌作为 Tailwind 扩展

**选择**：定义 `--font-size-{xs|sm|base|lg|xl|2xl}` 和 `--spacing-{1..16}` CSS 自定义属性，映射到 Tailwind 配置的 `fontSize` 和 `spacing` 下。令牌以 `text-sm`、`p-4` 等方式可用。

**理由**：保持 Tailwind 工具类的人体工学，同时强制令牌比例。无需学习自定义类名。

**备选方案**：
- 独立工具类（`.text-body`、`.space-4`）——偏离 Tailwind 惯例
- 无令牌，保持魔法数字——当前状态，已否决

### 5. 增量迁移——逐类迁移 App.css

**选择**：将 `App.css` 类逐步转为组件 JSX 中的 Tailwind 工具类，每迁移一个类即删除对应 CSS。`App.css` 清空后删除。

**理由**：一次性重写有破坏布局的风险。逐类迁移允许增量视觉验证。大多数 `App.css` 类是简单的布局/间距，直接映射到 Tailwind 工具类。

**备选方案**：
- 一次性重写——视觉回归风险高
- 保留 `App.css` 与令牌并存——延续双系统问题

### 6. 采用 DTCG 令牌命名格式

**选择**：令牌命名遵循 Design Tokens Community Group 规范，使用层级结构如 `--color-primary-default`、`--space-4`、`--font-size-sm`，保持与现有 shadcn/ui 约定兼容。

**理由**：DTCG 是设计令牌的行业标准，便于未来与设计工具（Figma Tokens、Style Dictionary）集成。shadcn/ui 的扁平命名（`--primary`）作为别名保留，确保向后兼容。

**备选方案**：
- 仅使用 shadcn/ui 扁平命名——缺少层级语义，不利于扩展
- 完全 DTCG 路径（`--color--primary--default`）——双连字符在 CSS 中不直观

## Risks / Trade-offs

- **[迁移过程中的视觉回归]** → 增量迁移，每步提交前视觉验证。迁移期间保持开发服务器运行。
- **[暗色模式颜色选择]** → 从 shadcn/ui 默认暗色调色板开始，保守策略；用户反馈后细化。暗色模式是增量的——亮色外观不变。
- **[新旧系统令牌命名冲突]** → 迁移期间，旧十六进制变量（`--primary: #2563eb`）与新 HSL 令牌（`--primary: 217.2 91.2% 59.8%`）同名但值格式不同。缓解：先迁移 `App.css` 引用，再删除 `App.css` 的 `:root` 块——`globals.css` 的 HSL `:root` 因层叠顺序已优先。
- **[JS 读取 CSS 变量的代码]** → 审计 `getComputedStyle` 调用；更新为解析 HSL 格式。当前无已知 JS 读取这些变量。
- **[DTCG 与 shadcn/ui 命名兼容性]** → DTCG 层级名作为主令牌，shadcn/ui 扁平名作为别名。两套均可使用，但组件代码应统一使用 Tailwind 语义类。
