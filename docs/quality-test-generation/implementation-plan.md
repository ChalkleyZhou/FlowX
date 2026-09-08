# 测试设计生成与提测门禁实施计划

## 目标

在不破坏现有用例库、提测快照和执行轮次的前提下，增加需求驱动的测试设计对象，支持现有用例比对、优化建议、动态冒烟用例和提测确认门禁。

## 任务拆分

### Task 1：领域枚举、协议和数据库模型

修改：

- `prisma/schema.prisma`
- `apps/api/src/common/types.ts`
- `apps/web/src/types.ts`

内容：

- 增加 `TestDesign`、`TestDesignCandidate`、`TestDesignSmokeCase` 及关系。
- 增加 `TestDesignRequirement`、`TestDesignWorkflowRun` 关联表，保留来源边界。
- 给 `TestRequest`、`TestPlan`、`TestCaseSnapshot`、`TestRun` 增加扩展字段。
- 增加测试设计状态、候选动作、候选处理结果、快照类型的常量和 TypeScript 类型。
- 生成 Prisma migration；不修改或删除历史质量表。

测试：先补 schema 关系和协议 fixture，验证 Prisma generate、类型编译和 JSON 契约。

### Task 2：测试设计服务与来源指纹

新增：

- `apps/api/src/quality/test-designs.service.ts`
- `apps/api/src/quality/test-designs.controller.ts`
- `apps/api/src/quality/dto/test-design.dto.ts`
- `apps/api/src/quality/test-designs.service.spec.ts`

内容：

- 创建测试设计草稿并校验项目、版本、需求、工作流和 Spec & Plan 来源。
- 规范化来源输入并计算指纹。
- 实现修订号、过期标记和刷新差异保留规则。
- 实现所有候选处理状态的确定性校验。

测试优先覆盖：跨项目访问、未确认 Spec & Plan、来源变化、源用例版本冲突、重复候选和修订冲突。

### Task 3：AI 生成契约与比对编排

修改：

- `apps/api/src/ai/ai-executor.ts`
- `apps/api/src/ai/mock-ai.executor.ts`
- `apps/api/src/ai/codex-ai.executor.ts`

新增：

- `apps/api/src/ai/test-design.output.schema.json`
- `apps/api/src/prompts/test-design.prompt.ts`
- 对应输出 schema 和 executor 测试。

内容：

- 增加 `generateTestDesign` 单一入口。
- 传入 PRD、设计、Spec & Plan、改动摘要和库内用例候选。
- 输出覆盖摘要、功能候选、冒烟候选和未覆盖项。
- 保证 mock executor 与真实 executor 返回同一协议形状。
- 生成失败不清空上一个可用草稿。

测试：schema 非法、重复候选、无效 sourceDefinitionId、超出 Workspace 边界、冒烟字段缺失和幂等键。

### Task 4：现有用例比对和确认事务

修改：

- `apps/api/src/quality/case-libraries.service.ts`
- `apps/api/src/quality/test-designs.service.ts`

内容：

- 复用现有库的分页查询和 Workspace/项目筛选逻辑。
- 增加确定性召回和 AI 语义比对结果保存。
- 实现 `REUSE`、`OPTIMIZE`、`CREATE`、`EXCLUDE` 的确认事务。
- 优化正式用例时递增版本；新增正式用例默认进入项目库。
- 为冲突源用例返回明确错误码。

测试：

- 优化后版本递增，旧 `TestCaseSnapshot` 内容不变。
- 新增用例只创建一次，重复确认不重复写入。
- 同一事务失败时用例库和测试设计均回滚。

### Task 5：提测门禁与快照冻结

修改：

- `apps/api/src/quality/test-requests.service.ts`
- `apps/api/src/quality/test-runs.service.ts`
- 相关 DTO、controller 和测试。

内容：

- 创建提测时强制校验已确认且未过期的 `testDesignId`。
- 将确认的功能候选和冒烟候选转换为 `TestCaseSnapshot`。
- 增加 `SMOKE` 执行轮次，只能选择冒烟快照。
- 保留现有“关联研发工作流必须完成”校验。

测试：未确认、过期、来源变化、未处理候选、无冒烟确认、开发工作流未完成、跨项目测试设计和快照重复创建。

### Task 6：Web 测试设计工作区

新增或修改：

- `apps/web/src/pages/quality/QualityTestDesignPage.tsx`
- `apps/web/src/pages/quality/QualityTestDesignPanel.tsx`
- `apps/web/src/pages/quality/QualityTestRequestDetailPage.tsx`
- `apps/web/src/api.ts`
- 路由和导航配置。

内容：

- 工作流详情展示并行测试设计入口和状态摘要。
- 测试设计页实现候选筛选、详情、差异编辑、处理结果和覆盖矩阵。
- 冒烟页签实现增删、编辑、排序和无冒烟原因确认。
- 提测详情展示门禁清单、快照范围和执行轮次。
- 处理 revision conflict、STALE 和生成失败状态。

测试：页面加载、生成、候选处理、优化差异、冒烟编辑、确认禁用条件和提测门禁错误定位。

### Task 7：文档、导航与兼容检查

修改：

- `docs/quality-foundation.md`
- `docs/user-manual.md`
- `apps/web/public/user-manual.md`
- 必要时更新 `README.md` 和 `docs/system-design.md`。

内容：

- 补充测试设计与提测门禁说明。
- 明确冒烟用例为本次改动临时快照，不是历史套件。
- 说明现有用例比对、优化版本和历史快照规则。
- 保持用户手册镜像一致。

## 依赖顺序

```text
Task 1
  -> Task 2
  -> Task 3
  -> Task 4
  -> Task 5
  -> Task 6
  -> Task 7
```

Task 2 和 Task 3 在契约确定后可以并行实现；Task 4 依赖两者的候选协议。

## 发布策略

1. 先完成数据库 migration、服务端接口和 mock executor。
2. 在已有项目中以“测试设计可选但新提测必须确认”为灰度开关验证。
3. 观察生成失败率、低置信度匹配率、确认耗时和提测门禁阻断原因。
4. 稳定后关闭旧的直接写入提测范围入口；保留历史提测只读和执行能力。

## 验证命令

```bash
pnpm prisma:generate
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm --filter flowx-web build
pnpm check
cmp -s docs/user-manual.md apps/web/public/user-manual.md
git diff --check
```

## 风险与应对

| 风险 | 应对 |
| --- | --- |
| AI 将相似用例误判为可复用 | 低置信度强制人工处理，保存匹配理由 |
| 优化时源用例被其他人修改 | 使用源版本和 revision 乐观锁，冲突后重新比对 |
| 开发改动超出 Spec & Plan | 提测前要求刷新影响分析，旧确认变为过期 |
| 冒烟范围过大 | 生成契约限制数量和覆盖目标，前端显示精简度提示 |
| 旧提测数据无法读取 | 新字段可选，历史请求/计划/快照按旧关系继续读取 |
| 确认事务部分写入 | 用单事务更新用例版本、创建新用例并确认测试设计 |

## 完成定义

- API、Web 类型和 Prisma schema 对测试设计协议保持一致。
- 项目库与 Workspace 共享库均能参与比对，且跨边界访问被拒绝。
- 优化、新增、复用和冒烟快照均有自动化测试。
- 提测未满足确认门禁时保持草稿并返回结构化缺失项。
- 历史快照和执行结果不因库内优化发生变化。
- 用户手册与 public 镜像一致，`pnpm --filter flowx-api test`、`pnpm --filter flowx-web test` 和 `git diff --check` 通过。
