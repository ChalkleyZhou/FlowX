import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDeviceIdentity } from './device.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('ensureDeviceIdentity', () => {
  it('creates stable installation and device identifiers', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-device-'));
    homes.push(homeDir);

    const first = ensureDeviceIdentity({ homeDir });
    const second = ensureDeviceIdentity({ homeDir });

    expect(first.installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.installationId).toBe(first.installationId);
    expect(second.deviceId).toBe(first.deviceId);
    expect(readFileSync(join(homeDir, '.flowx', 'local.json'), 'utf8')).toContain(first.deviceId);
  });
});
