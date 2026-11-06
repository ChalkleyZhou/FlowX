import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PageResult } from '@flowx-ai/protocol';

export interface PaginationQuery {
  page?: string | number;
  pageSize?: string | number;
}

function positiveInteger(value: string | number | undefined, fallback: number, field: string) {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException(`${field} 必须是正整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${field} 必须是正整数。`);
  }
  return parsed;
}

export function parsePagination(query: PaginationQuery = {}) {
  const page = positiveInteger(query.page, 1, 'page');
  const pageSize = positiveInteger(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize');
  const skip = (page - 1) * pageSize;
  if (pageSize > MAX_PAGE_SIZE || !Number.isSafeInteger(skip) || skip > 2_147_483_647) {
    throw new BadRequestException(`pageSize 不得超过 ${MAX_PAGE_SIZE}，分页偏移不得超出数据库支持范围。`);
  }
  return { page, pageSize, skip, take: pageSize };
}

export function pageResult<T>(items: T[], total: number, paging: Pick<ReturnType<typeof parsePagination>, 'page' | 'pageSize'>): PageResult<T> {
  return { items, total, page: paging.page, pageSize: paging.pageSize, totalPages: Math.max(1, Math.ceil(total / paging.pageSize)) };
}
