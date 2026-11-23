import { describe, expect, it } from 'vitest';
import { applyOrganizationScope, isOrganizationScopedModel } from './organization-scope';
describe('标签组织隔离', () => {
  it('标签与关联模型都通过项目/工作项隔离', () => {
    for (const model of ['ProjectLabel', 'WorkItemLabel']) {
      expect(isOrganizationScopedModel(model)).toBe(true);
      expect(applyOrganizationScope(model, 'findMany', { where: { id: 'x' } }, 'org')).toMatchObject({ where: { AND: expect.any(Array) } });
    }
    expect(applyOrganizationScope('WorkItemLabel', 'deleteMany', {}, 'org')).toEqual({ where: { workItem: { project: { workspace: { organizationId: 'org' } } }, label: { project: { workspace: { organizationId: 'org' } } } } });
  });
});
