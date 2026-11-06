import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { OrganizationMember, TestRequest, TestRequestAssignmentSummary, TestRequestAssignmentsPage } from '../../types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';

export function QualityAssignmentPanel({ request, onCompleted }: { request: TestRequest; onCompleted: (next: TestRequest) => void }) {
  const toast = useToast();
  const [data, setData] = useState<TestRequestAssignmentsPage>();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [assignments, memberPage] = await Promise.all([
        api.getTestRequestAssignments(request.id, { page: 1, pageSize: 100 }),
        api.getOrganizationMembers({ page: 1, pageSize: 100, status: 'ACTIVE' }),
      ]);
      setData(assignments);
      setMembers(memberPage.items);
      setValues(Object.fromEntries(assignments.items.map(item => [item.id, item.assignedToUserId ?? ''])));
    } catch (error) { toast.error(error instanceof Error ? error.message : '加载提测分派失败'); }
  }
  useEffect(() => { void load(); }, [request.id, request.scopeRevision]);

  const groups = useMemo(() => {
    const map = new Map<string, TestRequestAssignmentSummary[]>();
    for (const item of data?.items ?? []) {
      const key = item.moduleName ?? '未分模块';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [data]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const next = await api.updateTestRequestAssignments(request.id, { scopeRevision: data.scopeRevision, assignments: data.items.map(item => ({ snapshotId: item.id, assignedToUserId: values[item.id] || null })) });
      setData(next);
      toast.success('执行人分派已保存');
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存执行人分派失败'); }
    finally { setSaving(false); }
  }

  async function complete() {
    if (!data || data.summary.unassigned) return;
    setSaving(true);
    try {
      const next = await api.completeTestRequestAssignments(request.id, { scopeRevision: data.scopeRevision });
      onCompleted(next);
      toast.success('分派已完成，可以创建功能测试轮次');
    } catch (error) { toast.error(error instanceof Error ? error.message : '完成分派失败'); }
    finally { setSaving(false); }
  }

  function assignModule(items: TestRequestAssignmentSummary[], userId: string) {
    setValues(current => Object.fromEntries([...Object.entries(current), ...items.map(item => [item.id, userId])]));
  }

  return (
    <section className="space-y-4 rounded-md border p-4" aria-label="提测人员分派">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">按模块分派执行人</h2><p className="mt-1 text-sm text-muted-foreground">先给模块设置默认负责人，单条用例可以在下方覆盖。</p></div><div className="flex gap-2"><Badge variant={data?.summary.unassigned ? 'destructive' : 'outline'}>未分派 {data?.summary.unassigned ?? 0}</Badge><Button size="sm" variant="outline" disabled={saving || !data} onClick={() => void save()}>保存分派</Button><Button size="sm" disabled={saving || !data || Boolean(data.summary.unassigned)} onClick={() => void complete()}>完成分派</Button></div></div>
      {groups.map(([module, items]) => {
        const moduleValue = [...new Set(items.map(item => values[item.id] || ''))].length === 1 ? values[items[0].id] || '' : '';
        return <div className="rounded-md border p-3" key={module}><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{module}</h3><p className="text-xs text-muted-foreground">{items.length} 条用例 · 模块默认负责人</p></div><select className="rounded border bg-background px-2 py-1 text-sm" aria-label={`模块 ${module} 默认负责人`} value={moduleValue} onChange={event => assignModule(items, event.target.value)}><option value="">选择负责人</option>{members.map(member => <option key={member.id} value={member.id}>{member.displayName ?? member.account ?? member.id}</option>)}</select></div><div className="mt-3 space-y-1">{items.map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm"><span className="truncate">{item.title}</span><select className="max-w-48 rounded border bg-background px-2 py-1 text-xs" aria-label={`用例 ${item.title} 执行人`} value={values[item.id] ?? ''} onChange={event => setValues(current => ({ ...current, [item.id]: event.target.value }))}><option value="">未分派</option>{members.map(member => <option key={member.id} value={member.id}>{member.displayName ?? member.account ?? member.id}</option>)}</select></div>)}</div></div>;
      })}
      {!groups.length ? <p className="text-sm text-muted-foreground">确认范围后暂无功能用例可分派。</p> : null}
    </section>
  );
}
