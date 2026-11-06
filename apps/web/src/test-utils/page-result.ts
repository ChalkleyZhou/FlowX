import type { PageResult } from '../types';

export function pageResult<T>(items: T[], overrides: Partial<PageResult<T>> = {}): PageResult<T> {
  return { items, total: items.length, page: 1, pageSize: 20, totalPages: Math.max(1, Math.ceil(items.length / 20)), ...overrides };
}
