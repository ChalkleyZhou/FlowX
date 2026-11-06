import { useEffect, useState } from 'react';
import { api } from '../../api';
import { ListPagination } from '../../components/ListPagination';
import { PagedSelect } from '../../components/PagedSelect';
import { useQualityPage } from './use-quality-page';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import type { TestRequest, TestRun } from '../../types';

const targets = [
  { key: 'web', name: 'Web' },
  { key: 'api', name: 'API' },
  { key: 'ios', name: 'iOS' },
  { key: 'android', name: 'Android' },
];
type CaseMapping = { snapshotId: string; targetKeys: string[] };
export function QualityCreateRunDialog({
  open,
  onOpenChange,
  request,
  sourceBugId,
  sourceRunId,
  initialCases,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: TestRequest;
  sourceBugId?: string;
  sourceRunId?: string;
  initialCases?: CaseMapping[];
  onCreated: (run: TestRun) => void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('功能初测');
  const [mappings, setMappings] = useState<Record<string, string[]>>({});
  const [executionMode, setExecutionMode] = useState<'LOCAL' | 'MANUAL'>('LOCAL');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const snapshotPage = useQualityPage(`${request.id}:${page}:${query}`, () => api.getTestRequestSnapshots(request.id, { page, pageSize: 20, q: query || undefined, kind: 'FUNCTIONAL' }), open && !sourceRunId, setPage);
  const regressionPage = useQualityPage(`${sourceRunId}:${sourceBugId}:${page}:${query}`, () => api.getTestRunCases(sourceRunId!, { page, pageSize: 20, q: query || undefined, bugId: sourceBugId }), open && Boolean(sourceRunId), setPage);
  const snapshots = sourceRunId
    ? [...new Map(regressionPage.items.map(row => [row.snapshot.id, row.snapshot])).values()]
    : snapshotPage.items;
  const candidates = sourceRunId ? regressionPage : snapshotPage;
  useEffect(() => {
    if (!open) return;
    setName(sourceBugId ? '缺陷修复回归' : '功能初测');
    setExecutionMode('LOCAL');
    setAssigneeId('');
    setPage(1); setQuery('');
    const initial = initialCases ?? [];
    const next: Record<string, string[]> = {};
    for (const mapping of initial)
      next[mapping.snapshotId] = [...new Set([...(next[mapping.snapshotId] ?? []), ...mapping.targetKeys])];
    setMappings(next);
    setError('');
  }, [open, sourceBugId, request.id]);

  const cases = Object.entries(mappings)
    .filter(([, keys]) => keys.length)
    .map(([snapshotId, targetKeys]) => ({ snapshotId, targetKeys }));
  async function submit() {
    if (!cases.length) {
      setError('请明确选择至少一个用例与适用端。空适用端表示未确认，不会自动覆盖全部端。');
      return;
    }
    if (executionMode === 'MANUAL' && !assigneeId) {
      setError('请选择本轮执行人。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = executionMode === 'MANUAL'
        ? await api.createTestRun(request.id, {
          name: name.trim() || (sourceBugId ? '缺陷修复回归' : '功能初测'),
          runType: sourceBugId ? 'REGRESSION' : 'INITIAL',
          ...(sourceBugId ? { sourceBugId } : {}),
          cases: cases.map((item) => ({ snapshotId: item.snapshotId, assignedToUserId: assigneeId })),
        })
        : await api.createLocalTestRun(request.id, {
          name: name.trim() || (sourceBugId ? '缺陷修复回归' : '功能初测'),
          runType: sourceBugId ? 'REGRESSION' : 'INITIAL',
          ...(sourceBugId ? { sourceBugId } : {}),
          targets: targets
            .filter((target) => cases.some((item) => item.targetKeys.includes(target.key)))
            .map((target) => ({ ...target, required: true, expectedRevisions: [] })),
          cases,
        });
      toast.success(executionMode === 'MANUAL' ? '人工测试轮次已创建' : '本地测试轮次已创建');
      onOpenChange(false);
      await onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建本地轮次失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{sourceBugId ? '创建独立回归轮次' : '创建功能测试轮次'}</DialogTitle>
          <DialogDescription>
            明确勾选本轮用例与适用端，跨页保留选择；未勾选的用例不会进入本轮。
            {sourceBugId
              ? '回归使用已完成修复交付的代码基线，原失败历史保留。'
              : '服务端使用冻结的研发交付代码基线，回传结果保存在新轮次中。'}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          轮次名称
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-2 text-sm">
          执行方式
          <select
            aria-label="执行方式"
            className="rounded-md border border-border bg-background px-3 py-2"
            value={executionMode}
            onChange={(event) => setExecutionMode(event.target.value as 'LOCAL' | 'MANUAL')}
          >
            <option value="LOCAL">本地 Agent 执行</option>
            <option value="MANUAL">人工执行</option>
          </select>
        </label>
        {executionMode === 'MANUAL' ? (
          <label className="grid gap-2 text-sm">
            执行人
            <PagedSelect label="执行人" value={assigneeId} onValueChange={setAssigneeId} loadPage={async query => { const result = await api.getOrganizationMembers({ ...query, status: 'ACTIVE' }); return { ...result, items: result.items.map(member => ({ id: member.id, name: member.displayName ?? member.account ?? member.id })) }; }} placeholder="选择执行人" />
          </label>
        ) : null}
        <Input aria-label="搜索功能用例" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索功能用例" />
        <div className="max-h-[50vh] overflow-auto rounded border">
          <table className="w-full min-w-[580px] text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">功能用例</th>
                {targets.map((target) => (
                  <th key={target.key}>{target.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id} className="border-t">
                  <td className="p-3">
                    {snapshot.title}
                    <span className="block text-xs text-muted-foreground">
                      {snapshot.priority} ·{' '}
                      {snapshot.targetKeys?.length ? '已记录适用端，可在本轮调整' : '适用端未确认'}
                    </span>
                  </td>
                  {targets.map((target) => (
                    <td key={target.key} className="p-3 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${snapshot.title} 适用 ${target.name}`}
                        checked={mappings[snapshot.id]?.includes(target.key) ?? false}
                        onChange={(e) =>
                          setMappings((current) => ({
                            ...current,
                            [snapshot.id]: e.target.checked
                              ? [...(current[snapshot.id] ?? []), target.key]
                              : (current[snapshot.id] ?? []).filter((key) => key !== target.key),
                          }))
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {candidates.error ? <p role="alert">{candidates.error}<Button variant="outline" onClick={() => void candidates.refresh()}>重试候选用例</Button></p> : null}
        <ListPagination page={page} total={candidates.total} pageSize={20} loading={candidates.refreshing} onPageChange={setPage} />
        {candidates.hasLoaded && !candidates.error && !snapshots.length ? (
          <p className="text-sm text-muted-foreground">暂无功能用例快照，请先确认测试设计和提测范围。</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          本轮 {cases.length} 条用例 · {cases.reduce((count, item) => count + item.targetKeys.length, 0)}{' '}
          个执行项。未选择的用例不会进入本轮。
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void submit()}>
            {executionMode === 'MANUAL' ? '创建人工轮次' : '创建本地轮次'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
