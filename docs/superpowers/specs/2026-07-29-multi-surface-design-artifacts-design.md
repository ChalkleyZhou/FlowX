# 工作流设计阶段：多端多页设计稿

日期：2026-07-29  
状态：已确认  
范围：Workflow OpenDesign 设计阶段（产品构思仍为单份 `prd.md`）

## 背景

当前设计阶段协议与预览假设**一份**自包含单页 HTML（`designArtifact.html`）。真实需求常按端拆分（Web / 移动 / 管理后台等），且一端内可有多页原型。需要在不大改工作流状态机的前提下，让本地目录、MCP 回传与 Web 预览支持「按需多端、端内多页」。

## 目标

1. 本地以 `design/<surfaceId>/*.html` 组织多端多页稿。
2. 按端增量回传：一次 submit 更新一端的完整页集；其它端保留。
3. Web「有啥展示啥」：动态端 Tab + 页列表 + iframe，不预置空端。
4. 不预声明端 scope：人觉得够了即可确认（至少 1 页）。
5. Skill 推荐中文目录名，平台不强制枚举。

## 非目标

- PRD / 构思阶段强制声明端清单。
- 按端各自确认、按页增量 merge。
- iOS / Android 细分端。
- 独立 `DesignSurface` / `DesignPage` Prisma 模型（本阶段用 stage output 清单 + 磁盘文件即可）。
- **保留旧单字段 `designArtifact.html` 或旧预览 API `GET .../design-artifact` 的兼容路径**（一次性切换到新契约）。

## 决策摘要

| 项 | 选择 |
|----|------|
| 拆分维度 | 按端（目录）；端内多页 |
| 端范围 | 按需；不预声明 |
| 回传粒度 | 按端增量；该端 pages **整端替换** |
| 本地布局 | `design/<surfaceId>/*.html` |
| Web 预览 | 动态 Tab（有啥出啥）+ 页列表 + iframe |
| 落地路径 | 协议扩展（不新开一等公民表） |
| 推荐目录名 | Skill 推荐 `Web端` / `移动端` / `管理后台` |
| 旧契约 | **删除**，不做兼容 shim |

## 架构

```
构思 prd.md（不强制写端）
  → 本地 design/<surfaceId>/*.html
  → submit_design（按端，surfaces[]）
  → 云端按 surfaceId merge 落盘 + Stage output 清单
  → Web：动态 Tab → 页列表 → iframe
  → 确认（清单 ≥ 1 page）
```

职责：

- **Protocol**：`output.surfaces[]` 为必填交付物；`design` / `demo` 结构化字段保留。
- **Local / MCP**：目录即真相；按端打包；Skill 写推荐目录名。
- **Cloud**：按 `surfaceId` merge；清单进 StageExecution.output；HTML 落 `.flowx-data/design-artifacts/`。
- **Web**：只渲染清单中出现的端与页；确认不校验「推荐名」或「多端齐」。

## 本地目录

```text
~/.flowx/design-sessions/<sessionId>/
  prd.md
  design/
    Web端/
      首页.html
      详情.html
    移动端/
      首页.html
    管理后台/          # 按需；没有就不建、不传
      仪表盘.html
  result.json
```

约定：

- `surfaceId` = `design/` 下一级目录名原文（可为中文）。
- `pageId` = 去掉 `.html` 的文件名（建议稳定、可读；同端内唯一）。
- 可选同目录 `pages.json` 覆盖 `title` / 排序；缺省则 title≈文件名、排序按文件名。
- Skill 文案：若涉及多端，**优先**使用 `Web端` / `移动端` / `管理后台`；其它名称也可，平台按实际目录展示与回传。

## 协议

将 `flowx-design-result` 升级为多端契约（实现时递增 format / protocol 版本，并同步所有消费者）。

### `DesignCompletionReport.output`（新）

```ts
output: {
  design: Record<string, unknown>;  // 保留
  demo: Record<string, unknown>;    // 保留
  surfaces: Array<{
    id: string;                     // surfaceId，非枚举
    pages: Array<{
      id: string;                   // pageId，同端内唯一
      title?: string;
      html: string;                 // 完整 HTML 文档
    }>;
  }>;
}
```

规则：

- `surfaces` 必填，且至少包含 1 个 surface；每个 surface 的 `pages` 至少 1 页（空端应不传）。
- **按端增量**：一次 submit 通常只带 1 个 surface；服务端仅替换这些 surfaceId 对应的页集。
- 一次也可带多个 surface（整包快照式），语义仍是「名单内每个 surface 整端替换」。
- **不再接受** `designArtifact: { html }`；提交含旧字段而无 `surfaces` 时返回 400，并提示改用新契约。

### Handoff `outputContract`

`requiredFields` 改为 `design`、`demo`、`surfaces`（不再包含 `designArtifact`）。

## 云端存储与 Merge

1. 落盘路径：`.flowx-data/design-artifacts/<workflowRunId>/<surfaceId>/<pageId>-<timestamp>.html`（`surfaceId` / `pageId` 做文件系统安全编码）。
2. StageExecution.output 维护当前清单，例如：

```ts
{
  design: ...,
  demo: ...,
  surfaces: [{
    id: "Web端",
    pages: [{ id: "首页", title: "首页", relPath, bytes, generatedAt }]
  }]
}
```

不在 JSON 内联 html。

3. Merge：对本次 payload 中出现的每个 `surfaceId`，用其 `pages` **整体替换**该端当前页集；未出现的 surface 保持不变。
4. 删除某页：该端新页集中不包含该 `pageId`。
5. Artifact 登记：可按页注册（类型沿用或扩展为设计 HTML），便于证据链；UI 以 stage 清单为准。
6. 单页大小上限沿用现有（约 5MB）；超限则该次 submit 失败，其它端不动。

## Web 展示与 API

### UI（工作流详情 · 设计阶段）

- Tab = 当前清单中的 `surfaceId`（有啥出啥；无空占位）。
- 选中端后：页列表（`title` 或 `pageId`）+ sandboxed iframe。
- 确认前可展示摘要：「当前包含：Web端(3) · 移动端(1)」。

### API

- `GET /workflow-runs/:id/design-artifacts` → 当前清单（surfaces + pages 元数据，无 html 正文）。
- `GET /workflow-runs/:id/design-artifacts/:surfaceId/:pageId` → 该页 html（路径参数需 URL 编码）。
- **删除** `GET /workflow-runs/:id/design-artifact`（单 latest HTML）；Web 与测试全部改用新 API。

### 确认闸门

- 清单中至少 1 个 page 才可「确认设计」；否则禁用并提示先回传。
- 不要求多端齐；不校验推荐目录名。
- 驳回 / 重新构思行为保持现网语义；磁盘历史文件可保留对照，清单以最新成功 submit 为准。

## 本地 Adapter / MCP

- `flowx_submit_design`：从 `design/<surfaceId>/` 扫描生成 `surfaces`（可指定本次只交某一端）；写入 `result.json` 后回传。
- Skill（产品构思 / 设计）：说明推荐目录名与「按端回传、有啥展示啥」。
- 文档：`docs/opendesign-design-stage.md`、`docs/local-agent-guide.md` 与 Web 镜像同步更新；标明旧单 HTML 契约已废弃。

## 错误处理

| 情况 | 行为 |
|------|------|
| 缺 `surfaces` 或仍只带旧 `designArtifact` | 400，明确迁移提示 |
| `surfaceId` / `pageId` 空、pages 空 | 400 |
| 单页超大小上限 | 400，该次不落盘 |
| idempotency 重复同报告 | 与现 ExecutionSession 行为一致 |
| 会话非 DESIGN / 状态不允许 | 与现网一致 |

## 测试要点

- Protocol：新 output schema；拒绝仅 `designArtifact`。
- API：按端 merge（交移动不影响 Web）；整端替换删页；清单 API + 单页 html API。
- Web：仅渲染已有端；确认按钮在 0 页禁用、≥1 页可用。
- Local/MCP：多目录扫描、中文 surfaceId、单端 submit 打包。

## 文档与迁移

- 面向用户的指南改为只描述多端多页契约。
- 已有环境中仅含旧单 HTML 产物的进行中工作流：实现阶段需明确处理策略（建议：进入设计待确认的旧 run 要求重新按新契约回传，或一次性只读迁移脚本——**默认可接受「需重新回传」**，避免兼容层）。

## 开放实现细节（不阻塞产品定稿）

- `pages.json` schema 的精确字段。
- 文件系统安全编码算法选型。
- Artifact 表 `artifactType` 是否细分 per-page。
- 协议版本号具体 bump 值（实现时按 `packages/flowx-protocol` 规范处理）。
