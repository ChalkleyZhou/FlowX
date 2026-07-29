# 多端多页设计稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作流设计阶段从「单份 designArtifact.html」升级为「动态 surface + 多页 HTML」，支持按端增量回传与 Web 动态 Tab 预览；不做旧契约兼容。

**Architecture:** `@flowx-ai/protocol` 将 `FlowXDesignOutput` 改为必填 `surfaces[]`；API 按 `surfaceId` 整端替换落盘并在 StageExecution.output 存清单；删除旧 `GET .../design-artifact`；Web 用清单 API + 单页 API 渲染动态 Tab；local/MCP 从 `design/<surfaceId>/*.html` 扫描打包。云端 AI / mock executor 同步改为产出 `surfaces`。

**Tech Stack:** TypeScript、NestJS、Prisma StageExecution.output JSON、Vitest、React、`@flowx-ai/protocol` / `@flowx-ai/local` / `flowx-mcp`

**Spec:** `docs/superpowers/specs/2026-07-29-multi-surface-design-artifacts-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/flowx-protocol/src/design.ts` | `DesignSurface` / `DesignPage` / `FlowXDesignOutput.surfaces`；handoff `requiredFields` |
| `packages/flowx-protocol/src/design.test.ts`（新建） | 协议形状契约测试 |
| `apps/api/src/common/types.ts` | `DesignPageRef`、`DesignSurfaceInventory`、`DesignPhaseOutput` |
| `apps/api/src/ai/design-output-validate.ts` | 校验 `surfaces`；拒绝仅 `designArtifact` |
| `apps/api/src/workflow/dto/submit-local-design.dto.ts` | DTO 改为 `surfaces` |
| `apps/api/src/workflow/workflow.service.ts` | 按端 persist/merge、清单读写、删旧单稿 API |
| `apps/api/src/workflow/workflow.controller.ts` | 新清单/单页路由；删旧路由 |
| `apps/api/src/ai/*` + prompts | mock/codex/cursor 与 schema contract 改为 surfaces |
| `packages/flowx-local/src/adapters/open-design-adapter.ts` | 目录扫描、模板、校验、instructions |
| `packages/flowx-local/src/mcp.ts` + `packages/flowx-mcp` | submit schema |
| `packages/flowx-local/templates/**` | Skill 推荐 `Web端`/`移动端`/`管理后台` |
| `apps/web/src/types.ts` + `api.ts` | 新类型与 API |
| `apps/web/src/components/DesignArtifactPreview.tsx` | 动态 Tab + 页列表 + iframe |
| `docs/opendesign-design-stage.md`、`docs/local-agent-guide.md` + web public 镜像 | 用户文档 |
| `apps/cursor-extension/**` | 若仍引用 `designArtifact`，一并改为 `surfaces` |

---

### Task 1: Protocol — `surfaces` 契约

**Files:**
- Modify: `packages/flowx-protocol/src/design.ts`
- Create: `packages/flowx-protocol/src/design.test.ts`
- Modify: `packages/flowx-protocol/src/index.ts`（若需导出新类型）

- [ ] **Step 1: 写失败测试**

```ts
// packages/flowx-protocol/src/design.test.ts
import { describe, expect, it } from 'vitest';
import type { FlowXDesignOutput, OpenDesignContextPackage } from './design.js';

describe('FlowXDesignOutput surfaces contract', () => {
  it('types require surfaces with pages html', () => {
    const output: FlowXDesignOutput = {
      design: {},
      demo: {},
      surfaces: [
        {
          id: 'Web端',
          pages: [{ id: '首页', title: '首页', html: '<!doctype html><html></html>' }],
        },
      ],
    };
    expect(output.surfaces[0].id).toBe('Web端');
    expect(output.surfaces[0].pages[0].html).toContain('doctype');
  });

  it('handoff requiredFields list design demo surfaces', () => {
    const requiredFields: OpenDesignContextPackage['outputContract']['requiredFields'] = [
      'design',
      'demo',
      'surfaces',
    ];
    expect(requiredFields).not.toContain('designArtifact');
  });
});
```

- [ ] **Step 2: 运行测试确认失败/类型报错**

Run: `pnpm --filter @flowx-ai/protocol test`

Expected: 编译或类型与旧 `designArtifact` 定义冲突，或测试文件因类型不匹配失败。

- [ ] **Step 3: 实现协议类型**

将 `packages/flowx-protocol/src/design.ts` 改为：

```ts
export interface DesignPagePayload {
  id: string;
  title?: string;
  html: string;
  [key: string]: unknown;
}

export interface DesignSurfacePayload {
  id: string;
  pages: DesignPagePayload[];
  [key: string]: unknown;
}

export interface FlowXDesignOutput {
  design: Record<string, unknown>;
  demo: Record<string, unknown>;
  surfaces: DesignSurfacePayload[];
}

// OpenDesignContextPackage.outputContract:
format: 'flowx-design-result-v2';
requiredFields: readonly ['design', 'demo', 'surfaces'];
```

删除 `designArtifact` 字段。`format` 升为 `flowx-design-result-v2`。

- [ ] **Step 4: 再跑 protocol test + build**

Run: `pnpm --filter @flowx-ai/protocol test && pnpm --filter @flowx-ai/protocol build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-protocol/src/design.ts packages/flowx-protocol/src/design.test.ts packages/flowx-protocol/src/index.ts
git commit -m "$(cat <<'EOF'
feat(protocol): replace designArtifact with surfaces[] for multi-page design

EOF
)"
```

---

### Task 2: API 校验 — `assertDesignSpecOutput` 改为 surfaces

**Files:**
- Modify: `apps/api/src/ai/design-output-validate.ts`
- Modify: `apps/api/src/ai/design-output-validate.spec.ts`
- Modify: `apps/api/src/common/types.ts`（`DesignPhaseOutput`、新增 inventory 类型）

- [ ] **Step 1: 改测试为 surfaces（先改测试）**

在 `design-output-validate.spec.ts`：

- 合法样例顶层改为 `design` + `demo` + `surfaces: [{ id: 'Web端', pages: [{ id: 'index', html: '<!doctype html>...' }] }]`
- 断言拒绝：缺 `surfaces`、`surfaces: []`、page 无 html、**仅有旧 `designArtifact` 无 surfaces**（错误信息含 `surfaces` 与迁移提示）

- [ ] **Step 2: 跑 spec 确认失败**

Run: `pnpm --filter flowx-api exec vitest run src/ai/design-output-validate.spec.ts`

Expected: FAIL

- [ ] **Step 3: 实现校验**

```ts
// 核心逻辑示意
function assertSurfaces(raw: unknown): DesignSurfacePayload[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('DESIGN_OUTPUT_INVALID: Missing required non-empty array "surfaces".');
  }
  // 若候选仍有 designArtifact 且无合法 surfaces，错误中提示改用 surfaces
  return raw.map((surface, i) => {
    // id non-empty string; pages non-empty; each page id + non-empty html
    // html size checked later at persist
  });
}

export function assertDesignSpecOutput(raw: unknown): DesignPhaseOutput {
  const candidate = asObject(raw, '"design", "demo", and "surfaces"');
  if (candidate.designArtifact && !candidate.surfaces) {
    throw new Error(
      'DESIGN_OUTPUT_INVALID: designArtifact is removed; submit surfaces[{ id, pages[{ id, html }] }] instead.',
    );
  }
  const { design, demo } = validateDesignAndDemo(candidate);
  const surfaces = assertSurfaces(candidate.surfaces);
  return { design, demo, surfaces };
}
```

同步 `types.ts`：

```ts
export interface DesignPageRef {
  id: string;
  title?: string;
  relPath: string;
  bytes: number;
  generatedAt: string;
}

export interface DesignSurfaceInventory {
  id: string;
  pages: DesignPageRef[];
}

export interface DesignPhaseOutput {
  design: DesignSpec;
  demo: DemoArtifact;
  surfaces: Array<{ id: string; pages: Array<{ id: string; title?: string; html: string }> }>;
  demoPages?: DemoPage[];
}
```

删除/停止在 `DesignPhaseOutput` 上要求 `designArtifact`。

- [ ] **Step 4: 跑校验测试**

Run: `pnpm --filter flowx-api exec vitest run src/ai/design-output-validate.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai/design-output-validate.ts apps/api/src/ai/design-output-validate.spec.ts apps/api/src/common/types.ts
git commit -m "$(cat <<'EOF'
feat(api): validate design output surfaces and reject designArtifact

EOF
)"
```

---

### Task 3: API — 按端落盘 / merge / 清单读写

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`（`persistWorkflowDesignArtifact`、`completeLocalDesignSession`、`toPersistedDesignStageOutput`、`getLatestDesignArtifactRef`、`buildDemoDesignArtifactContext`、`getWorkflowDesignArtifact`）
- Modify: `apps/api/src/workflow/dto/submit-local-design.dto.ts`
- Modify: `apps/api/src/workflow/workflow.controller.ts`
- Create/Modify: 相关 workflow 测试（若已有 local design complete 测试则改；否则在 `workflow.service` 旁或现有 edge/workflow spec 补测）

- [ ] **Step 1: 写/改失败测试覆盖 merge**

测试要点（伪代码，落到现有测试风格）：

```ts
it('merges one surface without clearing other surfaces', async () => {
  // given stage output already has 移动端 pages
  // when completeLocalDesign with only Web端 pages
  // then inventory has both; 移动端 refs unchanged; Web端 replaced
});

it('replaces entire surface page set on resubmit', async () => {
  // Web端 was [首页, 详情]; resubmit Web端 [首页] only
  // then 详情 gone from inventory
});

it('GET design-artifacts returns inventory without html', async () => { ... });
it('GET design-artifacts/:surfaceId/:pageId returns html', async () => { ... });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-api exec vitest run`（限定新建/改动的 workflow design artifact 测试文件）

- [ ] **Step 3: 实现 persist + merge helpers**

```ts
function encodePathSegment(id: string): string {
  return encodeURIComponent(id);
}

private async persistDesignSurfacePages(
  workflowRunId: string,
  surfaceId: string,
  pages: Array<{ id: string; title?: string; html: string }>,
): Promise<DesignSurfaceInventory> {
  const generatedAt = new Date().toISOString();
  const outPages: DesignPageRef[] = [];
  for (const page of pages) {
    const bytes = Buffer.byteLength(page.html, 'utf8');
    if (bytes > DESIGN_ARTIFACT_MAX_BYTES) {
      throw new BadRequestException(
        `DESIGN_ARTIFACT_TOO_LARGE: surface=${surfaceId} page=${page.id} is ${bytes} bytes`,
      );
    }
    const safeSurface = encodePathSegment(surfaceId);
    const safePage = encodePathSegment(page.id);
    const fileName = `${safePage}-${generatedAt.replace(/[:.]/g, '-')}.html`;
    const relPath = `${workflowRunId}/${safeSurface}/${fileName}`;
    await mkdir(join(DESIGN_ARTIFACT_ROOT, workflowRunId, safeSurface), { recursive: true });
    await writeFile(join(DESIGN_ARTIFACT_ROOT, workflowRunId, safeSurface, fileName), page.html, 'utf8');
    // optional: registerWorkflowArtifact with metadata { surfaceId, pageId }
    outPages.push({
      id: page.id,
      title: page.title ?? page.id,
      relPath,
      bytes,
      generatedAt,
    });
  }
  return { id: surfaceId, pages: outPages };
}

private mergeDesignSurfaceInventory(
  previous: DesignSurfaceInventory[] | undefined,
  incoming: DesignSurfaceInventory[],
): DesignSurfaceInventory[] {
  const map = new Map((previous ?? []).map((s) => [s.id, s]));
  for (const surface of incoming) {
    map.set(surface.id, surface); // 整端替换
  }
  return [...map.values()];
}
```

`completeLocalDesignSession` / 云端 `runDesign` 落盘路径：

1. `assertDesignSpecOutput`
2. 对每个 incoming surface 调用 `persistDesignSurfacePages`
3. 读当前 design stage output 的 `surfaces` 清单，`mergeDesignSurfaceInventory`
4. `toPersistedDesignStageOutput` 写入 `{ design, demo, surfaces: inventory }`（**无** html、**无** designArtifact）

DTO：

```ts
export class SubmitLocalDesignDto {
  @IsObject() design!: Record<string, unknown>;
  @IsObject() demo!: Record<string, unknown>;
  @IsArray() surfaces!: unknown[];
}
```

Controller：

```ts
@Get(':id/design-artifacts')
listDesignArtifacts(@Param('id') id: string) {
  return this.workflowService.listWorkflowDesignArtifacts(id);
}

@Get(':id/design-artifacts/:surfaceId/:pageId')
getDesignArtifactPage(
  @Param('id') id: string,
  @Param('surfaceId') surfaceId: string,
  @Param('pageId') pageId: string,
) {
  return this.workflowService.getWorkflowDesignArtifactPage(
    id,
    decodeURIComponent(surfaceId),
    decodeURIComponent(pageId),
  );
}

// 删除 @Get(':id/design-artifact')
```

`listWorkflowDesignArtifacts`：从 latest design stage output 读 `surfaces` 清单。  
`getWorkflowDesignArtifactPage`：按 id 找 `relPath` → `readWorkflowDesignArtifactHtml`。

`buildDemoDesignArtifactContext`：拼接各端各页（仍截断总长度），文案改为「多端多页设计稿」。

Handoff builder 里 `requiredFields` / `format` 改为 v2 + `surfaces`（约 `workflow.service.ts` 中 `flowx-design-result-v1` 处）。

- [ ] **Step 4: 跑 API 相关测试**

Run: `pnpm --filter flowx-api test`（至少 design-output-validate + 本任务新测）

Expected: PASS；修复因删 `designArtifact` 导致的编译错误（本任务范围内能改的先改；executor 留 Task 4）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow apps/api/src/common/types.ts
git commit -m "$(cat <<'EOF'
feat(api): persist and serve multi-surface design artifacts

EOF
)"
```

---

### Task 4: 云端 AI / mock / prompts 对齐 surfaces

**Files:**
- Modify: `apps/api/src/ai/mock-ai.executor.ts` + `mock-ai.executor.spec.ts`
- Modify: `apps/api/src/ai/codex-ai.executor.ts`、`cursor-ai.executor.ts`（若直接拼 designArtifact）
- Modify: `apps/api/src/prompts/design-schema-contract.ts`、`design-generation.prompt.ts` / `designArtifactPrompt` 相关
- Modify: 任何仍引用 `designArtifact.html` 的 API 测试

- [ ] **Step 1: 改 mock 测试期望 surfaces**

```ts
expect(out.surfaces?.[0]?.id).toBe('Web端');
expect(out.surfaces?.[0]?.pages?.[0]?.html).toContain('<!doctype html>');
expect(out.designArtifact).toBeUndefined();
```

- [ ] **Step 2: 跑 mock spec 确认失败**

Run: `pnpm --filter flowx-api exec vitest run src/ai/mock-ai.executor.spec.ts`

- [ ] **Step 3: mock 返回单端 Web端 一页；prompt/contract 文案改为 surfaces**

Mock 最小实现：

```ts
surfaces: [
  {
    id: 'Web端',
    pages: [{ id: 'index', title: '设计稿', html: '<!doctype html>...' }],
  },
],
```

Prompt：要求输出 `design`、`demo`、`surfaces`；推荐至少 `Web端`；禁止 `designArtifact`。

- [ ] **Step 4: 跑 AI 相关测试至通过**

Run: `pnpm --filter flowx-api exec vitest run src/ai/`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai apps/api/src/prompts
git commit -m "$(cat <<'EOF'
feat(api): align design AI executors with surfaces contract

EOF
)"
```

---

### Task 5: Local adapter + MCP — 目录扫描与提交

**Files:**
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.ts`
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.test.ts`
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-mcp/src/tools.ts` + `tools.test.ts`（若独立包）
- Create helper（可选）: `packages/flowx-local/src/design-surfaces.ts`（扫描 `design/*/*.html`）

- [ ] **Step 1: 写扫描/校验测试**

```ts
it('loads surfaces from design/<surfaceId>/*.html', async () => {
  // arrange temp dir with design/Web端/首页.html and design/移动端/首页.html
  const surfaces = await loadDesignSurfacesFromDir(root);
  expect(surfaces.map((s) => s.id).sort()).toEqual(['Web端', '移动端']);
});

it('validateReport requires surfaces', () => {
  expect(() => validateReport({ ...base, output: { design: {}, demo: {}, surfaces: [] } })).toThrow();
});
```

- [ ] **Step 2: 跑 local 测试失败**

Run: `pnpm --filter @flowx-ai/local test`

- [ ] **Step 3: 实现扫描 + 改模板/instructions/MCP zod**

```ts
export async function loadDesignSurfacesFromDir(
  sessionDir: string,
  onlySurfaceId?: string,
): Promise<DesignSurfacePayload[]> {
  const designRoot = join(sessionDir, 'design');
  const entries = await readdir(designRoot, { withFileTypes: true });
  const surfaces: DesignSurfacePayload[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (onlySurfaceId && ent.name !== onlySurfaceId) continue;
    const dir = join(designRoot, ent.name);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.html'));
    const pages = [];
    for (const file of files) {
      const id = file.replace(/\.html$/i, '');
      const html = await readFile(join(dir, file), 'utf8');
      pages.push({ id, title: id, html });
    }
    if (pages.length) surfaces.push({ id: ent.name, pages });
  }
  return surfaces;
}
```

- `buildResultTemplate`：`surfaces: [{ id: 'Web端', pages: [{ id: 'index', html: '...' }] }]`
- `validateReport`：检查 `surfaces` 非空且每页有 html
- `buildInstructions(design)`：说明目录结构 + 推荐名 `Web端`/`移动端`/`管理后台` + `flowx_submit_design` 交 `surfaces`
- 创建会话时可 `mkdir` `design/Web端`（可选）
- MCP zod：`surfaces: z.array(...).min(1)`，删除 `designArtifact`
- submit 路径：若 report 未带 surfaces，可从 session `design/` 扫描后填入再 POST

- [ ] **Step 4: local + mcp test/build**

Run:

```bash
pnpm --filter @flowx-ai/local test && pnpm --filter @flowx-ai/local build
pnpm --filter flowx-mcp test
```

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-local packages/flowx-mcp
git commit -m "$(cat <<'EOF'
feat(local): pack design/<surfaceId> html into surfaces submit

EOF
)"
```

---

### Task 6: Skill 模板与本地/用户文档

**Files:**
- Modify: `packages/flowx-local/templates/flowx-product-prd/SKILL.md`（及若有 design 相关 skill 模板）
- Modify: `docs/opendesign-design-stage.md`
- Modify: `docs/local-agent-guide.md` + `apps/web/public/local-agent-guide.md`
- Modify: `docs/user-manual.md` + `apps/web/public/user-manual.md`（若提到单页设计稿）
- Modify: spec 状态已确认；计划实现后可在文档写「旧 designArtifact 已移除」

- [ ] **Step 1: 更新 Skill 文案**

加入：

```markdown
## 多端设计稿（设计阶段）

若需求涉及多端，在项目或会话 `design/` 下按端建目录，**推荐**：

- `Web端/`
- `移动端/`
- `管理后台/`

每端可有多个 `.html`。其它目录名也可；FlowX Web 按实际上传的端展示 Tab。
按端回传：`flowx_submit_design` 的 `output.surfaces`。
```

- [ ] **Step 2: 重写 opendesign-design-stage 中 result.json 示例为 surfaces；删除 designArtifact 示例**

- [ ] **Step 3: 同步 local-agent-guide 与 public 镜像**

Run:

```bash
# 编辑 docs 后
cp docs/local-agent-guide.md apps/web/public/local-agent-guide.md
# 若改了 user-manual
cp docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

- [ ] **Step 4: Commit**

```bash
git add packages/flowx-local/templates docs apps/web/public
git commit -m "$(cat <<'EOF'
docs: document multi-surface design directories and recommended names

EOF
)"
```

---

### Task 7: Web — 类型、API、动态预览

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/components/DesignArtifactPreview.tsx`
- Create: `apps/web/src/components/DesignArtifactPreview.test.tsx`（若项目有组件测惯例）
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`（确认摘要文案可选；确认按钮仍依赖 `DESIGN_WAITING_CONFIRMATION`）

- [ ] **Step 1: 类型与 api**

```ts
// types.ts
export interface DesignPageRef {
  id: string;
  title?: string;
  relPath: string;
  bytes: number;
  generatedAt: string;
}
export interface DesignSurfaceInventory {
  id: string;
  pages: DesignPageRef[];
}
export interface WorkflowDesignArtifactsList {
  surfaces: DesignSurfaceInventory[];
}
export interface WorkflowDesignArtifactPage {
  exists: boolean;
  html: string | null;
  surfaceId?: string;
  pageId?: string;
  generatedAt?: string;
}

// api.ts
listWorkflowDesignArtifacts: (id: string) =>
  request<WorkflowDesignArtifactsList>(`/workflow-runs/${id}/design-artifacts`),
getWorkflowDesignArtifactPage: (id: string, surfaceId: string, pageId: string) =>
  request<WorkflowDesignArtifactPage>(
    `/workflow-runs/${id}/design-artifacts/${encodeURIComponent(surfaceId)}/${encodeURIComponent(pageId)}`,
  ),
// 删除 getWorkflowDesignArtifact
```

- [ ] **Step 2: 重写 `DesignArtifactPreview`**

行为：

1. `listWorkflowDesignArtifacts` 加载清单
2. 无 surfaces → 空态文案（「暂无设计稿，请本地回传或 AI 生成」）
3. Tab = `surfaces.map(s => s.id)`（不预置）
4. 选中 surface → 页按钮/列表；选中 page → `getWorkflowDesignArtifactPage` → iframe `srcDoc`
5. 默认选第一端第一页
6. 保留刷新、新窗口打开当前页

- [ ] **Step 3: 可选确认摘要**

在设计阶段 `DESIGN_WAITING_CONFIRMATION` 时，于预览上方显示：`当前包含：Web端(2) · 移动端(1)`（由清单计算）。

确认按钮：维持仅在 `DESIGN_WAITING_CONFIRMATION` 可点（submit 已保证 ≥1 页）；无需额外前端禁用逻辑，除非要在 PENDING 且已有部分稿时展示预览（预览组件本身应能显示已 merge 的清单，即使仍 PENDING——若 complete 才进 WAITING，则仅 WAITING 有稿）。

- [ ] **Step 4: 跑 Web 测试**

Run: `pnpm --filter flowx-web test`

修复所有 `getWorkflowDesignArtifact` / `designArtifact` 引用。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): preview multi-surface design artifacts with dynamic tabs

EOF
)"
```

---

### Task 8: 扫尾消费者 + 全量校验

**Files:**
- Modify: `apps/cursor-extension/src/**`（`local-design.test.ts`、`flowx-client.ts` 等仍含 `designArtifact` 的）
- 全局 ripgrep 清理

- [ ] **Step 1: 搜索残留**

```bash
rg "designArtifact|design-artifact|flowx-design-result-v1" --glob '!docs/superpowers/**' --glob '!**/node_modules/**'
```

除历史 specs/plans 外，代码与现行用户文档不应再要求旧字段。

- [ ] **Step 2: 修 cursor-extension 与其它消费者至编译通过**

- [ ] **Step 3: 全量检查**

```bash
pnpm --filter @flowx-ai/protocol test
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp test
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm check
```

Expected: 全部 PASS（或记录与本任务无关的既有失败）。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: finish multi-surface design migration across consumers

EOF
)"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| `surfaces[]` 协议，无 designArtifact | 1, 2 |
| 本地 `design/<surfaceId>/*.html` | 5 |
| 按端增量、整端替换 | 3 |
| Web 动态 Tab + 页列表 | 7 |
| 不预声明 scope；≥1 页可确认 | 3 submit 校验 + 现有 WAITING 闸门 |
| Skill 推荐中文目录名 | 6 |
| 删除旧 API / 旧字段 | 3, 7, 8 |
| 落盘路径 / 清单 / 大小上限 | 3 |
| 文档同步 | 6 |
| 云端 AI 对齐 | 4 |

## 风险

- **破坏性变更**：进行中的旧设计会话需重新按 `surfaces` 回传（spec 已接受）。
- `workflow.service.ts` 体积大：改动保持在 design artifact 私有方法与 complete/run 路径，避免无关重构。
- URL 中文 `surfaceId`：必须 `encodeURIComponent` / `decodeURIComponent` 成对。
