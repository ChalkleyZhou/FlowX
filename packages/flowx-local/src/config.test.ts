import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_CONFIG,
  loadConfig,
  normalizeRepoUrl,
  saveConfig,
} from './config.js';

const tempHomes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'flowx-local-home-'));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

describe('normalizeRepoUrl', () => {
  it('trims whitespace', () => {
    expect(normalizeRepoUrl('  https://github.com/org/repo  ')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('lowercases the host', () => {
    expect(normalizeRepoUrl('https://GitHub.COM/Org/Repo')).toBe(
      'https://github.com/Org/Repo',
    );
  });

  it('strips .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/org/repo.git')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('ignores credentials in the URL', () => {
    expect(normalizeRepoUrl('https://user:token@github.com/org/repo.git')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('applies all normalizations together', () => {
    expect(
      normalizeRepoUrl('  https://User:Pass@GitHub.COM/org/repo.git  '),
    ).toBe('https://github.com/org/repo');
  });
});

describe('loadConfig / saveConfig', () => {
  it('returns defaults when config file is missing', () => {
    const homeDir = makeHome();
    expect(loadConfig({ homeDir })).toEqual(DEFAULT_LOCAL_CONFIG);
  });

  it('saves and loads config under ~/.flowx/local.json', () => {
    const homeDir = makeHome();
    const config = {
      ...DEFAULT_LOCAL_CONFIG,
      port: 4000,
      repositories: {
        'https://github.com/org/repo.git': '/tmp/repo',
      },
      defaultIde: 'codex' as const,
    };

    saveConfig(config, { homeDir });

    const onDisk = JSON.parse(
      readFileSync(join(homeDir, '.flowx', 'local.json'), 'utf8'),
    ) as {
      port: number;
      repositories: Record<string, string>;
      defaultIde: string;
    };

    expect(onDisk.port).toBe(4000);
    expect(onDisk.defaultIde).toBe('codex');
    expect(onDisk.repositories).toEqual({
      'https://github.com/org/repo': '/tmp/repo',
    });

    expect(loadConfig({ homeDir })).toEqual({
      ...DEFAULT_LOCAL_CONFIG,
      port: 4000,
      repositories: {
        'https://github.com/org/repo': '/tmp/repo',
      },
      defaultIde: 'codex',
    });
  });

  it('normalizes repository keys when loading existing file', () => {
    const homeDir = makeHome();
    mkdirSync(join(homeDir, '.flowx'), { recursive: true });
    writeFileSync(
      join(homeDir, '.flowx', 'local.json'),
      JSON.stringify({
        port: 3920,
        repositories: {
          'https://User:x@GitHub.COM/org/repo.git': '/Users/me/src/repo',
        },
        defaultIde: 'cursor',
      }),
      'utf8',
    );

    expect(loadConfig({ homeDir }).repositories).toEqual({
      'https://github.com/org/repo': '/Users/me/src/repo',
    });
  });
});
