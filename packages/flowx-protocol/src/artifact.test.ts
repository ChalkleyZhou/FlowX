import { describe, expect, it } from 'vitest';
import { ARTIFACT_STORAGE_PROVIDERS } from './artifact.js';

describe('artifact protocol', () => {
  it('supports oss artifact storage', () => {
    expect(ARTIFACT_STORAGE_PROVIDERS).toContain('oss');
  });
});
