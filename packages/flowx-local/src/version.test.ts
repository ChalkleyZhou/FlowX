import { describe, expect, it, vi } from 'vitest';
import {
  checkPackageVersion,
  formatVersionCheck,
  isNewerVersion,
} from './version.js';

describe('version check', () => {
  it('compares semver for update availability', () => {
    expect(isNewerVersion('0.4.1', '0.4.0')).toBe(true);
    expect(isNewerVersion('0.4.0', '0.4.0')).toBe(false);
    expect(isNewerVersion('0.3.9', '0.4.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('reports update when npm latest is newer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.4.1' }),
    });
    const result = await checkPackageVersion({
      installed: '0.4.0',
      fetchImpl: fetchImpl as never,
    });
    expect(result.updateAvailable).toBe(true);
    expect(result.latest).toBe('0.4.1');
    expect(result.message).toContain('0.4.0 → 0.4.1');
    expect(formatVersionCheck(result)).toContain('@flowx-ai/local 0.4.0');
  });

  it('reports up to date when versions match', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.4.0' }),
    });
    const result = await checkPackageVersion({
      installed: '0.4.0',
      fetchImpl: fetchImpl as never,
    });
    expect(result.updateAvailable).toBe(false);
    expect(result.message).toContain('Up to date');
  });

  it('still returns installed version when npm is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const result = await checkPackageVersion({
      installed: '0.4.0',
      fetchImpl: fetchImpl as never,
    });
    expect(result.installed).toBe('0.4.0');
    expect(result.latest).toBeNull();
    expect(result.message).toContain('Could not check npm');
  });
});
