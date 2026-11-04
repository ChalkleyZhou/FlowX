import { describe, expect, it } from 'vitest';
import { applyOrganizationScope } from './organization-scope';

describe('质量新增记录的组织隔离', () => {
  it.each(['QualityTestReport', 'QualityProgressEvent'])('%s 不能脱离组织过滤读取', (model) => {
    const result = applyOrganizationScope(model, 'findMany', { where: { id: 'record-1' } }, 'org-1');
    expect(result.where).toHaveProperty('AND');
    expect(JSON.stringify(result)).toContain('org-1');
  });
});
