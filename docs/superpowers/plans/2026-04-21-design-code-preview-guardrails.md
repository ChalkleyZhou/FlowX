# Repository-Normative Design Code Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a design-generation flow that outputs runnable preview code constrained by repository design norms and installed UI stack, with a Design System lifecycle: detect existing design system, synthesize one when missing, persist it into repository, and keep it synchronized when design revisions change it (detect frontend repositories and follow their real framework; only non-frontend repositories use HTML fallback).

**Architecture:** Replace DSL-centric design output with a code-first preview pipeline. The backend detects repository frontend stack, builds a capability manifest (components/tokens/rules), generates constrained code, validates norm compliance, and returns preview artifact metadata. Before generating preview code, the system must resolve Design System state: reuse existing repository design system if present; otherwise synthesize a minimal design system and write it into the repository as baseline assets/tokens. During design revisions, design-system deltas are detected and synchronized alongside demo code changes. The web panel shows preview status, files, and revision loop entry points. LLM 指令采用 **规范层（manifest）+ 审美层（借鉴 web-design-skill 的流程与反 cliché，冲突时以规范层为准）** 的双层拼接，见下文专节。

**Tech Stack:** NestJS, Prisma, TypeScript, React (web), Vitest, existing AI executor abstraction.

---

## 双层 Prompt：规范层 + 审美层（借鉴 [web-design-skill](https://github.com/ConardLi/web-design-skill)）

设计阶段生成 Demo / 预览代码时，**不要**把「仓库白名单约束」和「视觉与流程质量」混在同一段无结构提示里。采用两层拼接，且写明优先级。

### 第一层：规范层（必须，硬约束）

- 输入：`DesignCapabilityManifest`（前端栈 / 组件证据 / token / `disallowRules`）。
- 要求：组件、import、props、颜色与间距等 **只能** 使用 manifest 已列证据；禁止臆造组件与 token。
- 与 guardrail / `guardrailReport` 对齐：未通过规范检查的输出应进入修订循环。

### 第二层：审美层（可选增强，软约束中的「流程硬」）

参考 [ConardLi/web-design-skill](https://github.com/ConardLi/web-design-skill)（`web-design-engineer` 的 `SKILL.md` 与 `references/`）中 **与仓库无关冲突** 的部分，提升「从能用到耐看」的质量，例如：

- **工作流**：先理解需求 → 收集上下文 → **先用 Markdown 声明设计系统**（色板、字体层级、间距、动效原则）→ **尽早给出 v0 布局草稿** → 再完整实现 → 交付前自检（无控制台错误、无乱用色等）。
- **反 AI 审美 cliché**：避免千篇一律的渐变、emoji 当图标、假数据墙等（具体条可从该 skill 抽取后 **裁剪**）。
- **占位与资产**：诚实占位（如 `[icon]`）优于劣质自绘 SVG。

**冲突处理（写进 system/user 提示词）：** 凡审美层建议与 **规范层 / manifest** 冲突，**一律以规范层为准**。不得用 skill 中的默认字体/配色表覆盖仓库已有 token 与组件约束。

### 按栈分支使用强度


| 预览栈                     | 审美层用法                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `html`（非前端仓库兜底）         | 可较大比例采纳 skill 中的 **oklch / 字体搭配 / 反 cliché / 六步流程**（仍须遵守「无假敏感数据、可访问性底线」等产品约束）。                                                        |
| `frontend`（React/Vue 等） | 以 **流程 + 反 cliché + v0 草稿 + 自检清单** 为主；**删除或改写** skill 中与仓库冲突的「默认 Inter / 固定配色表」等，改为「必须复用 manifest 中的 tailwind / 设计 token / 已有 UI 组件」。 |


### 工程落地建议（后续迭代）

- 将「审美层」摘要为独立片段（或 vendored 的精简 `SKILL.md` 节），在 `design-generation.prompt.ts` 或 Codex 设计阶段 prompt 中 **接在 manifest 渲染块之后** 注入。
- 可选：在仓库内增加 `.agents/skills/web-design-engineer/`（MIT 许可），由编排仅在「视觉 / 交互 Demo」类任务中引用，避免全局污染其他阶段。

### Design System 生命周期（本方案新增核心约束）

在任何设计代码生成之前，必须先执行 `DesignSystemResolver`：

1. **Detect（检测）**：判断仓库是否已有可用设计系统证据（如 tokens 文件、tailwind theme、UI primitives、主题变量、字体策略）。
2. **Synthesize（归纳）**：若证据不足，基于仓库风格与需求归纳最小可用 Design System（颜色/间距/圆角/排版/动效层级），并生成机器可读声明（如 `design-system.generated.json`）。
3. **Persist（落库）**：将归纳后的 Design System 写入仓库（例如 `src/styles/tokens.css`、`tailwind.config.ts` 扩展、`docs/design-system.md`），让后续代码生成引用同一真源。
4. **Sync（同步）**：当设计修订触发 design system 变化时，必须生成并应用 Design System patch，保持「页面代码」和「设计系统资产」同轮更新，禁止只改页面不改 token 基线。

验收上，Design System 不再是“可选上下文”，而是 Demo 生成的前置依赖与持续约束对象。

### 设计阶段边界（非技术评审）

设计阶段只产出并评审以下内容：

- 页面结构与视觉层级是否合理
- 关键交互与状态反馈是否合理
- 是否遵守仓库已有或归纳后落库的 Design System
- 可运行预览与修订结果（`DESIGN_CODE_PREVIEW`）

明确**不在设计阶段产出**：

- API 设计 / 接口草案
- 数据库或数据模型方案
- 其他需要技术人员评审的实现细节

以上内容统一下沉到后续任务拆解与技术方案阶段处理。

---

### Task 1: Define code-preview artifacts and contract

**Files:**

- Modify: `apps/api/src/common/types.ts`
- Modify: `apps/web/src/types.ts`
- Test: `apps/api/src/common/types-demo.spec.ts`
- Test: `apps/web/src/types-demo.test.ts`
- **Step 1: Write failing type tests for new artifact shape**

```ts
it('accepts DESIGN_CODE_PREVIEW artifact payload shape', () => {
  const artifact: IdeationArtifact = {
    id: 'a1',
    requirementId: 'r1',
    type: 'DESIGN_CODE_PREVIEW',
    payload: {
      stack: 'frontend',
      framework: 'react',
      preview: { url: 'http://localhost:4173', entryRoute: '/design-preview' },
      files: [{ path: 'src/pages/DesignPreview.tsx', changeType: 'create' }],
      guardrailReport: { passed: true, violations: [] },
    },
    createdAt: new Date().toISOString(),
  };
  expect(artifact.type).toBe('DESIGN_CODE_PREVIEW');
});
```

- **Step 2: Run test to verify it fails**

Run: `pnpm --filter flowx-api test -- src/common/types-demo.spec.ts`
Expected: FAIL with missing `DESIGN_CODE_PREVIEW` types.

- **Step 3: Add minimal shared type definitions**

```ts
export type DesignPreviewStack = 'frontend' | 'html';
export type FrontendFramework = 'react' | 'vue' | 'svelte' | 'angular' | 'unknown';

export interface DesignCodePreviewPayload {
  stack: DesignPreviewStack;
  framework?: FrontendFramework;
  preview: { url: string; entryRoute: string };
  files: Array<{ path: string; changeType: 'create' | 'update' }>;
  guardrailReport: { passed: boolean; violations: string[] };
}
```

- **Step 4: Re-run API + Web type tests**

Run:

- `pnpm --filter flowx-api test -- src/common/types-demo.spec.ts`
- `pnpm --filter flowx-web test -- src/types-demo.test.ts`
Expected: PASS.
- **Step 5: Commit**

```bash
git add apps/api/src/common/types.ts apps/web/src/types.ts apps/api/src/common/types-demo.spec.ts apps/web/src/types-demo.test.ts
git commit -m "feat: define design code preview artifact contract"
```

### Task 2: Add repository-type detection + framework-aware guardrails + design-system resolver

**Files:**

- Create: `apps/api/src/ai/design-capability-manifest.ts`
- Create: `apps/api/src/ai/design-system-resolver.ts`
- Modify: `apps/api/src/ai/ai-executor.ts`
- Modify: `apps/api/src/ai/codex-ai.executor.ts`
- Test: `apps/api/src/ai/design-capability-manifest.spec.ts`
- Test: `apps/api/src/ai/design-system-resolver.spec.ts`
- **Step 1: Write failing scanner tests for frontend vs non-frontend detection**

```ts
it('detects frontend React repository and extracts tokens/components', async () => {
  const manifest = await buildDesignCapabilityManifest({
    localPath: fixturePath('react-repo'),
    syncStatus: 'READY',
    id: 'repo1',
    name: 'web-app',
    url: 'https://example.com/repo.git',
  });
  expect(manifest?.stack).toBe('frontend');
  expect(manifest?.framework).toBe('react');
  expect(manifest?.components.length).toBeGreaterThan(0);
});

it('falls back to html only for non-frontend repositories', async () => {
  const manifest = await buildDesignCapabilityManifest({
    localPath: fixturePath('non-frontend-repo'),
    syncStatus: 'READY',
    id: 'repo2',
    name: 'worker-service',
    url: 'https://example.com/worker.git',
  });
  expect(manifest?.stack).toBe('html');
});
```

- **Step 2: Run test to verify it fails**

Run: `pnpm --filter flowx-api test -- src/ai/design-capability-manifest.spec.ts`
Expected: FAIL due to missing scanner.

- **Step 3: Implement stack-aware capability manifest**

```ts
export interface DesignCapabilityManifest {
  stack: 'frontend' | 'html';
  framework?: 'react' | 'vue' | 'svelte' | 'angular' | 'unknown';
  components: Array<{ name: string; propsSchema: Record<string, unknown> }>;
  tokens: { colors: string[]; spacing: string[]; radius: string[] };
  disallow: string[];
}

// If repository is frontend, detect concrete framework (React/Vue/etc) and generate framework-native code.
// Only fallback to html when repository is not a frontend repository.
```

- **Step 3.1: Implement design-system resolver (detect/synthesize/persist plan)**

```ts
export interface DesignSystemResolution {
  mode: 'existing' | 'synthesized';
  descriptor: DesignSystemDescriptor;
  writePlan: Array<{ path: string; content: string; reason: string }>;
}

// existing -> 从仓库证据抽取 descriptor
// synthesized -> 归纳最小 DS，并返回落库 writePlan（由后续步骤应用）
```

- **Step 4: Wire manifest + design-system resolution into executor design generation input**

Run: `pnpm --filter flowx-api build`
Expected: PASS; `generateDesign` inputs compile with manifest + design system context support.

- **Step 5: Commit**

```bash
git add apps/api/src/ai/design-capability-manifest.ts apps/api/src/ai/design-capability-manifest.spec.ts apps/api/src/ai/design-system-resolver.ts apps/api/src/ai/design-system-resolver.spec.ts apps/api/src/ai/ai-executor.ts apps/api/src/ai/codex-ai.executor.ts
git commit -m "feat: add stack-aware capability and design-system resolver"
```

### Task 3: Switch design output from abstract spec to framework-native runnable preview metadata

**Prompt 注意：** 更新 `design-generation.prompt.ts` 时，按上文 **「双层 Prompt：规范层 + 审美层」** 组织内容：先 manifest / 规范层，再拼接审美层摘要；并显式写明 **与 manifest 冲突时以 manifest 为准**。`html` 栈可多用 skill 中的视觉与 token 推导思路；`frontend` 栈只采纳流程与反 cliché，配色字体服从仓库。并且新增硬约束：若 `DesignSystemResolver` 判定为 `synthesized`，必须先产出/应用 design-system 写入计划，再输出页面预览元数据。设计阶段输出中禁止要求 API 设计、接口草案、数据模型方案等技术产物。

**Files:**

- Modify: `apps/api/src/requirements/requirements.service.ts`
- Modify: `apps/api/src/prompts/design-generation.prompt.ts`
- Modify: `apps/api/src/ai/mock-ai.executor.ts`
- Test: `apps/api/src/requirements/requirements-demo.spec.ts`
- Test: `apps/api/src/ai/mock-ai.executor.spec.ts`
- **Step 1: Write failing requirement demo test for `DESIGN_CODE_PREVIEW` persistence**

```ts
it('stores DESIGN_CODE_PREVIEW artifact after design generation', async () => {
  const result = await service.startDesign(requirement.id);
  const artifacts = await prisma.ideationArtifact.findMany({ where: { requirementId: requirement.id } });
  expect(artifacts.some((a) => a.type === 'DESIGN_CODE_PREVIEW')).toBe(true);
  expect(result.preview?.url).toBeTruthy();
});
```

- **Step 2: Run failing test**

Run: `pnpm --filter flowx-api test -- src/requirements/requirements-demo.spec.ts`
Expected: FAIL because service still stores legacy design artifacts.

- **Step 3: Update prompt and executors to output code-preview payload**

```ts
return {
  preview: { url: localPreviewUrl, entryRoute: '/design-preview' },
  files: generatedFiles,
  guardrailReport,
  stack: manifest.stack,
  framework: manifest.framework,
};
```

- **Step 4: Ensure revisions keep guardrail loop**

Run:

- `pnpm --filter flowx-api test -- src/ai/mock-ai.executor.spec.ts`
- `pnpm --filter flowx-api test -- src/requirements/requirements-demo.spec.ts`
Expected: PASS.
- **Step 5: Commit**

```bash
git add apps/api/src/requirements/requirements.service.ts apps/api/src/prompts/design-generation.prompt.ts apps/api/src/ai/mock-ai.executor.ts apps/api/src/requirements/requirements-demo.spec.ts apps/api/src/ai/mock-ai.executor.spec.ts
git commit -m "feat: persist stack-constrained design code preview artifacts"
```

### Task 4: Update web ideation panel to preview code-first results

**Files:**

- Modify: `apps/web/src/components/IdeationDesignPanel.tsx`
- Create: `apps/web/src/components/design-preview/DesignPreviewPanel.tsx`
- Test: `apps/web/src/components/IdeationDesignPanel.test.tsx`
- **Step 1: Write failing UI test for code-preview artifact rendering**

```tsx
it('renders preview url and guardrail report for DESIGN_CODE_PREVIEW', () => {
  render(<IdeationDesignPanel ... />);
  expect(screen.getByText('代码预览')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /打开预览/i })).toBeInTheDocument();
});
```

- **Step 2: Run failing test**

Run: `pnpm --filter flowx-web test -- src/components/IdeationDesignPanel.test.tsx`
Expected: FAIL because panel only supports legacy design fields.

- **Step 3: Add code-preview rendering path with revision actions**

```tsx
{preview?.url ? (
  <DesignPreviewPanel preview={preview} guardrailReport={guardrailReport} files={files} />
) : (
  <LegacyDesignFallback ... />
)}
```

- **Step 4: Re-run web tests**

Run: `pnpm --filter flowx-web test`
Expected: PASS.

- **Step 5: Commit**

```bash
git add apps/web/src/components/IdeationDesignPanel.tsx apps/web/src/components/design-preview/DesignPreviewPanel.tsx apps/web/src/components/IdeationDesignPanel.test.tsx
git commit -m "feat: render design code preview in ideation panel"
```

### Task 5: End-to-end verification and rollout safety

**Files:**

- Modify: `apps/api/src/requirements/requirements.service.ts` (feature flag wiring if needed)
- Modify: `apps/api/src/common/types.ts` (feature flag types if needed)
- Test: `apps/api/src/`** and `apps/web/src/`** targeted tests
- **Step 1: Add feature flag for new design mode**

```ts
const IDEATION_DESIGN_MODE = process.env.IDEATION_DESIGN_MODE ?? 'legacy';
// 'legacy' | 'code_preview'
```

- **Step 2: Verify guarded rollout behavior**

Run:

- `IDEATION_DESIGN_MODE=legacy pnpm --filter flowx-api test -- src/requirements/requirements-demo.spec.ts`
- `IDEATION_DESIGN_MODE=code_preview pnpm --filter flowx-api test -- src/requirements/requirements-demo.spec.ts`
Expected: both pass with mode-specific assertions.
- **Step 3: Run full verification**

Run:

- `pnpm --filter flowx-api test`
- `pnpm --filter flowx-web test`
- `pnpm check`
Expected: existing known unrelated failures documented; no new failures from this feature.
- **Step 4: Update operational docs**

```md
Add: how stack detection works, how guardrail violations are surfaced, how to revise by natural-language feedback, and how Design System is detected/synthesized/persisted/synchronized.
```

- **Step 5: Commit**

```bash
git add apps/api/src/requirements/requirements.service.ts apps/api/src/common/types.ts docs/user-manual.md
git commit -m "chore: gate and document code-first design preview rollout"
```

---

## Recommended Approach (from brainstorming)

1. **A. Hard switch to code-preview only**
  Fastest UX gain, but higher regression risk for existing design sessions.
2. **B. Feature-flagged dual path (recommended)**
  Keep legacy path as fallback while introducing framework-aware code-preview path with guardrails.
3. **C. Hybrid preview-only adapter**
  Lowest backend churn, but weaker constraints and less auditability.

**Recommendation:** **B** for production safety and fast iteration.