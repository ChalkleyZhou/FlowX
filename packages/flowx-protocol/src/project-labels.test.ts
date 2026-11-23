import { describe, expect, it } from 'vitest';
import { normalizeProjectLabelName, parseProjectLabelIds, parseProjectLabelFilter, PROJECT_LABEL_COLORS } from './project-labels.js';

describe('项目标签共享契约', () => {
  it('规范名称并按 Unicode 码点校验', () => {
    expect(normalizeProjectLabelName(' 前端 ')).toBe('前端');
    expect(normalizeProjectLabelName('e\u0301')).toBe('é');
    expect(normalizeProjectLabelName('😀'.repeat(30))).toHaveLength(60);
    for (const value of [null, '', '  ', 'a\nb', 'a\u0000b', 'a'.repeat(31)]) expect(() => normalizeProjectLabelName(value)).toThrow();
    expect(PROJECT_LABEL_COLORS).toHaveLength(8);
  });
  it('数组去重、空数组与严格空值边界', () => {
    expect(parseProjectLabelIds([])).toEqual([]);
    expect(parseProjectLabelIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
    for (const value of [null, undefined, 'a', [''], [' '], [1], Array.from({ length: 21 }, (_, i) => String(i))]) expect(() => parseProjectLabelIds(value)).toThrow();
  });
  it('查询是逗号分隔 OR 筛选，空查询无筛选', () => {
    expect(parseProjectLabelFilter(undefined)).toEqual([]);
    expect(parseProjectLabelFilter('')).toEqual([]);
    expect(parseProjectLabelFilter('a,b,a')).toEqual(['a', 'b']);
    for (const value of [null, [], 'a,,b']) expect(() => parseProjectLabelFilter(value)).toThrow();
  });
});
