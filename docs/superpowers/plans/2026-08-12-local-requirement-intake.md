# 本地需求发起（Local Requirement Intake）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地 AI 通过 MCP + Skill 完成「选项目 → 创建需求 → 确认后启动工作流 → 可选进入产品构思」，Web 创建弱化为兜底。

**Architecture:** 在 `@flowx-ai/local` MCP 增加 `flowx_list_projects` / `flowx_create_requirement` / `flowx_start_workflow`（桥接现有 `GET /projects`、`POST /requirements`、`POST /workflow-runs`）；`userConfirmedStart` 仅在 MCP 层强制。新 Skill `flowx-intake-requirement` 由 `setup` 与 `flowx-product-prd` 一并安装。兼容包 `flowx-mcp` 同步工具。Web/手册按 C 叙事弱化网页创建入口。

**Tech Stack:** TypeScript、Vitest、`@modelcontextprotocol/sdk`、NestJS 现有 API（无新原子 intake API）、React Web 文案、Markdown 文档。

**Spec:** `docs/superpowers/specs/2026-08-12-local-requirement-intake-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/flowx-local/src/mcp.ts` | 注册三个 intake 工具并桥接 REST |
| `packages/flowx-local/src/mcp.test.ts` | 工具列表、list/create/start、`userConfirmedStart` 拒绝 |
| `packages/flowx-local/templates/flowx-intake-requirement/SKILL.md` | 发起流程 Skill |
| `packages/flowx-local/src/setup.ts` | 安装多个 Skill（prd + intake） |
| `packages/flowx-local/src/setup.test.ts` | 多 Skill 路径与 force/skip |
| `packages/flowx-local/src/update.ts` | `pickUpdateTargets` 适配多 Skill 路径探测 |
| `packages/flowx-mcp/src/flowx-api-client.ts` | 兼容包 API 方法 |
| `packages/flowx-mcp/src/tools.ts` + `tools.test.ts` | 兼容包工具注册与测试 |
| `apps/web/src/pages/RequirementsPage.tsx` (+ test) | 主 CTA 指向本地发起；网页创建降级 |
| `docs/local-agent-guide.md` + public 镜像 | setup / 工具 / 推荐路径 |
| `docs/user-manual.md` + public 镜像 | 需求发起主路径改为本地 |
| `docs/edge-agent-operations.md`（若有 setup 节） | 运维侧同步 |

---

### Task 1: MCP `flowx_list_projects` + `flowx_create_requirement`（TDD）

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-local/src/mcp.test.ts`

- [ ] **Step 1: 扩展工具列表断言（先失败）**

在 `packages/flowx-local/src/mcp.test.ts` 的 `identifies as flowx-local and registers the user-facing tools` 中，把期望工具名改为包含三个新工具（建议插在 `flowx_list_tasks` 之前，保持稳定顺序）：

```ts
expect(result.tools.map((tool) => tool.name)).toEqual([
  'flowx_get_active_design_session',
  'flowx_bind_workflow',
  'flowx_get_design_handoff',
  'flowx_get_brainstorm_handoff',
  'flowx_submit_design',
  'flowx_submit_brainstorm',
  'flowx_list_projects',
  'flowx_create_requirement',
  'flowx_start_workflow',
  'flowx_list_tasks',
  'flowx_get_task_context',
  'flowx_collect_git_report',
  'flowx_report_completion',
]);
```

- [ ] **Step 2: 新增 list/create 行为测试**

```ts
it('lists projects via GET /projects and creates requirements via POST /requirements', async () => {
  const homeDir = makeHome();
  await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/projects') && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify([
          {
            id: 'proj_1',
            name: 'Demo',
            workspaceId: 'ws_1',
            workspace: {
              id: 'ws_1',
              name: 'WS',
              repositories: [{ id: 'repo_1', name: 'app', url: 'https://git.example/app.git' }],
            },
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/requirements') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        projectId: 'proj_1',
        title: '本地发起',
        description: '描述',
        acceptanceCriteria: '可在列表看到该需求',
      });
      return new Response(
        JSON.stringify({ id: 'req_1', title: body.title, projectId: body.projectId }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  });

  const { client, server } = await connectClient(homeDir);
  const listed = await client.callTool({ name: 'flowx_list_projects', arguments: {} });
  expect(listed.isError).toBeUndefined();
  const listedPayload = JSON.parse(String((listed.content as Array<{ text: string }>)[0].text));
  expect(listedPayload.projects[0]).toMatchObject({
    id: 'proj_1',
    name: 'Demo',
    workspaceId: 'ws_1',
    workspaceName: 'WS',
    repositories: [{ id: 'repo_1', name: 'app' }],
  });

  const created = await client.callTool({
    name: 'flowx_create_requirement',
    arguments: {
      projectId: 'proj_1',
      title: '本地发起',
      description: '描述',
      acceptanceCriteria: '可在列表看到该需求',
    },
  });
  expect(created.isError).toBeUndefined();
  expect(JSON.parse(String((created.content as Array<{ text: string }>)[0].text))).toMatchObject({
    id: 'req_1',
    title: '本地发起',
    projectId: 'proj_1',
  });

  expect(fetchMock).toHaveBeenCalled();
  await client.close();
  await server.close();
});
```

- [ ] **Step 3: Run 确认失败**

Run: `pnpm --filter @flowx-ai/local test -- src/mcp.test.ts`  
Expected: FAIL（工具未注册或断言不匹配）

- [ ] **Step 4: 在 `mcp.ts` 注册工具（插在 `flowx_list_tasks` 之前）**

```ts
function summarizeProjects(raw: unknown) {
  const list = Array.isArray(raw) ? raw : [];
  return {
    projects: list.map((item) => {
      const project = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const workspace =
        project.workspace && typeof project.workspace === 'object'
          ? (project.workspace as Record<string, unknown>)
          : {};
      const repositories = Array.isArray(workspace.repositories) ? workspace.repositories : [];
      return {
        id: typeof project.id === 'string' ? project.id : '',
        name: typeof project.name === 'string' ? project.name : '',
        workspaceId:
          typeof project.workspaceId === 'string'
            ? project.workspaceId
            : typeof workspace.id === 'string'
              ? workspace.id
              : '',
        workspaceName: typeof workspace.name === 'string' ? workspace.name : '',
        repositories: repositories.map((repo) => {
          const row = repo && typeof repo === 'object' ? (repo as Record<string, unknown>) : {};
          return {
            id: typeof row.id === 'string' ? row.id : '',
            name: typeof row.name === 'string' ? row.name : '',
          };
        }),
      };
    }),
  };
}

server.registerTool(
  'flowx_list_projects',
  {
    title: 'List FlowX Projects',
    description:
      'List workspaces/projects visible to the current token for local requirement intake. Ask the user to pick a projectId; do not infer from local repo paths.',
    inputSchema: z.object({}),
  },
  async () => {
    const { client } = await resolveSession(options.homeDir);
    return runRequest(async () => summarizeProjects(await client.request('/projects')));
  },
);

server.registerTool(
  'flowx_create_requirement',
  {
    title: 'Create FlowX Requirement',
    description:
      'Create a requirement on FlowX (local intake). Requires projectId, title, description, acceptanceCriteria. Prefer confirming title/description with the user first; acceptanceCriteria may be a short placeholder if the user has not provided one yet.',
    inputSchema: z.object({
      projectId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      acceptanceCriteria: z.string().min(1),
      repositoryIds: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const { client } = await resolveSession(options.homeDir);
    return runRequest(() =>
      client.request('/requirements', {
        method: 'POST',
        body: JSON.stringify({
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
          ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
        }),
      }),
    );
  },
);
```

- [ ] **Step 5: Run 确认通过**

Run: `pnpm --filter @flowx-ai/local test -- src/mcp.test.ts`  
Expected: PASS（除尚未实现的 `flowx_start_workflow` 列表项外——若 Step 1 已包含 start 名称，可先只改列表为 list+create，或连同 Task 2 一起改列表）

若希望 Task 1 独立变绿：列表暂时只加 `flowx_list_projects` 与 `flowx_create_requirement`；Task 2 再追加 `flowx_start_workflow`。

- [ ] **Step 6: Commit（需用户授权后再执行）**

```bash
git add packages/flowx-local/src/mcp.ts packages/flowx-local/src/mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(local): add MCP list_projects and create_requirement

EOF
)"
```

---

### Task 2: MCP `flowx_start_workflow` + `userConfirmedStart`（TDD）

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-local/src/mcp.test.ts`

- [ ] **Step 1: 失败测试——未确认拒绝；确认后 POST `/workflow-runs`**

```ts
it('rejects start_workflow without userConfirmedStart and starts when confirmed', async () => {
  const homeDir = makeHome();
  await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/workflow-runs') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ requirementId: 'req_1', aiProvider: 'cursor' });
      expect(body.userConfirmedStart).toBeUndefined();
      return new Response(JSON.stringify({ id: 'wr_1', requirementId: 'req_1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });

  const { client, server } = await connectClient(homeDir);

  const denied = await client.callTool({
    name: 'flowx_start_workflow',
    arguments: { requirementId: 'req_1', userConfirmedStart: false },
  });
  expect(denied.isError).toBe(true);
  expect(String((denied.content as Array<{ text: string }>)[0].text)).toMatch(/userConfirmedStart/);
  expect(fetchMock).not.toHaveBeenCalled();

  const started = await client.callTool({
    name: 'flowx_start_workflow',
    arguments: {
      requirementId: 'req_1',
      userConfirmedStart: true,
      aiProvider: 'cursor',
    },
  });
  expect(started.isError).toBeUndefined();
  expect(JSON.parse(String((started.content as Array<{ text: string }>)[0].text))).toMatchObject({
    id: 'wr_1',
    requirementId: 'req_1',
  });

  await client.close();
  await server.close();
});
```

- [ ] **Step 2: Run 确认失败**

Run: `pnpm --filter @flowx-ai/local test -- src/mcp.test.ts`  
Expected: FAIL（工具不存在）

- [ ] **Step 3: 实现注册**

```ts
server.registerTool(
  'flowx_start_workflow',
  {
    title: 'Start FlowX Workflow',
    description:
      'Start a workflow for an existing requirement after showing the user a start summary and receiving explicit confirmation. Always pass userConfirmedStart=true only after that confirmation. Then ask whether to continue into product brainstorm (bind + flowx-product-prd) or stop.',
    inputSchema: z.object({
      requirementId: z.string().min(1),
      userConfirmedStart: z.boolean(),
      repositoryIds: z.array(z.string()).optional(),
      aiProvider: z.enum(['codex', 'cursor']).optional(),
    }),
  },
  async (input) => {
    if (input.userConfirmedStart !== true) {
      return textResult(
        'Refusing to start workflow: userConfirmedStart must be true after the user explicitly confirmed the start summary.',
        true,
      );
    }
    const { client } = await resolveSession(options.homeDir);
    return runRequest(() =>
      client.request('/workflow-runs', {
        method: 'POST',
        body: JSON.stringify({
          requirementId: input.requirementId,
          ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
          ...(input.aiProvider ? { aiProvider: input.aiProvider } : {}),
        }),
      }),
    );
  },
);
```

同步更新 Task 1 的工具名列表，加入 `flowx_start_workflow`。

- [ ] **Step 4: Run 确认通过**

Run: `pnpm --filter @flowx-ai/local test -- src/mcp.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add packages/flowx-local/src/mcp.ts packages/flowx-local/src/mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(local): add MCP start_workflow with userConfirmedStart gate

EOF
)"
```

---

### Task 3: Skill 模板 `flowx-intake-requirement`

**Files:**
- Create: `packages/flowx-local/templates/flowx-intake-requirement/SKILL.md`

- [ ] **Step 1: 写入完整 SKILL.md**

```markdown
---
name: flowx-intake-requirement
description: FlowX 本地需求发起：列出项目、创建需求、确认后启动工作流，并可选择进入产品构思。Use when the user wants to create a new FlowX requirement or start a requirement from local AI tools.
---

# FlowX 本地需求发起

在 Cursor / Codex + FlowX MCP 中，从零创建需求并启动工作流。平台以查看与确认门禁为主；本 Skill 是推荐发起路径。

## 何时使用

- 用户要新建 / 发起 FlowX 需求，且还没有应优先 bind 的既有工作流
- 若已有候选工作流：先 `flowx_list_tasks`，确认后 `flowx_bind_workflow`，不要重复创建

## 必须流程

1. **选项目**  
   调用 `flowx_list_projects`，向用户展示工作区/项目列表（可附一句推荐），**必须等用户选定** `projectId`。  
   禁止用本地目录或 git remote 猜测项目。

2. **收齐字段**  
   - 必填：`title`、`description`  
   - `acceptanceCriteria`：API 必填；用户未给时用一两句可观察结果占位，并在启动摘要标明「占位，可后续在 Web 改」  
   - `repositoryIds`：可选；不选则继承平台默认

3. **创建**  
   调用 `flowx_create_requirement`。成功后回显 `requirementId`、标题、项目。  
   创建前不强制二次确认；标题/描述含糊时先问清再调用。

4. **启动确认（硬门禁）**  
   创建成功后立刻进入启动，但先展示摘要再调工具：  
   - 需求标题与 id  
   - 仓库范围  
   - AI 执行器（`codex` / `cursor`，若用户有偏好）  
   - 选项：**启动并进入构思** / **仅启动，暂不构思**  
   仅当用户明确选择后，以 `userConfirmedStart: true` 调用 `flowx_start_workflow`。  
   禁止在未确认时启动。

5. **启动后分支**  
   - **进入构思：** `flowx_bind_workflow`（stage=`brainstorm`）→ 按 `flowx-product-prd` 继续（handoff → `prd.md` → 确认后 submit）  
   - **暂不构思：** 告知可在 Web 查看，或稍后 `flowx_list_tasks`；结束，不写 `prd.md`

## 禁止

- 未确认即 `flowx_start_workflow`
- 把聊天记录原样当需求正文
- 在本 Skill 内提交 `prd.md` / `design.md`
- 启动失败时宣称已启动
- 自动删除已创建但未启动的需求

## 失败处理

- 创建失败：不进入启动  
- 已创建、启动失败：保留 `requirementId`，引导再次确认后重试启动，或回 Web 启动
```

- [ ] **Step 2: Commit（需用户授权）**

```bash
git add packages/flowx-local/templates/flowx-intake-requirement/SKILL.md
git commit -m "$(cat <<'EOF'
feat(local): add flowx-intake-requirement skill template

EOF
)"
```

---

### Task 4: `setup` / `update` 安装多 Skill（TDD）

**Files:**
- Modify: `packages/flowx-local/src/setup.ts`
- Modify: `packages/flowx-local/src/setup.test.ts`
- Modify: `packages/flowx-local/src/update.ts`（若 `resolveSkillInstallPaths` 签名变化）
- Modify: `packages/flowx-local/src/update.test.ts`（若有路径断言）

- [ ] **Step 1: 改测试为多 Skill**

将 `SKILL_NAME` 单例改为常量数组，并让路径解析带 skill 名：

```ts
export const SETUP_SKILL_NAMES = ['flowx-product-prd', 'flowx-intake-requirement'] as const;
export type SetupSkillName = (typeof SETUP_SKILL_NAMES)[number];

export function resolveSkillInstallPaths(
  target: SetupTarget,
  homeDir = homedir(),
  skillName: SetupSkillName = 'flowx-product-prd',
): string[] {
  if (target === 'cursor') {
    return [join(homeDir, '.cursor', 'skills', skillName, 'SKILL.md')];
  }
  return [join(homeDir, '.agents', 'skills', skillName, 'SKILL.md')];
}

export function skillTemplatePath(skillName: SetupSkillName): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    skillName,
    'SKILL.md',
  );
}
```

`runSetup` 对每个 `SETUP_SKILL_NAMES` × target 写文件。  
测试期望：`cursor,codex,od` 首次写入 **4** 个路径（2 skills × 2 去重根：cursor + agents），且 intake skill 内容含 `flowx_start_workflow` / `userConfirmedStart`。

`pickUpdateTargets`：任一 skill 路径存在即视为该 target 已 setup，例如：

```ts
const paths = SETUP_SKILL_NAMES.flatMap((skill) =>
  resolveSkillInstallPaths(target, homeDir, skill),
);
if (paths.some((path) => existsSync(path))) {
  existing.push(target);
}
```

- [ ] **Step 2: 实现并使测试通过**

Run: `pnpm --filter @flowx-ai/local test -- src/setup.test.ts src/update.test.ts`  
Expected: PASS

- [ ] **Step 3: Commit（需用户授权）**

```bash
git add packages/flowx-local/src/setup.ts packages/flowx-local/src/setup.test.ts packages/flowx-local/src/update.ts packages/flowx-local/src/update.test.ts
git commit -m "$(cat <<'EOF'
feat(local): install intake skill alongside product-prd in setup

EOF
)"
```

---

### Task 5: 兼容包 `flowx-mcp` 同步（TDD）

**Files:**
- Modify: `packages/flowx-mcp/src/flowx-api-client.ts`
- Modify: `packages/flowx-mcp/src/tools.ts`
- Modify: `packages/flowx-mcp/src/tools.test.ts`
- Modify: `packages/flowx-mcp/src/server.ts`（若工具注册不在 tools.ts）

- [ ] **Step 1: 在 `FlowXApiClient` 增加方法**

```ts
listProjects() {
  return this.request('/projects');
}

createRequirement(body: {
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  repositoryIds?: string[];
}) {
  return this.request('/requirements', { method: 'POST', body: JSON.stringify(body) });
}

createWorkflowRun(body: {
  requirementId: string;
  repositoryIds?: string[];
  aiProvider?: 'codex' | 'cursor';
}) {
  return this.request('/workflow-runs', { method: 'POST', body: JSON.stringify(body) });
}
```

- [ ] **Step 2: handlers + registerTool**（描述与 local 一致；start 同样校验 `userConfirmedStart === true`）

- [ ] **Step 3: 单测 mock apiClient**

覆盖：listProjects 被调用；createRequirement 传参；start 在 `userConfirmedStart: false` 时不调用 `createWorkflowRun`。

Run: `pnpm --filter flowx-mcp test`  
Expected: PASS

- [ ] **Step 4: Commit（需用户授权）**

```bash
git add packages/flowx-mcp
git commit -m "$(cat <<'EOF'
feat(mcp): mirror local requirement intake tools

EOF
)"
```

---

### Task 6: Web 弱化创建入口

**Files:**
- Modify: `apps/web/src/pages/RequirementsPage.tsx`
- Modify: `apps/web/src/pages/RequirementsPage.test.tsx`（若有 CTA 文案断言则更新；否则补一条）

- [ ] **Step 1: 调整页头与主 CTA**

- `PageHeader` description 改为强调：推荐用本地 AI + Skill 发起；本页可查看与兜底创建。  
- `SectionHeader` extra：主按钮改为链到 `/local-agent`（文案如「用本地 AI 发起」）；次要 `UiButton variant="outline"` 仍打开现有创建 Modal（文案「网页创建」）。  
- 保持现有 Modal / `createRequirement` 逻辑不变。

示例结构（按页面现有组件 API 微调）：

```tsx
extra={(
  <div className="flex flex-wrap items-center gap-2">
    <UiButton asChild>
      <Link to="/local-agent">用本地 AI 发起</Link>
    </UiButton>
    <UiButton variant="outline" onClick={() => setCreateModalOpen(true)}>
      网页创建
    </UiButton>
  </div>
)}
```

若 `UiButton` 不支持 `asChild`，改用 `Link` + className 或 `useNavigate`。

- [ ] **Step 2: 更新/补充测试**

断言页面出现「用本地 AI 发起」与「网页创建」；点击网页创建仍打开对话框（沿用现有测法）。

Run: `pnpm --filter flowx-web test -- src/pages/RequirementsPage.test.tsx`  
Expected: PASS

- [ ] **Step 3: Commit（需用户授权）**

```bash
git add apps/web/src/pages/RequirementsPage.tsx apps/web/src/pages/RequirementsPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): prefer local AI intake CTA on requirements page

EOF
)"
```

---

### Task 7: 文档与手册镜像

**Files:**
- Modify: `docs/local-agent-guide.md`
- Modify: `apps/web/public/local-agent-guide.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `docs/edge-agent-operations.md`（setup 节提到仅 product-prd 处，改为两个 Skill）

- [ ] **Step 1: local-agent-guide**

在 setup 节写明安装 `flowx-product-prd` **与** `flowx-intake-requirement`。  
新增「本地发起需求」小节节：login → setup → Cursor/Codex 说新建需求 → `list_projects` → create → 确认 start（`userConfirmedStart`）→ 可选构思。  
MCP 工具表增加三个工具及启动门禁说明。

- [ ] **Step 2: user-manual**

「步骤 5 / 创建需求并启动工作流」改为：  
1）推荐本地 AI 发起（链到 `/local-agent`）；  
2）网页创建与启动作为兜底步骤保留。

- [ ] **Step 3: 同步 public 镜像并校验**

```bash
cp docs/local-agent-guide.md apps/web/public/local-agent-guide.md
cp docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
git diff --check
```

Expected: `cmp` 无输出；`git diff --check` 无错误。

- [ ] **Step 4: Commit（需用户授权）**

```bash
git add docs/local-agent-guide.md apps/web/public/local-agent-guide.md docs/user-manual.md apps/web/public/user-manual.md docs/edge-agent-operations.md
git commit -m "$(cat <<'EOF'
docs: document local requirement intake as primary path

EOF
)"
```

---

### Task 8: 回归验证

- [ ] **Step 1: 跑受影响包测试**

```bash
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp test
pnpm --filter flowx-web test -- src/pages/RequirementsPage.test.tsx
```

Expected: PASS

- [ ] **Step 2:（可选）本地手工烟测**

1. `flowx-local login` + `flowx-local setup --force`  
2. Cursor 调用 `flowx_list_projects` → create → 无确认 start 应失败 → 确认后 start 成功  
3. Web 需求列表可见；主 CTA 为本地发起  

- [ ] **Step 3: 将 spec 状态改为 Approved for implementation（可选）**

`docs/superpowers/specs/2026-08-12-local-requirement-intake-design.md` 头部 Status 改为 `Approved for implementation`。

---

## Spec coverage checklist

| Spec 要求 | Task |
| --- | --- |
| `flowx_list_projects` | 1 |
| `flowx_create_requirement`（对齐 DTO，含 acceptanceCriteria） | 1 |
| `flowx_start_workflow` + `userConfirmedStart` | 2 |
| Skill 编排与门禁文案 | 3 |
| `setup` 安装 intake Skill | 4 |
| 兼容 MCP 包 | 5 |
| Web 弱化创建、保留能力 | 6 |
| 手册 / local-agent-guide / 镜像 | 7 |
| 半成功不删需求、可选构思（Skill 约束，无服务端删除逻辑） | 3 |
| 不引入原子 create+start API | （刻意不做） |
| 不用本地仓库推断项目 | 1+3 |

## 风险与注意

- `GET /projects` 是否对 PAT 用户过滤可见范围：若返回过多，后续再加 workspace 过滤；一期先透传现有 API。  
- 创建与启动之间的半成功是预期行为；Skill 必须说清。  
- Commit 步骤默认需用户明确授权后再执行（仓库偏好）。
