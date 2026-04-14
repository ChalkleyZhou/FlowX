## ADDED Requirements

### Requirement: AI 生成基于目标仓库组件的 Demo 页面代码

Design 阶段的 AI executor MUST 在输出 DesignSpec 的同时，输出 `demoPages` 数组。每个 demoPage MUST 包含 `componentCode`（完整的页面组件源码）、`mockData`（组件所需的模拟数据）和 `filePath`（建议写入目标仓库的文件路径）。AI MUST 读取目标仓库的组件清单、Props 接口和页面模式样例，使用目标仓库真实的 import 路径和组件 API 生成代码。

#### Scenario: 成功生成 Demo 页面代码
- **WHEN** 用户在 BRAINSTORM_CONFIRMED 状态下启动 Design
- **THEN** AI executor 输出包含 `design`（DesignSpec）和 `demoPages` 数组的结果，每个 demoPage 的 `componentCode` 使用目标仓库实际存在的组件 import 路径

#### Scenario: 目标仓库无前端框架
- **WHEN** 目标仓库的 package.json 中不包含任何前端框架依赖（react/vue/angular 等）
- **THEN** AI 不生成 `demoPages`，仅输出 `design`（DesignSpec），Design 阶段正常完成

### Requirement: Design Prompt 注入目标仓库组件上下文

`buildDesignGenerationPrompt` MUST 在现有 prompt 基础上注入目标仓库的组件信息上下文，包含：组件文件清单、关键组件的 Props 接口定义、1-2 个典型页面的源码样例、设计 token 摘要。上下文 MUST 通过 `buildRepositoryContext` 获取，复用已有的仓库读取能力。

#### Scenario: 注入组件上下文后生成 Demo
- **WHEN** 目标仓库包含前端组件（如 `src/components/**/*.tsx`）
- **THEN** prompt 中包含组件清单、Props 接口和页面样例，AI 生成的 Demo 代码使用这些组件的真实 import 路径和 API

#### Scenario: 仓库上下文为空
- **WHEN** 目标仓库尚未完成 grounding 或 contextSnapshot 为空
- **THEN** prompt 中不注入组件上下文，AI 仅基于产品简报生成 DesignSpec，不生成 demoPages

### Requirement: Demo 代码写入目标仓库工作分支

Design 阶段生成 Demo 后，系统 MUST 将 Demo 页面代码写入目标仓库的工作分支（使用现有 RepositorySyncService 管理的 localPath）。写入位置 MUST 使用 `filePath` 字段指定的路径。写入后 MUST git commit，commit message 包含 requirement ID 和 "demo" 标识。

#### Scenario: 写入 Demo 代码到工作分支
- **WHEN** AI 成功生成 demoPages 且目标仓库 localPath 可用
- **THEN** 系统将每个 demoPage 的 componentCode 写入 localPath 下对应的 filePath，执行 git add + git commit

#### Scenario: 目标仓库不可写
- **WHEN** 目标仓库 localPath 不存在或 syncStatus 不是 READY
- **THEN** 系统跳过文件写入，Demo 代码仅存储为 IdeationArtifact，日志记录警告

### Requirement: Demo 页面存储为 IdeationArtifact

确认设计时，系统 MUST 将 demoPages 数据存储为 `IdeationArtifact`（type: `DEMO_PAGE`），content 字段 MUST 包含 `componentCode`、`mockData`、`filePath` 和 `previewUrl`（部署后填充）。

#### Scenario: 确认设计时存储 Demo artifact
- **WHEN** 用户确认设计（confirmDesign）
- **THEN** 系统创建 IdeationArtifact，type 为 `DEMO_PAGE`，content 包含完整的 demoPages 数据

#### Scenario: 修改设计时更新 Demo artifact
- **WHEN** 用户修改设计（reviseDesign）并重新确认
- **THEN** 系统创建新的 IdeationArtifact（新 attempt），旧 artifact 保留用于历史追溯

### Requirement: Demo 代码作为 Execution 阶段的参考输入

确认后的 Demo 页面代码 MUST 通过 IdeationArtifact 在后续工作流中可被 AI executor 读取。Task Split 和 Technical Plan 阶段的 AI prompt 中 MUST 包含已确认的 Demo artifact 引用，使 AI 能够基于 Demo 代码拆分任务和制定计划。

#### Scenario: Task Split 阶段读取 Demo artifact
- **WHEN** 工作流进入 Task Split 阶段，且需求存在已确认的 DEMO_PAGE artifact
- **THEN** AI executor 的输入包含 Demo 页面代码和 mock 数据，AI 基于此拆分任务

#### Scenario: 无 Demo artifact 时正常执行
- **WHEN** 工作流进入 Task Split 阶段，需求无 DEMO_PAGE artifact
- **THEN** Task Split 按现有逻辑执行，不受影响
