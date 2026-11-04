import { describe, expect, it } from 'vitest';
import { selectQualityCases } from './test-case-selection';

const row = (id: string, title = '普通用例') => ({ id, title, priority: 'P2', tags: [], moduleId: null, targetKeys: [], coverageLinks: [] as Array<{ targetType: string; targetKey: string }> });
describe('需求选例检索', () => {
  it('超过 250 条时仍优先纳入关联需求的历史用例并明确截断', () => {
    const rows = Array.from({ length: 251 }, (_, i) => row(`case-${i}`));
    rows[250].coverageLinks.push({ targetType: 'REQUIREMENT', targetKey: 'req-1' });
    const result = selectQualityCases(rows, { requirementIds: ['req-1'], text: '登录', limit: 250 });
    expect(result.cases[0].id).toBe('case-250');
    expect(result.summary).toEqual({ eligibleCount: 251, matchedCount: 251, suppliedCount: 250, truncated: true });
  });
  it('筛选维度取交集，空结果不扩展范围', () => {
    const cases = [{ ...row('web', '登录'), tags: ['认证'], targetKeys: ['web'] }, { ...row('api'), tags: ['认证'], targetKeys: ['api'] }];
    expect(selectQualityCases(cases, { requirementIds: [], text: '', selection: { libraryIds: ['lib-1'], tags: ['认证'], targetKeys: ['web'] } }).cases.map(x => x.id)).toEqual(['web']);
    expect(selectQualityCases(cases, { requirementIds: [], text: '', selection: { libraryIds: ['lib-1'], priorities: ['P0'] } }).cases).toEqual([]);
  });
});
