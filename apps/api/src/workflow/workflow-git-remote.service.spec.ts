import { describe, expect, it } from 'vitest';
import { compareRemoteSha } from './workflow-git-remote.service';

describe('compareRemoteSha', () => {
  it('returns true for exact match', () => {
    expect(compareRemoteSha('abc123def4567890', 'abc123def4567890')).toBe(true);
  });

  it('returns true when headSha is a short prefix', () => {
    expect(compareRemoteSha('abc123def4567890', 'abc123')).toBe(true);
  });

  it('returns false when tip mismatches', () => {
    expect(compareRemoteSha('ffffffffffffffffffffffffffffffffffffffff', 'abc123def4567890')).toBe(
      false,
    );
  });
});
