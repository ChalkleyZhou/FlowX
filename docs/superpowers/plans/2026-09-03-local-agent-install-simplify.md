# 本地 Agent 安装简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本仓库提交需用户明确授权。执行时默认**跳过**各 Task 的 Commit 步，除非用户当场要求提交。

**Goal:** 用户在本机 FlowX 上 `curl /install | bash` 完成 Node 检查、npm 装包、后台服务和按需 Skill/MCP；`login` 只收 token，不再静默使用 `127.0.0.1:3000`。

**Architecture:** `@flowx-ai/local` 的 `setup` 负责确认 API 地址、注册用户级 daemon、按 target 写 Skill 与用户级 MCP。API 公开 `GET /install` 动态生成 bash 向导（嵌入该站点的 API 地址）。Nginx/Vite 把站点根路径 `/install` 反代到 API。Web 与手册主路径改为这条 curl。

**Tech Stack:** Node 20+、TypeScript、Vitest、NestJS、`smol-toml`（Codex `config.toml` 合并）、macOS LaunchAgent / Linux systemd --user。

**Spec:** `docs/superpowers/specs/2026-09-03-local-agent-install-simplify-design.md`

---

## File map

| 文件 | 职责 |
| --- | --- |
| `packages/flowx-local/src/api-base-url.ts` | 规范化、历史占位判定、解析确认后的 API 地址 |
| `packages/flowx-local/src/user-mcp.ts` | 用户级 Cursor `mcp.json` / Codex `config.toml` upsert |
| `packages/flowx-local/src/flowx-bin.ts` | 解析 `flowx-local` 绝对路径 |
| `packages/flowx-local/src/user-service.ts` | 生成并安装 LaunchAgent / systemd user unit |
| `packages/flowx-local/src/setup.ts` | Skill + MCP + `--no-ide`；调用地址/服务 |
| `packages/flowx-local/src/config.ts` | 缺省 `apiBaseUrl` 改为空串，避免新配置写入 3000 |
| `packages/flowx-local/src/index.ts` | `login` 失败不落盘；`setup` 新 flag；`update`/`status` |
| `packages/flowx-local/package.json` | 增加 `smol-toml` |
| `apps/api/src/local-install/*` | 公开 `GET /install` 与脚本生成 |
| `apps/api/src/app.module.ts` | 注册 LocalInstallModule |
| `docker/nginx/flowx.conf`、`apps/web/vite.config.ts` | `/install` 反代 |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` 等 | 安装文案改为 curl |
| `docs/local-agent-guide.md` 及手册镜像 / README / 运维文档 | 用户主路径 |

---

### Task 1: API 地址解析（取消静默 3000）

**Files:**
- Create: `packages/flowx-local/src/api-base-url.ts`
- Create: `packages/flowx-local/src/api-base-url.test.ts`
- Modify: `packages/flowx-local/src/config.ts`
- Modify: `packages/flowx-local/src/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  isConfirmedApiBaseUrl,
  isPlaceholderApiBaseUrl,
  normalizeApiBaseUrl,
  resolveApiBaseUrl,
} from './api-base-url.js';

describe('api-base-url', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeApiBaseUrl(' https://flowx.example/api/ ')).toBe('https://flowx.example/api');
  });

  it('treats historical localhost:3000 as placeholder', () => {
    expect(isPlaceholderApiBaseUrl('http://127.0.0.1:3000/')).toBe(true);
    expect(isPlaceholderApiBaseUrl('http://localhost:3000')).toBe(true);
    expect(isPlaceholderApiBaseUrl('https://flowx.example/api')).toBe(false);
  });

  it('does not treat empty as confirmed', () => {
    expect(isConfirmedApiBaseUrl('')).toBe(false);
    expect(isConfirmedApiBaseUrl('http://127.0.0.1:3000')).toBe(false);
    expect(isConfirmedApiBaseUrl('https://flowx.example/api')).toBe(true);
  });

  it('prefers explicit flag even when it is loopback', () => {
    expect(
      resolveApiBaseUrl({
        flag: 'http://127.0.0.1:3000',
        env: 'https://ignored',
        config: 'https://also-ignored',
      }),
    ).toEqual({ url: 'http://127.0.0.1:3000', source: 'flag' });
  });

  it('uses env then confirmed config, and treats placeholder config as missing', () => {
    expect(
      resolveApiBaseUrl({ env: 'https://from.env/api/', config: 'http://127.0.0.1:3000' }),
    ).toEqual({ url: 'https://from.env/api', source: 'env' });
    expect(resolveApiBaseUrl({ config: 'http://127.0.0.1:3000' })).toEqual({
      url: null,
      source: 'missing',
    });
    expect(resolveApiBaseUrl({ config: 'https://flowx.example/api' })).toEqual({
      url: 'https://flowx.example/api',
      source: 'config',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/api-base-url.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`packages/flowx-local/src/api-base-url.ts`:

```ts
export type ApiBaseUrlSource = 'flag' | 'env' | 'config';

export type ResolvedApiBaseUrl =
  | { url: string; source: ApiBaseUrlSource }
  | { url: null; source: 'missing' };

export function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

const PLACEHOLDERS = new Set(['http://127.0.0.1:3000', 'http://localhost:3000']);

export function isPlaceholderApiBaseUrl(url: string): boolean {
  return PLACEHOLDERS.has(normalizeApiBaseUrl(url));
}

export function isConfirmedApiBaseUrl(url: string | undefined): boolean {
  const normalized = normalizeApiBaseUrl(url ?? '');
  return normalized.length > 0 && !isPlaceholderApiBaseUrl(normalized);
}

export function resolveApiBaseUrl(input: {
  flag?: string;
  env?: string;
  config?: string;
}): ResolvedApiBaseUrl {
  const flag = input.flag?.trim() ? normalizeApiBaseUrl(input.flag) : '';
  if (flag) {
    return { url: flag, source: 'flag' };
  }
  const env = input.env?.trim() ? normalizeApiBaseUrl(input.env) : '';
  if (env) {
    return { url: env, source: 'env' };
  }
  const config = input.config?.trim() ? normalizeApiBaseUrl(input.config) : '';
  if (isConfirmedApiBaseUrl(config)) {
    return { url: config, source: 'config' };
  }
  return { url: null, source: 'missing' };
}
```

将 `packages/flowx-local/src/config.ts` 的 `DEFAULT_LOCAL_CONFIG.apiBaseUrl` 改为 `''`。`normalizeConfig` 在字符串为空时保留空串，**不要**回落到 3000。

在 `config.test.ts` 增加：缺失文件或未写 `apiBaseUrl` 时 `loadConfig` 得到 `apiBaseUrl === ''`。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/api-base-url.test.ts src/config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（需用户授权）

```bash
git add packages/flowx-local/src/api-base-url.ts packages/flowx-local/src/api-base-url.test.ts packages/flowx-local/src/config.ts packages/flowx-local/src/config.test.ts
git commit -m "fix(local): stop treating localhost:3000 as a silent API default"
```

---

### Task 2: login 使用确认地址，校验失败不写凭据

**Files:**
- Modify: `packages/flowx-local/src/index.ts`
- Create: `packages/flowx-local/src/login.ts`（把 `runLogin` / `promptToken` / `validateApiToken` 从 index 抽出以便测）
- Create: `packages/flowx-local/src/login.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveConfig } from './config.js';
import { getCredentialsPath } from './credentials.js';
import { runLogin } from './login.js';

const homes: string[] = [];

afterEach(() => {
  while (homes.length) {
    const home = homes.pop();
    if (home) rmSync(home, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'flowx-login-'));
  homes.push(home);
  return home;
}

describe('runLogin', () => {
  it('refuses to save when API URL is the historical placeholder and no flag is given', async () => {
    const home = makeHome();
    saveConfig(
      {
        port: 3920,
        repositories: {},
        defaultIde: 'cursor',
        installationId: 'i',
        deviceId: 'd',
        apiBaseUrl: 'http://127.0.0.1:3000',
        protocolVersion: '1',
        openDesignCommand: '',
      },
      { homeDir: home },
    );
    await expect(
      runLogin(['--token', 'fxpat_x'], { homeDir: home, promptApiBaseUrl: async () => '' }),
    ).rejects.toThrow(/apiBaseUrl/i);
    await expect(import('node:fs/promises').then((fs) => fs.readFile(getCredentialsPath(home), 'utf8'))).rejects.toThrow();
  });

  it('does not write credentials when token validation fails', async () => {
    const home = makeHome();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'nope' }),
    );
    await expect(
      runLogin(['--api-base-url', 'https://flowx.example/api', '--token', 'fxpat_bad'], { homeDir: home }),
    ).rejects.toThrow(/Token validation failed/);
    await expect(
      import('node:fs/promises').then((fs) => fs.access(getCredentialsPath(home))),
    ).rejects.toThrow();
  });

  it('saves credentials and local.json apiBaseUrl on success', async () => {
    const home = makeHome();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
    await runLogin(['--api-base-url', 'https://flowx.example/api', '--token', 'fxpat_ok'], {
      homeDir: home,
    });
    const creds = JSON.parse(readFileSync(getCredentialsPath(home), 'utf8'));
    expect(creds.apiBaseUrl).toBe('https://flowx.example/api');
    expect(creds.apiToken).toBe('fxpat_ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/login.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement `login.ts` and switch `index.ts`**

`runLogin` 用 `resolveApiBaseUrl({ flag, env: process.env.FLOWX_API_BASE_URL, config: loadConfig({ homeDir }).apiBaseUrl })`。`source === 'missing'` 时调用注入的 `promptApiBaseUrl`（默认 readline：「FlowX API 地址（例如 https://your-host/api）: 」）。空输入抛错。校验失败（含 `fetch failed` / `ECONNREFUSED`）**抛错**，不再 warn 后保存。成功后 `writeCredentials`，并 `saveConfig({ ...loadConfig(), apiBaseUrl: url })`。

`index.ts` 的 `login` 分支改为 `await runLogin(argv.slice(1))`。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/login.test.ts src/credentials.test.ts`

Expected: PASS（若 `credentials.test.ts` 依赖默认 3000，一并改成显式 URL）

- [ ] **Step 5: Commit**（需用户授权）

```bash
git add packages/flowx-local/src/login.ts packages/flowx-local/src/login.test.ts packages/flowx-local/src/index.ts packages/flowx-local/src/credentials.test.ts
git commit -m "fix(local): require a confirmed API URL before saving login credentials"
```

---

### Task 3: 用户级 MCP 合并

**Files:**
- Modify: `packages/flowx-local/package.json`（dependency `smol-toml`）
- Create: `packages/flowx-local/src/user-mcp.ts`
- Create: `packages/flowx-local/src/user-mcp.test.ts`

- [ ] **Step 1: Add dependency**

在仓库根：`pnpm --filter @flowx-ai/local add smol-toml`

- [ ] **Step 2: Write the failing test**

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { upsertUserMcp } from './user-mcp.js';

const homes: string[] = [];
afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe('upsertUserMcp', () => {
  it('merges Cursor mcp.json without tokens and preserves other servers', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.cursor', 'mcp.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
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
      targets: ['cursor'],
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

  it('upserts Codex [mcp_servers.flowx] and leaves other tables', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const tomlPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(tomlPath, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
    upsertUserMcp({ homeDir: home, targets: ['codex'], flowxBin: '/bin/flowx-local' });
    const doc = parse(readFileSync(tomlPath, 'utf8')) as {
      model: string;
      mcp_servers: Record<string, { command?: string; args?: string[] }>;
    };
    expect(doc.model).toBe('gpt-5');
    expect(doc.mcp_servers.other.command).toBe('x');
    expect(doc.mcp_servers.flowx).toEqual({ command: '/bin/flowx-local', args: ['mcp'] });
  });

  it('throws on invalid Cursor JSON without overwriting', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.cursor', 'mcp.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(mcpPath, '{not json');
    expect(() =>
      upsertUserMcp({ homeDir: home, targets: ['cursor'], flowxBin: '/bin/flowx-local' }),
    ).toThrow(/mcp.json/);
    expect(readFileSync(mcpPath, 'utf8')).toBe('{not json');
  });

  it('does not write MCP for od', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    upsertUserMcp({ homeDir: home, targets: ['od'], flowxBin: '/bin/flowx-local' });
    expect(() => readFileSync(join(home, '.cursor', 'mcp.json'))).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/user-mcp.test.ts`

Expected: FAIL

- [ ] **Step 4: Implement `user-mcp.ts`**

导出 `upsertUserMcp({ homeDir, targets, flowxBin })`：对 `cursor` 读/建 `~/.cursor/mcp.json`，保留其它 server，`flowx` 设为 `{ command: flowxBin, args: ['mcp'] }`，若已有 `env` 则删除 `FLOWX_API_TOKEN` 与 `FLOWX_API_BASE_URL`，其它 env 键保留。对 `codex` 用 `smol-toml` `parse`/`stringify` 只改 `mcp_servers.flowx`；parse 失败抛出含路径的 Error。`od` 跳过。损坏 JSON 同样抛错且不写。

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/user-mcp.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**（需用户授权）

```bash
git add packages/flowx-local/package.json packages/flowx-local/src/user-mcp.ts packages/flowx-local/src/user-mcp.test.ts pnpm-lock.yaml
git commit -m "feat(local): write user-level Cursor and Codex MCP during setup"
```

---

### Task 4: `flowx-local` 绝对路径

**Files:**
- Create: `packages/flowx-local/src/flowx-bin.ts`
- Create: `packages/flowx-local/src/flowx-bin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveFlowxLocalBin } from './flowx-bin.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('resolveFlowxLocalBin', () => {
  it('returns an existing executable from PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowx-bin-'));
    dirs.push(dir);
    const bin = join(dir, 'flowx-local');
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    expect(resolveFlowxLocalBin({ pathEnv: dir, argv1: '/unrelated/node' })).toBe(bin);
  });

  it('throws when not found', () => {
    expect(() => resolveFlowxLocalBin({ pathEnv: '/tmp/does-not-exist-flowx-bin', argv1: '' })).toThrow(
      /flowx-local/,
    );
  });
});
```

- [ ] **Step 2: Implement**

在 `PATH` 中查找名为 `flowx-local` 的可执行文件；找不到则若 `process.argv[1]` 指向本包 `dist/index.js` 且文件存在，返回该绝对路径（`#!/usr/bin/env node` 入口）。仍找不到则抛错。

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/flowx-bin.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**（需用户授权）

```bash
git add packages/flowx-local/src/flowx-bin.ts packages/flowx-local/src/flowx-bin.test.ts
git commit -m "feat(local): resolve absolute flowx-local path for MCP and services"
```

---

### Task 5: 用户级后台服务模板

**Files:**
- Create: `packages/flowx-local/src/user-service.ts`
- Create: `packages/flowx-local/src/user-service.test.ts`

- [ ] **Step 1: Write the failing test**

测试 `renderLaunchAgentPlist('/usr/local/bin/flowx-local', '/tmp/home/.flowx/logs/serve.log')` 含 `ai.flowx.local`、`RunAtLoad`、`KeepAlive`、绝对路径、`serve`。  
测试 `renderSystemdUserUnit(...)` 含 `ExecStart=` 绝对路径、`Restart=always`。  
测试 `installUserService({ platform: 'darwin', homeDir, flowxBin, run: spy })` 写出 plist 并调用 `launchctl bootout`（忽略失败）+ `launchctl bootstrap gui/$UID`。  
`platform: 'win32'` 返回 `{ skipped: 'win32' }`，不抛错。  
`run` 失败则抛错。

- [ ] **Step 2: Implement**

路径：

- macOS: `{home}/Library/LaunchAgents/ai.flowx.local.plist`
- Linux: `{home}/.config/systemd/user/flowx-local.service`

创建 `{home}/.flowx/logs/`。plist 的 `StandardOutPath` / `StandardErrorPath` 都指向 `serve.log`。  
`installUserService` 通过注入的 `run(command, args)` 执行系统命令，便于测试。darwin：`launchctl bootstrap gui/$(id -u)`；linux：`systemctl --user daemon-reload && systemctl --user enable --now flowx-local.service`。

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/user-service.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**（需用户授权）

```bash
git add packages/flowx-local/src/user-service.ts packages/flowx-local/src/user-service.test.ts
git commit -m "feat(local): install loopback serve as a user login service"
```

---

### Task 6: 扩展 `runSetup`

**Files:**
- Modify: `packages/flowx-local/src/setup.ts`
- Modify: `packages/flowx-local/src/setup.test.ts`

- [ ] **Step 1: Extend tests**

在现有 Skill 测试之外增加：

1. `runSetup({ homeDir, noIde: true, apiBaseUrl: 'https://flowx.example/api', flowxBin: '/bin/flowx-local', installService })`  
   - 不写 Skill、不写 MCP  
   - `local.json` 的 `apiBaseUrl` 为该 URL  
   - 调用 `installService`

2. `runSetup({ homeDir, targets: 'cursor', apiBaseUrl: 'https://flowx.example/api', flowxBin: '/bin/flowx-local' })`  
   - 写 Cursor Skill  
   - 写 `~/.cursor/mcp.json` 且无 token  
   - 调用 `installService`

3. 无 `apiBaseUrl` 且 config 为 placeholder、`promptApiBaseUrl` 返回空 → throw  
4. 无 `flowxBin` 且 `resolveBin` 抛错 → throw，不写 MCP

- [ ] **Step 2: Implement**

扩展 `SetupOptions`：`noIde?: boolean`、`apiBaseUrl?: string`、`envApiBaseUrl?: string`、`flowxBin?: string`、`promptApiBaseUrl?: () => Promise<string>`、`installService?: typeof installUserService`、`resolveBin?: typeof resolveFlowxLocalBin`。

流程：

1. `resolveApiBaseUrl` → missing 则 prompt；仍空则 throw  
2. `saveConfig` 写入确认后的 `apiBaseUrl`（保留 device 字段）  
3. `flowxBin = options.flowxBin ?? resolveFlowxLocalBin()`  
4. `(options.installService ?? installUserService)({ homeDir, flowxBin })`  
5. 若 `noIde`：只返回（可把服务/配置路径放进 `written`）  
6. 否则现有 Skill 循环，然后 `upsertUserMcp`（仅 `cursor`/`codex` target）

`runSetup` 若需要 prompt 则改为 `async`；同步测试改为 `await runSetup(...)`。

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts src/user-mcp.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**（需用户授权）

```bash
git add packages/flowx-local/src/setup.ts packages/flowx-local/src/setup.test.ts
git commit -m "feat(local): setup writes API URL, user service, and optional IDE MCP"
```

---

### Task 7: CLI 接线（setup / update / status）

**Files:**
- Modify: `packages/flowx-local/src/index.ts`

- [ ] **Step 1: Update setup argv parsing**

```ts
const noIde = args.includes('--no-ide');
const force = args.includes('--force');
const apiBaseUrl = readFlagValue(args, '--api-base-url');
const targets = args.find((arg) => !arg.startsWith('--') && arg !== apiBaseUrl);
await runSetup({ targets, force, noIde, apiBaseUrl });
```

`readFlagValue` 已占用的 `--api-base-url` 值不能被当成 target。过滤 `--no-ide` / `--force` / `--api-base-url` 及其值。

Usage 行更新为含 `--no-ide` 与 `--api-base-url`。

- [ ] **Step 2: `update` 在 package 升级后跑 `setup`（不要默认 `--no-ide`）**，让 MCP command 与服务绝对路径刷新。保留 `--no-force` 对 Skill 的含义。

- [ ] **Step 3: `status` JSON 增加 `apiBaseUrl`（已有）和 `service`：`{ platform, installed: boolean, healthOk: boolean }`**。`healthOk` 对 `http://127.0.0.1:<port>/health` 做短超时 fetch；测 `status` 可抽 `buildStatusPayload` 小函数单测，或在 `user-service.ts` 导出 `isServiceInstalled(homeDir, platform)`。

- [ ] **Step 4: Run**

Run: `pnpm --filter @flowx-ai/local test`

Expected: PASS

- [ ] **Step 5: Commit**（需用户授权）

```bash
git add packages/flowx-local/src/index.ts
git commit -m "feat(local): wire setup flags and refresh service on update"
```

---

### Task 8: `GET /install` 脚本

**Files:**
- Create: `apps/api/src/local-install/install-script.ts`
- Create: `apps/api/src/local-install/install-script.spec.ts`
- Create: `apps/api/src/local-install/local-install.controller.ts`
- Create: `apps/api/src/local-install/local-install.controller.spec.ts`
- Create: `apps/api/src/local-install/local-install.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/public-api-base-url.ts`（可选：导出「安装用」解析，**不要**把 3000 写进脚本，除非 request origin 本身是 loopback）

- [ ] **Step 1: Script builder tests**

`buildInstallScript({ apiBaseUrl, webOrigin, installUrl })` 返回的字符串必须包含：

- `#!/usr/bin/env bash` 与 `set -euo pipefail`
- `https://nodejs.org/`
- `npm install -g @flowx-ai/local --registry https://registry.npmjs.org`
- `flowx-local setup --api-base-url '${apiBaseUrl}' --no-ide`
- `flowx-local setup cursor` / `setup codex`（在检测到且用户答 Y 时）
- `/settings/api-tokens` 与 `flowx-local login`
- `uname` 命中 `MINGW|MSYS|CYGWIN|Windows_NT` 时退出并说明不支持
- **不包含** `--token`、`fxpat_` 示例密钥、`127.0.0.1:3000` 作为默认（除非传入的 apiBaseUrl 恰好是 loopback）

再测 `resolveInstallApiBaseUrl({ env, requestOrigin })`：有 `PUBLIC_API_BASE_URL` 用它（去尾斜杠）；否则 `requestOrigin + '/api'`。

- [ ] **Step 2: Implement script**（生成函数内完整 bash，逻辑如下）

```bash
# 伪代码结构（实现时写成 install-script.ts 的模板字符串）
need node major >= 20 else echo nodejs.org and "$INSTALL_URL" && exit 1
npm install -g @flowx-ai/local --registry https://registry.npmjs.org
flowx-local setup --api-base-url "$API_BASE_URL" --no-ide
detect_cursor: /Applications/Cursor.app or $HOME/Applications/Cursor.app or command -v cursor
detect_codex: /Applications/Codex.app or $HOME/Applications/Codex.app or command -v codex
if tty; then ask Y/n per detected IDE; yes -> flowx-local setup <target>
else echo skip IDE; echo "flowx-local setup cursor" / "flowx-local setup codex"
fi
echo open "$WEB_ORIGIN/settings/api-tokens"
echo flowx-local login
```

询问用 `read -r`，默认 Y 当空输入（与常见安装脚本一致）。未检测到则 `echo 未找到 Cursor`，不问。

- [ ] **Step 3: Controller**

```ts
@Controller()
export class LocalInstallController {
  @Public()
  @Get('install')
  install(@Req() req: { protocol?: string; headers: Record<string, string | string[] | undefined> }) {
    const webOrigin = requestPublicOrigin(req);
    const apiBaseUrl = resolveInstallApiBaseUrl({
      env: process.env,
      requestOrigin: webOrigin,
    });
    const body = buildInstallScript({
      apiBaseUrl,
      webOrigin,
      installUrl: `${webOrigin}/install`,
    });
    return new StreamableFile(Buffer.from(body), {
      type: 'text/x-shellscript; charset=utf-8',
      disposition: 'inline; filename="install.sh"',
    });
  }
}
```

若 Nest 对 `StreamableFile` 不便测，controller 可返回字符串并在 `@Header` 设置 Content-Type。用 `Header('Content-Type', 'text/x-shellscript; charset=utf-8')` + 返回 string 更简单。

`requestPublicOrigin`：`x-forwarded-proto` 第一段、`x-forwarded-host` 或 `host`。

- [ ] **Step 4: Register `LocalInstallModule` in `AppModule`.** Controller spec：无 Bearer 也可调用（实例化 controller，不走 guard）；body 含 `nodejs.org` 与传入 origin 的 `/api`。

- [ ] **Step 5: Run**

Run: `pnpm --filter flowx-api exec vitest run src/local-install/install-script.spec.ts src/local-install/local-install.controller.spec.ts`

Expected: PASS

- [ ] **Step 6: Commit**（需用户授权）

```bash
git add apps/api/src/local-install apps/api/src/app.module.ts
git commit -m "feat(api): serve public curl installer at GET /install"
```

---

### Task 9: 把站点 `/install` 反代到 API

**Files:**
- Modify: `docker/nginx/flowx.conf`
- Modify: `apps/web/vite.config.ts`
- Modify: `docs/docker-deployment.md`（§6 Nginx 增加 `/install` 说明）

- [ ] **Step 1: Nginx** — 在 `location /api/` **之前**加入：

```nginx
  location = /install {
    proxy_pass http://flowx:3000/install;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
```

不要对 `/install` 做 `/api/` 那种 `rewrite` strip。

- [ ] **Step 2: Vite**

```ts
'/install': {
  target: 'http://127.0.0.1:3000',
},
```

与现有 `/api` proxy 并列。

- [ ] **Step 3: 在 `docs/docker-deployment.md` 方案二写明：** 用户安装命令是 `curl -fsSL http://<host>/install | bash`，依赖上述 location；并提醒配置 `PUBLIC_API_BASE_URL`。

- [ ] **Step 4: Commit**（需用户授权）

```bash
git add docker/nginx/flowx.conf apps/web/vite.config.ts docs/docker-deployment.md
git commit -m "feat: proxy /install to the API for curl onboarding"
```

---

### Task 10: Web 安装文案

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
- Modify: `apps/web/src/pages/LocalAgentGuidePage.tsx`

- [ ] **Step 1: 改测试**

将「npm install -g + flowx-local serve」断言改为包含：

- `curl -fsSL`
- `/install`
- 不再把 `flowx-local serve` 当作必装步骤（排障可无；主 callout 不要 serve）

用 `window.location.origin` 拼 `curl -fsSL ${origin}/install | bash`。测试环境 origin 一般为 `http://localhost:3000` 一类，断言 `/install` 与 `curl` 即可。

- [ ] **Step 2: 改页面**

`localLaunchSetupRequired` 与执行指引第 2 步改为 curl +「然后 `flowx-local login`」。Toast「未检测到本机 flowx-local」改为「请先完成本地安装（设置 → 本地 Agent）」。

`LocalAgentGuidePage` description：`在本机终端执行 curl 安装脚本，再 login，即可连接 Cursor / Codex。`

- [ ] **Step 3: Run**

Run: `pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx src/pages/LocalAgentGuidePage.tsx`

（若 LocalAgentGuidePage 无测试，只跑 Detail 测试 + 改 description。）

Expected: PASS

- [ ] **Step 4: Commit**（需用户授权）

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx apps/web/src/pages/LocalAgentGuidePage.tsx
git commit -m "feat(web): point local agent setup at curl /install"
```

---

### Task 11: 手册与 README

**Files:**
- Modify: `docs/local-agent-guide.md`（重写第 2–3 节为短主路径）
- Modify: `docs/user-manual.md`
- Modify: `README.md`
- Modify: `docs/edge-agent-operations.md`
- Modify: `docs/web-local-ide-launch.md`
- Copy 到 `apps/web/public/user-manual.md` 与 `apps/web/public/local-agent-guide.md`

- [ ] **Step 1: `docs/local-agent-guide.md` 开篇改为**

```markdown
# FlowX 本地 Agent 使用指南

在本机把 FlowX 接到 Cursor / Codex。Skill 是流程说明，MCP 是实际调用的工具，需要一起装；安装脚本会处理。

## 安装

在 FlowX 网页（与你日常使用的同一站点）执行：

```bash
curl -fsSL https://<当前站点>/install | bash
flowx-local login
```

脚本会检查 Node.js 20+（没有则打开 https://nodejs.org/ 自行安装后重跑）、安装 `@flowx-ai/local`、注册本机后台服务，并在检测到 Cursor / Codex 时询问是否写入 Skill 和 MCP。`login` 只粘贴设置页生成的 `fxpat_…` token。

平台内也可打开侧栏「本地 Agent」复制当前站点的 curl。
```

其后：本地发起需求 / 本地启动 / OpenDesign 金路径保留但删掉重复的长安装段。`serve`、`--api-base-url`、公司 npm registry、PATH 找不到命令放到「排障」。

- [ ] **Step 2: 同步 user-manual / README / edge-agent-operations / web-local-ide-launch** 的安装命令为 curl 主路径；贡献者保留 `pnpm flowx-local serve`。

- [ ] **Step 3: 复制镜像并校验**

```bash
cp docs/user-manual.md apps/web/public/user-manual.md
cp docs/local-agent-guide.md apps/web/public/local-agent-guide.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
git diff --check
```

Expected: `cmp` 无输出，`git diff --check` 退出 0。

- [ ] **Step 4: Commit**（需用户授权）

```bash
git add docs/local-agent-guide.md docs/user-manual.md docs/edge-agent-operations.md docs/web-local-ide-launch.md README.md apps/web/public/user-manual.md apps/web/public/local-agent-guide.md
git commit -m "docs: make curl /install the local agent onboarding path"
```

---

### Task 12: 回归

- [ ] **Step 1: Run**

```bash
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-api exec vitest run src/local-install
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

Expected: 全部 PASS / `cmp` 静默。

- [ ] **Step 2:** 若 `credentials.test.ts` 或其它 local 测试仍假设默认 3000，按 Task 1 语义修掉后再跑全包 `pnpm --filter @flowx-ai/local test`。

---

## Spec coverage

| Spec 项 | Task |
| --- | --- |
| 取消静默 3000；flag 可显式 loopback | 1 |
| login 校验失败不写 credentials | 2 |
| 用户级 MCP、无 token、保留其它 server、坏文件中止 | 3 |
| 绝对路径 | 4 |
| LaunchAgent / systemd、win32 跳过 | 5 |
| `--no-ide`、setup 写地址+服务+按需 IDE | 6–7 |
| GET /install 向导、Node 只提示、检测 IDE 再问、提醒 login | 8 |
| Nginx / Vite `/install` | 9 |
| Web copy | 10 |
| 手册 | 11 |
| Windows `/install` 退出 | 8 脚本 |
| OpenDesign curl 不检测 | 8 |
| 不改项目级 mcp.json 启动路径 | （无 task，刻意） |
| `update` 刷新路径 | 7 |

## Placeholder scan

无 TBD。bash 向导以 Task 8 伪代码为准，实现时写进 `install-script.ts` 模板字符串，测试锁定关键子串。
