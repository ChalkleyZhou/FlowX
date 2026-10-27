import { describe, expect, it } from 'vitest';
import { assertPrototypeAnalysis } from './prototype-analysis';

import { analysis } from './prototype-test-fixture';

describe('原型分析输出契约', () => {
  it('接受结构化需求、设计与来源', () => {
    expect(assertPrototypeAnalysis(analysis, ['index.html'])).toEqual(analysis);
  });
  it('不接受缺少正文、空标题、无效布尔和重复问题 ID', () => {
    for (const candidate of [
      { ...analysis, description: undefined }, { ...analysis, clarifications: [{ ...analysis.clarifications[0], id: '__proto__' }] }, { ...analysis, title: ' ' },
      { ...analysis, clarifications: [{ ...analysis.clarifications[0], required: 'yes' }] },
      { ...analysis, clarifications: [analysis.clarifications[0], analysis.clarifications[0]] },
    ]) expect(() => assertPrototypeAnalysis(candidate, ['index.html'])).toThrow();
  });
  it('拒绝虚构来源和超量问题', () => {
    expect(() => assertPrototypeAnalysis(analysis, ['other.html'])).toThrow(/来源/);
    expect(() => assertPrototypeAnalysis({ ...analysis, clarifications: Array.from({ length: 11 }, (_, i) => ({ ...analysis.clarifications[0], id: String(i) })) }, ['index.html'])).toThrow();
  });
  it('接受需求文档路径，旧结果可以没有该字段', () => {
    expect(assertPrototypeAnalysis({ ...analysis, requirementDocuments: ['prd.md'] }, ['index.html', 'prd.md']).requirementDocuments).toEqual(['prd.md']);
    expect(assertPrototypeAnalysis(analysis, ['index.html']).requirementDocuments).toBeUndefined();
  });
  it('拒绝不存在或重复的需求文档，新整理必须给出判断', () => {
    expect(() => assertPrototypeAnalysis({ ...analysis, requirementDocuments: ['missing.md'] }, ['index.html'])).toThrow(/来源/);
    expect(() => assertPrototypeAnalysis({ ...analysis, requirementDocuments: ['prd.md', 'prd.md'] }, ['prd.md'])).toThrow(/重复/);
    expect(() => assertPrototypeAnalysis(analysis, ['index.html'], { requireRequirementDocuments: true })).toThrow(/requirementDocuments/);
    expect(assertPrototypeAnalysis({ ...analysis, requirementDocuments: [] }, ['index.html'], { requireRequirementDocuments: true }).requirementDocuments).toEqual([]);
  });
});
