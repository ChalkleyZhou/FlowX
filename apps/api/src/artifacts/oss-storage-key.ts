import { BadRequestException } from '@nestjs/common';

export type OssStorageScope = 'managed' | 'server' | 'workflow';

export function isOssStorageKeyInOrganization(storageKey: string, organizationId: string): boolean {
  return storageKey.startsWith(`org/${encodeURIComponent(organizationId.trim())}/`);
}

export function buildOssStorageKey(input: {
  organizationId?: string | null;
  userId?: string | null;
  scope: OssStorageScope;
  key: string;
}): string {
  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new BadRequestException({
      code: 'OSS_STORAGE_ORGANIZATION_REQUIRED',
      message: 'OSS artifacts require an organization scope.',
    });
  }
  const key = input.key.trim().replace(/\\/g, '/');
  if (!key || key.startsWith('/') || key.includes('\0') || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new BadRequestException({
      code: 'ARTIFACT_INVALID_REFERENCE',
      message: 'Invalid OSS artifact storage key.',
    });
  }
  const organizationSegment = encodeURIComponent(organizationId);
  if (input.scope === 'workflow') {
    return `org/${organizationSegment}/workflow/${key}`;
  }
  const userSegment = encodeURIComponent(input.userId?.trim() || 'system');
  return `org/${organizationSegment}/user/${userSegment}/${input.scope}/${key}`;
}
