import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.fn();
const mkdirMock = vi.fn();
const writeFileMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('fs/promises', () => ({
  access: accessMock,
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('CursorAiExecutor', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.PATH = '/mock/bin';
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('falls back to `cursor agent` when legacy `cursor-agent` binary is unavailable', async () => {
    accessMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/mock/bin/cursor') {
        return;
      }
      throw new Error('missing');
    });

    spawnMock.mockImplementation((command: string, args: string[]) => {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ subtype: 'success', is_error: false, result: '{"ok":true}' })),
        );
        child.emit('close', 0);
      });
      return child;
    });

    const { CursorAiExecutor } = await import('./cursor-ai.executor');
    const executor = new CursorAiExecutor();

    const result = await (executor as unknown as {
      runJsonStage: <T>(schemaFile: string, prompt: string, stageName: string, addDirs?: string[]) => Promise<T>;
    }).runJsonStage<{ ok: boolean }>('schema.json', 'hello', 'task split', ['/tmp/workspace']);

    expect(result).toEqual({ ok: true });
    expect(spawnMock).toHaveBeenCalledWith(
      'cursor',
      ['agent', '-p', '--trust', '--output-format', 'json', 'hello'],
      expect.objectContaining({ cwd: '/tmp/workspace' }),
    );
  });

  it('fails fast when Cursor reports an authentication error on stderr', async () => {
    accessMock.mockResolvedValue(undefined);

    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const { CursorAiExecutor } = await import('./cursor-ai.executor');
    const executor = new CursorAiExecutor();

    const promise = (executor as unknown as {
      runJsonStage: <T>(schemaFile: string, prompt: string, stageName: string, addDirs?: string[]) => Promise<T>;
    }).runJsonStage<{ ok: boolean }>('schema.json', 'hello', 'task split', ['/tmp/workspace']);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spawnMock).toHaveBeenCalledTimes(1);
    child.stderr.emit('data', Buffer.from('Starting login process...\n'));

    await expect(promise).rejects.toThrow(/authentication failed/i);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('parses the JSON object from Cursor result even when the result includes leading commentary', async () => {
    accessMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/mock/bin/cursor') {
        return;
      }
      throw new Error('missing');
    });

    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              subtype: 'success',
              is_error: false,
              result: 'Exploring repo structure first.\\n\\n{"summary":"ok","stages":[]}',
            }),
          ),
        );
        child.emit('close', 0);
      });
      return child;
    });

    const { CursorAiExecutor } = await import('./cursor-ai.executor');
    const executor = new CursorAiExecutor();

    const result = await (executor as unknown as {
      runJsonStage: <T>(schemaFile: string, prompt: string, stageName: string, addDirs?: string[]) => Promise<T>;
    }).runJsonStage<{ summary: string; stages: unknown[] }>(
      'schema.json',
      'hello',
      'technical plan',
      ['/tmp/workspace'],
    );

    expect(result).toEqual({ summary: 'ok', stages: [] });
  });

  it('prefers the last valid JSON object when Cursor emits a corrected result after commentary', async () => {
    accessMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/mock/bin/cursor') {
        return;
      }
      throw new Error('missing');
    });

    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              subtype: 'success',
              is_error: false,
              result:
                'First draft invalid.\\n' +
                '{"issues":["x"],"bugs":[],"missingTests":[],"suggestions":"wrong","impactScope":[]}\\n' +
                'Correction follows.\\n' +
                '{"issues":["x"],"bugs":[],"missingTests":[],"suggestions":["ok"],"impactScope":[]}',
            }),
          ),
        );
        child.emit('close', 0);
      });
      return child;
    });

    const { CursorAiExecutor } = await import('./cursor-ai.executor');
    const executor = new CursorAiExecutor();

    const result = await (executor as unknown as {
      runJsonStage: <T>(schemaFile: string, prompt: string, stageName: string, addDirs?: string[]) => Promise<T>;
    }).runJsonStage<{
      issues: string[];
      bugs: string[];
      missingTests: string[];
      suggestions: string[];
      impactScope: string[];
    }>('schema.json', 'hello', 'review', ['/tmp/workspace']);

    expect(result).toEqual({
      issues: ['x'],
      bugs: [],
      missingTests: [],
      suggestions: ['ok'],
      impactScope: [],
    });
  });

  it('passes workspace trust flag for mutation stages too', async () => {
    accessMock.mockResolvedValue(undefined);

    spawnMock.mockImplementation((command: string, args: string[]) => {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        child.emit('close', 0);
      });
      return child;
    });

    const { CursorAiExecutor } = await import('./cursor-ai.executor');
    const executor = new CursorAiExecutor();

    await (executor as unknown as {
      runMutationStage: (cwd: string, prompt: string, stageName: string) => Promise<void>;
    }).runMutationStage('/tmp/workspace', 'apply fix', 'execution-ai');

    expect(spawnMock).toHaveBeenCalledWith(
      'cursor-agent',
      ['-p', '--trust', '--force', '--output-format', 'text', 'apply fix'],
      expect.objectContaining({ cwd: '/tmp/workspace' }),
    );
  });
});
