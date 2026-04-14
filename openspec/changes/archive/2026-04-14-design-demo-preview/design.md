## Context

FlowX 的 Ideation 阶段当前流程：Brainstorm（产品简报）→ Design（DesignSpec 文本规格）→ Finalize。Design 阶段仅输出文本描述的 layout，用户无法感知视觉效果，导致设计方向无法在开发前验证。

目标仓库已通过 RepositorySyncService clone 到本地（`.flowx-data/workspaces/{id}/repositories/{name}/`），AI executor 通过 `buildRepositoryContext` 读取仓库上下文。现有 Deploy 模块支持 rokid-ops provider，可将代码推送到 OPS 平台部署并返回 `externalJobUrl`。

关键约束：Demo 必须基于目标仓库的组件和模式生成，而非 FlowX 自身的组件库。

## Goals / Non-Goals

**Goals:**
- Design 阶段 AI 生成基于目标仓库组件的可编译 Demo 页面代码
- Demo 代码写入目标仓库工作分支，通过现有部署链路部署获取预览 URL
- 用户在 IdeationDesignPanel 中可视觉预览并确认/修改 Demo
- 确认后的 Demo 代码作为后续 Execution 阶段的参考输入

**Non-Goals:**
- 不做本地 dev server 管理（预览完全走部署链路）
- 不做 Figma/设计工具集成
- 不做非前端项目的 Demo 预览（纯后端仓库降级为仅存储代码）
- 不做 Demo 页面的交互逻辑（仅视觉展示，无真实数据交互）
- 不做 Demo 代码直接复用到 Execution 的自动化（由 AI 在 Execution 阶段参考 Demo artifact）

## Decisions

### D1: Demo 代码生成与 DesignSpec 合并输出

AI executor 的 `generateDesign` 方法同时输出 `DesignSpec`（文本规格）和 `demoPages`（页面代码），而非拆分为两个独立阶段。

**理由**: DesignSpec 和 Demo 页面是同一设计意图的两种表达——前者是结构化描述，后者是可视化实现。拆分为两个阶段会引入额外的状态管理和部署等待，且用户需要确认两次相同的设计意图。合并后用户一次确认即可。

**替代方案**: 新增独立的 "Demo" 阶段（BRAINSTORM → DESIGN → DEMO → FINALIZE）——增加了流程复杂度和用户等待时间，未采纳。

### D2: Demo 部署复用现有 Deploy 模块

Demo 代码写入工作分支后，调用现有 `DeployService.createJob` 触发部署，复用 `RepositoryDeployConfig` 和 provider 体系。

**理由**: 已有完整的部署链路（commit → push → OPS → URL），无需自建预览基础设施。`DeployJobRecord` 已有 `externalJobUrl` 字段可直接用作预览地址。

**替代方案**: 本地启动 dev server 预览——需要端口管理、进程生命周期管理、npm install 等复杂基础设施，且预览环境与生产不一致，未采纳。

### D3: Demo 页面代码作为 IdeationArtifact 存储

Demo 页面代码存储为 `IdeationArtifact`（type: `DEMO_PAGE`），包含组件代码、mock 数据、建议文件路径和预览 URL。

**理由**: 复用现有 artifact 体系，无需新增 Prisma 模型。Demo 代码、mock 数据和预览 URL 作为同一 artifact 的 content 字段存储，保证数据一致性。

**替代方案**: 新增 `DemoPage` 模型——过度设计，Demo 数据的生命周期与 Ideation 绑定，无需独立模型。

### D4: 预览 URL 通过轮询获取

部署触发后，前端轮询 DeployJobRecord 状态，当 `status` 变为 `TRIGGERED` 且 `externalJobUrl` 有值时展示预览。

**理由**: OPS 平台部署是异步的，Webhook 回调需要公网可达的端点。轮询实现简单，Demo 预览对实时性要求不高（几秒到几分钟可接受）。

**替代方案**: Webhook 回调——需要公网端点和签名验证，MVP 阶段过重，后续可演进。

### D5: AI Prompt 改造策略

Design prompt 在现有基础上扩展：保持 DesignSpec 输出，新增 `demoPages` 输出要求。Prompt 中注入目标仓库的组件清单、Props 接口、页面模式样例，引导 AI 用目标仓库的真实组件生成代码。

**理由**: 最小改动原则——不破坏现有 DesignSpec 功能，仅扩展输出。目标仓库上下文已有 `buildRepositoryContext` 能力，只需增强 prompt 中的组件信息提取。

## Risks / Trade-offs

- **[部署耗时]** → Demo 部署可能需要数分钟，用户等待体验差。缓解：展示部署进度状态，提供"部署中..."动画和预计时间。
- **[目标仓库无法部署]** → 仓库未配置 RepositoryDeployConfig 或 provider 不可用时无法获取预览 URL。缓解：降级为仅存储 Demo 代码（代码视图），提示用户配置部署。
- **[AI 生成代码质量]** → Demo 页面可能无法直接编译或与目标仓库组件 API 不匹配。缓解：AI executor 已有 JSON schema 校验；可在写入前做基础语法检查。
- **[Demo 页面路由冲突]** → 写入目标仓库的 Demo 路由可能与现有路由冲突。缓解：使用带前缀的路由路径（如 `/flowx-demo/requirement-{id}`）。
