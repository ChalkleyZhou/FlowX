# 工作区 / 需求 / 工作流关系梳理与并行化改造建议

## 1. 当前模型怎么连

当前系统的主链路是：

`Workspace -> Requirement -> WorkflowRun`

辅助链路是：

`Workspace -> Repository`

`WorkflowRun -> WorkflowRepository`

其中 `WorkflowRepository` 不是独立的项目范围定义，而是 `WorkflowRun` 启动时从 `Workspace.repositories` 整体复制出来的工作副本。

### 1.1 当前实体职责

- `Workspace`
  - 同时承担“项目容器”“仓库集合”“需求归属边界”三种职责
- `Requirement`
  - 只能直接归属于一个 `Workspace`
- `WorkflowRun`
  - 只能直接归属于一个 `Requirement`
  - 启动时默认继承该 `Requirement.workspace` 下的全部仓库
- `Issue / Bug`
  - 也继续沿用 `workspaceId + requirementId + workflowRunId` 这条单链路归档

### 1.2 代码中的硬约束

- `Requirement.workspaceId` 直接绑定工作区
  - [prisma/schema.prisma](/Users/chalkley/workspace/FlowX/prisma/schema.prisma#L10)
- `Workspace` 直接拥有 `requirements`
  - [prisma/schema.prisma](/Users/chalkley/workspace/FlowX/prisma/schema.prisma#L26)
- `WorkflowRun` 只绑定一个 `requirementId`
  - [prisma/schema.prisma](/Users/chalkley/workspace/FlowX/prisma/schema.prisma#L165)
- 创建需求时必须提供 `workspaceId`
  - [create-requirement.dto.ts](/Users/chalkley/workspace/FlowX/apps/api/src/requirements/dto/create-requirement.dto.ts#L1)
  - [requirements.service.ts](/Users/chalkley/workspace/FlowX/apps/api/src/requirements/requirements.service.ts#L9)
- 创建工作流时只允许传 `requirementId`
  - [create-workflow-run.dto.ts](/Users/chalkley/workspace/FlowX/apps/api/src/workflow/dto/create-workflow-run.dto.ts#L1)
- 一个需求只能有一个未结束工作流
  - [workflow.service.ts](/Users/chalkley/workspace/FlowX/apps/api/src/workflow/workflow.service.ts#L81)
- 工作流仓库范围默认等于工作区全部仓库
  - [workflow.service.ts](/Users/chalkley/workspace/FlowX/apps/api/src/workflow/workflow.service.ts#L126)
  - [workflow.service.ts](/Users/chalkley/workspace/FlowX/apps/api/src/workflow/workflow.service.ts#L1187)
- 前端创建需求时也只让用户选择工作区
  - [RequirementsPage.tsx](/Users/chalkley/workspace/FlowX/apps/web/src/pages/RequirementsPage.tsx#L117)
- 前端工作流筛选维度只有工作区和需求
  - [WorkflowRunsPage.tsx](/Users/chalkley/workspace/FlowX/apps/web/src/pages/WorkflowRunsPage.tsx#L33)

## 2. 现在为什么不满足“多项目、多需求并行”

### 2.1 `Workspace` 被设计得过重

当前 `Workspace` 既像“业务项目”，又像“代码仓库分组”，还像“需求池”。这样会导致：

- 一个业务项目下如果要拆前端、后端、运营后台、基础设施等多个并行子项目，只能继续堆在同一个 `Workspace`
- 一个需求如果只改其中 1 到 2 个仓库，工作流仍会继承整个工作区的仓库上下文
- 同一批仓库如果服务多个项目域，就只能靠复制 `Workspace` 或者让一个工作区变得越来越臃肿

### 2.2 `Requirement` 不是“工作项”，只是“挂在工作区下的一条需求”

它缺少几个并行管理必需的信息：

- 没有项目维度
- 没有父子需求 / 史诗 / 子任务关系
- 没有依赖关系
- 没有优先级、负责人、排期、状态流等面向执行管理的字段
- 没有仓库范围选择

结果是系统能记录“有这个需求”，但还不能表达“这条需求和另外几条需求一起组成同一个项目迭代，并且分别推进到不同仓库”。

### 2.3 `WorkflowRun` 是“单需求、整工作区、单活跃流”

这是当前并行能力的最大瓶颈：

- 一个 `WorkflowRun` 只服务一个 `Requirement`
- 一个 `Requirement` 只能有一个进行中的 `WorkflowRun`
- 一个 `WorkflowRun` 会默认复制工作区全部仓库

这意味着系统只能很好支持：

- 一个工作区里录很多需求
- 但每条需求按单线程方式推进

它不擅长支持：

- 同一项目下多条需求同时执行
- 一个需求拆成多个并行实施流
- 一个跨前后端需求按仓库分流执行
- 多个项目共享仓库池但独立排期

### 2.4 `Issue / Bug` 的归档链路也过于单线

当前沉淀对象主要挂在：

- `workspaceId`
- `requirementId`
- `workflowRunId`

这会让后续这些场景变难：

- 问题属于“项目”但不属于单个需求
- 问题由多个需求交叉触发
- 问题应该回落到“仓库模块 / 能力域 / 版本线”

## 3. 本质问题：缺了“项目”和“范围”两个一等实体

要支持多项目、多需求并行，至少要把下面两个概念从当前模型中解耦出来：

### 3.1 Project

表示一个真实的业务或研发交付单元。

它不应该等价于 `Workspace`。

它需要承载：

- 项目名称、描述、状态
- 项目负责人
- 项目周期 / 迭代
- 项目下的需求池
- 项目默认仓库范围

### 3.2 Scope

表示一次需求或工作流到底影响哪些仓库、模块、分支。

当前系统把这个范围隐式塞进了 `Workspace.repositories` 和 `WorkflowRepository` 里，但没有显式建模。

显式建模后，系统才能表达：

- 项目 A 默认关注仓库 `web + api`
- 需求 R1 只涉及 `web`
- 需求 R2 涉及 `api + worker`
- 工作流 W1 基于需求范围执行
- 工作流 W2 是需求 R1 的一次补丁流，只跑 `web`

## 4. 建议的新关系模型

建议把关系改成下面这条主线：

`Workspace -> Project -> Requirement -> WorkflowRun`

同时增加范围关系：

`Workspace -> Repository`

`Project <-> Repository`（项目默认作用仓库）

`Requirement <-> Repository`（需求实际影响仓库）

`WorkflowRun <-> Repository`（本次执行选择的仓库副本）

### 4.1 推荐实体划分

#### Workspace

保留为“组织下的协作工作区 / 代码与流程容器”，职责收敛为：

- 仓库注册与同步
- 项目容器
- 全局问题池

#### Project

新增一层，表示真正的项目或产品线。

建议字段：

- `id`
- `workspaceId`
- `name`
- `code`
- `description`
- `status`
- `ownerUserId`
- `createdAt`
- `updatedAt`

#### ProjectRepository

新增项目默认仓库范围的映射表。

建议字段：

- `projectId`
- `repositoryId`
- `role`
  - 例如 `primary`, `optional`, `infra`

#### Requirement

从“工作区下需求”调整为“项目下工作项”。

建议新增或调整：

- `projectId` 取代单纯 `workspaceId`
- 保留冗余 `workspaceId` 也可以，但应由 `project.workspaceId` 推导
- `type`
  - `epic`, `feature`, `task`, `bugfix`
- `parentRequirementId`
- `priority`
- `assigneeUserId`
- `iteration`
- `status`
  - 业务状态，不等于工作流状态

#### RequirementRepository

新增需求与仓库的多对多关系，表达需求真实影响范围。

#### WorkflowRun

仍可保留“单次执行实例”定位，但要从“单需求单线程”升级为“需求下可并行执行的 run”。

建议新增：

- `projectId`
- `runType`
  - `main`, `patch`, `experiment`, `hotfix`, `review-fix`
- `parentWorkflowRunId`
- `scopeStrategy`
  - `project_default`, `requirement_selected`, `manual_override`
- `concurrencyKey`
  - 用来控制互斥范围

### 4.2 目标关系图

```text
Workspace
├─ Repositories
├─ Projects
│  ├─ ProjectRepositories
│  ├─ Requirements
│  │  ├─ RequirementRepositories
│  │  ├─ WorkflowRuns
│  │  └─ RequirementDependencies
│  └─ Issues / Bugs
└─ Global Issues / Bugs
```

## 5. 并行场景下应该怎么约束

不是简单放开“一个需求多个工作流”就够了，还要定义并行规则。

### 5.1 允许的并行

- 同一个 `Project` 下多个 `Requirement` 并行
- 同一个 `Requirement` 下多个 `WorkflowRun` 并行，但必须区分目的
  - 例如主线开发、补丁修复、审查回补
- 同一个 `Requirement` 的多个工作流可按仓库范围并行

### 5.2 需要互斥的情况

- 同一需求、同一仓库范围、同一分支策略的主线 run 不能同时执行
- 同一仓库同一基线分支上，多个自动执行流如果会写入同一工作副本，需要加锁

### 5.3 推荐的并行控制字段

建议引入 `WorkflowConcurrencyLock`，或者先用规则字段实现：

- `requirementId`
- `repositoryId`
- `baseBranch`
- `lockScope`
  - `requirement`
  - `project`
  - `repository-branch`

这样系统不需要粗暴地限制“每个需求只能有一个活跃工作流”。

## 6. API 和前端应该怎么调整

### 6.1 后端 API

建议新增而不是直接覆写现有语义：

- `POST /projects`
- `GET /projects`
- `GET /projects/:id`
- `POST /projects/:id/repositories`
- `POST /requirements`
  - 改为接收 `projectId`
  - 可选 `repositoryIds`
- `POST /workflow-runs`
  - 改为接收：
    - `requirementId`
    - `repositoryIds?`
    - `runType?`
    - `parentWorkflowRunId?`

### 6.2 前端页面

建议把当前三个页面语义重新拉开：

- `Workspaces`
  - 只管工作区和仓库底座
- `Projects`
  - 看项目池、项目状态、项目默认仓库范围
- `Requirements`
  - 先按项目过滤，再看需求池
- `WorkflowRuns`
  - 支持按项目、需求、仓库、runType、状态筛选

创建需求时，表单应从：

- 选择工作区

改成：

- 选择项目
- 选择影响仓库
- 设置需求类型 / 优先级 / 负责人

发起工作流时，表单应允许：

- 继承需求默认仓库范围
- 手动覆盖本次执行仓库范围
- 指定 runType

## 7. 兼容现有系统的最小改造路径

### Phase 1：补一层 `Project`

先做最关键解耦：

- 新增 `Project`
- `Requirement` 改挂 `Project`
- `Project` 再挂 `Workspace`

这一阶段先不动太多流程逻辑，优先把“工作区”和“项目”拆开。

### Phase 2：补 `RequirementRepository`

让需求拥有自己的仓库作用范围，不再默认等于整个工作区。

这一步完成后，`WorkflowRun` 创建时可以默认继承需求范围，而不是工作区全部仓库。

### Phase 3：放开 `Requirement` 下多活跃工作流

把当前：

- “一个需求只能有一个未结束工作流”

改成：

- “同一互斥范围内只能有一个活跃工作流”

这样才能真正支持并行。

### Phase 4：增加依赖与排期能力

如果后面要做真正的多需求并行编排，可以继续补：

- `RequirementDependency`
- `Iteration / Milestone`
- `RequirementStatus` 业务状态机
- 项目看板 / WIP 限制

## 8. 我对当前仓库的结论

当前系统更准确的定位不是“多项目多需求并行编排平台”，而是：

“一个工作区下，围绕单条需求发起单主线工作流，并在多个仓库上生成工作副本的 AI 研发流程 MVP”

这个定位对 MVP 是成立的，但如果目标已经升级为：

- 多项目共存
- 多需求并行
- 按仓库范围执行
- 按项目做规划和筛选

那现在的关联关系确实不够，核心不是 UI 少几个筛选项，而是数据模型里少了：

- `Project`
- `RequirementRepository`
- 更细粒度的 `WorkflowRun` 并行约束

## 9. 优先级建议

如果只做一件事，优先做：

1. 引入 `Project`
2. 让 `Requirement` 归属于 `Project`
3. 让 `WorkflowRun` 创建时支持传入 `repositoryIds`

如果做两件事，再加上：

4. 去掉“一个需求只能有一个活跃工作流”的绝对限制，改成基于范围的互斥策略

这样改完，系统就会从“单链路 MVP”进入“可支持多项目、多需求并行”的正确轨道。
