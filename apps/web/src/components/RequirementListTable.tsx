import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from './ui/badge';
import type { Requirement } from '../types';
import { formatPriority, formatWorkItemStatus } from '../utils/label-utils';

function formatCreatedAt(value?: string | null) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function statusVariant(status?: string | null) {
  if (['DONE', 'FIXED', 'RESOLVED', 'VERIFIED'].includes(status ?? '')) return 'success' as const;
  if (['IN_PROGRESS', 'FIXING'].includes(status ?? '')) return 'warning' as const;
  if (['OPEN', 'CONFIRMED'].includes(status ?? '')) return 'default' as const;
  return 'secondary' as const;
}

export function RequirementListTable({
  items,
  renderActions,
  onOpen,
  returnTo,
}: {
  items: Requirement[];
  renderActions: (item: Requirement) => ReactNode;
  onOpen?: (item: Requirement) => void;
  returnTo?: string;
}) {
  return (
    <table className="w-max min-w-full text-sm">
      <thead className="bg-muted/40 text-left text-muted-foreground">
        <tr>
          {['需求', '需求描述', '优先级', '状态', '规划版本', '创建人', '创建时间', '操作'].map((label) => (
            <th
              key={label}
              className={label === '操作'
                ? 'sticky right-0 z-20 whitespace-nowrap border-l border-border bg-muted px-4 py-3 font-medium'
                : 'whitespace-nowrap px-4 py-3 font-medium'}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const description = item.description.trim() || '未填写';
          const version = item.version?.name ?? '未分配';
          const creator = item.createdByName?.trim() || '未记录';
          return (
            <tr key={item.id} className="border-t border-border">
              <td className="whitespace-nowrap px-4 py-3 font-medium">
                <div className="flex min-w-[220px] flex-col gap-1">
                  {onOpen ? (
                    <button type="button" title={item.title} className="block w-[240px] truncate text-left text-foreground hover:text-primary" onClick={() => onOpen(item)}>{item.title}</button>
                  ) : (
                    <Link to={`/work-items/${item.id}`} state={returnTo ? { returnTo } : undefined} title={item.title} className="block w-[240px] truncate text-foreground no-underline hover:text-primary">{item.title}</Link>
                  )}
                  <span title={item.displayCode ?? item.id} className="block w-[240px] truncate text-xs font-normal text-muted-foreground">{item.displayCode ?? item.id}</span>
                  {item.prototypeImport && item.prototypeImport.status !== 'CONFIRMED' ? (
                    <Badge variant="warning">{item.prototypeImport.status === 'FAILED' ? '导入失败' : '原型导入中'}</Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <span className="block w-[320px] truncate" title={description}>{description}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
              <td className="whitespace-nowrap px-4 py-3"><Badge variant={statusVariant(item.status)}>{formatWorkItemStatus(item.status)}</Badge></td>
              <td className="whitespace-nowrap px-4 py-3"><span className="block max-w-[180px] truncate" title={version}>{version}</span></td>
              <td className="whitespace-nowrap px-4 py-3"><span className="block max-w-[120px] truncate" title={creator}>{creator}</span></td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground"><time dateTime={item.createdAt ?? undefined}>{formatCreatedAt(item.createdAt)}</time></td>
              <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3">
                <div className="flex flex-nowrap gap-2">{renderActions(item)}</div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
