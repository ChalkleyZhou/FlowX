# Code Review 独立沙箱工作空间设计

## 背景

Daily Code Review 今天仍通过工作区主 clone（`.flowx-data/workspaces/.../repositories/...`）做 `ensureRepositoryReadyForReview`，会在共享树上 checkout 分支，与开发用的 workflow 拷贝抢同一套工作区仓库状态。

产品上需要：

1. CR **单独开辟**工作空间，与开发路径分离。
2. 沙箱内拉齐工作区各仓库，可切换分支，但**约定不修改**业务文件。
3. Skill / 多端审查按**仓库名**定位仓库；磁盘上的 `{slug}-{id8}` 仅作路径去重，不是 skill 标识。
4. 审查由 **skill + 整仓当前树** 驱动；当日 commit/diff 仅为可选上下文，无 commit 不整仓跳过。
5. 审查范围默认工作区全部仓库（`CodeReviewSource` 仅作排除），已在实现中落地，本设计与之衔接。

不做此前否决的「工作区级 bare/mirror 统一对象库」方案。

## 目标

- 每个 FlowX `Workspace` 拥有一份长期 CR 沙箱目录，内含该工作区纳入审查的各仓 clone。
- Daily CR 的 sync / checkout / AI cwd 只使用沙箱路径，不再改写工作区主树。
- Unit 输入同时提供 `repositoryName` 与 `localPath`，并附带 `workspaceRepositoryMap`，供 skill 按仓名解析。
- Prompt 明确禁止修改业务文件、commit、push（本期不做文件系统只读加固）。
- 无当日 commit 时仍可按 skill 审查当前树。

## 非目标

- 不做 bare/mirror 共享对象库或 git worktree 统一架构。
- 不改变 workflow 的 per-run 可写拷贝模型。
- 本期不做 chmod / 只读挂载等强制只读。
- 不把多仓合成单一 git monorepo。
- 不改变工作流「实现审查」（prompt 主导、skill 辅助）产品边界。

## 设计原则

### CR 与开发磁盘隔离

```text
.flowx-data/
  workspaces/{workspaceId}/repositories/...   # 主 clone（登记/其它用途；CR 不 checkout）
  workflows/{workflowRunId}/repositories/...  # 开发可写
  code-review/workspaces/{workspaceId}/
    repositories/{slug}-{repoId8}/            # CR 专用沙箱
```

根目录可通过环境变量覆盖（建议 `CODE_REVIEW_REPOS_ROOT`，默认落在与 `WORKSPACE_REPOS_ROOT` 同级的 `.flowx-data` 下）。

### 路径用 slug-id，skill 用仓库名

- 磁盘目录：`{slug}-{repoId8}`，避免重名冲突。
- Skill / 多端审查识别：`Repository.name`（及 map 中的 `name`）。
- 禁止要求 skill 书写或匹配 slug-id 片段。

### Skill + 整仓主导

审查主输入是沙箱内当前工作树 + 仓库内 review skill；近期 commit/diff 可选附带。无当日变更不视为「无需审查」。

### 只读靠约定

本期通过 prompt / skill 说明约束；平台不强制 FS 只读。

## 布局与按仓名解析

### 沙箱路径

```text
{CODE_REVIEW_REPOS_ROOT|.flowx-data}/code-review/workspaces/{workspaceId}/repositories/{slug}-{repoId8}
```

路径可由 `workspaceId` + `repositoryId` + name slug **确定性计算**，首版可不新增 Prisma 列；若运维需要可观测同步状态，再增加可选字段（如 `codeReviewLocalPath`、`codeReviewSyncStatus`）。

### Unit / Prompt 契约

每次审查 unit 至少包含：

```ts
{
  repositoryId: string;
  repositoryName: string;       // Repository.name，skill 认这个
  localPath: string;            // CR 沙箱绝对路径
  branch: string;
  workspaceRepositoryMap: Array<{
    name: string;
    repositoryId: string;
    localPath: string;
  }>;
  discoveredSkill?: { relativePath: string; content: string } | null;
  // 可选：近期 commits / commitDiffBundle 作上下文
}
```

Prompt 约定：

1. 若 skill 指定仓库名，用 `repositoryName` 或 `workspaceRepositoryMap` 解析到 `localPath`。
2. 不要依赖目录名中的 slug-id。
3. 禁止修改业务文件、禁止 `git commit` / `git push`；允许 `fetch` / 只读查看（切分支由平台在调用前完成）。

同工作区 `Repository.name` 冲突时：以 `repositoryId` 为准，map 中保留多项并在日志/报告中提示歧义；产品上仍应避免重名登记。

## 同步、切分支与审查流程

### 纳入范围

与现有逻辑一致：

- 默认：项目所属工作区的全部 `Repository`。
- 排除：`CodeReviewSource` 且 `isActive === false`。
- 无仓库或全部排除：空跑（`SKIPPED_NO_CR_SOURCES` 语义保留，文案区分无仓 / 全排除）。

### `ensureCodeReviewSandbox(repo, branch)`

1. 计算沙箱路径。
2. 若不存在 `.git`：从远程 `clone`（不从工作区主树 checkout 出业务状态作为唯一来源；可选用远程 URL，与主树一致的凭证策略）。
3. `fetch --prune`。
4. Checkout 目标分支（默认 `currentBranch || defaultBranch`）。
5. 返回沙箱 `localPath` 与同步结果。

Daily CR **停止**对工作区主树调用会改 HEAD 的 `ensureRepositoryReadyForReview`（或将其仅用于非 CR 场景）。

### 生成审查

```text
解析纳入仓列表
  → 并行/串行 ensureCodeReviewSandbox（建议 per-repo 锁）
  → 构建 workspaceRepositoryMap（仅纳入仓）
  → 每仓：发现 skill → AI 按 skill 审当前树（可选附 commit/diff）
  → 无 skill → SKIPPED_NO_SKILL；sync 失败 → 该仓 FAILED；其它仓继续
```

无当日 commit：仍创建 unit 并调用 AI（不再因无 group/commit 而跳过该仓）。

## 数据与兼容

| 概念 | 行为 |
|---|---|
| `Repository.localPath` | 继续表示工作区主 clone |
| CR 沙箱 path | 确定性路径；可选后续持久化 |
| 旧 CR 行为 | 升级后新生成走沙箱；历史报告不改写 |
| 凭证 | 复用现有 git remote auth（组织/环境变量） |

## 分期

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| **P0** | `ensureCodeReviewSandbox`；CR 生成改用沙箱 path；主树不再被 CR checkout | 开发树 HEAD 不因 CR 改变 |
| **P1** | Unit + prompt 带 `workspaceRepositoryMap`；整仓 skill 审查；更新 `daily-code-review.prompt` | 无 commit 仍可 COMPLETED/有 findings；skill 可按仓名解析 |
| **P2** |（可选）UI 展示沙箱同步/分支；失败重试 | 运维可感知 |
| **P3** |（可选）只读加固与沙箱 GC | 误写可挡；磁盘可回收 |

## 失败语义

| 情况 | 行为 |
|---|---|
| 单仓 clone/fetch/checkout 失败 | 该仓 unit `FAILED` + 原因；其它仓继续 |
| 无 review skill | 该仓 `SKIPPED_NO_SKILL` + skillHint |
| AI 失败 | 该仓 `FAILED` |
| 工作区无仓 / 全部排除 | 整次空跑，非假成功 |

## 成功标准

- CR 与开发使用不同磁盘根路径。
- 工作区多仓可在 CR 沙箱内拉齐、切分支并完成审查。
- Skill 按 `Repository.name` 能解析到对应沙箱 `localPath`。
- 无当日 commit 仍可按 skill 审查。
- Prompt 明确禁止改代码；本期不强制 FS 只读。

## 开放实现项

- `CODE_REVIEW_REPOS_ROOT` 与 `WORKSPACE_REPOS_ROOT` 的默认拼接方式。
- 多仓 sandbox sync 的并行度与锁实现（进程内 mutex vs 文件锁）。
- 是否在 P1 完全去掉「无 commit 不建 unit」的旧分组逻辑，或保留 commits 仅作附件。
- Cursor/Codex executor 是否放宽「禁止执行 shell」以便 skill 读仓（需与安全约束平衡；默认仍优先平台已挂载的 tree + map）。
