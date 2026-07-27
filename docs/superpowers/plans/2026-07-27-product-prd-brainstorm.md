# 产品构思改为 PRD 头脑风暴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本地产品构思从 Superpowers/`spec.md` 改为「先头脑风暴、再写精简 `prd.md`」的 `flowx-product-prd` Skill，面向产品经理/设计师，并同步协议、Adapter、MCP、Web 文案与手册。

**Architecture:** 新用户级 Skill 模板 + `flowx-local setup` 安装名切换；协议 `resultFileName` 改为 `prd.md`；OpenDesign adapter 主读 `prd.md` 并兼容 `spec.md`/`brainstorm.md`；MCP/Web/文档文案对齐。不改工作流状态机与 submit API 形状。

**Tech Stack:** `@flowx-ai/local`、`@flowx-ai/protocol`、`flowx-mcp`、NestJS workflow handoff、React Web、Vitest

**Spec:** `docs/superpowers/specs/2026-07-27-product-prd-brainstorm-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/flowx-local/templates/flowx-product-prd/SKILL.md` | 新 PRD 头脑风暴 Skill（主） |
| `packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md` | 改为弃用说明 stub，或删除（见 Task 1） |
| `packages/flowx-local/src/setup.ts` | `SKILL_NAME = flowx-product-prd` |
| `packages/flowx-local/src/setup.test.ts` | 断言新路径与 `prd.md` |
| `packages/flowx-protocol/src/brainstorm.ts` | `resultFileName: 'prd.md'` |
| `apps/api/src/workflow/workflow.service.ts` | handoff `resultFileName: 'prd.md'` |
| `apps/api/src/workflow/workflow-local-design.spec.ts` | 断言 `prd.md` |
| `packages/flowx-local/src/adapters/open-design-adapter.ts` | 初始 `prd.md`、INSTRUCTIONS、读取顺序 |
| `packages/flowx-local/src/adapters/open-design-adapter.test.ts` | 优先 `prd.md` |
| `packages/flowx-local/src/mcp.ts` | tool 描述文案 |
| `packages/flowx-mcp/src/tools.ts` | tool 描述文案 |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | 引导/toast/按钮「规格」→「PRD/产品需求」 |
| `docs/user-manual.md` + public 镜像 | 用户可见流程 |
| `docs/local-agent-guide.md` + public 镜像 | setup / PRD 流程 |
| `docs/opendesign-design-stage.md`、`docs/edge-agent-operations.md` | 专题文档（若仍写 spec） |

---

### Task 1: 新 Skill 模板 + setup 切换

**Files:**
- Create: `packages/flowx-local/templates/flowx-product-prd/SKILL.md`
- Modify: `packages/flowx-local/src/setup.ts`（`SKILL_NAME`）
- Modify: `packages/flowx-local/src/setup.test.ts`
- Modify or Delete: `packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md`

- [ ] **Step 1: Write failing setup tests**

In `setup.test.ts`, change expectations from `flowx-brainstorm-spec` / `spec.md` to:

```typescript
expect(cursorSkill).toContain('flowx-product-prd'); // path includes this
expect(readFileSync(cursorSkill, 'utf8')).toContain('prd.md');
expect(readFileSync(cursorSkill, 'utf8')).toContain('头脑风暴');
expect(readFileSync(cursorSkill, 'utf8')).not.toContain('Superpowers');
expect(readFileSync(cursorSkill, 'utf8')).not.toContain('OpenSpec');
```

Update all path strings that currently use `flowx-brainstorm-spec` to `flowx-product-prd`.

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts
```

- [ ] **Step 3: Add Skill template**

Create `packages/flowx-local/templates/flowx-product-prd/SKILL.md`:

```markdown
---
name: flowx-product-prd
description: FlowX 产品构思：多轮头脑风暴澄清产品需求后，写出给产品经理/设计师确认的 prd.md，再经 MCP 回传。Use when FlowX local brainstorm / 产品构思 / OpenDesign brainstorm is active.
---

# FlowX 产品构思 → PRD

在 FlowX「产品构思」阶段（Cursor / OpenDesign + FlowX MCP）使用本 Skill。

## 读者与目标

- **读者：** 产品经理、设计师（以及确认需求的业务方）
- **目标：** 先**头脑风暴**把产品需求谈清楚，再产出确认后的 **`prd.md`**
- **不是：** 技术方案、接口设计、Superpowers/OpenSpec 风格工程 spec

## 必须流程

1. **拉上下文（MCP）**
   - `flowx_get_active_design_session`
   - `flowx_get_brainstorm_handoff`（有活跃会话时可省略 id）
2. **先头脑风暴，再写文档。** 用多轮问题澄清：要解决什么问题、给谁用、核心场景、边界、怎样算做成。未澄清够之前，不要写正式 `prd.md`。
3. **写 `prd.md`**（优先写在用户自己的项目目录），章节：
   - 背景与问题
   - 目标用户
   - 目标 / 非目标
   - 用户故事与核心场景
   - 产品规则与边界情况
   - 验收标准（用户可感知的结果）
   - 仍开放的产品问题（能关则先在对话关掉）
4. **把完整 `prd.md` 展示给用户**，明确询问是否正确、完整。
5. **仅在用户确认后**调用 `flowx_submit_brainstorm`，`report = { idempotencyKey, markdown }`，`markdown` = 完整 `prd.md` 正文。
6. **禁止**提交未确认草稿、对话原文、或把聊天记录当 PRD。

## 允许写入 `prd.md`

- 用户是谁、核心场景与产品流程（产品语言）
- 目标与非目标（业务边界）
- 产品规则、约束、边界情况（用户可感知）
- 验收标准（可观察的产品结果，不是测试代码）
- 仍开放的**产品**问题

## 禁止写入 `prd.md` 正文

- API / RPC / 协议字段、库与框架名、数据库与表结构
- 系统架构、模块拆分、组件/中间件实现方式
- 「用某某技术实现」类表述

技术疑点可在对话中标记「留给设计 / 技术方案阶段」；**不要**展开写进 `prd.md`。若用户坚持存量约束，只用一句产品语言转述（例如「需对接现有登录」），不写实现方式。

## 备注

- workflow / session id 来自 MCP，不要写死在本 Skill
- 成功回传后平台进入设计阶段，并展示本次 PRD Markdown
```

- [ ] **Step 4: Point setup at new skill**

In `setup.ts`:

```typescript
const SKILL_NAME = 'flowx-product-prd';
```

- [ ] **Step 5: Deprecate old template**

Replace `templates/flowx-brainstorm-spec/SKILL.md` content with a short deprecated stub that points to `flowx-product-prd` and `flowx-local setup --force`, **or** delete the directory if nothing imports it by path except old docs. Prefer stub so accidental old installs still redirect readers.

- [ ] **Step 6: Run setup tests — PASS**

```bash
pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/flowx-local/templates/flowx-product-prd/SKILL.md \
  packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md \
  packages/flowx-local/src/setup.ts \
  packages/flowx-local/src/setup.test.ts
git commit -m "$(cat <<'EOF'
feat(local): add flowx-product-prd skill and switch setup install

EOF
)"
```

---

### Task 2: Protocol + API handoff `prd.md`

**Files:**
- Modify: `packages/flowx-protocol/src/brainstorm.ts`
- Modify: `apps/api/src/workflow/workflow.service.ts`（~3298）
- Modify: `apps/api/src/workflow/workflow-local-design.spec.ts`
- Check: `apps/api/src/edge/open-design-edge.service.spec.ts` if it asserts `spec.md`

- [ ] **Step 1: Update failing consumer tests first**

In `workflow-local-design.spec.ts` change:

```typescript
expect(result.handoff.contextPackage.outputContract.resultFileName).toBe('prd.md');
```

Any fixture with `resultFileName: 'spec.md'` → `'prd.md'`.

- [ ] **Step 2: Run API local-design test — expect FAIL**

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-design.spec.ts
```

- [ ] **Step 3: Change protocol type**

```typescript
outputContract: {
  resultFileName: 'prd.md';
  format: 'flowx-brainstorm-markdown-v1';
};
```

Keep `format` string unchanged (YAML/API contract id; no need to rename).

- [ ] **Step 4: Change API handoff builder**

In `workflow.service.ts` where brainstorm context package sets `resultFileName: 'spec.md'`, set `'prd.md'`.

- [ ] **Step 5: Build protocol + re-run tests**

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/protocol test
pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-design.spec.ts src/edge/open-design-edge.service.spec.ts
```

Expected: PASS（若 edge spec 仍写 spec.md，一并改）

- [ ] **Step 6: Commit**

```bash
git add packages/flowx-protocol/src/brainstorm.ts \
  apps/api/src/workflow/workflow.service.ts \
  apps/api/src/workflow/workflow-local-design.spec.ts \
  apps/api/src/edge/open-design-edge.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(protocol): use prd.md as brainstorm handoff result file

EOF
)"
```

---

### Task 3: OpenDesign adapter — `prd.md` 主路径与兼容读取

**Files:**
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.ts`
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.test.ts`

- [ ] **Step 1: Update adapter tests (TDD)**

Change brainstorm launch expectations:

- `resultPath` ends with `prd.md`
- initial file / instructions contain `flowx-product-prd` and `prd.md`
- Prefer reading `prd.md`; still fall back to `spec.md` then `brainstorm.md`

Example assertion updates:

```typescript
expect(launched.resultPath.endsWith('prd.md')).toBe(true);
expect(readFileSync(launched.resultPath, 'utf8')).toContain('flowx-product-prd');
```

Add/adjust submit test: write `prd.md` and ensure markdown is submitted; keep a case that `spec.md` still works when `prd.md` absent.

- [ ] **Step 2: Run adapter tests — FAIL**

```bash
pnpm --filter @flowx-ai/local exec vitest run src/adapters/open-design-adapter.test.ts
```

- [ ] **Step 3: Implement adapter changes**

1. Brainstorm `resultFileName` prefer handoff contract, fallback `'prd.md'`:

```typescript
const resultFileName =
  stage === 'brainstorm'
    ? input.handoff.contextPackage.outputContract?.resultFileName ?? 'prd.md'
    : input.handoff.contextPackage.outputContract.resultFileName;
```

（若 brainstorm 类型已固定 `'prd.md'`，直接用 contract 字段即可。）

2. Replace `writeInitialMarkdown` seed with Chinese PRD outline + `flowx-product-prd` instructions (sections matching spec).

3. Update `buildInstructions` brainstorm branch: Skill 名、`prd.md`、头脑风暴、读者、禁止实现细节；兼容句改为「可读本目录 `prd.md`（兼容 `spec.md` / `brainstorm.md`）」。

4. `readBrainstormMarkdown` candidates:

```typescript
const candidates = [
  resultPath,
  join(root, 'prd.md'),
  join(root, 'spec.md'),
  join(root, 'brainstorm.md'),
];
```

5. Error message: empty file text mention `prd.md (or legacy spec.md / brainstorm.md)`.

- [ ] **Step 4: Run adapter tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-local/src/adapters/open-design-adapter.ts \
  packages/flowx-local/src/adapters/open-design-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(local): prefer prd.md for OpenDesign brainstorm artifacts

EOF
)"
```

---

### Task 4: MCP tool 描述（local + flowx-mcp）

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-mcp/src/tools.ts`
- Modify related `*.test.ts` if they assert old copy

- [ ] **Step 1: Update descriptions**

`flowx_get_brainstorm_handoff`：澄清 → 写 `prd.md`（产品经理/设计师可读的 PRD）→ 确认。

`flowx_submit_brainstorm`：提交用户已确认的 **PRD** Markdown（`prd.md`）；勿提交草稿或对话原文。

Remove / avoid `spec.md` as primary wording（可一句兼容旧文件名即可）。

- [ ] **Step 2: Run MCP/local mcp tests**

```bash
pnpm --filter @flowx-ai/local exec vitest run src/mcp.test.ts
pnpm --filter flowx-mcp test
```

- [ ] **Step 3: Commit**

```bash
git add packages/flowx-local/src/mcp.ts packages/flowx-mcp/src/tools.ts
# + any test files touched
git commit -m "$(cat <<'EOF'
docs(mcp): describe brainstorm handoff as product PRD

EOF
)"
```

---

### Task 5: Web 文案

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`（若断言旧文案）

- [ ] **Step 1: Update user-visible strings**

| 位置 | 新文案（建议） |
| --- | --- |
| 打开本地构思成功 | `已打开 Open Design。请按 flowx-product-prd：头脑风暴澄清 → 写 prd.md → 确认后再 MCP 回传产品需求。` |
| 会话就绪 | `构思会话已就绪。请先 flowx-local setup，再打开 Open Design，头脑风暴并确认 prd.md 后回传。` |
| 按钮「回传规格」 | `回传 PRD` |
| toast 成功 | `本地产品需求（PRD）已回传` |
| toast 失败 / outbox | 「规格」→「PRD」或「产品需求」 |
| 重新构思确认 | `将回到产品构思并重新编写产品需求；已有设计产物会保留供对照。` |

- [ ] **Step 2: Fix tests that look for old labels**（如「回传规格」）

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx \
  apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): present brainstorm output as product PRD copy

EOF
)"
```

---

### Task 6: 文档与镜像

**Files:**
- `docs/user-manual.md` + `apps/web/public/user-manual.md`
- `docs/local-agent-guide.md` + `apps/web/public/local-agent-guide.md`
- `docs/opendesign-design-stage.md`
- `docs/edge-agent-operations.md`（若仍写 brainstorm-spec / spec.md）

- [ ] **Step 1: Rewrite构思相关段落**

要点：

- Skill 名：`flowx-product-prd`；`flowx-local setup` / `--force` 迁移
- 流程：头脑风暴 → `prd.md` → 确认 → `flowx_submit_brainstorm`
- 读者：产品经理/设计师；不写实现细节
- 旧 `flowx-brainstorm-spec` / `spec.md` 标注弃用/兼容

- [ ] **Step 2: Sync mirrors + cmp**

```bash
# after editing docs sources, copy to public or edit both
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/user-manual.md apps/web/public/user-manual.md \
  docs/local-agent-guide.md apps/web/public/local-agent-guide.md \
  docs/opendesign-design-stage.md docs/edge-agent-operations.md
git commit -m "$(cat <<'EOF'
docs: document product PRD brainstorm flow

EOF
)"
```

---

### Task 7: 收尾验证

- [ ] **Step 1: Focused tests**

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp test
pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-design.spec.ts
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

Expected: all PASS / cmp exit 0

- [ ] **Step 2: Manual smoke（可选）**

1. `flowx-local setup --force`  
2. 打开本地构思 → 确认会话目录/`INSTRUCTIONS` 提 `prd.md` 与 `flowx-product-prd`  
3. 写短 PRD 确认回传 → Web 展示产品需求 Markdown  

---

## Spec coverage checklist

| Spec 要求 | Task |
| --- | --- |
| 先头脑风暴再写文档 | Task 1 Skill |
| 产物 `prd.md` | Task 1–3 |
| 精简产品向章节 / 禁止实现细节 | Task 1 Skill + Task 3 seed/INSTRUCTIONS |
| Skill `flowx-product-prd` + setup | Task 1 |
| 不参考 Superpowers/OpenSpec | Task 1 测试 `not.toContain` |
| 兼容 `spec.md` / `brainstorm.md` | Task 3 |
| API submit 契约不变 | Task 2–4（仅文案/文件名） |
| Web / 手册文案 | Task 5–6 |
| 云端 runBrainstorm 不同步 | 无任务（YAGNI） |
| 不硬拦截关键词 | 无任务 |

## Placeholder / consistency self-review

- Skill 名全文统一 `flowx-product-prd`；文件名统一 `prd.md`
- Protocol literal `'prd.md'` 与 API / adapter / tests 一致
- `format: 'flowx-brainstorm-markdown-v1'` 保持不变，避免无必要协议大版本噪音
