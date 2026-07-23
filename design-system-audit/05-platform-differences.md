# 平台差异

## Web desktop

- `AppLayout` 使用 232px 固定侧栏，主画布最大 1440px。
- 桌面可以使用 hover、tooltip 和表格密度；焦点环必须保留。
- 弹层和下拉由 Radix 管理，不能依赖页面位置计算。

## Responsive Web / H5

- 1200px 以下侧栏转为顶部区域，导航入口保持单行横向滚动，页面内边距降至 16px。
- 表格容器必须 `overflow-x-auto`，按钮和输入保持至少 40px 高度。
- 尚未发现 safe-area、独立移动端路由或原生桥接证据；无法判断是否存在更深的 H5 适配需求。

## Android / iOS

未发现 `build.gradle`、`AndroidManifest.xml`、iOS target 或原生资源目录。本项目当前没有可审计的 Android/iOS 平台差异。
