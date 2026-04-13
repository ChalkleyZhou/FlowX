## 1. 设计令牌基础

- [x] 1.1 在 `globals.css` `:root` 中定义完整的亮色主题 DTCG 层级令牌——添加缺失的语义令牌（`--color-success`、`--color-success-foreground`、`--color-warning`、`--color-warning-foreground`、`--color-danger`、`--color-danger-foreground`、`--color-surface`、`--color-surface-foreground`、`--color-surface-subtle`）
- [x] 1.2 为所有 DTCG 层级令牌创建 shadcn/ui 扁平别名（如 `--primary: var(--color-primary-default)`），确保现有组件无破坏
- [x] 1.3 在 `globals.css` `.dark` 选择器中定义暗色主题 DTCG 令牌——所有语义令牌使用满足 WCAG AA 对比度的暗色适配值
- [x] 1.4 在 `globals.css` 中添加排版比例令牌（`--font-size-xs` 到 `--font-size-2xl` 及对应行高）
- [x] 1.5 在 `globals.css` 中添加间距比例令牌（`--space-1` 到 `--space-16`，4px 递增）
- [x] 1.6 在 `.dark` 选择器中添加暗色阴影令牌（`--shadow-sm`、`--shadow-md`、`--shadow-lg` 使用更暗 rgba 值）
- [x] 1.7 添加过渡令牌 `--transition-theme: 150ms ease` 用于主题切换
- [x] 1.8 更新 `tailwind.config.ts`，将新排版、间距和阴影令牌映射到 Tailwind 的 `fontSize`、`spacing` 和 `boxShadow` 配置
- [x] 1.9 创建 `apps/web/src/design-tokens.ts`，将所有令牌值导出为类型化常量供 JS/TS 使用

## 2. ThemeProvider 实现

- [x] 2.1 创建 `apps/web/src/components/theme-provider.tsx`，包含 React 上下文、`ThemeProvider` 组件和 `useTheme` 钩子
- [x] 2.2 实现 `localStorage` 持久化（键名 `flowx-theme`），挂载时读取、变更时写入
- [x] 2.3 通过 `matchMedia('(prefers-color-scheme: dark)')` 实现系统偏好检测，并监听实时变化
- [x] 2.4 在 `ThemeProvider` 中实现 `.dark` 类切换逻辑——在 `document.documentElement` 上添加/移除
- [x] 2.5 在 `index.html` 中添加内联脚本，防止加载时主题闪烁（读取 localStorage，首次绘制前应用 `.dark`）
- [x] 2.6 在 `App.tsx` 中用 `ThemeProvider` 包裹应用根组件

## 3. 主题切换 UI

- [x] 3.1 创建 `ThemeToggle` 组件，包含太阳/月亮图标和三态循环（light → dark → system）
- [x] 3.2 将 `ThemeToggle` 放置在侧边栏底部区域（`AppLayout.tsx` 或等效导航组件）
- [x] 3.3 为 `useTheme` 添加守卫——在 `ThemeProvider` 外部调用时抛出描述性错误

## 4. App.css 迁移——布局与导航

- [x] 4.1 将 `.app-nav-shell` 和 `.app-nav-sider` 布局类迁移为 `AppLayout.tsx` 中的 Tailwind 工具类
- [x] 4.2 将 `.app-main-layout` 迁移为 Tailwind 工具类
- [x] 4.3 将 `.app-brand` 和 `.flowx-logo-*` 排版/布局类迁移为 `FlowXLogo.tsx` 中的 Tailwind 工具类
- [x] 4.4 将 `.app-nav-link` 和 `.app-nav-link-active` 迁移为基于令牌的 Tailwind 工具类
- [x] 4.5 将 `.app-nav-menu` 和 `.app-nav-footer` 迁移为 Tailwind 工具类
- [x] 4.6 将 `.session-avatar` 和 `.session-panel` 类迁移为 Tailwind 工具类

## 5. App.css 迁移——页面与组件

- [x] 5.1 将 `.page-container` 迁移为页面组件中的 Tailwind 工具类
- [x] 5.2 将 `.pagination-*` 类迁移为 Tailwind 工具类
- [x] 5.3 将 `.toast-*` 类迁移为 Toast 组件中的 Tailwind 工具类
- [x] 5.4 将 `.stage-*` 和 `.record-list-*` 类迁移为工作流组件中的 Tailwind 工具类
- [x] 5.5 将 `.eyebrow` 及排版工具类迁移为使用排版令牌的 Tailwind 工具类
- [x] 5.6 将 `App.css` 中的 `@media` 响应式断点迁移为组件 JSX 中的 Tailwind 响应式前缀

## 6. 组件令牌审计与清理

- [x] 6.1 搜索 `components/` 下所有 `.tsx` 文件中的硬编码十六进制颜色，替换为基于令牌的 Tailwind 类
- [x] 6.2 搜索所有 `.tsx` 文件中带原始值的内联 `style={{ color/backgroundColor }}`，替换为令牌引用
- [x] 6.3 搜索所有 `.tsx` 文件中的 Tailwind 任意值语法（`text-[11px]`、`p-[14px]` 等），替换为令牌化的 Tailwind 工具类
- [x] 6.4 搜索所有 `.tsx` 文件中的非语义 Tailwind 颜色类（如 `text-slate-950`、`border-slate-200`），替换为语义令牌类
- [x] 6.5 为所有交互元素（按钮、链接、输入框）添加统一的 `focus-visible:ring-2 focus-visible:ring-ring`
- [x] 6.6 为受主题切换影响的元素添加 `transition-colors` 类（使用 `--transition-theme` 时长）
- [x] 6.7 删除 `App.css` 并从入口文件中移除其导入

## 7. 验证

- [x] 7.1 运行 `pnpm --filter flowx-web build` 验证无构建错误
- [x] 7.2 运行 `pnpm --filter flowx-web test` 验证所有测试通过
- [x] 7.3 视觉验证：亮色模式外观与迁移前基线一致
- [x] 7.4 视觉验证：暗色模式在所有页面上正确渲染，对比度适当
- [x] 7.5 视觉验证：主题切换器正确循环，刷新后偏好保留
- [x] 7.6 视觉验证：页面加载无错误主题闪烁
- [x] 7.7 运行 `pnpm check` 执行完整项目验证
