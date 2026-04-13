## Why

当前前端存在两套冲突的 CSS 系统（`globals.css` 的 HSL 设计令牌与 `App.css` 的十六进制传统变量），导致组件样式不一致、硬编码颜色散落各处，且深色模式虽在 Tailwind 中配置但从未实现。缺少统一的设计体系使得每个新组件都需要临时决策，UI 难以维护和扩展。

## What Changes

- 将双 CSS 系统合并为单一 HSL 设计令牌层（`globals.css`），移除 `App.css` 传统变量
- 基于 DTCG（Design Tokens Community Group）格式定义完整的设计令牌集：颜色（亮色 + 暗色）、排版、间距、圆角、阴影、过渡
- 实现深色模式：`ThemeProvider` 组件、系统偏好检测、手动切换、`localStorage` 持久化
- 将所有自定义组件统一为仅使用设计令牌（消除硬编码颜色、间距和字号）
- 将 `App.css` 中的所有样式迁移为 Tailwind 工具类，最终删除 `App.css`
- 补充缺失的 shadcn/ui 组件（Tooltip、DropdownMenu、Skeleton 等）
- 创建 `design-tokens.ts` 导出文件，使令牌可在 JS/TS 中编程式访问
- 添加统一的焦点环、过渡动画和响应式模式

## Capabilities

### New Capabilities

- `design-tokens`: 基于 DTCG 格式的统一 HSL 令牌体系，覆盖颜色（语义 + 调色板）、排版、间距、圆角、阴影和过渡，包含亮色与暗色主题值
- `theme-provider`: 深色模式基础设施 — `ThemeProvider` 组件、`localStorage` 持久化、系统偏好检测、切换 UI、`useTheme` 钩子
- `component-migration`: 将所有自定义组件迁移至仅使用设计令牌，消除硬编码值，将 `App.css` 样式转为 Tailwind 工具类，最终删除 `App.css`

### Modified Capabilities

## Impact

- **`apps/web/src/globals.css`**: 重建为所有 CSS 自定义属性的单一来源；新增暗色主题 `.dark` 选择器
- **`apps/web/src/App.css`**: 逐步迁移后删除；所有样式迁移至基于令牌的 Tailwind 工具类
- **`apps/web/tailwind.config.ts`**: 更新以引用新的令牌结构（排版、间距映射）
- **`apps/web/src/components/`**: 所有 23 个自定义组件更新为使用令牌
- **`apps/web/src/pages/`**: 所有页面组件更新硬编码样式
- **`apps/web/src/components/ui/`**: 扩展额外的 shadcn/ui 组件
- **依赖**: 可能新增轻量级 React 上下文实现主题切换；无重大新依赖
