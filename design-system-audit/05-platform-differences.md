# 平台差异

## Web desktop

Evidence：React + Vite、Tailwind、Radix/shadcn 风格组件、约 232px 固定侧栏和最大 1440px 主内容宽度。

建议：桌面端承担高密度列表、Diff 查看和工作流审查；应支持键盘导航、URL 可恢复状态、sticky 操作栏和 1280px 以上的双栏工作区。

## 窄屏 Web

Evidence：`AppLayout.tsx` 在较窄宽度把侧栏变为顶部横向布局，页面通过 Tailwind breakpoint 换行；当前没有 safe-area、独立移动路由或原生桥接证据。

建议：窄屏只保证“查看状态、完成主操作、处理筛选、返回列表”四条主路径；Diff 采用文件列表与查看器分层切换，筛选收进 Sheet/Popover，避免把桌面布局缩小后继续堆叠。

## Android / iOS / 小程序

未发现实现或平台资源，无法判断平台原生适配。若后续增加移动端，应复用业务状态和 API 契约，但不要直接复用桌面密度；工作流主操作应采用底部固定操作区，列表筛选采用移动端筛选面板。
