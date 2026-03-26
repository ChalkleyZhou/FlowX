# AI研发调度系统 MVP 设计

## 1. 模块划分

### Backend modules

- `requirements`
  - 负责需求录入与查询
- `workflow`
  - 负责 workflow 生命周期、阶段调度、状态流转、历史记录
- `ai`
  - 提供统一 `AIExecutor` 抽象和 provider 注入
- `prisma`
  - 数据访问
- `common`
  - 枚举、状态机、schema、响应模型

### Frontend modules

- `pages/RequirementsPage`
  - 创建需求与查看列表
- `pages/WorkflowPage`
  - 查看 workflow 与阶段操作
- `components/StageCard`
  - 展示阶段状态、输出、人工确认操作

## 2. 目录结构

```text
.
├── apps
│   ├── api
│   │   ├── src
│   │   │   ├── ai
│   │   │   ├── common
│   │   │   ├── prisma
│   │   │   ├── prompts
│   │   │   ├── requirements
│   │   │   ├── workflow
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── package.json
│   └── web
│       ├── src
│       │   ├── components
│       │   ├── api.ts
│       │   ├── App.tsx
│       │   └── main.tsx
│       └── package.json
├── prisma
│   └── schema.prisma
└── docs
    └── system-design.md
```

## 3. 数据模型

### Requirement

- `id`
- `status`
- `title`
- `description`
- `acceptanceCriteria`
- `createdAt`
- `updatedAt`

### WorkflowRun

- `id`
- `status`
- `requirementId`
- `currentStage`
- `createdAt`
- `updatedAt`

### StageExecution

- `id`
- `workflowRunId`
- `stage`
- `attempt`
- `status`
- `input`
- `output`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `createdAt`
- `updatedAt`

### Task

- `id`
- `workflowRunId`
- `title`
- `description`
- `order`
- `status`
- `createdAt`
- `updatedAt`

### Plan

- `id`
- `workflowRunId`
- `status`
- `summary`
- `implementationPlan`
- `filesToModify`
- `newFiles`
- `riskPoints`
- `createdAt`
- `updatedAt`

### CodeExecution

- `id`
- `workflowRunId`
- `status`
- `patchSummary`
- `changedFiles`
- `codeChanges`
- `createdAt`
- `updatedAt`

### ReviewReport

- `id`
- `workflowRunId`
- `status`
- `issues`
- `bugs`
- `missingTests`
- `suggestions`
- `impactScope`
- `createdAt`
- `updatedAt`

## 4. 状态机设计

### WorkflowRun status

- `created`
- `task_split_pending`
- `task_split_waiting_confirmation`
- `task_split_confirmed`
- `plan_pending`
- `plan_waiting_confirmation`
- `plan_confirmed`
- `execution_pending`
- `execution_running`
- `review_pending`
- `human_review_pending`
- `done`
- `failed`

### StageExecution status

- `pending`
- `running`
- `completed`
- `failed`
- `waiting_confirmation`
- `rejected`

### 核心流转

1. 创建 workflow: `created -> task_split_pending`
2. 执行 task split:
   - workflow `task_split_pending -> task_split_waiting_confirmation`
   - 创建一个新的 stage execution attempt
   - stage `running -> waiting_confirmation`
3. 人工确认 task split:
   - workflow `task_split_waiting_confirmation -> task_split_confirmed -> plan_pending`
   - stage `waiting_confirmation -> completed`
4. 驳回 task split:
   - workflow `task_split_waiting_confirmation -> task_split_pending`
   - stage `waiting_confirmation -> rejected`
5. 执行 plan:
   - workflow `plan_pending -> plan_waiting_confirmation`
   - 创建一个新的 stage execution attempt
   - stage `running -> waiting_confirmation`
6. 人工确认 plan:
   - workflow `plan_waiting_confirmation -> plan_confirmed -> execution_pending`
   - stage `waiting_confirmation -> completed`
7. 驳回 plan:
   - workflow `plan_waiting_confirmation -> plan_pending`
   - stage `waiting_confirmation -> rejected`
8. 执行 development:
   - workflow `execution_pending -> execution_running -> review_pending`
9. 执行 AI review:
   - workflow `review_pending -> human_review_pending`
10. 人工决定:
   - `accept/continue -> done`
   - `rework -> execution_pending`
   - `rollback -> failed`

### 约束

- task split 未确认，plan 不可执行
- plan 未确认，execution 不可执行
- execution 未完成，review 不可执行
- 所有状态流转统一通过 `WorkflowStateMachine` 校验
- `StageExecution` 按 attempt 追加，保留完整阶段历史

## 5. API 设计

### Requirements

- `POST /requirements`
- `GET /requirements`
- `GET /requirements/:id`

### Workflow

- `POST /workflow-runs`
- `GET /workflow-runs`
- `GET /workflow-runs/:id`
- `GET /workflow-runs/:id/history`

### Task split

- `POST /workflow-runs/:id/task-split/run`
- `POST /workflow-runs/:id/task-split/confirm`
- `POST /workflow-runs/:id/task-split/reject`

### Technical plan

- `POST /workflow-runs/:id/plan/run`
- `POST /workflow-runs/:id/plan/confirm`
- `POST /workflow-runs/:id/plan/reject`

### Execution

- `POST /workflow-runs/:id/execution/run`

### AI review

- `POST /workflow-runs/:id/review/run`

### Human decision

- `POST /workflow-runs/:id/human-review/decision`

## 6. AI 集成设计

```ts
interface AIExecutor {
  splitTasks(input: SplitTasksInput): Promise<SplitTasksOutput>;
  generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput>;
  executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput>;
  reviewCode(input: ReviewCodeInput): Promise<ReviewCodeOutput>;
}
```

### 设计原则

- provider 通过 Nest DI 注入
- prompt 与业务逻辑分离，放在 `src/prompts`
- 业务层只依赖 `AIExecutor`，不依赖具体平台 SDK
