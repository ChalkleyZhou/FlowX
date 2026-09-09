# WorkBuddy 本地 IDE 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把腾讯 WorkBuddy 桌面端做成 `flowx-local` 的第三本地 IDE，覆盖默认 setup、用户/项目 MCP 与 Skill、以及 Web「本地启动」。

**Architecture:** 沿用 Cursor 的 `ToolAdapter` + `launchIde`。`ide: "workbuddy"` 走 `WorkBuddyAdapter`：写 `.workbuddy` 配置后用桌面端打开仓库。不改云端 `aiProvider` / 凭据。

**Tech Stack:** TypeScript、Vitest、`packages/flowx-local` loopback HTTP、React Web bridge。

**Design spec:** `docs/superpowers/specs/2026-09-09-workbuddy-local-ide-design.md`

**Commit 约定：** 本仓库默认不自动 commit。任务里的 commit 步骤仅在用户明确要求提交时执行。

---

## File map

| Path | Role |
|------|------|
| `packages/flowx-local/src/open-ide.ts` | `Ide` 增加 `workbuddy`；桌面端启动 |
| `packages/flowx-local/src/open-ide.test.ts` | macOS / Windows / Linux 启动测试 |
| `packages/flowx-local/src/config.ts` | `defaultIde` 允许 `workbuddy` |
| `packages/flowx-local/src/config.test.ts` | 读写 `defaultIde: workbuddy` |
| `packages/flowx-local/src/user-mcp.ts` | 用户级 `~/.workbuddy/mcp.json` |
| `packages/flowx-local/src/user-mcp.test.ts` | 合并 / 非法 JSON / 去 token |
| `packages/flowx-local/src/setup.ts` | 默认 target 含 `workbuddy`；Skill 路径 |
| `packages/flowx-local/src/setup.test.ts` | 默认列表与 Skill 落盘 |
| `packages/flowx-local/src/update.ts` | update 扫描含 `workbuddy` |
| `packages/flowx-local/src/update.test.ts` | 无已有 Skill 时默认含 `workbuddy` |
| `packages/flowx-local/src/ensure-project.ts` | `ide=workbuddy` 写项目 `.workbuddy` |
| `packages/flowx-local/src/ensure-project.test.ts` | 项目级 MCP / Skill |
| `packages/flowx-local/src/adapters/workbuddy-adapter.ts` | 新 adapter |
| `packages/flowx-local/src/adapters/ide-launch.ts` | 把 `ide` 传给 `ensureProject`；返回 `opened` |
| `packages/flowx-local/src/adapters/ide-adapter.test.ts` | WorkBuddy adapter |
| `packages/flowx-local/src/launch.ts` | registry 注册 WorkBuddy |
| `packages/flowx-local/src/server.ts` | `/launch` 接受 `workbuddy` |
| `packages/flowx-local/src/index.ts` | CLI usage 文案 |
| `apps/web/src/lib/flowx-local-bridge.ts` | `ide` + `opened` |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | 第三按钮与 toast |
| `docs/local-agent-guide.md`、`docs/web-local-ide-launch.md`、`docs/user-manual.md` 及 `apps/web/public` 镜像 | 用户文档 |

---

### Task 1: `Ide` 与桌面端启动

**Files:**
- Modify: `packages/flowx-local/src/open-ide.ts`
- Test: `packages/flowx-local/src/open-ide.test.ts`

- [ ] **Step 1: Write the failing tests**

在 `open-ide.test.ts` 追加：

```ts
  it('opens WorkBuddy on macOS with open -a', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const exec = vi.fn(() => ({ stdin: { end: vi.fn() } }));

    await expect(
      openIde('workbuddy', '/work/repo', 'Do the work', { spawn, exec, platform: 'darwin' }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['-a', 'WorkBuddy', '/work/repo'],
      expect.objectContaining({ detached: true }),
    );
    expect(exec).toHaveBeenCalledWith('pbcopy');
  });

  it('opens WorkBuddy.exe on Windows from WORKBUDDY_PATH', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const existsSync = vi.fn(() => true);

    await expect(
      openIde('workbuddy', 'C:\\work\\repo', 'Do the work', {
        spawn,
        exec: vi.fn(),
        platform: 'win32',
        existsSync,
        env: { WORKBUDDY_PATH: 'D:\\Apps\\WorkBuddy.exe' },
      }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith(
      'D:\\Apps\\WorkBuddy.exe',
      ['C:\\work\\repo'],
      expect.objectContaining({ detached: true }),
    );
  });

  it('opens WorkBuddy.exe from LOCALAPPDATA when WORKBUDDY_PATH is absent', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const existsSync = vi.fn((path: string) => path.endsWith('WorkBuddy.exe'));

    await expect(
      openIde('workbuddy', 'C:\\work\\repo', 'prompt', {
        spawn,
        exec: vi.fn(),
        platform: 'win32',
        existsSync,
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe',
      ['C:\\work\\repo'],
      expect.objectContaining({ detached: true }),
    );
  });

  it('does not spawn WorkBuddy on Linux', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openIde('workbuddy', '/work/repo', 'Do the work', {
        spawn,
        exec: vi.fn(),
        platform: 'linux',
      }),
    ).resolves.toEqual({ opened: false, prefilled: false });

    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns opened false when Windows WorkBuddy.exe is missing', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openIde('workbuddy', 'C:\\work\\repo', 'prompt', {
        spawn,
        exec: vi.fn(),
        platform: 'win32',
        existsSync: () => false,
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
    ).resolves.toEqual({ opened: false, prefilled: false });

    expect(spawn).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/open-ide.test.ts`

Expected: FAIL，因为 `'workbuddy'` 不是当前 `Ide`。

- [ ] **Step 3: Write minimal implementation**

`open-ide.ts` 改为：

```ts
import { exec, spawn } from 'node:child_process';
import { existsSync as defaultExistsSync } from 'node:fs';
import { platform as getPlatform } from 'node:os';
import { join } from 'node:path';

export const LOCAL_IDES = ['cursor', 'codex', 'workbuddy'] as const;
export type Ide = (typeof LOCAL_IDES)[number];

export function isLocalIde(value: string): value is Ide {
  return (LOCAL_IDES as readonly string[]).includes(value);
}

type SpawnCommand = (
  command: string,
  args: string[],
  options: { cwd?: string; detached: boolean; stdio: 'ignore' },
) => { unref?: () => void };

type ExecuteCommand = (
  command: string,
) => { stdin?: { end: (input: string) => void } | null } | undefined;

export type OpenIdeDependencies = {
  spawn?: SpawnCommand;
  exec?: ExecuteCommand;
  platform?: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
};

export function resolveWorkBuddyExecutable(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  existsSync: (path: string) => boolean = defaultExistsSync,
): string | null {
  if (platform !== 'win32') {
    return null;
  }
  const configured = env.WORKBUDDY_PATH?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  const localAppData = env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    return null;
  }
  const fallback = join(localAppData, 'Programs', 'WorkBuddy', 'WorkBuddy.exe');
  return existsSync(fallback) ? fallback : null;
}

function copyToClipboard(
  prompt: string,
  platform: NodeJS.Platform,
  run: ExecuteCommand,
): void {
  if (platform !== 'darwin') {
    return;
  }
  try {
    const child = run('pbcopy');
    child?.stdin?.end(prompt);
  } catch {
    // Clipboard support is best effort.
  }
}

function resolveLaunchCommand(
  ide: Ide,
  gitRoot: string,
  platform: NodeJS.Platform,
  deps: OpenIdeDependencies,
): { command: string; args: string[]; cwd?: string } | null {
  if (ide === 'cursor') {
    return { command: 'cursor', args: [gitRoot] };
  }
  if (ide === 'codex') {
    return { command: 'codex', args: [], cwd: gitRoot };
  }
  if (platform === 'darwin') {
    return { command: 'open', args: ['-a', 'WorkBuddy', gitRoot] };
  }
  if (platform === 'win32') {
    const exe = resolveWorkBuddyExecutable(
      platform,
      deps.env ?? process.env,
      deps.existsSync ?? defaultExistsSync,
    );
    if (!exe) {
      return null;
    }
    return { command: exe, args: [gitRoot] };
  }
  return null;
}

export async function openIde(
  ide: Ide,
  gitRoot: string,
  prompt: string,
  dependencies: OpenIdeDependencies = {},
): Promise<{ opened: boolean; prefilled: boolean }> {
  const platform = dependencies.platform ?? getPlatform();
  const launch = resolveLaunchCommand(ide, gitRoot, platform, dependencies);
  if (!launch) {
    return { opened: false, prefilled: false };
  }
  const run: SpawnCommand = dependencies.spawn ?? spawn;
  try {
    const child = run(launch.command, launch.args, {
      cwd: launch.cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref?.();
    copyToClipboard(prompt, platform, dependencies.exec ?? ((command) => exec(command)));
    return { opened: true, prefilled: false };
  } catch {
    return { opened: false, prefilled: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/open-ide.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add packages/flowx-local/src/open-ide.ts packages/flowx-local/src/open-ide.test.ts
git commit -m "$(cat <<'EOF'
feat(local): open WorkBuddy desktop as a third IDE

EOF
)"
```

---

### Task 2: `defaultIde` 接受 `workbuddy`

**Files:**
- Modify: `packages/flowx-local/src/config.ts`
- Test: `packages/flowx-local/src/config.test.ts`

- [ ] **Step 1: Write the failing test**

在 `config.test.ts` 的 `loadConfig / saveConfig` 增加：

```ts
  it('persists defaultIde workbuddy', () => {
    const homeDir = makeHome();
    saveConfig(
      {
        ...DEFAULT_LOCAL_CONFIG,
        defaultIde: 'workbuddy',
      },
      { homeDir },
    );

    expect(loadConfig({ homeDir }).defaultIde).toBe('workbuddy');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/config.test.ts`

Expected: FAIL，`normalizeConfig` 把未知值回退成 `cursor`。

- [ ] **Step 3: Write minimal implementation**

`config.ts`：

```ts
import { isLocalIde, type Ide } from './open-ide.js';

export type DefaultIde = Ide;
```

`normalizeConfig` 中：

```ts
  const defaultIde = raw?.defaultIde && isLocalIde(raw.defaultIde)
    ? raw.defaultIde
    : DEFAULT_LOCAL_CONFIG.defaultIde;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add packages/flowx-local/src/config.ts packages/flowx-local/src/config.test.ts
git commit -m "$(cat <<'EOF'
feat(local): allow defaultIde workbuddy

EOF
)"
```

---

### Task 3: 用户级 `~/.workbuddy/mcp.json`

**Files:**
- Modify: `packages/flowx-local/src/user-mcp.ts`
- Test: `packages/flowx-local/src/user-mcp.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  it('merges WorkBuddy mcp.json without tokens and preserves other servers', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.workbuddy', 'mcp.json');
    mkdirSync(join(home, '.workbuddy'), { recursive: true });
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          other: { command: 'other' },
          flowx: {
            command: 'old',
            args: ['mcp'],
            env: { FLOWX_API_TOKEN: 'fxpat_old', FLOWX_API_BASE_URL: 'http://127.0.0.1:3000', KEEP: 'x' },
          },
        },
      }),
    );
    const result = upsertUserMcp({
      homeDir: home,
      targets: ['workbuddy'],
      flowxBin: '/usr/local/bin/flowx-local',
    });
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(parsed.mcpServers.other).toEqual({ command: 'other' });
    expect(parsed.mcpServers.flowx).toEqual({
      command: '/usr/local/bin/flowx-local',
      args: ['mcp'],
      env: { KEEP: 'x' },
    });
    expect(result.written).toContain(mcpPath);
  });

  it('throws on invalid WorkBuddy JSON without overwriting', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.workbuddy', 'mcp.json');
    mkdirSync(join(home, '.workbuddy'), { recursive: true });
    writeFileSync(mcpPath, '{not json');
    expect(() =>
      upsertUserMcp({ homeDir: home, targets: ['workbuddy'], flowxBin: '/bin/flowx-local' }),
    ).toThrow(/mcp.json/);
    expect(readFileSync(mcpPath, 'utf8')).toBe('{not json');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/user-mcp.test.ts`

Expected: FAIL，`workbuddy` 不是 `UserMcpTarget`。

- [ ] **Step 3: Write minimal implementation**

`user-mcp.ts`：

```ts
export type UserMcpTarget = 'cursor' | 'codex' | 'od' | 'workbuddy';
```

`upsertUserMcp` 循环中：

```ts
    if (target === 'cursor') {
      written.push(upsertJsonMcp(join(input.homeDir, '.cursor', 'mcp.json'), input.flowxBin, nodeExecPath));
    } else if (target === 'workbuddy') {
      written.push(upsertJsonMcp(join(input.homeDir, '.workbuddy', 'mcp.json'), input.flowxBin, nodeExecPath));
    } else if (target === 'codex') {
      written.push(upsertCodexMcp(input.homeDir, input.flowxBin, nodeExecPath));
    }
```

把现有 `upsertCursorMcp` 抽成 `upsertJsonMcp(mcpPath, flowxBin, nodeExecPath)`，Cursor 与 WorkBuddy 共用解析/合并/去 token 逻辑，不新增独立文件。`od` 仍然不写 MCP。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/user-mcp.test.ts`

Expected: PASS（含原有 Cursor / Codex 用例）

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add packages/flowx-local/src/user-mcp.ts packages/flowx-local/src/user-mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(local): upsert FlowX MCP into ~/.workbuddy/mcp.json

EOF
)"
```

---

### Task 4: setup / update 默认包含 `workbuddy`

**Files:**
- Modify: `packages/flowx-local/src/setup.ts`
- Modify: `packages/flowx-local/src/update.ts`
- Modify: `packages/flowx-local/src/index.ts`
- Test: `packages/flowx-local/src/setup.test.ts`
- Test: `packages/flowx-local/src/update.test.ts`

- [ ] **Step 1: Write the failing tests**

改 `setup.test.ts`：

```ts
  it('defaults targets to cursor,codex,od,workbuddy', () => {
    expect(parseSetupTargets()).toEqual(['cursor', 'codex', 'od', 'workbuddy']);
    expect(parseSetupTargets('')).toEqual(['cursor', 'codex', 'od', 'workbuddy']);
  });

  it('parses comma-separated targets and rejects unknown ones', () => {
    expect(parseSetupTargets('cursor,workbuddy')).toEqual(['cursor', 'workbuddy']);
    expect(() => parseSetupTargets('vscode')).toThrow(/Unknown setup target/);
  });
```

在 `resolves user-level skill paths` 增加：

```ts
    expect(resolveSkillInstallPaths('workbuddy', '/tmp/home')).toEqual([
      '/tmp/home/.workbuddy/skills/flowx-product-prd/SKILL.md',
    ]);
    expect(resolveSkillInstallPaths('workbuddy', '/tmp/home', 'flowx-intake-requirement')).toEqual([
      '/tmp/home/.workbuddy/skills/flowx-intake-requirement/SKILL.md',
    ]);
```

新增：

```ts
  it('writes WorkBuddy skills and user MCP', async () => {
    const home = makeHome();
    await runSetup({
      homeDir: home,
      targets: 'workbuddy',
      apiBaseUrl: 'https://flowx.example/api',
      flowxBin: '/bin/flowx-local',
      installService: vi.fn(),
    });
    const prd = join(home, '.workbuddy', 'skills', 'flowx-product-prd', 'SKILL.md');
    const intake = join(home, '.workbuddy', 'skills', 'flowx-intake-requirement', 'SKILL.md');
    const mcpPath = join(home, '.workbuddy', 'mcp.json');
    expect(existsSync(prd)).toBe(true);
    expect(existsSync(intake)).toBe(true);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers?: { flowx?: { command?: string; env?: Record<string, string> } };
    };
    expect(mcp.mcpServers?.flowx?.command).toBe('/bin/flowx-local');
    expect(mcp.mcpServers?.flowx?.env?.FLOWX_API_TOKEN).toBeUndefined();
  });
```

改 `update.test.ts`：

```ts
  it('auto-picks all default targets when none exist', () => {
    const homeDir = join(tmpdir(), `flowx-update-${Date.now()}`);
    const picked = pickUpdateTargets(homeDir);
    expect(picked).toEqual(['cursor', 'codex', 'od', 'workbuddy']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts src/update.test.ts`

Expected: FAIL，默认仍是 `cursor,codex,od`。

- [ ] **Step 3: Write minimal implementation**

`setup.ts`：

```ts
export type SetupTarget = 'cursor' | 'codex' | 'od' | 'workbuddy';

const DEFAULT_TARGETS: SetupTarget[] = ['cursor', 'codex', 'od', 'workbuddy'];
```

`parseSetupTargets` 的 `allowed` 改为同样四项；错误信息改为 `Use cursor, codex, od, and/or workbuddy.`

`resolveSkillInstallPaths`：

```ts
  if (target === 'cursor') {
    return [join(homeDir, '.cursor', 'skills', skillName, 'SKILL.md')];
  }
  if (target === 'workbuddy') {
    return [join(homeDir, '.workbuddy', 'skills', skillName, 'SKILL.md')];
  }
  return [join(homeDir, '.agents', 'skills', skillName, 'SKILL.md')];
```

`upsertUserMcp` 过滤：

```ts
    targets: targets.filter((target): target is 'cursor' | 'codex' | 'workbuddy' =>
      target === 'cursor' || target === 'codex' || target === 'workbuddy',
    ),
```

`update.ts`：

```ts
  const candidates: SetupTarget[] = ['cursor', 'codex', 'od', 'workbuddy'];
```

`index.ts` usage 两处 `cursor|codex|od` 改为 `cursor|codex|od|workbuddy`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts src/update.test.ts src/setup-cli.test.ts`

Expected: PASS。`writes missing skills...` 仍用显式 `targets: 'cursor,codex,od'`，路径数保持 4。

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add packages/flowx-local/src/setup.ts packages/flowx-local/src/setup.test.ts packages/flowx-local/src/update.ts packages/flowx-local/src/update.test.ts packages/flowx-local/src/index.ts
git commit -m "$(cat <<'EOF'
feat(local): include workbuddy in default setup targets

EOF
)"
```

---

### Task 5: 项目级 `.workbuddy` 落盘

**Files:**
- Modify: `packages/flowx-local/src/ensure-project.ts`
- Test: `packages/flowx-local/src/ensure-project.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  it('writes WorkBuddy project skill and mcp when ide is workbuddy', () => {
    const gitRoot = makeProject();
    const mcpPath = join(gitRoot, '.workbuddy', 'mcp.json');
    mkdirSync(join(gitRoot, '.workbuddy'), { recursive: true });
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { existing: { command: 'test' } } }));

    ensureProject(gitRoot, {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
      ide: 'workbuddy',
    });

    expect(existsSync(join(gitRoot, '.workbuddy', 'skills', 'flowx-local-execution', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(gitRoot, '.cursor', 'mcp.json'))).toBe(false);
    expect(existsSync(join(gitRoot, '.cursor', 'skills', 'flowx-local-execution', 'SKILL.md'))).toBe(false);
    expect(JSON.parse(readFileSync(mcpPath, 'utf8'))).toEqual({
      mcpServers: {
        existing: { command: 'test' },
        flowx: {
          command: 'flowx-local',
          args: ['mcp'],
          env: {
            FLOWX_API_BASE_URL: 'https://flowx.example',
            FLOWX_API_TOKEN: 'token-1',
          },
        },
      },
    });
  });

  it('does not overwrite an existing WorkBuddy skill', () => {
    const gitRoot = makeProject();
    const skillPath = join(gitRoot, '.workbuddy', 'skills', 'flowx-local-execution', 'SKILL.md');
    mkdirSync(join(gitRoot, '.workbuddy', 'skills', 'flowx-local-execution'), { recursive: true });
    writeFileSync(skillPath, 'custom instructions');

    ensureProject(gitRoot, {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
      ide: 'workbuddy',
    });

    expect(readFileSync(skillPath, 'utf8')).toBe('custom instructions');
  });
```

原有「缺省写 `.cursor` + `.agents`」用例保持不变。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/ensure-project.test.ts`

Expected: FAIL，`EnsureProjectOptions` 没有 `ide`。

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Ide } from './open-ide.js';

export type EnsureProjectOptions = {
  apiBaseUrl: string;
  mcpToken: string;
  mcpEntryPath?: string;
  ide?: Ide;
};
```

`ensureProject` 在 `ide === 'workbuddy'` 时：

- `writeIfMissing(join(gitRoot, '.workbuddy', 'skills', 'flowx-local-execution', 'SKILL.md'), skill)`
- 把现有 MCP merge 写到 `join(gitRoot, '.workbuddy', 'mcp.json')`
- 不写 `.cursor` / `.agents`

否则保持现有 `.cursor` + `.agents` 行为。MCP server 构造逻辑复用现有 `mcpEntryPath` / `flowx-local mcp` 分支。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/ensure-project.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add packages/flowx-local/src/ensure-project.ts packages/flowx-local/src/ensure-project.test.ts
git commit -m "$(cat <<'EOF'
feat(local): write project .workbuddy MCP and skill on launch

EOF
)"
```

---

### Task 6: Adapter、`/launch` 与 `opened`

**Files:**
- Create: `packages/flowx-local/src/adapters/workbuddy-adapter.ts`
- Modify: `packages/flowx-local/src/adapters/ide-launch.ts`
- Modify: `packages/flowx-local/src/adapters/ide-adapter.test.ts`
- Modify: `packages/flowx-local/src/launch.ts`
- Modify: `packages/flowx-local/src/server.ts`
- Modify: `packages/flowx-local/src/server.test.ts`
- Test: `packages/flowx-local/src/adapters/ide-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

`ide-adapter.test.ts` 追加：

```ts
import { WorkBuddyAdapter } from './workbuddy-adapter.js';

describe('WorkBuddyAdapter', () => {
  it('ensures project with workbuddy ide and opens workbuddy', async () => {
    const ensureProject = vi.fn();
    const writePromptFile = vi.fn(() => '/repo/.flowx/tasks/workflow-1.md');
    const openIde = vi.fn(async () => ({ opened: false, prefilled: false }));
    const adapter = new WorkBuddyAdapter({ ensureProject, writePromptFile, openIde });

    await expect(adapter.launch(baseInput)).resolves.toEqual({
      ok: true,
      gitRoot: '/repo',
      ide: 'workbuddy',
      opened: false,
      prefilled: false,
      promptPath: '/repo/.flowx/tasks/workflow-1.md',
      executionSessionId: 'session-1',
      workflowRunId: 'workflow-1',
    });

    expect(ensureProject).toHaveBeenCalledWith('/repo', {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
      mcpEntryPath: '/tools/flowx-mcp/dist/index.js',
      ide: 'workbuddy',
    });
    expect(openIde).toHaveBeenCalledWith('workbuddy', '/repo', 'Do work');
  });
});
```

同步把 Cursor / Codex adapter 期望补上 `opened: true`（mock `openIde` 返回 `{ opened: true, prefilled: false }`）。

`server.test.ts` 的 `runLaunch` 参数类型改为 `'cursor' | 'codex' | 'workbuddy'`，并新增：

```ts
  it('accepts workbuddy launch requests', async () => {
    const runLaunch = async (input: {
      ticket: string;
      ide: 'cursor' | 'codex' | 'workbuddy';
      apiBaseUrl: string;
    }) => ({
      ok: true as const,
      gitRoot: '/work/repo',
      ide: input.ide,
      opened: false,
      prefilled: false,
      promptPath: '/work/repo/.flowx/tasks/workflow-1.md',
    });
    const server = createLocalServer({ runLaunch, homeDir: makeHome() });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');

    const response = await fetch(`http://127.0.0.1:${address.port}/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ticket: 'ticket-1',
        ide: 'workbuddy',
        apiBaseUrl: 'https://flowx.example',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ide: 'workbuddy' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/adapters/ide-adapter.test.ts src/server.test.ts`

Expected: FAIL，没有 `WorkBuddyAdapter`，`/launch` 拒收 `workbuddy`。

- [ ] **Step 3: Write minimal implementation**

`workbuddy-adapter.ts`：

```ts
import type { ToolAdapter } from './tool-adapter.js';
import {
  launchIde,
  type IdeAdapterDeps,
  type IdeAdapterLaunchInput,
  type IdeLaunchResult,
} from './ide-launch.js';

export class WorkBuddyAdapter implements ToolAdapter<IdeAdapterLaunchInput, IdeLaunchResult> {
  readonly name = 'workbuddy';
  readonly capabilities = ['repo-open', 'chat-handoff', 'completion-report'] as const;

  constructor(private readonly deps: IdeAdapterDeps = {}) {}

  launch(input: IdeAdapterLaunchInput): Promise<IdeLaunchResult> {
    return launchIde({ ...input, ide: 'workbuddy' }, this.deps);
  }
}
```

`ide-launch.ts` 的 `IdeLaunchResult` 增加 `opened: boolean`。`launchIde`：

```ts
  (deps.ensureProject ?? ensureProject)(input.gitRoot, {
    apiBaseUrl: input.apiBaseUrl,
    mcpToken: input.mcpToken,
    mcpEntryPath: input.mcpEntryPath,
    ide: input.ide,
  });
  // ...
  return {
    ok: true,
    gitRoot: input.gitRoot,
    ide: input.ide,
    opened: opened.opened,
    prefilled: opened.prefilled,
    promptPath,
    executionSessionId: input.executionSessionId,
    workflowRunId: input.workflowRunId,
  };
```

`launch.ts`：

```ts
import { WorkBuddyAdapter } from './adapters/workbuddy-adapter.js';

export function defaultIdeRegistry(deps: IdeAdapterDeps = {}) {
  return new AdapterRegistry([
    new CursorAdapter(deps),
    new CodexAdapter(deps),
    new WorkBuddyAdapter(deps),
  ]);
}
```

`server.ts`：

```ts
import { isLocalIde } from './open-ide.js';
// ...
        if (
          !body ||
          typeof body.ticket !== 'string' ||
          typeof body.ide !== 'string' ||
          !isLocalIde(body.ide) ||
          typeof body.apiBaseUrl !== 'string'
        ) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/adapters/ide-adapter.test.ts src/launch.test.ts src/server.test.ts`

Expected: PASS。`launch.test.ts` 若断言完整对象且缺 `opened`，给 mock `adapterLaunch` 补上 `opened: true` 或改成 `toMatchObject`。

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add packages/flowx-local/src/adapters/workbuddy-adapter.ts packages/flowx-local/src/adapters/ide-launch.ts packages/flowx-local/src/adapters/ide-adapter.test.ts packages/flowx-local/src/launch.ts packages/flowx-local/src/server.ts packages/flowx-local/src/server.test.ts packages/flowx-local/src/launch.test.ts
git commit -m "$(cat <<'EOF'
feat(local): launch WorkBuddy through the IDE adapter

EOF
)"
```

---

### Task 7: Web 本地启动第三选项

**Files:**
- Modify: `apps/web/src/lib/flowx-local-bridge.ts`
- Test: `apps/web/src/lib/flowx-local-bridge.test.ts`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Test: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
- Modify: `apps/web/src/pages/LocalAgentGuidePage.tsx`

- [ ] **Step 1: Write the failing tests**

`flowx-local-bridge.test.ts` 增加：

```ts
  it('launchFlowxLocal accepts workbuddy and returns opened', async () => {
    const body = {
      ticket: 'ticket-1',
      ide: 'workbuddy' as const,
      apiBaseUrl: 'http://127.0.0.1:3000',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        gitRoot: '/tmp/repo',
        ide: 'workbuddy',
        opened: false,
        prefilled: false,
        promptPath: '/tmp/repo/.flowx/tasks/w.md',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(launchFlowxLocal(body, 3922)).resolves.toEqual({
      ok: true,
      gitRoot: '/tmp/repo',
      ide: 'workbuddy',
      opened: false,
      prefilled: false,
      promptPath: '/tmp/repo/.flowx/tasks/w.md',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3922/launch',
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });
```

`WorkflowRunDetailPage.test.tsx` 在现有 Cursor 用例后追加：

```ts
  it('launches WorkBuddy through flowx-local', async () => {
    // 复用 Cursor 用例的 claim / ticket / probe mock
    launchFlowxLocal.mockResolvedValue({
      ok: true,
      gitRoot: '/tmp/flowx',
      ide: 'workbuddy',
      opened: false,
      prefilled: false,
      promptPath: '/tmp/flowx/.flowx/prompt.md',
    });

    await renderPage();
    // 点「开发执行」→「本地启动」→「WorkBuddy」，断言：
    expect(launchFlowxLocal).toHaveBeenCalledWith(
      { ticket: 'ticket-1', ide: 'workbuddy', apiBaseUrl: 'http://127.0.0.1:3000' },
      3920,
    );
  });
```

实现时把 Cursor 用例的公共 arrange 抽到该测试里（claim / ticket / probe 与现有用例相同），不要写「similar to previous test」而不给 arrange。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter flowx-web exec vitest run src/lib/flowx-local-bridge.test.ts src/pages/WorkflowRunDetailPage.test.tsx`

Expected: FAIL，`ide` 类型不含 `workbuddy`，对话框没有第三按钮。

- [ ] **Step 3: Write minimal implementation**

`flowx-local-bridge.ts`：

```ts
export type FlowxLocalLaunchBody = {
  ticket: string;
  ide: 'cursor' | 'codex' | 'workbuddy';
  apiBaseUrl: string;
};

export type FlowxLocalLaunchResult = {
  ok: true;
  gitRoot: string;
  ide: string;
  prefilled: boolean;
  promptPath: string;
  opened?: boolean;
};
```

`WorkflowRunDetailPage.tsx` 增加：

```ts
function localIdeLabel(ide: FlowxLocalLaunchBody['ide']): string {
  if (ide === 'cursor') return 'Cursor';
  if (ide === 'workbuddy') return 'WorkBuddy';
  return 'Codex';
}

function localLaunchSuccessMessage(
  ide: FlowxLocalLaunchBody['ide'],
  result: FlowxLocalLaunchResult,
): string {
  const label = localIdeLabel(ide);
  if (result.prefilled) {
    return `已打开 ${label} 并预填执行上下文`;
  }
  if (result.opened === false) {
    return `提示词已生成，但未打开 ${label}`;
  }
  return `已打开 ${label}；提示词文件已生成，内容已复制到剪贴板`;
}
```

`launchLocalExecution` 的 toast 改为 `toast.success(localLaunchSuccessMessage(ide, result))`。

对话框第三按钮：

```tsx
            <UiButton
              type="button"
              variant="outline"
              className="flex-1"
              disabled={localLaunchBusy}
              onClick={() => void launchLocalExecution('workbuddy')}
            >
              WorkBuddy
            </UiButton>
```

帮助文案 `选择 Cursor 或 Codex` 改为 `选择 Cursor、Codex 或 WorkBuddy`。

`LocalAgentGuidePage.tsx` description 改为：`在本机终端执行 curl 安装脚本，再 login，即可连接 Cursor / Codex / WorkBuddy。`

不改 AI 凭据页、需求页云端执行器、`aiProvider`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter flowx-web exec vitest run src/lib/flowx-local-bridge.test.ts src/pages/WorkflowRunDetailPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**（仅在用户明确要求提交时）

```bash
git add apps/web/src/lib/flowx-local-bridge.ts apps/web/src/lib/flowx-local-bridge.test.ts apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx apps/web/src/pages/LocalAgentGuidePage.tsx
git commit -m "$(cat <<'EOF'
feat(web): offer WorkBuddy in local IDE launch

EOF
)"
```

---

### Task 8: 文档与手册镜像

**Files:**
- Modify: `docs/local-agent-guide.md`
- Modify: `apps/web/public/local-agent-guide.md`
- Modify: `docs/web-local-ide-launch.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `apps/web/src/pages/LocalAgentGuidePage.tsx`（若 Task 7 已改则跳过）
- Modify: `docs/superpowers/specs/2026-09-09-workbuddy-local-ide-design.md`（Status 改为 Approved）

- [ ] **Step 1: Update user-facing docs**

`docs/local-agent-guide.md`：

- 开头「接到本机 Cursor / Codex」改为「接到本机 Cursor / Codex / WorkBuddy」
- 「检测到 Cursor / Codex」改为「检测到 Cursor / Codex / WorkBuddy」
- 「选 Cursor / Codex」改为「选 Cursor / Codex / WorkBuddy」

`docs/web-local-ide-launch.md`：

- 流程图与步骤 3 增加 WorkBuddy
- MCP 章节说明：Cursor 写 `.cursor/mcp.json`，WorkBuddy 写 `.workbuddy/mcp.json`，形状相同
- 启动：macOS `open -a WorkBuddy <repo>`，Windows `%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe`，可用 `WORKBUDDY_PATH` 覆盖；Linux 不打开桌面端

`docs/user-manual.md`：

- 「本机用 Cursor / Codex 或 OpenDesign」改为「本机用 Cursor / Codex / WorkBuddy 或 OpenDesign」
- 「本地启动（Cursor / Codex）」改为「本地启动（Cursor / Codex / WorkBuddy）」
- AI 凭据那一行保持「Cursor / Codex 凭据」，不要写成 WorkBuddy 凭据

- [ ] **Step 2: Sync public mirrors**

```bash
cp docs/user-manual.md apps/web/public/user-manual.md
cp docs/local-agent-guide.md apps/web/public/local-agent-guide.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

Expected: `cmp` 无输出、退出码 0。

- [ ] **Step 3: Run package tests and whitespace check**

```bash
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-web test
git diff --check
```

Expected: 全部 PASS；`git diff --check` 无输出。

- [ ] **Step 4: Commit**（仅在用户明确要求提交时）

```bash
git add docs/local-agent-guide.md apps/web/public/local-agent-guide.md docs/web-local-ide-launch.md docs/user-manual.md apps/web/public/user-manual.md docs/superpowers/specs/2026-09-09-workbuddy-local-ide-design.md docs/superpowers/plans/2026-09-09-workbuddy-local-ide.md
git commit -m "$(cat <<'EOF'
docs: document WorkBuddy as a local IDE

EOF
)"
```

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| 第三 IDE / `defaultIde` | 1, 2, 6 |
| 默认 setup `cursor,codex,od,workbuddy` | 4 |
| 用户级 `~/.workbuddy/mcp.json` + skills | 3, 4 |
| 项目级 `.workbuddy` 仅 `ide=workbuddy` | 5, 6 |
| 桌面启动 macOS / Windows / Linux | 1 |
| `/launch` 接受 `workbuddy` | 6 |
| Web 第三选项与 toast | 7 |
| 文档与镜像 | 8 |
| 不做凭据 / `aiProvider` / CodeBuddy CLI | 全任务未改这些文件 |

## Self-review

- 无 TBD / 「similar to Task N」占位；WorkBuddy Web 测试要求写全 arrange。
- `Ide` / `DefaultIde` / `SetupTarget` / bridge `ide` 统一为 `'cursor' \| 'codex' \| 'workbuddy'`。
- `opened` 从 `openIde` → `IdeLaunchResult` → Web toast 一条链。
- Cursor / Codex 缺省落盘与凭据页不在改动列表里。
