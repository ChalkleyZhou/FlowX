/** 记录浏览分页：默认和最大页大小在所有入口保持一致。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageQuery {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary?: Record<string, number>;
}
