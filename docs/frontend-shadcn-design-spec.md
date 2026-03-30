# FlowX 前端主题与设计系统规范

> 适用范围：`/Users/chalkley/workspace/FlowX/apps/web`
>
> 目标：将 FlowX 前端稳定维护在 `shadcn/ui + Tailwind CSS` 的设计系统范式下，保证视觉统一、组件边界清晰、页面可持续迭代。

## 1. 当前状态

FlowX 前端已经完成以下基础重构：

- 已移除 `Ant Design`
- 基础交互组件已切换到 `shadcn/ui` 风格组件
- 主路径页面已切换到 `Card / CardHeader / CardContent` 等组合范式
- 页面区域样式正在从全局 `App.css` 回收到组件级和页面级

这份文档不再描述“迁移计划”，而是定义当前应长期遵守的设计规范。

## 2. 设计目标

### 2.1 产品气质

- 面向 B2B 研发协作场景
- 克制、专业、稳定
- 统一而不单调
- 默认即生产可用，不做 demo 风装饰

### 2.2 设计原则

- `Consistency > creativity`
- `Hierarchy > decoration`
- `Spacing > color`
- `Composition > ad-hoc CSS`
- `Token first, page second`

### 2.3 非目标

- 不引入营销官网式视觉语言
- 不引入大面积渐变、重阴影、强装饰
- 不为了“好看”破坏业务密度和可读性
- 不重新发明一套独立于 `shadcn/ui` 的组件系统

## 3. Token 体系

## 3.1 主题来源

全局主题 token 分两层：

1. `globals.css`
   - 作为 `shadcn/ui` 主题源
   - 提供 HSL 语义变量，驱动 Tailwind 和基础组件

2. `App.css`
   - 作为应用壳层语义变量
   - 仅补充页面壳、导航壳、toast 和少量全局区域语义色

### 文件位置

- [globals.css](/Users/chalkley/workspace/FlowX/apps/web/src/globals.css)
- [tailwind.config.ts](/Users/chalkley/workspace/FlowX/apps/web/tailwind.config.ts)
- [App.css](/Users/chalkley/workspace/FlowX/apps/web/src/App.css)

## 3.2 shadcn 基础 token

来自 [globals.css](/Users/chalkley/workspace/FlowX/apps/web/src/globals.css)：

- `--background`: 页面基础背景
- `--foreground`: 主文本色
- `--card`: 卡片背景
- `--card-foreground`: 卡片文本色
- `--popover`
- `--popover-foreground`
- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`
- `--muted`
- `--muted-foreground`
- `--accent`
- `--accent-foreground`
- `--destructive`
- `--destructive-foreground`
- `--border`
- `--input`
- `--ring`

## 3.3 应用语义 token

来自 [App.css](/Users/chalkley/workspace/FlowX/apps/web/src/App.css)：

- `--bg`: 应用级页面背景
- `--surface`: 主卡片背景
- `--surface-subtle`: 轻分组背景
- `--surface-muted`: 次级淡背景
- `--text`: 主文本
- `--text-secondary`: 次级文本
- `--text-tertiary`: 弱提示文本
- `--border`: 默认边框
- `--border-strong`: 强一点的边框
- `--primary`
- `--primary-hover`
- `--primary-soft`
- `--success`
- `--warning`
- `--danger`
- `--shadow-sm`
- `--shadow-md`
- `--shadow-lg`
- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--page-width`

## 3.4 使用规则

- 优先使用 `globals.css` 中的 shadcn token 作为基础组件来源
- 业务页面不要直接写死颜色值
- 页面里确实需要语义色时，优先引用已有 token
- 新增 token 必须先判断是：
  - 基础设计 token
  - 应用壳语义 token
  - 某个页面临时样式

不要把页面临时样式升级成全局 token

## 4. 颜色规范

### 4.1 主色

- 唯一主色：蓝色系
- 用途：
  - 当前导航项
  - 主按钮
  - 关键强调信息
  - 少量状态高亮

### 4.2 中性色

- 页面背景偏冷白
- 卡片以白底和极浅灰底为主
- 文本层级通过深浅区分，不通过多色区分

### 4.3 状态色

- `success`: 仅用于成功态和完成态
- `warning`: 仅用于提醒态
- `danger`: 仅用于错误、风险、破坏性操作

### 4.4 禁止项

- 同一页面多主色并存
- 高饱和彩色标签泛滥
- 大面积渐变面板
- 把状态色当装饰色使用

## 5. 排版规范

### 5.1 字体栈

当前全局字体栈定义在 [App.css](/Users/chalkley/workspace/FlowX/apps/web/src/App.css)：

```text
"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif
```

后续若要更换字体栈，必须整站统一替换，不允许局部页面自行设置。

### 5.2 文本层级

- Page Title
  - 用于页面主标题
  - 强调当前模块，不写 slogan
- Section Title
  - 用于卡片区块标题
- Card Title
  - 用于单个业务卡标题
- Body
  - 用于正文和主要信息
- Secondary
  - 用于说明、补充信息、统计说明
- Eyebrow
  - 用于小标签、组标题、模块类别

### 5.3 文案规则

- 页面标题只表达当前模块，不叠加宣传语
- 区块说明只补充上下文，不重复标题
- 状态文案优先可执行、可理解
- 避免写“控制台”“工作台”式泛词，除非页面确实需要

## 6. 圆角、边框、阴影

### 6.1 圆角

- `sm`: 小型控件
- `md`: 输入框、按钮、badge
- `lg`: 卡片、对话框、面板

规则：

- 不使用 `rounded-full` 作为默认状态块
- 仅胶囊型 badge 或特殊状态标签可用圆胶囊
- 面板圆角统一偏大，形成 SaaS 产品质感

### 6.2 边框

- 默认使用轻边框强调结构
- hover 通过边框和浅背景变化体现
- 不依赖重阴影区分层级

### 6.3 阴影

- 普通卡片：轻阴影
- 模态框和悬浮反馈：中阴影
- 避免所有区域都浮起来

## 7. Spacing 规范

基于 `8px` 节奏：

- `4`
- `8`
- `12`
- `16`
- `20`
- `24`
- `32`

### 页面级 spacing

- `page-container` 作为主内容区，必须保有真实内边距
- 页面内主区块之间需要明确垂直间距
- 指标卡与主内容之间的间距，不应小于列表项内部间距

### 组件级 spacing

- 卡片头和卡片正文必须区分
- 表单 label 和 field 之间保持稳定间距
- 操作区按钮之间统一使用固定 gap

### 禁止项

- 组件之间直接贴边
- 靠多个临时 margin 修对齐
- 同类型列表页 spacing 不一致

## 8. 布局规范

## 8.1 App Shell

当前全局布局由 [AppLayout.tsx](/Users/chalkley/workspace/FlowX/apps/web/src/components/AppLayout.tsx) 驱动。

### 布局结构

- 左侧固定导航
- 右侧主内容区
- 用户信息固定在侧边栏底部
- 不再保留单独顶部工具条

### 侧边栏规范

- 宽度稳定
- 导航项轻量化，不额外套一层装饰背景卡
- 当前项通过背景、边框和文字颜色区分
- 用户信息区放在导航底部，不打断主内容

### 主内容区规范

- 使用 `page-container`
- 必须有真实 padding
- 宽度受 `--page-width` 限制
- 页面之间统一纵向节奏

## 8.2 页面模板

### 列表页

```text
PageHeader
Metrics（可选）
Filter / Actions
RecordList
Pagination
```

### 详情页

```text
DetailHeader
Metrics（可选）
Main Card / Form
Context Card
```

### 工作流页

```text
DetailHeader
Summary Metrics
Steps
Current Stage
Diff Review
Review Findings
Repository Context
```

## 8.3 响应式规则

- `>= 1440px`
  - 标准桌面密度
- `1280px - 1439px`
  - 收紧壳层留白
- `< 1280px`
  - 导航改成顶部块状布局
  - 页面容器 padding 收紧
- 小笔记本宽度优先保证：
  - 不横向溢出
  - 卡片正常换行
  - 操作区自然折行

## 9. 组件层级规范

## 9.1 基础层：`components/ui/*`

这是唯一的基础 UI 层。

当前已落地的关键组件包括：

- `button`
- `input`
- `textarea`
- `select`
- `dialog`
- `card`
- `badge`
- `separator`
- `spinner`
- `toast`
- `alert`
- `tabs`
- `scroll-area`
- `section-heading`

规则：

- 新的基础交互能力优先补进 `components/ui/*`
- 不允许在业务页面里重新造基础按钮、输入框、badge

## 9.2 业务组合层：`components/*`

这一层只做组合，不重新发明设计语言。

当前稳定组件包括：

- `PageHeader`
- `DetailHeader`
- `ContextPanel`
- `MetricCard`
- `RecordListItem`
- `RepositoryBranchCard`
- `ReviewFindingCard`
- `DiffFileListPanel`
- `DiffViewerPanel`
- `WorkflowSteps`
- `StageCard`
- `EmptyState`
- `StatPill`

规则：

- 优先组合 `Card / CardHeader / CardContent / CardTitle / CardDescription`
- 避免把一个业务组件再次包成“万能视觉壳”
- 组件内部优先用 Tailwind utility class
- 组件内部样式无法表达时，再考虑局部 CSS

## 9.3 页面层：`pages/*`

页面层的职责：

- 组织模块结构
- 管理数据请求和状态
- 使用组件组合页面

页面层不应承担：

- 重复定义基础按钮样式
- 重复定义卡片视觉体系
- 在页面里堆大量全局 class 名

## 10. 样式边界规范

这是未来最重要的一条约束。

## 10.1 `globals.css` 负责什么

- shadcn 主题变量
- Tailwind base layer
- 真正全局的 element reset

## 10.2 `App.css` 负责什么

仅负责以下内容：

- App Shell
- 导航壳层
- `page-container`
- toast 这类跨页面公共层
- 极少数无法用 utility class 简洁表达的全局结构

`App.css` 不应该再负责：

- 单个页面的表单布局
- 单个页面的 diff viewer 结构
- 某个业务模块的局部 spacing
- 某个组件的视觉细节

## 10.3 组件文件负责什么

- 组件自己的布局和视觉表达
- 该组件内部的 Tailwind class
- 与组件绑定的状态样式

## 10.4 页面文件负责什么

- 页面局部区域布局
- 某个页面专属的网格、分栏、空状态位置

## 11. 组合规范

### 11.1 卡片类区域

所有主要面板优先使用：

- `Card`
- `CardHeader`
- `CardTitle`
- `CardDescription`
- `CardContent`

不再鼓励：

- `div` 外面套一层边框，再手写标题结构

### 11.2 操作按钮

- 页面只保留一个主 CTA
- 次级操作使用 outline / ghost
- 危险操作统一 destructive

### 11.3 状态表达

- 状态优先用 `Badge`
- 统计优先用 `StatPill`
- 不用随意定义新的状态块形态

### 11.4 列表项

- 列表项优先用 `RecordListItem`
- 仓库信息优先用 `RepositoryBranchCard`
- 审查问题优先用 `ReviewFindingCard`

## 12. 页面实施约束

未来新增或重构页面时，必须遵守：

1. 先判断是否已有可复用组件
2. 再决定是否需要扩展 `components/ui/*`
3. 再决定是否新增业务组合组件
4. 最后才允许页面内写局部结构

### 禁止项

- 重新引入新的重型组件库
- 在页面里新增大块 `foo-*` 的全局类
- 为一个页面临时发明一套视觉规则
- 用大量 `App.css` 类去兜组件内部布局

## 13. 评审清单

每次前端 UI 改动，至少检查以下问题：

### 设计系统一致性

- 是否优先复用了 `ui/*`
- 是否优先复用了现有业务组件
- 是否新增了不必要的视觉壳组件

### 样式边界

- 样式是否应该写在组件里而不是 `App.css`
- 页面是否引入了新的全局类依赖
- 是否出现重复 token 或硬编码颜色

### 布局质量

- `page-container` 是否有稳定 padding
- 页面区块之间是否有明确间距
- 小屏笔记本宽度下是否仍然稳定

### 视觉层级

- 标题、说明、正文、辅助文本是否清晰分层
- 操作按钮优先级是否明确
- 状态表达是否统一

## 14. 后续维护建议

下一阶段建议继续做两件事：

1. 为稳定组件补充更细的使用约定
   - 什么时候用 `RecordListItem`
   - 什么时候用 `RepositoryBranchCard`
   - 什么时候直接用 `Card`

2. 定期回扫 `App.css`
   - 如果某段样式只服务于单个页面或单个组件，应继续回收

## 15. 一句话约束

FlowX 前端以后应坚持：

**用 `shadcn/ui` 做基础，用组合组件搭页面，用页面局部 class 处理局部布局，而不是再回到“大一统 App.css + 页面随手写样式”的模式。**
