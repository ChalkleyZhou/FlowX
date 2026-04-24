import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectLocalDevCommand } from './detect-local-dev-command';

describe('detectLocalDevCommand', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flowx-dev-detect-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects pnpm dev at repository root', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    const result = detectLocalDevCommand(dir);
    expect(result?.packageManager).toBe('pnpm');
    expect(result?.scriptName).toBe('dev');
    expect(result?.cwd).toBe(dir);
  });

  it('detects nested apps workspace package when root has no dev script', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }));
    writeFileSync(join(dir, 'package-lock.json'), '');
    const result = detectLocalDevCommand(dir);
    expect(result?.cwd).toBe(join(dir, 'apps', 'web'));
    expect(result?.packageManager).toBe('npm');
    expect(result?.scriptName).toBe('dev');
  });
});
