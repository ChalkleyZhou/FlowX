import { describe, expect, it } from 'vitest';
import { pageResult, parsePagination } from './pagination';

describe('服务端分页契约', () => {
  it('默认只请求第一页 20 条，第二页在数据库跳过第一页', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
    expect(parsePagination({ page: '2', pageSize: '10' })).toEqual({ page: 2, pageSize: 10, skip: 10, take: 10 });
  });
  it.each(['0', '-1', '1.5', 'Infinity', 'NaN', 'abc', '', ' 2 ', '1e2'])('拒绝非法页码 %j', page => {
    expect(() => parsePagination({ page })).toThrow();
  });
  it.each(['0', '-1', '101', '1.2', 'abc'])('拒绝非法页大小 %j', pageSize => {
    expect(() => parsePagination({ pageSize })).toThrow();
  });
  it('拒绝会使数据库偏移溢出的页码', () => {
    expect(() => parsePagination({ page: Number.MAX_SAFE_INTEGER })).toThrow();
  });
  it('空集合仍有第一页，越界页保留原始页码以便客户端回退', () => {
    expect(pageResult([], 0, parsePagination({}))).toEqual({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(pageResult([], 21, parsePagination({ page: 3 }))).toEqual({ items: [], total: 21, page: 3, pageSize: 20, totalPages: 2 });
  });
});
