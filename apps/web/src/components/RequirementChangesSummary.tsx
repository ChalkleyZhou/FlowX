import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RequirementChange } from '../types';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type ChangesPage = Awaited<ReturnType<typeof api.getRequirementChanges>>;

interface Props {
  requirementId: string;
  onViewAll: () => void;
  onCreateChange: () => void;
}

function statusLabel(record: RequirementChange) {
  if (record.mode === 'SUPPLEMENT') return '补充变更';
  return {
    NOT_REQUESTED: '重新走流程',
    PENDING: '待启动',
    STARTING: record.prototype ? '正在整理原型并启动流程' : '正在启动流程',
    STARTED: '已启动新流程',
    FAILED: '启动失败',
  }[record.restartStatus];
}

export function RequirementChangesSummary({ requirementId, onViewAll, onCreateChange }: Props) {
  const [data, setData] = useState<ChangesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api.getRequirementChanges(requirementId, undefined, { page: 1, pageSize: 3 })
      .then(next => { if (active) setData(next); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '需求修改项加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requirementId, retry]);

  const records = [...(data?.items ?? [])].sort((a, b) => b.revision - a.revision).slice(0, 3);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>版本工作台需求修改项{data?.total ? ` · ${data.total}` : ''}</CardTitle>
        <Button size="sm" variant="outline" onClick={onCreateChange}>提交变更</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.hasPendingChanges ? <p role="status" className="rounded-md bg-muted px-3 py-2 text-xs leading-5">当前任务尚未读取最新修改项。</p> : null}
        {loading ? <p role="status" className="text-sm text-muted-foreground">正在加载修改项…</p> : null}
        {error ? <div className="flex items-center gap-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>重试</Button></div> : null}
        {!loading && !error && records.length === 0 ? <p className="text-sm text-muted-foreground">当前还没有需求修改项。</p> : null}
        {records.map(record => (
          <article key={record.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>第 {record.revision} 次</span>
              <span>{record.createdByName}</span>
              <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString('zh-CN')}</time>
              <span>{statusLabel(record)}</span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-5">{record.content}</p>
          </article>
        ))}
        {data?.total && data.total > records.length ? <Button size="sm" variant="ghost" className="w-full" onClick={onViewAll}>查看全部修改</Button> : null}
        {data?.total && data.total <= records.length ? <Button size="sm" variant="ghost" className="w-full" onClick={onViewAll}>查看完整记录</Button> : null}
      </CardContent>
    </Card>
  );
}
