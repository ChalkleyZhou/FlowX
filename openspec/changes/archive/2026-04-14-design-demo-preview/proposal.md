## Why

Design 阶段当前只输出文本描述的 layout（如 `[顶部导航] [侧边栏] [主内容区]`），用户无法看到产品长什么样，导致视觉方向无法在开发前锁定。这使 Design 阶段形同虚设——缺少可感知的视觉产出，产品不是一个可用的"构思→设计→开发"闭环。

## What Changes

- Design 阶段 AI 除输出 DesignSpec 外，同时生成基于目标仓库组件和模式的 Demo 页面代码（真实可编译的 React/Vue 等组件）
- Demo 页面代码写入目标仓库工作分支，通过现有部署链路（OPS 平台）部署，获取预览 URL
- IdeationDesignPanel 新增预览区域，iframe 展示部署后的 Demo 页面
- 用户可通过预览 URL 视觉确认设计方向，确认后 Demo 代码作为 Execution 阶段的参考输入
- 支持修改反馈循环：用户对 Demo 不满意可提供反馈，AI 重新生成并重新部署

## Capabilities

### New Capabilities
- `demo-generation`: AI 基于目标仓库上下文生成 Demo 页面代码的能力，包含 prompt 改造、输出结构扩展、artifact 存储和部署触发
- `demo-preview`: Demo 页面部署后的预览展示能力，包含预览 URL 管理、iframe 渲染、部署状态追踪

### Modified Capabilities

## Impact

- **AI Executor**: `generateDesign` 方法需扩展输出结构，增加 `demoPages` 字段；prompt 需改造为输出可编译代码
- **Ideation 流程**: `startDesign` / `confirmDesign` / `reviseDesign` 需增加 Demo 代码写入工作分支、触发部署、获取预览 URL 的逻辑
- **Deploy 模块**: 复用现有部署能力，可能需要支持 Demo 专用部署配置（如预览环境）
- **前端**: `IdeationDesignPanel` 需新增预览区域（iframe / URL 展示 / 部署状态指示）
- **数据模型**: `IdeationArtifact` 需支持 Demo 代码和预览 URL 的存储
- **Prisma**: 无新增模型，复用 `IdeationArtifact` 和 `DeployJobRecord`
