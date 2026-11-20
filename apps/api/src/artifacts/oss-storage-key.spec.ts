import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildOssStorageKey } from './oss-storage-key';

describe('buildOssStorageKey', () => {
  it('keeps workflow artifacts under the organization namespace', () => {
    expect(buildOssStorageKey({
      organizationId: 'org-1',
      scope: 'workflow',
      key: 'workflow/run-1/manifest.json',
    })).toBe('org/org-1/workflow/workflow/run-1/manifest.json');
  });

  it('keeps user managed artifacts under both organization and user namespaces', () => {
    expect(buildOssStorageKey({
      organizationId: 'org/1',
      userId: 'user-1',
      scope: 'managed',
      key: 'session-1/report.log',
    })).toBe('org/org%2F1/user/user-1/managed/session-1/report.log');
  });

  it('rejects missing organization and traversal keys', () => {
    expect(() => buildOssStorageKey({ organizationId: '', scope: 'workflow', key: 'manifest.json' })).toThrow(BadRequestException);
    expect(() => buildOssStorageKey({ organizationId: 'org-1', scope: 'workflow', key: '../manifest.json' })).toThrow(BadRequestException);
  });
});
