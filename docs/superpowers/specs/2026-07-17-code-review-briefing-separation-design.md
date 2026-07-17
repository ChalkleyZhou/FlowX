# Code Review 与简报分离设计

## 背景

FlowX 当前把「日常 Code Review」挂在项目简报子系统下：共享 webhook/`BriefingEvent`、共享 `ProjectBriefingConfig` 调度、共享投递入口，前端也以「项目简报与 Code Review」并列呈现。结果是：

- 用户把 Code Review 当成简报的附属能力，而不是独立产品。
- 日常审查实际由「提交窗口」驱动，仓库 review skill 只是门禁（无 skill 则 `SKIPPED_NO_SKILL`），与「skill 主导审查」的产品意图不符。
- 工作流阶段的 AI Review（需求实现审查）与日常 CR 名称相近，但驱动方式、对象和结果生命周期完全不同，容易被误认为应收敛成一种能力。

本设计把日常 Code Review 拆成独立产品，明确它与简报、工作流实现审查的边界，并规定日常 CR 由仓库 Agent Skill 主导。

## 目标

- 日常 Code Review 与项目简报在导航、配置、数据源、调度、投递上均可独立。
- 日常 Code Review 以仓库 review skill 为审查主体；FlowX 只负责发现 skill、准备变更证据、编排执行、落库与投递。
- 简报只做变更摘要；不触发 CR，不把 CR finding 写入简报正文；若需发出 CR，则与简报并列投递。
- 工作流实现审查保持独立：上层 prompt 主导，skill 仅辅助；不与日常 CR 合成一种产品。
- 给出可分期落地的边界，避免继续把新字段写回简报配置。

## 非目标

- 不在本期把工作流实现审查与日常 CR 收敛为同一 Run/Report 模型。
- 不要求日常 CR finding 自动进入 `ReviewFinding` / Issue / Bug 流程（可列为后续能力）。
- 不在本期重新设计简报内容语义（仍遵循既有 commit 驱动项目变化简报设计）。
- 不规定具体 AI provider 实现细节；只规定产品契约与驱动权。
- 不强制用户为简报与 CR 配置不同的外部渠道；「可独立」不等于「必须不同」。

## 设计原则

### 三条能力，互不吞并

| 能力 | 用户问题 | 驱动权 | 产品归属 |
|---|---|---|---|
| 项目简报 | 这段时间项目改了什么？ | 变更事实 + 总结 prompt | 独立产品 |
| 日常 Code Review | 按仓库 skill，这段变更有没有问题？ | 仓库 review skill | 独立产品（从简报拆出） |
| 工作流实现审查 | 刚做完的这个功能能不能过？ | 上层 prompt；skill 仅辅助 | 工作流阶段 |

### Skill 是日常 CR 的主体，不是门禁装饰

日常 CR 的 checklist、关注点与审查期望以仓库 skill（如 `.cursor/skills/**/SKILL.md` 中 review 类 skill）为准。FlowX 不维护第二套平台审查标准去覆盖 skill。没有可发现的 review skill 时，日常 CR 应跳过并说明原因，而不是静默用通用 prompt 顶替。

### 简报与 CR 并列，不嵌套

简报管道与 CR 管道平行。生成失败、投递失败互不影响。同一外部渠道（如同一钉钉群）可以同时作为两边的投递目标，但这是用户配置选择，不是系统捆绑。

### 工作流审查：prompt 主导，skill 辅助

工作流审查对象是「当前需求的实现」，必须对照需求、方案与本次执行产物。仓库 skill 可注入为风格/禁区/仓库约定的辅助约束；无 skill 时审查仍继续。

## 产品边界与核心对象

### 日常 Code Review 逻辑对象

- `CodeReviewSource`：独立数据源（仓库/事件接入），不依赖 `BriefingSource` 作为产品概念。
- `CodeReviewConfig`：项目级开关、调度、默认审查范围。
- `CodeReviewRun`：一次审查执行（定时或手动）。
- `CodeReviewReport`：面向详情页与投递的报告产物（可与 Run 1:1 或作为 Run 的主产物字段，实现计划再定）。
- CR 侧 `DeliveryTarget` 绑定：与简报绑定分离；允许指向同一外部渠道的不同绑定记录。

### 明确不做

- 简报不生成、不触发日常 CR。
- CR 报告不写入简报正文。
- 日常 CR 不挂在「工作流实现审查」导航下，也不共用结果生命周期。
- 无 review skill 时：日常 CR → 跳过；工作流实现审查 → 不因缺 skill 阻断。

## 日常 Code Review 主流程

```text
配置 CR Source / Schedule / Delivery
              │
              ▼
   触发：定时窗口 或 手动「立即审查」
              │
              ▼
   按 Source 拉取变更证据（commit/diff 等）
              │
              ▼
   同步仓库 → 发现 review Skill（SKILL.md）
         │                    │
    找到 skill            未找到
         │                    │
         ▼                    ▼
  以 skill 为审查主体      Run = SKIPPED_NO_SKILL
  调用 AI 执行审查         记录 skillHint；可选投递跳过通知
         │
         ▼
  落库 CodeReviewRun + Report
         │
         ▼
  按 CR 自己的 DeliveryTarget 投递报告
```

### 触发

- **定时**：仅由 `CodeReviewConfig.enabled` 与 CR 自身 schedule 决定；与简报 schedule 无关。
- **手动**：在 Code Review 入口选择项目/源/时间范围（或默认最近窗口）立即执行。
- 任一侧失败不影响另一侧。

### Skill 发现

- 在仓库约定路径下查找 Agent Skill（如 `.cursor/skills/`、`.agents/skills/`、`.claude/skills/`）。
- 优先选择名称或描述表明用于 code review 的 skill。
- 多个候选时按约定优先级选一个，并在报告中写明实际使用的 skill 路径。
- 未找到：`SKIPPED_NO_SKILL`，提供添加 skill 的提示，不回退到平台通用审查 prompt。

### 报告与投递

- 独立详情页展示：审查范围、所用 skill、finding、跳过/失败原因。
- 投递内容为 CR 报告本身（或摘要 + 详情链接），不嵌入简报 Markdown。
- 投递日志与简报 `DeliveryLog` 分离（或通过类型字段区分），保证可独立追溯。

### 空态与错误

| 情况 | 日常 CR 行为 |
|---|---|
| 未配置 Source | 引导配置，不生成 |
| 窗口内无变更 | 记录空跑结果（默认）；不伪装成成功审查 |
| 无 review skill | `SKIPPED_NO_SKILL` + skillHint |
| AI/执行失败 | `FAILED`，支持重试 |
| 投递失败 | Run/Report 已生成则保留；投递状态单独失败 |

## 工作流实现审查

```text
需求 + 方案 + 执行产物/diff
            │
            ▼
   上层 Review Prompt（驱动者）
            │
            ├── 有 review skill → 作为辅助约束注入
            └── 无 skill → 仍继续审查
            │
            ▼
   ReviewReport + ReviewFinding
   → 人工确认 → 可选转 Issue/Bug
```

### 与日常 CR 的对照

| | 日常 Code Review | 工作流实现审查 |
|---|---|---|
| 主驱动 | 仓库 skill | FlowX 阶段 prompt |
| Skill 角色 | 主体 | 可选辅助上下文 |
| 审查对象 | Source 配置范围内的变更 | 当前 WorkflowRun 的实现 |
| 无 skill | 跳过 | 不阻断 |
| 结果去向 | CR 报告 + CR 投递 | 工作流人工确认 / Issue·Bug |
| 产品入口 | 独立 Code Review | 工作流详情阶段 |

### 硬边界

- 不共用 Run/Report 生命周期。
- 不自动双向同步 finding。
- 可共用「发现 SKILL.md」技术能力，但调用契约不同：日常 = 执行 skill；工作流 = 读取 skill 文本作附录。
- 导航「Code Review」仅指日常能力；工作流阶段沿用实现审查 / AI Review 命名。

## 简报关系与信息架构

```text
Briefing pipeline          Code Review pipeline
───────────────            ────────────────────
Source A                   Source B（可不同）
Schedule A                 Schedule B
Generate Briefing          Generate CR Report
Delivery Target X          Delivery Target Y
```

- 移除捆绑文案「项目简报与 Code Review」。
- 简报页不再提供 CR tab / 一键生成 CR。
- 独立导航：Code Review（列表、详情、手动触发、skill 状态、源/调度/投递配置）。
- 项目设置中两套配置卡片并排，无父子关系。

## 分期落地

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| **P0** | 产品与运行时拆分：独立模块/API/导航；调度与投递解耦；简报不再触发或展示 CR | 用户感知为两个产品；两侧失败互不影响 |
| **P1** | 数据源独立（`CodeReviewSource` 等）；迁移现有 Daily CR 配置与历史 | 新配置不再写入 `ProjectBriefingConfig`；Source 可与简报不同 |
| **P2** | 工作流实现审查增加 skill 辅助注入（仍 prompt 主导） | 有/无 skill 行为符合上表；无 skill 不阻断 |
| **P3** | 体验打磨：skill 发现状态、投递预览、空跑/跳过策略与运营文案 | 空态可自助恢复 |

### 迁移约束

- P0 允许 CR 暂时适配读取既有 webhook/事件表，但配置模型必须逻辑独立。
- P1 前不得向 `ProjectBriefingConfig` 增加新的 CR 专用字段。
- 历史 `DailyCodeReview` 记录应可迁移或只读兼容展示，避免用户丢失过往报告。

## 成功标准

- 关闭简报调度后，CR 仍可按自身配置定时/手动运行并投递。
- 关闭 CR 调度后，简报行为不变。
- 未配置 CR Source 或未绑定 CR 投递目标时，不影响简报。
- 仓库无 review skill 时，日常 CR 明确跳过；工作流实现审查仍可完成。
- 前端无「在简报内管理 CR」的主路径。

## 开放实现项（不阻塞本产品设计）

以下留给 implementation plan 决定，本设计只要求行为符合上文契约：

- Prisma 表是新建 `CodeReview*` 还是重命名演进 `DailyCodeReview*`。
- DeliveryTarget 用多态绑定还是两侧各自关联表。
- 多 review skill 的精确优先级算法。
- 空跑是否向投递渠道发送「无变更」通知（默认：落库空跑，是否投递可配置，默认不打扰）。
- 工作流 skill 辅助注入的 prompt 具体版式。
