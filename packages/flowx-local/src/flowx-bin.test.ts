import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

  it('falls back to argv1 when PATH has no flowx-local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowx-bin-'));
    dirs.push(dir);
    const entry = join(dir, 'dist', 'index.js');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(entry, 'export {};\n');
    expect(
      resolveFlowxLocalBin({
        pathEnv: '/tmp/does-not-exist-flowx-bin',
        argv1: entry,
      }),
    ).toBe(resolve(entry));
  });

  it('throws when not found', () => {
    expect(() => resolveFlowxLocalBin({ pathEnv: '/tmp/does-not-exist-flowx-bin', argv1: '' })).toThrow(
      /flowx-local/,
    );
  });
});
