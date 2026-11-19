import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { DEFAULT_LOCAL_CONFIG, PACKAGE_VERSION, saveConfig } from './config.js';
import { getUpdateContext, versionPackageDir, writeJsonAtomic } from './update-store.js';

it('真实 CLI/daemon/stdio MCP：后台就绪事件切换服务，旧 MCP 保持运行，新连接读取新版，停止信号关闭服务', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'flowx-runtime-'));
  const packageDir = join(homeDir, 'installed');
  const entry = join(packageDir, 'dist', 'index.js');
  const sourceDir = fileURLToPath(new URL('.', import.meta.url));
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, FLOWX_LOCAL_AUTO_UPDATE: '0' };
  delete env.FLOWX_LOCAL_ORIGINAL_PACKAGE;
  delete env.FLOWX_LOCAL_SERVE_CHILD;
  delete env.FLOWX_LOCAL_BYPASS_UPDATE;
  const clients: Client[] = [];
  let daemon: ChildProcess | undefined;
  try {
    const compile = (source: string, destination: string) => {
      mkdirSync(destination, { recursive: true });
      for (const file of readdirSync(source, { withFileTypes: true })) {
        if (file.isDirectory()) compile(join(source, file.name), join(destination, file.name));
        else if (file.name.endsWith('.ts') && !file.name.endsWith('.test.ts')) {
          writeFileSync(join(destination, file.name.replace(/\.ts$/, '.js')), ts.transpileModule(
            readFileSync(join(source, file.name), 'utf8'),
            { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
          ).outputText);
        }
      }
    };
    compile(sourceDir, join(packageDir, 'dist'));
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@flowx-ai/local', version: PACKAGE_VERSION, type: 'module' }));
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(packageDir, 'node_modules'), 'junction');
    cpSync(fileURLToPath(new URL('../templates', import.meta.url)), join(packageDir, 'templates'), { recursive: true });
    const reserve = createServer();
    await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve));
    const address = reserve.address();
    if (!address || typeof address === 'string') throw Error('No test port');
    const port = address.port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    saveConfig({ ...DEFAULT_LOCAL_CONFIG, port, autoUpdate: false }, { homeDir });
    const connect = async () => {
      const client = new Client({ name: 'runtime-test', version: '1.0.0' });
      clients.push(client);
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp'],
        env: env as Record<string, string>, stderr: 'pipe' }));
      return client;
    };
    const originalMcp = await connect();
    expect(originalMcp.getServerVersion()?.version).toBe(PACKAGE_VERSION);
    daemon = spawn(process.execPath, [entry, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let startupCount = 0;
    let logs = '';
    daemon.stdout?.on('data', (chunk) => { logs += String(chunk); startupCount = logs.split('listening on').length - 1; });
    daemon.stderr?.on('data', (chunk) => { logs += String(chunk); });
    await vi.waitFor(() => expect(startupCount, logs).toBe(1), { timeout: 10000 });
    const health = async () => (await fetch(`http://127.0.0.1:${port}/health`)).json() as Promise<{ version: string }>;
    expect((await health()).version).toBe(PACKAGE_VERSION);

    const context = getUpdateContext({ homeDir, packageDir });
    const candidate = versionPackageDir(context, '9.0.0');
    cpSync(packageDir, candidate, { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(candidate, 'package.json'), JSON.stringify({ name: '@flowx-ai/local', version: '9.0.0', type: 'module' }));
    const configPath = join(candidate, 'dist', 'config.js');
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(/export const PACKAGE_VERSION = [^;]+;/, "export const PACKAGE_VERSION = '9.0.0';"));
    writeJsonAtomic(join(context.storeDir, 'active.json'), { version: '9.0.0' });
    // 没有再请求 health：文件事件本身必须让空闲服务完成切换。
    await vi.waitFor(() => expect(startupCount, logs).toBe(2), { timeout: 10000 });
    expect((await health()).version).toBe('9.0.0');
    expect(originalMcp.getServerVersion()?.version).toBe(PACKAGE_VERSION);
    const result = await originalMcp.callTool({ name: 'flowx_get_active_design_session', arguments: {} });
    expect(result.isError).not.toBe(true);
    const nextMcp = await connect();
    expect(nextMcp.getServerVersion()?.version).toBe('9.0.0');
    const stopped = new Promise<void>((resolve) => daemon!.once('close', () => resolve()));
    daemon.kill('SIGTERM');
    await stopped;
    daemon = undefined;
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    if (daemon) {
      const stopped = new Promise<void>((resolve) => daemon!.once('close', () => resolve()));
      daemon.kill('SIGTERM');
      await stopped;
    }
    rmSync(homeDir, { recursive: true, force: true });
  }
}, 30000);
