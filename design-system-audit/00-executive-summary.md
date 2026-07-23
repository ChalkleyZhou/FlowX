# 设计系统审计摘要

## 范围

审计覆盖 `apps/web` 的 React/Vite/Tailwind 前端、全局 token、基础 UI、共享业务组件、App Shell、页面模板和现有设计文档。当前没有发现可访问的 Storybook、Figma 导出物或正式视觉截图。

## 结论

现有代码有 token 和 shadcn 组件骨架，但没有形成真正的 source of truth：历史页面曾大量通过高圆角、渐变和任意阴影覆盖基础层，且 AGENTS 声明的 `docs/design-system.md` 缺失。成熟度：**2/5，基础存在但治理失效**。

本次先建立 `Control Room` 方向，并改造全局 token、基础组件、页面模板和导航壳层。主色已从蓝色改为黑色，暗色主题反相为白色以保证可读性；它能立刻统一大多数页面的底色、密度、圆角和交互反馈。

## Top risks

- token 值在 CSS、TypeScript、页面任意 class 之间重复，修改主题容易产生漂移。
- 全部业务模块依赖同一组 Page/Record 组件，旧的视觉覆盖仍会影响细节一致性。
- 缺少可视化回归和组件文档，移动端溢出风险无法由单元测试覆盖。

## Top opportunities

- 通过共享模板和语义 token，一次修改即可覆盖大部分管理台页面。
- 以导航、列表、详情、工作流四个模板建立稳定信息层级。
- 增加浏览器截图基线和无障碍检查，降低后续回归成本。
