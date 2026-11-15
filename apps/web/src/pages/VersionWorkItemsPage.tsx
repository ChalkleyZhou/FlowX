import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { PagedSelect } from '../components/PagedSelect';
import type { ProjectVersionSummary, WorkItem } from '../types';

const statuses = ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export function VersionWorkItemsPage() {
  const { projectId = '', versionId = '' } = useParams();
  const toast = useToast();
  const [version, setVersion] = useState<ProjectVersionSummary | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [kind, setKind] = useState<'ALL' | WorkItem['kind']>('ALL');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ kind: 'REQUIREMENT' as WorkItem['kind'], title: '', description: '', remark: '', splitMode: 'AI' as 'AI' | 'SINGLE' | 'MANUAL' });

  async function load(next?: string) {
    if (!projectId || !versionId) return;
    setLoading(true);
    try {
      const result = await api.listVersionWorkItems(projectId, versionId, { cursor: next, kind: kind === 'ALL' ? undefined : kind, q: q.trim() || undefined, pageSize: 30 });
      setItems(result.items);
      setNextCursor(result.nextCursor);
      setCursor(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载版本工作项失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void api.getProjectVersion(projectId, versionId).then(setVersion).catch(() => setVersion(null));
  }, [projectId, versionId]);
  useEffect(() => { void load(); }, [projectId, versionId, kind]);

  async function update(item: WorkItem, payload: Parameters<typeof api.updateWorkItem>[1]) {
    try {
      const updated = await api.updateWorkItem(item.id, { ...payload, updatedAt: item.updatedAt });
      setItems(current => current.map(row => row.id === item.id ? { ...row, ...updated } : row));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新工作项失败');
    }
  }

  async function create() {
    if (!draft.title.trim()) return;
    try {
      await api.createVersionWorkItem(projectId, versionId, draft);
      setDraft({ kind: 'REQUIREMENT', title: '', description: '', remark: '', splitMode: 'AI' });
      setCreateOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建工作项失败');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Version work items" title={version?.name ?? '版本工作项'} description="会议中统一查看需求和 Issue，直接更新状态、负责人和备注。" actions={<Button onClick={() => setCreateOpen(true)}>快速新建</Button>} />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input className="max-w-xs" placeholder="搜索标题或描述" value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(); }} />
          <Select value={kind} onValueChange={value => setKind(value as typeof kind)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">全部类型</SelectItem><SelectItem value="REQUIREMENT">需求</SelectItem><SelectItem value="ISSUE">Issue</SelectItem></SelectContent></Select>
          <Button variant="outline" onClick={() => void load()}>查询</Button>
          {loading ? <Spinner className="h-4 w-4" /> : <span className="text-xs text-muted-foreground">当前页 {items.length} 条</span>}
        </CardContent>
      </Card>
      {createOpen ? <Card><CardContent className="grid gap-3 p-4 md:grid-cols-2"><Select value={draft.kind} onValueChange={value => setDraft(current => ({ ...current, kind: value as WorkItem['kind'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="REQUIREMENT">需求</SelectItem><SelectItem value="ISSUE">Issue</SelectItem></SelectContent></Select><p className="flex items-center text-sm text-muted-foreground">创建后由 AI 判断是否需要拆分，确认前不会派发执行项。</p><Input className="md:col-span-2" placeholder="标题" value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /><Textarea className="md:col-span-2" placeholder="会议记录或描述" value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /><Input className="md:col-span-2" placeholder="备注" value={draft.remark} onChange={event => setDraft(current => ({ ...current, remark: event.target.value }))} /><div className="flex gap-2 md:col-span-2"><Button onClick={() => void create()}>创建</Button><Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button></div></CardContent></Card> : null}
      <Card><CardContent className="overflow-x-auto p-0"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">类型</th><th className="p-3">标题</th><th className="p-3">状态</th><th className="p-3">负责人</th><th className="p-3">备注</th><th className="p-3">执行项</th><th className="p-3">操作</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><Badge variant="outline">{item.kind === 'REQUIREMENT' ? '需求' : 'Issue'}</Badge></td><td className="min-w-64 p-3 font-medium"><Link className="text-foreground no-underline hover:text-primary" to={`/work-items/${item.id}`}>{item.title}</Link></td><td className="p-3"><Select value={item.status} onValueChange={value => void update(item, { status: value })}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{statuses.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></td><td className="p-3 min-w-48"><PagedSelect value={item.ownerUserId ?? ''} selectedLabel={item.ownerUser?.displayName ?? undefined} placeholder="选择负责人" allowClear emptyLabel="未指定" scopeKey={item.workspaceId} loadPage={async query => { const result = await api.getOrganizationMembers({ ...query, status: 'ACTIVE' }); return { ...result, items: result.items.map(member => ({ id: member.id, name: member.displayName })) }; }} onValueChange={value => void update(item, { ownerUserId: value || null })} /></td><td className="min-w-48 p-3"><Input value={item.remark} onBlur={event => { if (event.target.value !== item.remark) void update(item, { remark: event.target.value }); }} onChange={event => setItems(current => current.map(row => row.id === item.id ? { ...row, remark: event.target.value } : row))} /></td><td className="p-3 text-muted-foreground">{item.executionPlans?.[0]?.items?.length ?? 0} 个</td><td className="p-3"><Button size="sm" variant="outline" asChild><Link to={`/work-items/${item.id}`}>详情</Link></Button></td></tr>)}</tbody></table>{!loading && !items.length ? <p className="p-8 text-center text-sm text-muted-foreground">当前版本还没有需求或 Issue。</p> : null}</CardContent></Card>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={!cursor || loading} onClick={() => void load()}>回到第一页</Button><Button variant="outline" disabled={!nextCursor || loading} onClick={() => void load(nextCursor ?? undefined)}>下一页</Button></div>
    </div>
  );
}
