## ADDED Requirements

### Requirement: 所有自定义组件仅使用设计令牌
`apps/web/src/components/` 中的所有自定义组件 SHALL 引用设计令牌（通过 Tailwind 工具类或 CSS 自定义属性），而非硬编码颜色值、字号或魔法间距数字。

#### Scenario: 组件代码中无硬编码十六进制颜色
- **WHEN** 开发者在组件源文件中搜索十六进制颜色模式（`#[0-9a-fA-F]{3,8}`）
- **THEN** `components/` 下的 `.tsx` 文件中无匹配项（`ui/` 除外，由 shadcn 管理）

#### Scenario: 无内联样式颜色值
- **WHEN** 组件渲染时
- **THEN** 无 `style={{ color: '...' }}` 或 `style={{ backgroundColor: '...' }}` 属性包含原始颜色值；它们使用 CSS 自定义属性或 Tailwind 类

#### Scenario: 间距使用基于令牌的 Tailwind 类
- **WHEN** 组件应用 padding、margin 或 gap
- **THEN** 使用 Tailwind 间距工具类（如 `p-4`、`gap-3`）而非任意像素值

### Requirement: App.css 样式迁移为 Tailwind 工具类
`App.css` 中定义的所有 CSS 类 SHALL 迁移为组件 JSX 中的 Tailwind 工具类。迁移完成后 `App.css` SHALL 被删除。

#### Scenario: 布局类已迁移
- **WHEN** 迁移完成
- **THEN** `.app-nav-shell`、`.app-nav-sider`、`.app-main-layout`、`.page-container` 等布局类替换为组件 JSX 中等效的 Tailwind 工具类

#### Scenario: 品牌与排版类已迁移
- **WHEN** 迁移完成
- **THEN** `.app-brand`、`.flowx-logo-*`、`.eyebrow` 等排版相关类替换为 Tailwind 工具类和设计令牌

#### Scenario: 导航类已迁移
- **WHEN** 迁移完成
- **THEN** `.app-nav-link`、`.app-nav-link-active`、`.app-nav-menu` 等导航相关类替换为 Tailwind 工具类

#### Scenario: Toast 和会话类已迁移
- **WHEN** 迁移完成
- **THEN** `.toast-*`、`.session-*` 等组件类替换为 Tailwind 工具类或移入各自组件文件的作用域样式

#### Scenario: 响应式断点已迁移
- **WHEN** 迁移完成
- **THEN** `App.css` 中的 `@media` 断点替换为组件 JSX 中的 Tailwind 响应式前缀（`sm:`、`md:`、`lg:`、`xl:`）

#### Scenario: App.css 已删除
- **WHEN** 所有类已迁移
- **THEN** `App.css` 从项目中移除，且无导入引用残留

### Requirement: 统一焦点环模式
所有交互元素 SHALL 在键盘导航聚焦时显示使用 `--ring` 令牌的统一焦点环。

#### Scenario: 按钮和链接的焦点环
- **WHEN** 按钮或链接获得键盘焦点
- **THEN** 显示使用 `ring` 颜色令牌的可见焦点环

#### Scenario: 焦点环使用设计令牌
- **WHEN** 焦点环渲染时
- **THEN** 其颜色源自 `--ring` CSS 自定义属性，在暗色模式中自适应

### Requirement: 平滑主题过渡
主题变更（light ↔ dark）时，所有受影响元素 SHALL 平滑过渡而非突然切换。

#### Scenario: 主题过渡动画
- **WHEN** 用户切换主题
- **THEN** background-color、color、border-color 属性以约 150ms 的 ease 时间函数过渡

### Requirement: 组件内硬编码值审计
迁移完成后 SHALL 执行全量审计，确保无残留的硬编码颜色、间距或字号。

#### Scenario: 页面组件中无硬编码颜色
- **WHEN** 审计 `apps/web/src/pages/` 下的 `.tsx` 文件
- **THEN** 无硬编码十六进制颜色、`rgb()` 值或任意 Tailwind 颜色类（如 `text-slate-950`）；全部替换为语义令牌类

#### Scenario: 组件中无 Tailwind 任意值
- **WHEN** 审计组件文件中的 Tailwind 任意值语法（如 `text-[11px]`、`p-[14px]`）
- **THEN** 所有任意值替换为令牌化的 Tailwind 工具类或设计令牌引用
