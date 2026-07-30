# 设计阶段 Markdown + HTML 预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设计阶段工作流详情只展示「设计文档 Markdown」与「HTML 预览」两块；提交契约增量必填顶层 `markdown`，结构化 `design`/`demo`/`surfaces` 仍持久化但不在 StageCard 展开。

**Architecture:** 在 `@flowx-ai/protocol` 的 `DesignCompletionReport` 增加必填 `markdown`；API 本地完成路径校验并写入 StageExecution.output；云端 AI 路径由服务端从结构化结果生成 markdown 再持久化；Web 用独立文档面板读 `output.markdown`，DESIGN 的 StageCard 不再渲染字段树；Local/MCP/Skill/手册同步 `design.md`。

**Tech Stack:** TypeScript、NestJS、Vitest、React、`@flowx-ai/protocol`、`@flowx-ai/local`、`flowx-mcp`

**Spec:** `docs/superpowers/specs/2026-07-30-design-stage-markdown-display-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/flowx-protocol/src/design.ts` | `DesignCompletionReport.markdown`；handoff `markdownFileName` |
| `packages/flowx-protocol/src/protocol.test.ts` | 协议形状断言 |
| `apps/api/src/edge/dto/complete-open-design.dto.ts` | HTTP DTO 必填 `markdown` |
| `apps/api/src/workflow/workflow.service.ts` | 校验 markdown、`toPersistedDesignStageOutput`、AI 合成 markdown、handoff |
| `apps/api/src/workflow/workflow-local-design.spec.ts` | 本地完成有/无 markdown |
| `apps/api/src/ai/design-markdown.ts`（新建） | 从 design/demo 生成 markdown（云端 AI 路径） |
| `apps/api/src/ai/design-markdown.spec.ts`（新建） | 合成函数单测 |
| `packages/flowx-local/src/mcp.ts` | zod `designReportSchema.markdown` |
| `packages/flowx-local/src/mcp.test.ts` | schema / submit fixture |
| `packages/flowx-local/src/adapters/open-design-adapter.ts` | 写 `design.md` 模板、instructions |
| `packages/flowx-local/templates/flowx-product-prd/SKILL.md` | 设计段：`design.md` + markdown 提交 |
| `packages/flowx-mcp/src/flowx-api-client.ts` | `DesignCompletionReportInput.markdown` |
| `packages/flowx-mcp/src/tools.ts` | zod + 工具描述 |
| `packages/flowx-mcp/src/tools.test.ts` | submit fixture |
| `apps/web/src/components/DesignDocumentPanel.tsx`（新建） | MD 模块 + 空态 |
| `apps/web/src/components/DesignDocumentPanel.test.tsx`（新建） | 有/无 markdown |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | DESIGN：StageCard.output 清空；挂文档面板 |
| `apps/web/src/pages/WorkflowRunDetailPage.test.tsx` | 断言不渲染字段树、渲染 MD/空态 |
| `docs/opendesign-design-stage.md`、`docs/local-agent-guide.md`、`docs/user-manual.md` + `apps/web/public` 镜像 | 用户可见文档 |

---

### Task 1: Protocol — `markdown` 契约

**Files:**
- Modify: `packages/flowx-protocol/src/design.ts`
- Modify: `packages/flowx-protocol/src/protocol.test.ts`

- [ ] **Step 1: 写失败测试（先改测试期望）**

在 `protocol.test.ts` 的 design report 用例中，要求 `report.markdown` 为非空字符串，并期望 handoff `outputContract.markdownFileName === 'design.md'`：

```ts
const context: OpenDesignContextPackage = {
  // ...existing fields...
  outputContract: {
    resultFileName: 'result.json',
    markdownFileName: 'design.md',
    format: 'flowx-design-result-v2',
    requiredFields: ['design', 'demo', 'surfaces'],
  },
};
const report: DesignCompletionReport = {
  idempotencyKey: 'design:session-1:v1',
  markdown: '# 设计文档\n\n概述…',
  output: {
    design: { overview: 'Export page' },
    demo: { summary: 'Primary flow' },
    surfaces: [
      {
        id: 'Web端',
        pages: [{ id: 'index', html: '<!doctype html><html></html>' }],
      },
    ],
  },
};
expect(report.markdown.length).toBeGreaterThan(0);
expect(context.outputContract.markdownFileName).toBe('design.md');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowx-ai/protocol test`

Expected: FAIL（类型/属性尚不存在，或测试断言失败）

- [ ] **Step 3: 最小实现**

`packages/flowx-protocol/src/design.ts`：

```ts
export interface OpenDesignContextPackage {
  // ...unchanged fields...
  outputContract: {
    resultFileName: string;
    /** 人读设计文档，与 brainstorm 的 prd.md 对齐 */
    markdownFileName: 'design.md';
    format: 'flowx-design-result-v2';
    requiredFields: readonly ['design', 'demo', 'surfaces'];
  };
  metadata?: Record<string, unknown>;
}

export interface DesignCompletionReport {
  idempotencyKey: string;
  /** 平台「设计文档」模块唯一正文 */
  markdown: string;
  summary?: string;
  output: FlowXDesignOutput;
  metadata?: Record<string, unknown>;
}
```

保留 `resultFileName: 'result.json'`（结构化报告模板）；人读文档文件名为并列字段 `markdownFileName`（对应 spec 中「或并列字段」）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowx-ai/protocol test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-protocol/src/design.ts packages/flowx-protocol/src/protocol.test.ts
git commit -m "$(cat <<'EOF'
feat(protocol): require design completion markdown

EOF
)"
```

---

### Task 2: API — 从 design/demo 合成 markdown（AI 路径）

**Files:**
- Create: `apps/api/src/ai/design-markdown.ts`
- Create: `apps/api/src/ai/design-markdown.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/ai/design-markdown.spec.ts
import { describe, expect, it } from 'vitest';
import { buildDesignMarkdownFromStructured } from './design-markdown';

describe('buildDesignMarkdownFromStructured', () => {
  it('builds a readable markdown document from design and demo', () => {
    const md = buildDesignMarkdownFromStructured(
      {
        overview: '导出页改版',
        pages: [{ name: '首页', route: '/', layout: '单列', keyComponents: ['按钮'], interactions: ['点击导出'] }],
        demoScenario: '用户导出报表',
        designRationale: '降低认知负担',
      },
      {
        summary: '主流程可走通',
        flows: [{ name: '导出', goal: '完成导出', entry: '/', states: ['空态', '成功'] }],
        scope: { included: ['Web'], excluded: ['移动端'] },
        knownGaps: ['无暗色'],
      },
    );
    expect(md).toContain('# 设计文档');
    expect(md).toContain('导出页改版');
    expect(md).toContain('用户导出报表');
    expect(md).toContain('主流程可走通');
    expect(md).toContain('导出');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-api exec vitest run src/ai/design-markdown.spec.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// apps/api/src/ai/design-markdown.ts
import type { DemoArtifact, DesignSpec } from '../common/types';

export function buildDesignMarkdownFromStructured(
  design: DesignSpec,
  demo: DemoArtifact,
): string {
  const pages = (design.pages ?? [])
    .map((page, index) => {
      const title = typeof page.name === 'string' ? page.name : `页面 ${index + 1}`;
      const route = typeof page.route === 'string' ? page.route : '';
      const layout = typeof page.layout === 'string' ? page.layout : '';
      return [`### ${title}`, route ? `- 路由：${route}` : '', layout ? `- 布局：${layout}` : '']
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const included = demo.scope?.included?.length ? demo.scope.included.join('、') : '（无）';
  const excluded = demo.scope?.excluded?.length ? demo.scope.excluded.join('、') : '（无）';
  const flows =
    (demo.flows ?? [])
      .map((f) => `- ${f.name}：${f.goal}（入口 ${f.entry}）`)
      .join('\n') || '- （无）';
  const gaps = (demo.knownGaps ?? []).map((g) => `- ${g}`).join('\n') || '- （无）';

  return [
    '# 设计文档',
    '',
    '## 概述',
    '',
    design.overview?.trim() || '（无）',
    '',
    '## 页面',
    '',
    pages || '（无）',
    '',
    '## Demo 场景',
    '',
    design.demoScenario?.trim() || '（无）',
    '',
    '## 设计理由',
    '',
    design.designRationale?.trim() || '（无）',
    '',
    '## Demo 摘要',
    '',
    demo.summary?.trim() || '（无）',
    '',
    '## 流程',
    '',
    flows,
    '',
    '## 范围',
    '',
    `- 包含：${included}`,
    `- 排除：${excluded}`,
    '',
    '## 已知缺口',
    '',
    gaps,
    '',
  ].join('\n');
}
```

（若 `DesignSpec.pages` 元素类型字段名与仓库不一致，以 `apps/api/src/common/types.ts` 为准微调。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter flowx-api exec vitest run src/ai/design-markdown.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai/design-markdown.ts apps/api/src/ai/design-markdown.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): synthesize design markdown from structured output

EOF
)"
```

---

### Task 3: API — 持久化与本地完成校验

**Files:**
- Modify: `apps/api/src/edge/dto/complete-open-design.dto.ts`
- Modify: `apps/api/src/workflow/workflow.service.ts`（`toPersistedDesignStageOutput`、`completeLocalDesignSession`、AI `generateDesign` 持久化处、`buildOpenDesignHandoff`）
- Modify: `apps/api/src/workflow/workflow-local-design.spec.ts`
- Modify: 任何构造 `DesignCompletionReport` / handoff `outputContract` 的 API 测试 fixture

- [ ] **Step 1: 写失败测试**

在 `workflow-local-design.spec.ts` 增加：

```ts
it('rejects local design completion without markdown', async () => {
  // arrange DESIGN_PENDING + active session（沿用文件内既有 setup）
  await expect(
    service.completeLocalDesignSession(sessionId, {
      idempotencyKey: 'design:test:no-md',
      output: validDesignOutput, // design/demo/surfaces 合法
    } as never),
  ).rejects.toThrow(/markdown/i);
});

it('persists markdown on successful local design completion', async () => {
  const result = await service.completeLocalDesignSession(sessionId, {
    idempotencyKey: 'design:test:with-md',
    markdown: '# 设计文档\n\n正文',
    output: validDesignOutput,
  });
  const designStage = /* 取最新 DESIGN stage */;
  expect(designStage.output).toMatchObject({
    format: 'markdown',
    markdown: '# 设计文档\n\n正文',
  });
  expect(designStage.output.design).toBeDefined();
  expect(designStage.output.surfaces).toBeDefined();
});
```

更新既有成功用例的 report，补上 `markdown`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-design.spec.ts`  
Expected: FAIL（缺 markdown 校验 / 未持久化）

- [ ] **Step 3: 最小实现**

1. `CompleteOpenDesignDto` 增加：

```ts
@IsString()
@MaxLength(200_000)
markdown!: string;
```

2. `toPersistedDesignStageOutput` 改为：

```ts
private toPersistedDesignStageOutput(
  output: Pick<GenerateDesignOutput, 'design' | 'demo'> | { design: DesignSpec; demo: DemoArtifact },
  surfaces: DesignSurfaceInventory[],
  markdown: string,
): {
  format: 'markdown';
  markdown: string;
  design: DesignSpec;
  demo: DemoArtifact;
  surfaces: DesignSurfaceInventory[];
} {
  return {
    format: 'markdown',
    markdown,
    design: output.design,
    demo: output.demo,
    surfaces,
  };
}
```

3. `completeLocalDesignSession` 在 `assertDesignSpecOutput` 之前或之后：

```ts
const markdown = report.markdown?.trim() ?? '';
if (!markdown) {
  throw new BadRequestException('Design markdown is required.');
}
// ...
const persistedOutput = this.toPersistedDesignStageOutput(
  { design: parsed.design, demo: parsed.demo },
  persistedSurfaces,
  markdown,
);
```

4. AI `generateDesign` 成功路径：

```ts
const markdown = buildDesignMarkdownFromStructured(designResult.design, designResult.demo);
const persistedOutput = this.toPersistedDesignStageOutput(
  designResult,
  persistedSurfaces,
  markdown,
);
```

5. `buildOpenDesignHandoff` 的 `outputContract` 增加 `markdownFileName: 'design.md'`。

6. `submitLocalDesign`：若 body 无 markdown，用 `buildDesignMarkdownFromStructured` 合成后再持久化（兼容旧 IDE 扁平面 body）；若日后 DTO 带 markdown 则优先用提交值。

- [ ] **Step 4: 跑测试确认通过**

Run:

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-design.spec.ts
pnpm --filter flowx-api exec vitest run src/edge/open-design-edge.service.spec.ts
pnpm --filter flowx-api exec vitest run src/workflow/workflow.service.spec.ts
```

Expected: PASS（按需修 fixture）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/edge/dto/complete-open-design.dto.ts \
  apps/api/src/workflow/workflow.service.ts \
  apps/api/src/workflow/workflow-local-design.spec.ts \
  apps/api/src/ai/design-markdown.ts \
  apps/api/src/edge/open-design-edge.service.spec.ts \
  apps/api/src/workflow/workflow.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): persist and require design stage markdown

EOF
)"
```

---

### Task 4: Local MCP + adapter + Skill

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-local/src/mcp.test.ts`
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.ts`
- Modify: `packages/flowx-local/templates/flowx-product-prd/SKILL.md`
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.test.ts`（若有 handoff/template 断言）

- [ ] **Step 1: 写失败测试**

- `mcp.test.ts`：submit design 的合法 report 必须含 `markdown`；缺 markdown 的 schema parse 失败。  
- `open-design-adapter.test.ts`：会话初始化后工作区存在 `design.md`；instructions / README 提到 `design.md` 与 `flowx_submit_design` 的 `markdown`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowx-ai/local test`  
Expected: FAIL

- [ ] **Step 3: 最小实现**

1. `designReportSchema`：

```ts
const designReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  markdown: z.string().min(1),
  summary: z.string().optional(),
  output: z.object({ /* unchanged */ }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
```

2. `buildResultTemplate` 增加 `markdown: ''` 或占位说明字符串（提交前会被 agent 换成真正文；空串会被 API 拒绝，模板仅本地草稿）。

3. 新增 `writeInitialDesignMarkdown`（镜像 `writeInitialMarkdown`），写入 `design.md` 大纲：概述 / 页面与交互 / 多端说明 / 验收要点；在 design session launch 时调用。

4. README / instructions 文案：先写确认 `design.md`，再 `flowx_submit_design({ markdown, output })`；`output.surfaces` 规则不变。

5. Skill「多端设计稿」节补充：`design.md` 为平台展示正文，与 HTML 目录并列。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowx-ai/local test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-local
git commit -m "$(cat <<'EOF'
feat(local): require design.md markdown on design submit

EOF
)"
```

---

### Task 5: flowx-mcp 包对齐

**Files:**
- Modify: `packages/flowx-mcp/src/flowx-api-client.ts`
- Modify: `packages/flowx-mcp/src/tools.ts`
- Modify: `packages/flowx-mcp/src/tools.test.ts`

- [ ] **Step 1: 写失败测试**

`tools.test.ts` 中 `flowx_submit_design` fixture 增加 `markdown`；增加缺 markdown 时返回 invalid 的用例。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-mcp test`  
Expected: FAIL

- [ ] **Step 3: 最小实现**

```ts
export interface DesignCompletionReportInput {
  idempotencyKey: string;
  markdown: string;
  summary?: string;
  output: { /* unchanged */ };
  metadata?: Record<string, unknown>;
}
```

`designReportSchema` 增加 `markdown: z.string().min(1)`；工具 description 写明须提交确认后的 `design.md` 正文。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter flowx-mcp test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-mcp
git commit -m "$(cat <<'EOF'
feat(mcp): require markdown on flowx_submit_design

EOF
)"
```

---

### Task 6: Web — `DesignDocumentPanel` + 详情页裁剪

**Files:**
- Create: `apps/web/src/components/DesignDocumentPanel.tsx`
- Create: `apps/web/src/components/DesignDocumentPanel.test.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// DesignDocumentPanel.test.tsx
it('shows empty state when markdown missing', () => {
  render(<DesignDocumentPanel output={{ design: { overview: 'x' }, demo: {}, surfaces: [] }} />);
  expect(screen.getByText('尚未提交设计文档')).toBeTruthy();
});

it('renders markdown when present', () => {
  render(
    <DesignDocumentPanel
      output={{ format: 'markdown', markdown: '# 设计文档\n\n你好', design: {}, demo: {}, surfaces: [] }}
    />,
  );
  expect(screen.getByText(/设计文档/)).toBeTruthy();
  expect(screen.getByText(/你好/)).toBeTruthy();
});
```

在 `WorkflowRunDetailPage.test.tsx` 增加 DESIGN 用例：stage output 含 `design.overview` 与 `markdown` 时，页面显示 markdown，**不**显示「overview」字段树标签（或不断言出现嵌套 `design` 区块标题）；无 markdown 时出现「尚未提交设计文档」。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-web exec vitest run src/components/DesignDocumentPanel.test.tsx src/pages/WorkflowRunDetailPage.test.tsx`  
Expected: FAIL

- [ ] **Step 3: 最小实现**

`DesignDocumentPanel.tsx`（对齐现有 Card / SectionHeader 风格）：

```tsx
export function DesignDocumentPanel({ output }: { output: unknown }) {
  const markdown = extractDesignMarkdown(output);
  return (
    <Card className="rounded-md border-border bg-card">
      <CardHeader className="p-5 pb-0">
        <SectionHeader eyebrow="Design Doc" title="设计文档" description="与产品构思类似的一份 Markdown 设计说明。" />
      </CardHeader>
      <CardContent className="p-5 pt-4">
        {markdown ? (
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{markdown}</pre>
        ) : (
          <EmptyState description="尚未提交设计文档" />
        )}
      </CardContent>
    </Card>
  );
}

function extractDesignMarkdown(output: unknown): string | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const md = (output as { markdown?: unknown }).markdown;
  return typeof md === 'string' && md.trim() ? md : null;
}
```

`WorkflowRunDetailPage.tsx`：

- DESIGN 的 `StageCard`：`output: null`（保留 status / actions）。
- 在 StageCard 与 `DesignArtifactPreview` 之间（或预览之上）渲染：

```tsx
{selectedStage === 'DESIGN' && workflowRun ? (
  <DesignDocumentPanel output={getStage(workflowRun, 'DESIGN')?.output} />
) : null}
```

保持现有 `DesignArtifactPreview` 卡片不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter flowx-web exec vitest run src/components/DesignDocumentPanel.test.tsx src/pages/WorkflowRunDetailPage.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/DesignDocumentPanel.tsx \
  apps/web/src/components/DesignDocumentPanel.test.tsx \
  apps/web/src/pages/WorkflowRunDetailPage.tsx \
  apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): show design markdown and hide structured tree

EOF
)"
```

---

### Task 7: 文档与手册镜像

**Files:**
- Modify: `docs/opendesign-design-stage.md`
- Modify: `docs/local-agent-guide.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/local-agent-guide.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `docs/superpowers/specs/2026-07-29-multi-surface-design-artifacts-design.md`（仅在与本变更冲突的展示描述处加一句交叉引用，可选）

- [ ] **Step 1: 更新文案要点**

- 设计阶段平台展示：**设计文档（`design.md` / `markdown`）+ HTML 预览**；不再描述 StageCard 长字段树。
- 提交流程：确认 `design.md` → `flowx_submit_design({ markdown, output })`；`surfaces` 规则不变。
- 旧 run 无 markdown 时平台显示「尚未提交设计文档」。

- [ ] **Step 2: 同步 public 镜像**

```bash
cp docs/user-manual.md apps/web/public/user-manual.md
cp docs/local-agent-guide.md apps/web/public/local-agent-guide.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/opendesign-design-stage.md docs/local-agent-guide.md docs/user-manual.md \
  apps/web/public/local-agent-guide.md apps/web/public/user-manual.md
git commit -m "$(cat <<'EOF'
docs: design stage shows markdown plus HTML preview

EOF
)"
```

---

### Task 8: 回归验证

- [ ] **Step 1: 按子系统跑测试**

```bash
pnpm --filter @flowx-ai/protocol test
pnpm --filter flowx-api test
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp test
pnpm --filter flowx-web test
```

- [ ] **Step 2: 交割前全量（若时间允许）**

```bash
pnpm check
```

- [ ] **Step 3: 手工冒烟清单**

1. 新本地设计提交带 markdown → 详情见 MD + HTML 预览，无 design/demo 字段树。  
2. 旧 run 仅有 surfaces → MD 空态 + 预览仍可用。  
3. 缺 markdown 的 MCP submit → 400 / MCP 错误。  
4. 确认设计按钮对无 markdown 旧 run 仍可用。

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| 两主模块 MD + HTML | Task 6 |
| 顶层 `markdown` 必填（新提交） | Task 1, 3, 4, 5 |
| 结构化仍持久化、Web 不展示树 | Task 3, 6 |
| 旧数据空态、不拼装 | Task 6（extract 无 fallback） |
| 确认不新增 markdown 硬门槛 | Task 3（不改 `confirmDesign`） |
| 云端 AI 写入合成 markdown | Task 2, 3 |
| `design.md` / handoff / Skill / 手册 | Task 1, 4, 7 |
| 测试范围 | Task 1–6, 8 |

## Self-review notes

- 无 TBD；handoff 使用 `markdownFileName: 'design.md'` 并列保留 `resultFileName: 'result.json'`，避免打断 surfaces 打包。  
- `toPersistedDesignStageOutput` 签名在 Task 3 统一为三参数，AI / local / submitLocalDesign 调用点一并更新。  
- Web 不在展示期用 design/demo 拼 markdown，与 spec 一致。
