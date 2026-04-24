import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dependenciesLookInstalled,
  hasNonEmptyNodeModules,
  resolveDependencyInstallCwd,
  resolveInstallPackageManager,
  suggestFromDevLogTail,
} from './local-dev-deps';

describe('local-dev-deps', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flowx-local-dev-deps-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('hasNonEmptyNodeModules is false when node_modules missing', () => {
    expect(hasNonEmptyNodeModules(dir)).toBe(false);
  });

  it('hasNonEmptyNodeModules is true when node_modules has entries', () => {
    mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true });
    expect(hasNonEmptyNodeModules(dir)).toBe(true);
  });

  it('dependenciesLookInstalled checks cwd then repo root', () => {
    const app = join(dir, 'apps', 'web');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    expect(dependenciesLookInstalled(dir, { cwd: app })).toBe(true);
  });

  it('resolveDependencyInstallCwd uses repo root for pnpm workspace', () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
    const app = join(dir, 'apps', 'web');
    expect(resolveDependencyInstallCwd(dir, { cwd: app, packageManager: 'pnpm' })).toBe(dir);
    expect(resolveDependencyInstallCwd(dir, { cwd: app, packageManager: 'npm' })).toBe(dir);
  });

  it('resolveInstallPackageManager prefers repo-root lock/workspace over detected package manager', () => {
    const app = join(dir, 'apps', 'web');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(resolveInstallPackageManager(dir, { packageManager: 'npm' })).toBe('pnpm');
    rmSync(join(dir, 'pnpm-lock.yaml'));

    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(resolveInstallPackageManager(dir, { packageManager: 'npm' })).toBe('yarn');
    rmSync(join(dir, 'yarn.lock'));

    writeFileSync(join(dir, 'package-lock.json'), '');
    expect(resolveInstallPackageManager(dir, { packageManager: 'yarn' })).toBe('npm');
    rmSync(join(dir, 'package-lock.json'));

    expect(resolveInstallPackageManager(app, { packageManager: 'npm' })).toBe('npm');
  });

  it('suggestFromDevLogTail hints on module not found', () => {
    expect(suggestFromDevLogTail('Error: Cannot find module vite')).toContain('依赖');
  });
});
