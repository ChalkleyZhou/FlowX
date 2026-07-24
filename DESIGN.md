---
name: FlowX Control Room
description: 面向 AI 研发流程的克制型工作台，使用中性画布、黑色主操作、深色导航和语义化状态色来支持高密度扫描与安全操作。
colors:
  primary: "hsl(0 0% 7%)"
  background: "hsl(220 20% 97%)"
  foreground: "hsl(222 47% 11%)"
  navigation: "hsl(222 47% 11%)"
  success: "hsl(158 64% 38%)"
  warning: "hsl(31 92% 45%)"
  danger: "hsl(0 72% 51%)"
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
  list-page:
    structure: "PageHeader + ListToolbar + RecordList + Pagination"
  workflow-page:
    structure: "DetailHeader + ActionBar + StageRail + current-stage workspace"
---

## Overview

FlowX 使用 `Control Room` 设计语言。它服务于反复扫描、比较、确认和追踪的研发管理操作，不使用营销式构图、渐变背景或装饰性浮卡。它同时是研发流程控制平面，界面应帮助用户定位待处理事项、理解当前状态、完成下一步决策，并追溯上下文和证据。

## Visual Language

采用中性画布、轻边框、有限状态色和较高信息密度。深色侧栏表达导航边界，黑色承担亮色主题主操作；暗色主题将主操作反相为白色。主色、状态色和间距优先使用 `apps/web/src/globals.css` 与 `apps/web/src/design-tokens.ts` 中的语义 token。页面容器最大宽度为 1440px，桌面内边距 32px，移动端 16px。

## Layout

列表页统一使用 `PageHeader + ListToolbar + RecordList + Pagination`。详情页突出当前任务和主操作，长流程使用阶段导航与渐进式展开，避免把所有阶段堆在同一长页面。

## Components

优先复用 `components/ui/*` 和现有业务组合组件。`Button`、`Input`、`Select`、`Textarea` 保持约 40px 控件高度；图标按钮需要 `aria-label` 或 tooltip。新增列表或工作流能力应优先沉淀为 `Pagination`、`ListQueryState`、`WorkflowActionBar`、`WorkflowStageRail` 等组合能力，不在页面内复制状态判断和布局。

## Interaction

搜索、筛选、排序和分页进入 URL；个人默认偏好进入按用户和组织隔离的 `localStorage`。每个工作流状态只有一个明确的主动作，运行、失败、待确认和人工审查必须提供不同的反馈和恢复路径。

## Accessibility

按钮和状态必须有语义名称，键盘可以访问阶段导航和分页，焦点状态清晰，颜色不能作为状态的唯一表达。点击目标至少 40px；加载、错误、空数据和权限状态都必须有可读文本，默认目标为 WCAG 2.2 AA。

## Platform Notes

当前证据覆盖 Web desktop 和 responsive Web。窄屏导航可保持单行横向滚动，但复杂表格和 Diff 必须采用适合窄屏的分层视图，不能只压缩桌面布局。

## References

- 产品与交互方案：[docs/product-ux-review.md](docs/product-ux-review.md)
- Web 设计系统：[apps/web/docs/design-system.md](apps/web/docs/design-system.md)
- 详细设计系统审计：[design-system-audit/00-executive-summary.md](design-system-audit/00-executive-summary.md)
- 现有前端规范：[docs/frontend-shadcn-design-spec.md](docs/frontend-shadcn-design-spec.md)
