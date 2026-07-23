---
name: FlowX Control Room
description: 面向 AI 研发流程的克制型工作台，使用中性画布、黑色主操作、深色导航和语义化状态色来支持高密度扫描与安全操作。
colors:
  primary: "hsl(0 0% 7%)"
  background: "hsl(220 20% 97%)"
  foreground: "hsl(222 47% 11%)"
  navigation: "hsl(222 47% 11%)"
typography:
  body:
    fontFamily: "Inter, system-ui, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
spacing:
  unit: "4px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
  card:
    borderRadius: "{rounded.md}"
    shadow: "none"
---

## Overview

FlowX 使用 `Control Room` 设计语言。它服务于反复扫描、比较、确认和追踪的研发管理操作，不使用营销式构图、渐变背景或装饰性浮卡。

## Visual Language

- 主画布保持中性；深色侧栏表达导航边界，黑色承担主操作、链接和活动指示。
- 暗色主题将主操作反相为白色，以维持 WCAG 对比度；这仍然属于同一 `primary` 语义。
- 颜色必须通过语义 token 使用：`primary`、`success`、`warning`、`danger`、`muted`。
- 圆角只使用 4/6/8px。状态徽标可以使用 `rounded-full`，卡片和页面区块不得使用大圆角。
- 卡片默认只有 1px 边框和无阴影。阴影仅用于弹层、悬浮菜单和需要脱离文档流的元素。
- 页面按 8px 网格组织；常规页面容器最大宽度为 1440px，桌面内边距 32px，移动端 16px。

## Colors

CSS source of truth 是 `apps/web/src/globals.css`，编程式 token 是 `apps/web/src/design-tokens.ts`。亮色主题的状态颜色必须满足文字可读性；暗色主题只调整变量，不在业务组件中复制 `dark:` 分支。

## Typography

正文 14px/20px，辅助信息 13px/18px，页面标题 24px/30px，区块标题 18px/26px。中文使用系统字体栈，标题保持中等字重，避免全大写和过度字距。

## Spacing and Layout

使用 Tailwind 语义类和现有页面模板。页面结构固定为 `PageHeader`、指标带（可选）、`ListToolbar`、内容区；新增操作放在页面标题区，不塞进筛选条。列表和详情优先使用单层边界，避免卡片套卡片。

## Components

- `Button`：主操作使用 `default`，次操作使用 `outline` 或 `secondary`，破坏性操作使用 `destructive`。
- `Badge`：只表示状态、范围或轻量分类，不承载按钮行为。
- `Card`：用于有边界的内容组或重复记录，不用于包裹整页装饰。
- `Input` / `Select` / `Textarea`：保持 40px 控件高度，标签、错误和帮助文本必须成组出现。
- `PageHeader` / `SectionHeader` / `MetricCard` / `RecordListItem`：页面级布局优先复用，不在 page 中复制视觉结构。
- 交互按钮使用 `lucide-react` 图标；图标按钮必须有 `aria-label` 或可见 tooltip。

## Accessibility

可聚焦元素必须有清晰的 `:focus-visible` 状态；点击目标至少 40px 高；状态不能只靠颜色表达；表格、表单和导航需要保留语义标签。默认目标为 WCAG 2.2 AA。

## Platform Notes

当前证据只覆盖 Web desktop 和 responsive Web。移动端使用同一语义 token，导航保持单行横向滚动，表格必须横向滚动，操作按钮不得因为内容压缩而变形。

## References

- 前端 SSOT：[apps/web/docs/design-system.md](apps/web/docs/design-system.md)
- 详细审计：[design-system-audit/00-executive-summary.md](design-system-audit/00-executive-summary.md)
- 布局约定：[docs/frontend-shadcn-design-spec.md](docs/frontend-shadcn-design-spec.md)
