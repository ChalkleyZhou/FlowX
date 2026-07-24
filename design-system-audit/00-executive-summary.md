# 设计系统审计摘要

## 范围

本次审计覆盖 `apps/web` Web 桌面管理台、前端基础组件、业务组合组件、列表页、工作流列表和工作流详情，以及对应的 API 列表边界。未发现独立的 Android、iOS 或小程序实现。

## 一句话判断

FlowX 已有一套可用的 shadcn/ui + Tailwind 组件和中性 B2B 管理台方向，但设计系统治理和交互基座尚未覆盖列表查询、分页、工作流状态工作台等高频产品能力。

现有 `Control Room` 视觉方向已经落地：中性画布、黑色主操作、语义化状态色、轻边框和较高信息密度。当前审计重点是把这套视觉基础延伸到可恢复的列表查询和可执行的工作流操作。

## 成熟度

整体：Medium-Low。

- Foundations：Medium。颜色、字体、间距和圆角已有 token，但文档与代码存在冲突。
- Components：Medium。基础组件和若干业务组合组件齐全，但缺少 Pagination、统一状态 Badge、列表查询和工作流操作栏。
- Interaction：Low。列表分页、URL 状态、筛选偏好和复杂状态反馈未形成公共模式。
- Governance：Low。已有前端规范，但没有明确 source of truth、采用度检查和视觉回归门禁。

原有视觉治理已在 `apps/web/docs/design-system.md` 明确 CSS/TS token、组件边界和 WCAG 2.2 AA 目标，但仍缺少完整组件状态文档、视觉回归和 token 漂移检查。

## Top risks

- 列表接口返回全量数组，数据增长后性能和可用性同时恶化。
- 工作流详情把多个用户任务和状态分支放入单页，容易误操作或遗漏待处理动作。
- `docs/frontend-shadcn-design-spec.md` 的蓝色/Avenir 描述与实际黑色/Inter 实现不一致。
- 筛选和分页状态不能可靠恢复，用户无法分享工作视图。

## Top opportunities

- 以“我的工作队列”作为产品入口，显著减少用户寻找待办的成本。
- 统一 `PageResult<T>`、URL query 和 `Pagination`，一次解决多个列表页问题。
- 将工作流改造成“当前阶段工作台”，突出一个主动作并保留上下文、审查和历史。

## 建议下一步

先完成 `docs/product-ux-review.md` 中的 P0：工作流、需求、问题、缺陷服务端分页和统一列表状态；随后再拆工作流详情，避免在旧页面结构上继续增加状态分支。
