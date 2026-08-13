import { describe, expect, it, vi } from 'vitest';
import { resolveRequirementVersionId } from './resolve-requirement-version';

describe('resolveRequirementVersionId', () => {
  it('defaults to current version when omitted', async () => {
    await expect(
      resolveRequirementVersionId({ currentVersionId: 'ver-1', assertOwned: vi.fn() }),
    ).resolves.toBe('ver-1');
  });

  it('keeps unversioned when explicitly null', async () => {
    await expect(
      resolveRequirementVersionId({ versionId: null, currentVersionId: 'ver-1', assertOwned: vi.fn() }),
    ).resolves.toBeNull();
  });

  it('uses explicit id after ownership check', async () => {
    const assertOwned = vi.fn();
    await expect(
      resolveRequirementVersionId({ versionId: 'ver-2', currentVersionId: 'ver-1', assertOwned }),
    ).resolves.toBe('ver-2');
    expect(assertOwned).toHaveBeenCalledWith('ver-2');
  });
});
