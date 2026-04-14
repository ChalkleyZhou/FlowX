## 1. 类型定义与接口扩展

- [x] 1.1 在 `apps/api/src/common/types.ts` 中扩展 `GenerateDesignOutput` 接口，新增 `demoPages?: DemoPage[]` 字段，定义 `DemoPage` 类型（componentCode, mockData, filePath）
- [x] 1.2 在 `apps/api/src/common/types.ts` 中扩展 `GenerateDesignInput` 接口，新增 `repositoryComponentContext?: RepositoryComponentContext` 字段，定义仓库组件上下文类型（componentFiles, propTypes, pageExamples, designTokens）

## 2. AI Prompt 改造

- [x] 2.1 改造 `apps/api/src/prompts/design-generation.prompt.ts`，扩展 user prompt 要求 AI 同时输出 `demoPages` 数组，包含可编译的页面组件代码和 mock 数据
- [x] 2.2 在 `apps/api/src/ai/codex-ai.executor.ts` 的 `buildDesignGenerationPrompt` 方法中注入目标仓库组件上下文（组件清单、Props 接口、页面样例、设计 token）
- [x] 2.3 在 `apps/api/src/ai/codex-ai.executor.ts` 中新增 `buildRepositoryComponentContext` 方法，从目标仓库 localPath 读取组件文件清单和关键 Props 接口
- [x] 2.4 更新 `apps/api/src/ai/mock-ai.executor.ts` 的 `generateDesign` 方法，返回包含 demoPages 的 mock 数据

## 3. Demo 代码写入工作分支

- [x] 3.1 在 `apps/api/src/requirements/requirements.service.ts` 中新增 `writeDemoPagesToRepo` 私有方法，接收 demoPages 数组和仓库信息，将组件代码写入 localPath 对应 filePath，执行 git commit
- [x] 3.2 在 `startDesign` 和 `reviseDesign` 方法中，AI 生成完成后调用 `writeDemoPagesToRepo`
- [x] 3.3 处理仓库不可写的降级逻辑：localPath 不存在或 syncStatus 非 READY 时跳过写入并记录警告日志

## 4. Demo 部署触发与预览 URL 管理

- [x] 4.1 在 `apps/api/src/requirements/requirements.service.ts` 中注入 `DeployService` 依赖
- [x] 4.2 新增 `triggerDemoDeploy` 私有方法，在 Demo 代码写入后调用 `DeployService.createJob` 触发部署，传入 repositoryId、工作分支名、commitSha
- [x] 4.3 处理仓库未配置部署的降级：enabled 为 false 时跳过部署，记录日志
- [x] 4.4 新增 `updateDemoPreviewUrl` 方法，部署后通过 DeployJobRecord.externalJobUrl 更新 IdeationArtifact 的 content.previewUrl

## 5. IdeationArtifact 存储扩展

- [x] 5.1 修改 `confirmDesign` 方法，在存储 DESIGN_SPEC artifact 的同时，存储 DEMO_PAGE artifact（包含 componentCode, mockData, filePath, previewUrl）
- [x] 5.2 修改 `reviseDesign` 后的确认流程，创建新的 DEMO_PAGE artifact（新 attempt），保留旧 artifact 用于历史追溯

## 6. Execution 阶段读取 Demo artifact

- [x] 6.1 在 `apps/api/src/workflow/workflow.service.ts` 的 Task Split 和 Plan 阶段构建 AI 输入时，查询需求的 DEMO_PAGE artifact 并注入上下文
- [x] 6.2 在 codex executor 的 `buildTaskSplitPrompt` 和 `buildPlanPrompt` 中加入 Demo 页面代码引用

## 7. 前端 API 与类型

- [x] 7.1 在 `apps/web/src/types.ts` 中扩展 IdeationArtifact 类型，支持 `DEMO_PAGE` 类型及其 content 结构（componentCode, mockData, filePath, previewUrl）
- [x] 7.2 在 `apps/web/src/api.ts` 中新增查询 Demo 部署状态的方法（getDemoDeployStatus）

## 8. 前端预览 UI

- [x] 8.1 改造 `IdeationDesignPanel`，新增 Demo 预览区域，当存在 previewUrl 时用 iframe 展示
- [x] 8.2 实现部署状态展示：部署中动画、已就绪、失败、未配置部署等状态
- [x] 8.3 实现预览状态轮询：AI 生成完成后每 3 秒查询部署状态，获取到 previewUrl 后停止，超时 5 分钟后提示
- [x] 8.4 实现降级展示：无 previewUrl 时展示 Demo 代码视图（语法高亮）和"新窗口打开"链接
- [x] 8.5 处理组件卸载时清除轮询 interval

## 9. 测试

- [x] 9.1 为 `GenerateDesignOutput` 扩展编写类型测试
- [x] 9.2 为 `writeDemoPagesToRepo` 编写单元测试（正常写入、仓库不可写降级）
- [x] 9.3 为 `triggerDemoDeploy` 编写单元测试（正常触发、未配置部署降级、部署失败）
- [x] 9.4 为 `confirmDesign` 的 DEMO_PAGE artifact 存储编写测试
- [x] 9.5 为前端 IdeationDesignPanel 预览区域编写组件测试
