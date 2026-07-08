import { describe, expect, it, vi } from 'vitest';
import {
  buildSchedulerAuthSession,
  resolveProjectOrganizationId,
  toAiInvocationRecipient,
} from './briefing-auth-session';

describe('briefing-auth-session', () => {
  it('builds recipient from interactive session', () => {
    expect(
      toAiInvocationRecipient({
        user: { id: 'user-1', displayName: '张三' },
        organization: { id: 'org-1', name: '研发组织' },
      }),
    ).toEqual({
      flowxUserId: 'user-1',
      flowxOrganizationId: 'org-1',
      displayName: '张三',
      providerOrganizationId: null,
      organizationName: '研发组织',
    });
  });

  it('builds scheduler recipient from organization-only session', () => {
    expect(
      toAiInvocationRecipient({
        organization: { id: 'org-1', name: '研发组织' },
      }),
    ).toEqual({
      flowxUserId: 'scheduler',
      flowxOrganizationId: 'org-1',
      displayName: 'FlowX Scheduler',
      providerOrganizationId: null,
      organizationName: '研发组织',
    });
  });

  it('resolves organization from active delivery targets first', async () => {
    const deliveryTargetFindFirst = vi.fn().mockResolvedValue({ organizationId: 'org-delivery' });
    const organizationAiCredentialFindMany = vi.fn();

    const organizationId = await resolveProjectOrganizationId(
      {
        deliveryTarget: { findFirst: deliveryTargetFindFirst },
        organizationAiCredential: { findMany: organizationAiCredentialFindMany },
      } as never,
      'project-1',
    );

    expect(organizationId).toBe('org-delivery');
    expect(organizationAiCredentialFindMany).not.toHaveBeenCalled();
  });

  it('falls back to the only organization with AI credentials', async () => {
    const deliveryTargetFindFirst = vi.fn().mockResolvedValue(null);
    const organizationAiCredentialFindMany = vi
      .fn()
      .mockResolvedValue([{ organizationId: 'org-only' }]);

    const organizationId = await resolveProjectOrganizationId(
      {
        deliveryTarget: { findFirst: deliveryTargetFindFirst },
        organizationAiCredential: { findMany: organizationAiCredentialFindMany },
      } as never,
      'project-1',
    );

    expect(organizationId).toBe('org-only');
  });

  it('builds scheduler auth session from organization record', async () => {
    const organizationFindUnique = vi.fn().mockResolvedValue({
      id: 'org-1',
      name: '研发组织',
      providerOrganizationId: 'ding-org-1',
    });

    await expect(
      buildSchedulerAuthSession(
        {
          organization: { findUnique: organizationFindUnique },
        } as never,
        'org-1',
      ),
    ).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: '研发组织',
        providerOrganizationId: 'ding-org-1',
      },
    });
  });
});
