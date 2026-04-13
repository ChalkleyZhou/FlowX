## ADDED Requirements

### Requirement: 统一的 HSL 令牌层
系统 SHALL 在 `globals.css` 中以 HSL CSS 自定义属性定义所有视觉设计令牌，作为唯一来源。`App.css` 中的传统十六进制 `:root` 块 SHALL 被移除。

#### Scenario: 亮色主题令牌定义完整
- **WHEN** `globals.css` 加载完成
- **THEN** `:root` 选择器定义了 HSL 自定义属性：background、foreground、primary、secondary、muted、accent、destructive、success、warning、border、input、ring、card、popover、surface、surface-subtle 及其前景色变体

#### Scenario: 暗色主题令牌定义完整
- **WHEN** `.dark` 选择器在根元素上激活
- **THEN** 所有语义令牌具有暗色模式 HSL 值，对比度满足 WCAG AA 标准

#### Scenario: App.css 十六进制变量已移除
- **WHEN** 迁移完成
- **THEN** `App.css` 不再包含带十六进制颜色变量的 `:root` 块，所有引用已替换

### Requirement: DTCG 令牌命名规范
系统 SHALL 遵循 DTCG（Design Tokens Community Group）命名规范定义令牌层级结构，同时为 shadcn/ui 兼容性保留扁平别名。

#### Scenario: DTCG 层级令牌存在
- **WHEN** `globals.css` 加载完成
- **THEN** 令牌使用层级命名如 `--color-primary-default`、`--color-success-default`、`--space-4`、`--font-size-sm`、`--radius-md`、`--shadow-md`

#### Scenario: shadcn/ui 扁平别名存在
- **WHEN** shadcn/ui 组件引用 `--primary`、`--background` 等扁平令牌
- **THEN** 这些别名指向对应的 DTCG 层级令牌值，确保向后兼容

### Requirement: 语义颜色令牌体系
系统 SHALL 定义语义颜色令牌以抽象原始调色板值。组件 SHALL 仅使用语义令牌，不使用原始调色板 HSL 值。

#### Scenario: 语义令牌覆盖所有 UI 状态
- **WHEN** 组件需要某用途的颜色
- **THEN** 存在对应的语义令牌（如 `--color-success` 表示正向状态、`--color-warning` 表示警示、`--color-danger` 表示破坏性操作、`--color-surface` 表示卡片背景、`--color-surface-subtle` 表示微弱背景）

#### Scenario: 暗色模式自动重映射语义令牌
- **WHEN** `.dark` 类在根元素上激活
- **THEN** 语义令牌自动解析为暗色适配值，无需修改任何组件代码

### Requirement: 排版比例令牌
系统 SHALL 定义排版比例作为 CSS 自定义属性并映射到 Tailwind 的 `fontSize` 配置。

#### Scenario: 排版令牌已定义
- **WHEN** `globals.css` 加载完成
- **THEN** 存在 `--font-size-xs`（12px）、`--font-size-sm`（13px）、`--font-size-base`（14px）、`--font-size-lg`（16px）、`--font-size-xl`（18px）、`--font-size-2xl`（24px）及对应行高令牌

#### Scenario: Tailwind 工具类使用排版令牌
- **WHEN** 开发者在组件中编写 `text-sm`
- **THEN** font-size 解析为 `--font-size-sm` 令牌值

### Requirement: 间距比例令牌
系统 SHALL 定义间距比例作为 CSS 自定义属性并映射到 Tailwind 的 `spacing` 配置。

#### Scenario: 间距令牌已定义
- **WHEN** `globals.css` 加载完成
- **THEN** 存在间距步长令牌（如 `--space-1` 到 `--space-16`，4px 递增）

#### Scenario: Tailwind 间距工具类使用令牌
- **WHEN** 开发者在组件中编写 `p-4`
- **THEN** padding 解析为 `--space-4` 令牌值

### Requirement: 圆角与阴影令牌
系统 SHALL 定义圆角和阴影令牌作为 CSS 自定义属性（部分已存在），确保在亮色/暗色模式下完整且一致。

#### Scenario: 圆角令牌存在
- **WHEN** `globals.css` 加载完成
- **THEN** `--radius-sm`、`--radius-md`、`--radius-lg` 已定义并被 Tailwind 的 `borderRadius` 配置消费

#### Scenario: 阴影令牌包含暗色模式变体
- **WHEN** `.dark` 类激活
- **THEN** 阴影令牌使用适合暗色背景的更暗 rgba 值

### Requirement: 过渡令牌
系统 SHALL 定义主题切换过渡令牌，确保亮暗切换时平滑过渡。

#### Scenario: 过渡令牌已定义
- **WHEN** `globals.css` 加载完成
- **THEN** `--transition-theme` 令牌存在（值如 `150ms ease`），用于 background-color、color、border-color 的过渡

### Requirement: 编程式令牌导出
系统 SHALL 将设计令牌导出为 TypeScript 模块（`design-tokens.ts`），使令牌可在 CSS 自定义属性不可用的场景（如图表颜色、Canvas 渲染）中使用。

#### Scenario: 令牌作为 TS 常量导出
- **WHEN** 开发者从 `design-tokens.ts` 导入
- **THEN** 语义颜色值、间距值和排版值作为类型化常量可用

#### Scenario: 导出令牌与 CSS 保持同步
- **WHEN** `globals.css` 中的令牌值更新
- **THEN** `design-tokens.ts` 中的对应导出 MUST 同步更新（文档标注为手动同步点）
