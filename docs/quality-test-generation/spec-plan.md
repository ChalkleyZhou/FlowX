# 测试设计生成与提测门禁 Spec & Plan

## 1. 范围与设计原则

本规格扩展现有测试与质量中心，不新增研发工作流串行阶段。`SPEC_PLAN_CONFIRMED` 代表测试设计可以生成；开发执行和测试设计生成并行，提测时通过统一门禁汇合。

本期实现原则：

- 测试设计候选与正式用例库分离，候选必须人工处理。
- 功能用例进入正式库后再按提测计划冻结快照。
- 冒烟用例只写入本次测试计划快照，不进入长期用例库。
- 所有上游来源和候选决策使用修订号与指纹校验，避免过期确认。
- 保留现有 `TestCaseDefinition`、`TestCaseSnapshot`、`TestRequest`、`TestRun` 的历史语义。

## 2. 领域对象

### 2.1 TestDesign

测试设计是一次需求版本的候选生成和人工确认记录。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | String | 主键 |
| `workspaceId` / `projectId` / `projectVersionId` | String | 组织、项目和版本边界 |
| `status` | String | `NOT_STARTED`、`GENERATING`、`WAITING_REVIEW`、`WAITING_CONFIRMATION`、`CONFIRMED`、`STALE`、`GENERATION_FAILED` |
| `revision` | Int | 测试设计修订号，从 1 开始 |
| `sourceFingerprint` | String | PRD、设计、Spec & Plan 和改动摘要的规范化指纹 |
| `sourceSummary` | Json | 来源对象、版本和读取时间 |
| `coverageSummary` | Json | 功能点、主流程、异常、权限、数据边界等覆盖摘要 |
| `coverageChecks` | Json | 结构化覆盖检查结果 |
| `uncoveredItems` | Json | 未覆盖项及处理状态 |
| `noCaseReason` | String? | 确认无功能用例时的原因 |
| `noSmokeReason` | String? | 确认无冒烟场景时的原因 |
| `confirmedByUserId` / `confirmedAt` | String? / DateTime? | 确认审计信息 |
| `staleReason` | String? | 过期原因 |

`TestDesign` 通过 `TestDesignRequirement` 和 `TestDesignWorkflowRun` 关联一个或多个 `Requirement` 和 `WorkflowRun`，并保留生成输入摘要，避免后续原文变化导致历史内容无法解释。

### 2.2 TestDesignCandidate

候选表示一个功能测试用例的建议处理结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `testDesignId` | String | 所属测试设计 |
| `action` | String | `REUSE`、`OPTIMIZE`、`CREATE`、`EXCLUDE` |
| `resolution` | String | `PENDING`、`ACCEPTED`、`REJECTED` |
| `sourceDefinitionId` | String? | 复用或优化的现有用例 |
| `sourceVersion` | Int? | 生成时看到的现有版本 |
| `matchScore` | Float? | 0 到 1 的匹配置信度 |
| `matchReason` | String? | 匹配和建议原因 |
| `coverageKeys` | Json | 关联验收标准、功能点和边界标识 |
| `proposedCase` | Json | 编辑中的完整用例内容 |
| `decisionNote` | String? | 人工处理说明 |
| `sortOrder` | Int | 展示顺序 |

`proposedCase` 至少包含 `title`、`priority`、`precondition`、`steps`、`expected`、`tags`。

### 2.2.1 关联表

新增 `TestDesignRequirement` 和 `TestDesignWorkflowRun` 两张关联表，主键分别为 `(testDesignId, requirementId)` 和 `(testDesignId, workflowRunId)`，外键删除策略沿用现有质量域的限制策略，防止删除需求或工作流时静默改写测试设计来源。

### 2.3 TestDesignSmokeCase

冒烟候选是本次改动的临时用例，不关联长期用例定义。

字段至少包含：`title`、`priority`、`precondition`、`steps`、`expected`、`blocking`、`coverageKeys`、`resolution`、`sortOrder`。

冒烟候选确认后，在创建 `TestPlan` 时转换为 `TestCaseSnapshot`，并将 `kind` 标记为 `SMOKE`；功能候选转换为 `FUNCTIONAL`。

### 2.4 现有模型扩展

- `TestRequest` 增加可选唯一字段 `testDesignId`，新流程创建提测时必须指向 `CONFIRMED` 且未过期的测试设计。
- `TestPlan` 增加 `testDesignId` 关系，保证一个测试计划对应一次确认的测试设计修订。
- `TestCaseSnapshot` 增加 `kind`（`FUNCTIONAL` / `SMOKE`）和 `origin`（`LIBRARY` / `GENERATED`）。
- `TestRun.runType` 增加 `SMOKE`。`SMOKE` 轮次只能选择 `kind = SMOKE` 的快照；`INITIAL` 默认选择功能快照，可显式包含冒烟快照。
- 不删除既有用例、提测和执行表，不修改历史快照。

## 3. 输入指纹与过期规则

### 3.1 指纹组成

对以下内容做规范化后计算指纹：

1. 需求正文、验收标准和需求版本。
2. 设计文档和设计 Artifact 的稳定标识及版本。
3. `SPEC_PLAN` 阶段的完整 `output` 和确认版本。
4. 关联项目版本、需求、工作流和仓库范围。
5. 可用的开发变更摘要；开发尚未完成时使用已确认 Spec & Plan 的变更范围。

规范化规则：对象键排序、数组保持业务顺序、空值统一、字符串去除首尾空白。指纹只用于一致性判断，不向用户展示内部哈希细节。

### 3.2 过期规则

- 上游文档确认版本变化，测试设计变为 `STALE`。
- 项目版本、需求关联或 Spec & Plan 关联变化，测试设计变为 `STALE`。
- 开发完成后的实际变更摘要与生成时使用的范围不一致时，标记“待刷新影响分析”；刷新前不能提测。
- 用例库中被复用或优化的源用例版本变化时，对应候选标记冲突；不能直接确认。
- 旧修订只读保留，新修订从旧修订复制未受影响的人工决策。

## 4. API 契约

### 4.1 测试设计

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `POST` | `/quality/test-designs` | 基于项目版本、需求和 Spec & Plan 创建草稿 |
| `GET` | `/quality/test-designs/:id` | 返回来源、候选、冒烟项、覆盖检查和审计信息 |
| `POST` | `/quality/test-designs/:id/generate` | 生成或重新生成候选；支持幂等键 |
| `POST` | `/quality/test-designs/:id/refresh` | 只分析来源/实际改动变化，保留未受影响决策 |
| `PATCH` | `/quality/test-designs/:id/candidates/:candidateId` | 编辑候选内容、动作、处理结果和说明 |
| `PATCH` | `/quality/test-designs/:id/smoke` | 批量编辑、排序和删除冒烟候选 |
| `POST` | `/quality/test-designs/:id/confirm` | 校验门槛并确认当前修订 |

### 4.2 请求和响应要点

`POST /quality/test-designs`：

```json
{
  "workspaceId": "ws_1",
  "projectId": "project_1",
  "projectVersionId": "version_1",
  "requirementIds": ["req_1"],
  "workflowRunIds": ["run_1"],
  "sourceStage": "SPEC_PLAN"
}
```

生成响应包含 `revision`、`sourceFingerprint`、`coverageSummary`、`candidates`、`smokeCases` 和 `uncoveredItems`。候选中的 `sourceDefinitionId` 必须属于当前 Workspace 的共享库或项目库，且状态为 `ACTIVE`。

`PATCH` 和 `confirm` 请求携带 `revision`。服务端发现修订不一致时返回 `TEST_DESIGN_REVISION_CONFLICT`，前端提示刷新，不覆盖他人的编辑。

确认请求：

```json
{
  "revision": 2,
  "coverageChecks": [
    { "key": "acceptance", "passed": true, "note": "" }
  ],
  "uncoveredItems": [],
  "noCaseReason": null,
  "hasSmokeCases": true
}
```

## 5. 生成与比对逻辑

### 5.1 生成步骤

1. 校验 PRD、设计和 Spec & Plan 均已确认。
2. 读取来源并计算 `sourceFingerprint`。
3. 查询当前 Workspace 共享库和项目库中的有效用例，限制在当前组织边界。
4. 先按覆盖标识、模块、标签和文本规范化做确定性候选召回。
5. 对召回结果进行语义比对，输出匹配度、匹配原因和差异摘要。
6. 生成复用、优化、新增、不纳入候选及本次冒烟候选。
7. 对输出做结构校验、权限校验和重复候选校验后，以 `WAITING_REVIEW` 保存。

### 5.2 决策约束

- 匹配度低于配置阈值时，默认动作必须为 `CREATE` 或 `PENDING`，不能自动 `REUSE`。
- `OPTIMIZE` 必须携带 `sourceDefinitionId`、`sourceVersion` 和完整 `proposedCase`。
- `REUSE` 必须携带源用例和源版本。
- `CREATE` 不能携带源用例；确认后创建正式 `TestCaseDefinition`。
- `EXCLUDE` 必须携带 `decisionNote`。
- 同一个源用例在同一修订中只能有一个未终结的优化候选。
- 冒烟候选不参与正式用例库的新增统计，不因历史冒烟结果自动继承。

### 5.3 确认事务

确认时在一个事务中完成：

1. 再次验证来源指纹和所有源用例版本。
2. 验证所有候选均已处理，未覆盖项有补充用例、接受风险或不适用说明。
3. 验证功能候选已确认，或 `noCaseReason` 非空且有确认人；验证冒烟候选已确认，或 `noSmokeReason` 非空且有确认人。
4. 对 `OPTIMIZE` 更新正式用例内容并递增 `version`。
5. 对 `CREATE` 创建正式用例，默认进入当前项目库。
6. 将测试设计标记为 `CONFIRMED` 并写入审计信息。

如果第 4 或第 5 步失败，整个确认回滚；不产生半确认状态。

## 6. 提测门禁与快照

扩展 `POST /quality/test-requests`：

- 必须传入 `testDesignId`。
- 测试设计必须属于同一 Workspace、项目和项目版本。
- 测试设计必须为 `CONFIRMED`，且指纹仍与当前来源一致。
- 测试设计确认的功能候选和冒烟候选必须在创建提测计划时一次性转换为快照。
- 若测试设计没有功能候选，必须在 `noCaseReason` 中保留人工确认原因。
- 仍保留所有关联研发工作流已完成的校验；工作流未完成时可以有测试设计，但不能创建 `READY` 提测。

快照字段映射：

| 来源 | `TestCaseSnapshot.kind` | `origin` | `sourceDefinitionId` |
| --- | --- | --- | --- |
| 复用 | `FUNCTIONAL` | `LIBRARY` | 有 |
| 优化 | `FUNCTIONAL` | `LIBRARY` | 有，版本为确认后的版本 |
| 新增 | `FUNCTIONAL` | `GENERATED` | 新创建定义 |
| 冒烟 | `SMOKE` | `GENERATED` | 空 |

## 7. 错误码与权限

建议错误码：

- `TEST_DESIGN_SOURCE_NOT_CONFIRMED`
- `TEST_DESIGN_GENERATION_INVALID`
- `TEST_DESIGN_REVISION_CONFLICT`
- `TEST_DESIGN_SOURCE_STALE`
- `TEST_DESIGN_CANDIDATE_UNRESOLVED`
- `TEST_DESIGN_SMOKE_UNCONFIRMED`
- `TEST_REQUEST_DESIGN_REQUIRED`

所有查询和写入沿用现有 Workspace/项目权限边界。AI 生成失败的错误信息不得包含 token、完整凭据或内部原文之外的敏感信息。

## 8. 前端实现要点

- 在工作流详情的 Spec & Plan 区域增加并行测试设计入口和状态摘要。
- 新增 `/quality/test-requests/:id` 提测详情页，复用现有质量页面的 `PageHeader`、`ListToolbar`、`Badge`、`Dialog` 和分页组件。
- `apps/web/src/api.ts` 增加测试设计 API；`apps/web/src/types.ts` 增加严格类型，不使用 `any` 绕过候选契约。
- 提测创建对门禁错误显示缺失项和跳转入口，不使用不可恢复的通用错误弹窗。
- 候选详情使用差异视图；冒烟页签使用可排序列表，确认区显示剩余待处理数。

## 9. 验证策略

后端：

- 测试设计状态转换、过期和修订冲突。
- 跨 Workspace/项目的源用例和测试设计访问拒绝。
- 复用、优化、新增、不纳入和冒烟候选的结构校验。
- 优化版本递增、快照不变和确认事务回滚。
- 提测门禁：未确认、过期、未处理候选、无冒烟说明、未完成工作流均不能进入 `READY`。
- 重复生成和重复确认的幂等行为。

前端：

- 测试设计状态和数量摘要渲染。
- 候选动作切换、优化差异编辑和冲突提示。
- 冒烟增删排序和无冒烟原因校验。
- 提测门禁错误定位。

## 10. 非本期实现

- 自动化脚本或测试代码生成。
- 基于历史执行结果的智能优先级预测。
- 长期项目冒烟套件管理。
- 多人同时编辑同一候选的实时协同。
