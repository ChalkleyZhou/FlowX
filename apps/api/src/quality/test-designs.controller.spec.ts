import { describe, expect, it, vi } from 'vitest';
import { TestDesignsController } from './test-designs.controller';

describe('TestDesignsController', () => {
  it('passes the authenticated user and organization to generation', () => {
    const generate = vi.fn();
    const controller = new TestDesignsController({ generate } as never);

    controller.generate('design-1', {
      authSession: {
        user: { id: 'user-1', displayName: '测试用户' },
        organization: { id: 'org-1' },
      },
    });

    expect(generate).toHaveBeenCalledWith('design-1', {
      flowxUserId: 'user-1',
      flowxOrganizationId: 'org-1',
      displayName: '测试用户',
    });
  });
});
