import { describe, expect, it } from 'vitest';
import { applyOrganizationScope } from './organization-scope';

describe('applyOrganizationScope', () => {
  const organizationId = 'org-current';

  it.each([
    ['Workspace', { organizationId }],
    ['Project', { workspace: { organizationId } }],
    ['Requirement', { project: { workspace: { organizationId } } }],
    ['WorkflowRun', { requirement: { project: { workspace: { organizationId } } } }],
    ['Issue', { workspace: { organizationId } }],
    ['Bug', { workspace: { organizationId } }],
    ['ExternalIntegration', { organizationId }],
    ['YunxiaoWebhookDelivery', { organizationId }],
  ])('adds the organization boundary to %s reads', (model, expectedScope) => {
    const args = applyOrganizationScope(model, 'findMany', {
      where: { status: 'ACTIVE' },
    }, organizationId);

    expect(args).toEqual({
      where: {
        status: 'ACTIVE',
        AND: [expectedScope],
      },
    });
  });

  it('keeps the unique id at the top level for scoped direct reads', () => {
    const args = applyOrganizationScope('Requirement', 'findUniqueOrThrow', {
      where: { id: 'requirement-other-org' },
    }, organizationId);

    expect(args).toEqual({
      where: {
        id: 'requirement-other-org',
        AND: [{ project: { workspace: { organizationId } } }],
      },
    });
  });

  it('forces new workspaces into the current organization', () => {
    const args = applyOrganizationScope('Workspace', 'create', {
      data: { name: 'Workspace A' },
    }, organizationId);

    expect(args).toEqual({
      data: {
        name: 'Workspace A',
        organizationId,
      },
    });
  });

  it('does not scope authentication models', () => {
    const original = { where: { id: 'user-1' } };
    expect(applyOrganizationScope('User', 'findUnique', original, organizationId)).toBe(original);
  });
});
