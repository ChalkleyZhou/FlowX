# FlowX Design System

本文件是 FlowX 前端设计体系的唯一来源（Single Source of Truth）。所有视觉相关开发必须遵循此规范，禁止使用令牌以外的硬编码值。

---

## 1. 颜色体系

### 1.1 语义颜色

语义颜色是组件代码中唯一允许使用的颜色引用方式。禁止直接使用调色板值或硬编码 hex/rgb。

| 令牌名 | 用途 | 亮色 | 暗色 | Tailwind 类 |
|---|---|---|---|---|
| **Primary** | 主操作、当前选中、品牌强调 | ![#3B82F6](https://via.placeholder.com/16/3B82F6/3B82F6) `hsl(217.2, 91.2%, 59.8%)` | ![#6398F8](https://via.placeholder.com/16/6398F8/6398F8) `hsl(217.2, 91.2%, 68%)` | `text-primary` `bg-primary` `border-primary` |
| **Primary Foreground** | 主色上的文字 | ![#F8FAFB](https://via.placeholder.com/16/F8FAFB/F8FAFB) `hsl(210, 40%, 98%)` | ![#1A1F2E](https://via.placeholder.com/16/1A1F2E/1A1F2E) `hsl(222.2, 47.4%, 11.2%)` | `text-primary-foreground` |
| **Primary Soft** | 主色浅底（标签底色、头像底） | ![#DBEAFE](https://via.placeholder.com/16/DBEAFE/DBEAFE) `hsl(217.2, 91.2%, 94%)` | ![#1E3A5F](https://via.placeholder.com/16/1E3A5F/1E3A5F) `hsl(217.2, 91.2%, 18%)` | `bg-primary-soft` |
| **Danger** | 破坏性操作、错误状态 | ![#DC2626](https://via.placeholder.com/16/DC2626/DC2626) `hsl(0, 72.2%, 50.6%)` | ![#CF4444](https://via.placeholder.com/16/CF4444/CF4444) `hsl(0, 62%, 55%)` | `text-danger` `bg-danger` |
| **Success** | 成功、完成、正向状态 | ![#16A34A](https://via.placeholder.com/16/16A34A/16A34A) `hsl(142, 71%, 45%)` | ![#22C55E](https://via.placeholder.com/16/22C55E/22C55E) `hsl(142, 71%, 52%)` | `text-success` `bg-success` |
| **Warning** | 警示、等待确认 | ![#D97706](https://via.placeholder.com/16/D97706/D97706) `hsl(38, 92%, 50%)` | !#[#E8A317](https://via.placeholder.com/16/E8A317/E8A317) `hsl(38, 92%, 56%)` | `text-warning` `bg-warning` |
| **Background** | 页面底色 | ![#F4F7FB](https://via.placeholder.com/16/F4F7FB/F4F7FB) `hsl(210, 40%, 98%)` | ![#0C0F18](https://via.placeholder.com/16/0C0F18/0C0F18) `hsl(222.2, 47.4%, 7%)` | `bg-background` |
| **Foreground** | 正文文字 | ![#0F172A](https://via.placeholder.com/16/0F172A/0F172A) `hsl(222.2, 47.4%, 11.2%)` | ![#F8FAFB](https://via.placeholder.com/16/F8FAFB/F8FAFB) `hsl(210, 40%, 98%)` | `text-foreground` |
| **Muted** | 次要底色、分割区域 | ![#F1F5F9](https://via.placeholder.com/16/F1F5F9/F1F5F9) `hsl(210, 40%, 96.1%)` | ![#1E293B](https://via.placeholder.com/16/1E293B/1E293B) `hsl(217.2, 33%, 17%)` | `bg-muted` |
| **Muted Foreground** | 辅助说明文字 | ![#64748B](https://via.placeholder.com/16/64748B/64748B) `hsl(215.4, 16.3%, 46.9%)` | ![#94A3B8](https://via.placeholder.com/16/94A3B8/94A3B8) `hsl(215.4, 16.3%, 63%)` | `text-muted-foreground` |
| **Card** | 卡片、面板底色 | ![#FFFFFF](https://via.placeholder.com/16/FFFFFF/FFFFFF) `hsl(0, 0%, 100%)` | ![#151A27](https://via.placeholder.com/16/151A27/151A27) `hsl(222.2, 47.4%, 10%)` | `bg-card` `text-card-foreground` |
| **Surface** | 浮层底色（Toast、弹窗） | ![#FFFFFF](https://via.placeholder.com/16/FFFFFF/FFFFFF) `hsl(0, 0%, 100%)` | ![#151A27](https://via.placeholder.com/16/151A27/151A27) `hsl(222.2, 47.4%, 10%)` | `bg-surface` |
| **Surface Subtle** | 微弱区分底色 | ![#FAFBFD](https://via.placeholder.com/16/FAFBFD/FAFBFD) `hsl(210, 40%, 99%)` | ![#1A1F2E](https://via.placeholder.com/16/1A1F2E/1A1F2E) `hsl(222.2, 47.4%, 12%)` | `bg-surface-subtle` |
| **Border** | 边框、分割线 | ![#E2E8F0](https://via.placeholder.com/16/E2E8F0/E2E8F0) `hsl(214.3, 31.8%, 91.4%)` | ![#1E293B](https://via.placeholder.com/16/1E293B/1E293B) `hsl(217.2, 33%, 17%)` | `border-border` |
| **Border Strong** | 强调边框（hover 状态） | ![#CBD5E1](https://via.placeholder.com/16/CBD5E1/CBD5E1) `hsl(214.3, 31.8%, 80%)` | ![#334155](https://via.placeholder.com/16/334155/334155) `hsl(217.2, 33%, 25%)` | `border-border-strong` |
| **Ring** | 焦点环 | ![#3B82F6](https://via.placeholder.com/16/3B82F6/3B82F6) `hsl(217.2, 91.2%, 59.8%)` | ![#6398F8](https://via.placeholder.com/16/6398F8/6398F8) `hsl(217.2, 91.2%, 68%)` | `ring-ring` |

### 1.2 颜色使用规则

| 规则 | 正确 | 错误 |
|---|---|---|
| 文字颜色 | `text-foreground`、`text-muted-foreground` | `text-slate-950`、`text-[#0f172a]` |
| 背景颜色 | `bg-card`、`bg-muted`、`bg-background` | `bg-white`、`bg-slate-50` |
| 边框颜色 | `border-border` | `border-slate-200` |
| 语义状态 | `text-success`、`bg-danger` | `text-green-600`、`bg-red-500` |
| 焦点环 | `focus-visible:ring-2 focus-visible:ring-ring` | 自定义焦点色 |

---

## 2. 排版体系

字体栈：`"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`

| 令牌名 | 字号 | 行高 | 用途 | Tailwind 类 |
|---|---|---|---|---|
| **xs** | 12px | 16px | 标签文字、Eyebrow、辅助标注 | `text-xs` |
| **sm** | 13px | 18px | 次要说明、列表副文本 | `text-sm` |
| **base** | 14px | 20px | 正文、表单标签、按钮 | `text-base` |
| **lg** | 16px | 24px | 小标题、卡片标题 | `text-lg` |
| **xl** | 18px | 28px | 页面副标题、品牌名 | `text-xl` |
| **2xl** | 24px | 32px | 页面主标题 | `text-2xl` |

### 2.1 字重

| 名称 | 值 | 用途 |
|---|---|---|
| Regular | 400 | 正文 |
| Semibold | 600 | 标签、导航、小标题 |
| Bold | 700 | Eyebrow、强调文字 |
| Extrabold | 800 | 品牌 Wordmark |

### 2.2 排版组合模式

| 模式 | 令牌组合 | 用途 |
|---|---|---|
| **Eyebrow** | `text-xs font-semibold uppercase tracking-[0.08em] text-primary` | 段落标签（如 "Workflow Steps"） |
| **卡片标题** | `text-2xl font-bold tracking-tight text-foreground` | 大号标题 |
| **正文** | `text-base text-foreground` | 普通段落文字 |
| **辅助说明** | `text-sm text-muted-foreground` | 描述、次级信息 |

---

## 3. 间距体系

4px 基础网格。所有间距必须使用以下令牌，禁止硬编码像素值。

| 令牌 | 值 | Tailwind | 典型用途 |
|---|---|---|---|
| space-1 | 4px | `p-1` `gap-1` | 图标与文字间距 |
| space-2 | 8px | `p-2` `gap-2` | 列表项间距 |
| space-3 | 12px | `p-3` `gap-3` | 卡片内紧凑间距 |
| space-4 | 16px | `p-4` `gap-4` | 卡片内标准间距 |
| space-5 | 20px | `p-5` `gap-5` | 区段间距 |
| space-6 | 24px | `p-6` `gap-6` | 页面级间距 |
| space-7 | 28px | `p-7` `gap-7` | 页面容器 padding |
| space-8 | 32px | `p-8` `gap-8` | 大区段间距 |

> space-9 至 space-16（36px–64px）用于特殊场景，日常开发不常用。

---

## 4. 圆角体系

| 令牌 | 值 | Tailwind | 用途 |
|---|---|---|---|
| **sm** | 10px | `rounded-sm` | 小按钮、Badge、输入框 |
| **md** | 14px | `rounded-md` | 卡片、导航项、弹窗 |
| **lg** | 18px | `rounded-lg` | 大面板、Toast |

---

## 5. 阴影体系

| 令牌 | 亮色值 | 暗色值 | Tailwind | 用途 |
|---|---|---|---|---|
| **sm** | `0 1px 2px rgba(15,23,42,0.04)` | `0 1px 2px rgba(0,0,0,0.2)` | `shadow-sm` | 卡片默认 |
| **md** | `0 12px 32px rgba(15,23,42,0.06)` | `0 12px 32px rgba(0,0,0,0.3)` | `shadow-md` | Toast、悬浮层 |
| **lg** | `0 24px 48px rgba(15,23,42,0.08)` | `0 24px 48px rgba(0,0,0,0.4)` | `shadow-lg` | 弹窗 |

---

## 6. 交互规范

### 6.1 焦点环

所有可交互元素（按钮、链接、输入框）必须添加焦点环：

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
```

### 6.2 过渡动画

主题切换过渡统一使用：

```
transition-colors
```

数值源自 `--transition-theme: 150ms ease`。

### 6.3 Hover 状态

| 元素 | 亮色 Hover | 暗色 Hover |
|---|---|---|
| 导航链接 | `hover:bg-surface-subtle hover:text-foreground` | 同左 |
| 卡片（可交互） | `hover:border-border-strong hover:bg-muted/40` | 同左 |
| 按钮 Primary | `hover:bg-foreground/90` | 同左 |
| 按钮 Outline | `hover:bg-muted hover:text-foreground` | 同左 |

---

## 7. 暗色模式

- 主题切换三态：`light` → `dark` → `system`
- 偏好存储于 `localStorage` 键 `flowx-theme`
- 使用 `useTheme()` 钩子读取/修改主题
- 防闪烁：`index.html` 内联脚本在首次绘制前应用 `.dark` 类

**开发规范**：禁止为暗色模式单独写 `dark:` 变体类。所有暗色适配通过 CSS 自定义属性在 `globals.css` 的 `.dark` 选择器中完成，组件代码无需感知当前主题。

---

## 8. 开发红线

以下行为被视为违规，PR Review 必须打回：

| 违规 | 示例 | 正确做法 |
|---|---|---|
| 硬编码颜色 | `text-[#0f172a]`、`bg-white` | 使用语义令牌 `text-foreground`、`bg-card` |
| 使用非语义 Tailwind 色板 | `text-slate-950`、`bg-slate-50`、`border-slate-200` | `text-foreground`、`bg-muted`、`border-border` |
| 硬编码字号 | `text-[11px]`、`text-[28px]` | `text-xs`、`text-2xl` |
| 硬编码间距 | `p-[14px]`、`gap-[18px]` | `p-3.5`、`gap-[18px]` 仅当令牌无法表达时使用任意值 |
| 使用 App.css 变量 | `text-[var(--text)]` | `text-foreground` |
| 直接使用调色板令牌 | `text-[var(--color-primary-default)]` | `text-primary` |

---

## 9. 令牌参考表

### CSS 自定义属性 → Tailwind 映射

| CSS 变量 | Tailwind 类 |
|---|---|
| `--color-primary-default` | `text-primary` / `bg-primary` / `border-primary` |
| `--color-primary-foreground` | `text-primary-foreground` / `bg-primary-foreground` |
| `--color-success-default` | `text-success` / `bg-success` |
| `--color-warning-default` | `text-warning` / `bg-warning` |
| `--color-danger-default` | `text-danger` / `bg-danger` |
| `--color-background` | `bg-background` |
| `--color-foreground` | `text-foreground` |
| `--color-muted-default` | `bg-muted` |
| `--color-muted-foreground` | `text-muted-foreground` |
| `--color-card-default` | `bg-card` |
| `--color-card-foreground` | `text-card-foreground` |
| `--color-surface-default` | `bg-surface` |
| `--color-surface-subtle` | `bg-surface-subtle` |
| `--color-border` | `border-border` |
| `--color-border-strong` | `border-border-strong` |
| `--color-ring` | `ring-ring` |
| `--font-size-xs` ~ `--font-size-2xl` | `text-xs` ~ `text-2xl` |
| `--space-1` ~ `--space-16` | `p-1` ~ `p-16` / `gap-1` ~ `gap-16` |
| `--radius-sm` / `--radius-md` / `--radius-lg` | `rounded-sm` / `rounded-md` / `rounded-lg` |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | `shadow-sm` / `shadow-md` / `shadow-lg` |

---

> 本文档由 `globals.css` 和 `tailwind.config.ts` 中的令牌值生成。当 CSS 令牌更新时，此文档必须同步更新。
