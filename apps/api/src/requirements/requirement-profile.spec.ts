import { describe, expect, it } from 'vitest';
import { requirementProfileFields } from './requirement-profile';

describe('requirementProfileFields', () => {
  it('keeps filled profile fields and drops blanks', () => {
    expect(requirementProfileFields({
      priority: 'HIGH',
      functionalModule: ' 导出 ',
      riskImpact: '',
      productRequirementDocument: '见 PRD',
      remark: '先做 CSV',
      createdByName: 'Ada',
    })).toEqual({
      priority: 'HIGH',
      functionalModule: '导出',
      productRequirementDocument: '见 PRD',
      remark: '先做 CSV',
      createdByName: 'Ada',
    });
  });
});
