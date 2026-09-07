# 测试与质量中心基础设计

## 目标

测试与质量中心承接用例库、AI 提测范围、用例执行和 Bug 回归。它与研发工作流保持独立生命周期，通过 `Requirement`、`WorkflowRun`、`Artifact` 和 `Bug` 建立可追溯关系。

当前阶段只建设核心闭环，不包含传统提测审批、拒绝、周排期、独立通知中心和质量报表。

## 领域关系

```text
Workspace
├── TestCaseLibrary(scope=WORKSPACE)
└── Project
    ├── TestCaseLibrary(scope=PROJECT)
    └── ProjectVersion
        └── TestRequest
            ├── Requirement[]
            ├── WorkflowRun[]
            ├── Artifact[]
            └── TestPlan
                ├── TestCaseSnapshot[]
                └── TestRun[]
                    └── TestRunCase → TestResult → Bug?
```

- Workspace 共享库用于跨项目复用的通用用例。
- 项目库只对所属项目可见。
- `TestCaseDefinition` 是持续维护的用例定义；进入提测范围时复制为不可变的 `TestCaseSnapshot`。
- 快照记录源用例及版本、AI 选择理由和影响等级，库内用例后续变化不会改写历史执行事实。
- `TestRequest` 必须关联明确的 `ProjectVersion`、至少一个 `Requirement`，以及已经完成的研发 `WorkflowRun`。

## 状态

提测状态没有 `REJECTED` 或传统审批状态：

```text
DRAFT → READY → IN_TEST → PASSED | FAILED | BLOCKED
  └──────────────→ CANCELLED
PASSED | FAILED | BLOCKED → IN_TEST（新一轮回归）
```

AI 负责生成和解释测试范围，确定性规则负责从 `DRAFT` 进入 `READY`：

1. 至少存在一个用例快照。
2. 所有关联研发工作流仍为 `done`。
3. 所有结构化 `coverageChecks` 均通过。

测试范围不完整时保持 `DRAFT`，返回缺失项，不产生“拒绝”状态。

## Bug 回归

创建 `REGRESSION` 类型的 `TestRun` 时必须关联 `sourceBugId`。Bug 必须属于当前项目，且对应的 `fixWorkflowRun` 已完成。每次修复生成新的执行轮次，不覆盖之前结果。

首版仍由上游 AI 分析服务提交选中的用例、选择理由和影响等级；后续在此契约上接入 Diff、覆盖关系和历史失败数据分析。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/quality/case-libraries` | 创建 Workspace 共享库或项目库 |
| `GET` | `/quality/case-libraries` | 查询共享库和指定项目库 |
| `POST` | `/quality/case-libraries/:libraryId/modules` | 创建用例模块 |
| `GET` | `/quality/case-libraries/:libraryId/modules` | 查询目标用例库的模块，供创建和编辑用例时选择 |
| `POST` | `/quality/case-libraries/:libraryId/cases` | 创建用例及覆盖关系 |
| `POST` | `/quality/case-libraries/:libraryId/cases/import` | 一次导入最多 1000 条用例；整批校验后通过单次原子写入落库 |
| `GET` | `/quality/test-cases` | 查询当前项目可用的共享/项目用例；传入 `page`、`pageSize` 后返回服务端分页结果，可使用 `q`、`priority`、`libraryId` 筛选 |
| `PATCH` | `/quality/test-cases/:id` | 编辑有效用例并递增定义版本；已冻结的提测快照保持不变 |
| `DELETE` | `/quality/test-cases/:id` | 逻辑删除用例，不影响已经冻结的提测快照和历史执行结果 |
| `POST` | `/quality/test-requests` | 从项目版本、需求和已完成工作流创建提测草稿 |
| `GET` | `/quality/test-requests` | 查询提测记录 |
| `GET` | `/quality/test-requests/:id` | 查询提测、范围快照和执行轮次 |
| `POST` | `/quality/test-requests/:id/scope/cases` | 写入 AI 选用用例及选择依据 |
| `POST` | `/quality/test-requests/:id/scope/complete` | 完成规则校验并进入 `READY` |
| `GET` | `/quality/test-requests/:id/runs` | 查询执行轮次和逐例结果 |
| `POST` | `/quality/test-requests/:id/runs` | 创建初测或 Bug 回归轮次 |
| `POST` | `/quality/test-run-cases/:id/result` | 写入单条用例结果并聚合轮次状态 |

所有对象沿 Workspace 继承当前组织边界。API 不允许跨 Workspace 关联项目，也不允许从其他项目用例库选择用例。

## Web 入口

一级导航 `测试与质量` 对应 `/quality`，展开三个独立子菜单：提测管理 `/quality/test-requests`、用例库 `/quality/test-cases`、执行记录 `/quality/test-runs`。用例库采用高密度列表和服务端分页，完整步骤与预期结果按需查看；列表提供创建、查看、编辑和删除操作，编辑可调整所属用例库、模块、编号、标题、优先级、前置条件、步骤、预期结果和标签。每次保存编辑都会递增用例定义版本，已经冻结的提测快照仍保留选例时的内容和版本。用例库支持下载 CSV 模板并批量导入，客户端先校验列结构和逐行内容，服务端再校验模块、编号重复和批量上限，任何错误都会中止整批写入。删除用例只会将定义归档并退出后续 AI 选例范围，不修改历史快照。提测创建只允许选择项目版本下已完成的研发工作流；AI 选例、覆盖检查和快照冻结仍由质量域 API 契约控制。
