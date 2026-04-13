## ADDED Requirements

### Requirement: ThemeProvider 组件
系统 SHALL 提供 `ThemeProvider` React 组件包裹应用，管理当前主题（light、dark 或 system）。

#### Scenario: ThemeProvider 包裹应用
- **WHEN** 应用挂载
- **THEN** `ThemeProvider` 在根层级渲染，为所有后代组件提供主题上下文

#### Scenario: 系统偏好检测
- **WHEN** localStorage 中无主题偏好且系统偏好暗色模式（`prefers-color-scheme: dark`）
- **THEN** 应用 SHALL 以暗色主题渲染

#### Scenario: 手动主题覆盖
- **WHEN** 用户通过切换器显式选择主题
- **THEN** 所选主题 SHALL 优先于系统偏好，`.dark` 类 SHALL 相应地添加或移除

### Requirement: 主题持久化
系统 SHALL 将用户主题偏好持久化到 `localStorage`，使其在页面刷新和浏览器重启后保留。

#### Scenario: 主题偏好已保存
- **WHEN** 用户选择主题
- **THEN** 偏好保存到 `localStorage`（键名如 `flowx-theme`）

#### Scenario: 加载时恢复主题偏好
- **WHEN** 应用加载且 `localStorage` 中存在主题偏好
- **THEN** 存储的偏好 SHALL 被应用，覆盖系统偏好

#### Scenario: 防止主题闪烁
- **WHEN** 应用加载时 `localStorage` 中存储了暗色主题偏好
- **THEN** `.dark` 类 SHALL 在首次绘制前应用（通过 `index.html` 中的内联脚本），防止亮色主题闪烁

### Requirement: 主题切换 UI
系统 SHALL 提供可从应用外壳（侧边栏或顶栏）访问的主题切换控件。

#### Scenario: 切换器切换主题
- **WHEN** 用户点击主题切换器
- **THEN** 主题在 light → dark → system 间循环，图标/标签更新为当前状态

#### Scenario: 切换器反映当前主题
- **WHEN** 当前主题为 dark
- **THEN** 切换器图标显示太阳（或等效的"切换到亮色"指示器）

#### Scenario: 切换器位于侧边栏
- **WHEN** 侧边栏可见
- **THEN** 主题切换器渲染在侧边栏底部区域，与现有导航布局一致

### Requirement: useTheme 钩子
系统 SHALL 导出 `useTheme` 钩子，返回当前主题状态和设置器，使任何组件可读取或修改主题。

#### Scenario: 钩子返回当前主题
- **WHEN** 组件调用 `useTheme()`
- **THEN** 返回 `{ theme, setTheme }`，其中 `theme` 为 `'light' | 'dark' | 'system'`，`setTheme` 可更新主题

#### Scenario: 钩子在 ThemeProvider 外使用时报错
- **WHEN** `useTheme()` 在 `ThemeProvider` 外部调用
- **THEN** SHALL 抛出描述性错误，提示组件必须包裹在 `ThemeProvider` 中

### Requirement: 系统偏好实时响应
系统 SHALL 监听系统主题偏好的实时变化，当用户在操作系统级别切换主题时自动适配。

#### Scenario: 系统偏好实时切换
- **WHEN** 应用主题设置为 system 且用户在操作系统中切换明暗偏好
- **THEN** 应用 SHALL 自动跟随系统偏好切换主题
