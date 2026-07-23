# 组件清单

## Navigation

| 组件 | 源码 | 状态/缺口 |
| --- | --- | --- |
| `AppLayout` | `apps/web/src/components/AppLayout.tsx` | 桌面固定侧栏、移动横向导航、活动态、紧凑用户区；窄屏入口保持单行可滚动 |
| `FlowXLogo` | `apps/web/src/components/FlowXLogo.tsx` | 有 sm/md/lg；SVG 仍含渐变，属于品牌例外，需补品牌规范 |

## Inputs and actions

| 组件 | 源码 | 状态/缺口 |
| --- | --- | --- |
| `Button` | `apps/web/src/components/ui/button.tsx` | default/secondary/outline/ghost/destructive，sm/md/lg/icon；需增加 loading 约定 |
| `Input` | `apps/web/src/components/ui/input.tsx` | 40px、placeholder、disabled、focus；错误态由调用方表达 |
| `Select` | `apps/web/src/components/ui/select.tsx` | Radix、键盘选择、滚动；需补错误和空选项模式 |
| `Tabs` | `apps/web/src/components/ui/tabs.tsx` | Radix tabs；视觉仍有旧高圆角覆盖 |

## Data display

| 组件 | 源码 | 状态/缺口 |
| --- | --- | --- |
| `Card` | `apps/web/src/components/ui/card.tsx` | 默认边框无阴影，适合内容组；历史调用方仍可能覆盖视觉 |
| `Badge` | `apps/web/src/components/ui/badge.tsx` | default/secondary/success/warning/destructive/outline；状态语义明确 |
| `MetricCard` | `apps/web/src/components/MetricCard.tsx` | 紧凑指标、可选帮助文本；无 loading skeleton |
| `RecordListItem` | `apps/web/src/components/RecordListItem.tsx` | 标题、徽标、详情、操作、hover；可继续补 selected/disabled |
| `EmptyState` | `apps/web/src/components/EmptyState.tsx` | 标题、描述、动作；缺少 loading/error 对照态 |

## Layout composition

`PageHeader`、`SectionHeader`、`ListToolbar`、`FilterBar` 形成列表和详情模板。页面不应直接复制这些组件内部的边框、padding 和 focus 规则。
