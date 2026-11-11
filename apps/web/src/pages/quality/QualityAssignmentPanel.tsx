import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers3 } from 'lucide-react';
import { api } from '../../api';
import type { OrganizationMember, TestRequest, TestRequestAssignmentSummary, TestRequestAssignmentsPage } from '../../types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { PagedSelect } from '../../components/PagedSelect';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/utils';

type AssignmentGroup = {
  module: string;
  items: TestRequestAssignmentSummary[];
  defaultUserId: string;
  assignedCount: number;
  unassignedCount: number;
  exceptionItems: TestRequestAssignmentSummary[];
};

const memberName = (member: OrganizationMember) => member.displayName ?? member.account ?? member.id;

export function QualityAssignmentPanel({ request, onCompleted }: { request: TestRequest; onCompleted: (next: TestRequest) => void }) {
  const toast = useToast();
  const [data, setData] = useState<TestRequestAssignmentsPage>();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [moduleDefaults, setModuleDefaults] = useState<Record<string, string>>({});
  const [expandedModules, setExpandedModules] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const readOnly = !['DRAFT', 'READY'].includes(request.status);

  async function load() {
    try {
      const [assignments, memberPage] = await Promise.all([
        api.getTestRequestAssignments(request.id, { page: 1, pageSize: 100 }),
        api.getOrganizationMembers({ page: 1, pageSize: 100, status: 'ACTIVE' }),
      ]);
      const nextValues = Object.fromEntries(assignments.items.map(item => [item.id, item.assignedToUserId ?? '']));
      const nextDefaults = Object.fromEntries(Object.entries(
        assignments.items.reduce<Record<string, string[]>>((groups, item) => {
          const module = item.moduleName ?? '未分模块';
          (groups[module] ??= []).push(item.assignedToUserId ?? '');
          return groups;
        }, {}),
      ).map(([module, assigned]) => [module, new Set(assigned).size === 1 ? assigned[0] : '']));
      setData(assignments);
      setMembers(memberPage.items);
      setValues(nextValues);
      setModuleDefaults(nextDefaults);
      setExpandedModules(Object.entries(nextDefaults).filter(([, value]) => !value).map(([module]) => module));
    } catch (error) { toast.error(error instanceof Error ? error.message : '加载提测分派失败'); }
  }

  useEffect(() => { void load(); }, [request.id, request.scopeRevision]);

  const groups = useMemo<AssignmentGroup[]>(() => {
    const grouped = new Map<string, TestRequestAssignmentSummary[]>();
    for (const item of data?.items ?? []) {
      const module = item.moduleName ?? '未分模块';
      grouped.set(module, [...(grouped.get(module) ?? []), item]);
    }
    return [...grouped.entries()].map(([module, items]) => {
      const defaultUserId = moduleDefaults[module] ?? '';
      const assignedCount = items.filter(item => Boolean(values[item.id])).length;
      const exceptionItems = defaultUserId
        ? items.filter(item => (values[item.id] ?? '') !== defaultUserId)
        : items;
      return { module, items, defaultUserId, assignedCount, unassignedCount: items.length - assignedCount, exceptionItems };
    });
  }, [data, moduleDefaults, values]);

  const summary = useMemo(() => ({
    modules: groups.length,
    total: groups.reduce((count, group) => count + group.items.length, 0),
    assigned: groups.reduce((count, group) => count + group.assignedCount, 0),
    unassigned: groups.reduce((count, group) => count + group.unassignedCount, 0),
    exceptions: groups.reduce((count, group) => count + (group.defaultUserId ? group.exceptionItems.length : 0), 0),
  }), [groups]);

  async function save() {
    if (!data || readOnly) return;
    setSaving(true);
    try {
      const next = await api.updateTestRequestAssignments(request.id, { scopeRevision: data.scopeRevision, assignments: data.items.map(item => ({ snapshotId: item.id, assignedToUserId: values[item.id] || null })) });
      setData(next);
      toast.success('执行人分派已保存');
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存执行人分派失败'); }
    finally { setSaving(false); }
  }

  async function complete() {
    if (!data || readOnly || summary.unassigned) return;
    setSaving(true);
    try {
      const next = await api.completeTestRequestAssignments(request.id, { scopeRevision: data.scopeRevision });
      onCompleted(next);
      toast.success('分派已完成，可以创建功能测试轮次');
    } catch (error) { toast.error(error instanceof Error ? error.message : '完成分派失败'); }
    finally { setSaving(false); }
  }

  function assignModule(module: string, items: TestRequestAssignmentSummary[], userId: string) {
    setModuleDefaults(current => ({ ...current, [module]: userId }));
    setValues(current => ({ ...current, ...Object.fromEntries(items.map(item => [item.id, userId])) }));
  }

  function assignCase(module: string, itemId: string, userId: string) {
    setExpandedModules(current => current.includes(module) ? current : [...current, module]);
    setValues(current => ({ ...current, [itemId]: userId }));
  }

  function assigneeOptions(value: string, emptyLabel: string, onChange: (userId: string) => void, label: string, compact = false) {
    const selectedMember = value ? members.find(member => member.id === value) : undefined;
    return <PagedSelect
      label={label}
      value={value}
      selectedLabel={selectedMember ? memberName(selectedMember) : undefined}
      onValueChange={onChange}
      allowClear
      emptyLabel={emptyLabel}
      placeholder={emptyLabel}
      className={cn('w-48', compact && 'text-xs')}
      disabled={readOnly || saving}
      loadPage={async query => {
        const result = await api.getOrganizationMembers({ ...query, status: 'ACTIVE' });
        return { ...result, items: result.items.map(member => ({ id: member.id, name: memberName(member) })) };
      }}
    />;
  }

  return (
    <section className="space-y-4 rounded-md border p-4" aria-label="提测人员分派">
      {readOnly ? <p role="status" className="rounded border border-primary/20 bg-primary/5 p-3 text-sm">提测已开始或已结束，分派已锁定，仅可查看。</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">按模块分派执行人</h2><p className="mt-1 text-sm text-muted-foreground">先设置模块默认负责人，只在有差异时处理单条例外。</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant={summary.unassigned ? 'destructive' : 'outline'}>待分派 {summary.unassigned}</Badge><Button size="sm" variant="outline" disabled={readOnly || saving || !data} onClick={() => void save()}>保存分派</Button><Button size="sm" disabled={readOnly || saving || !data || Boolean(summary.unassigned)} onClick={() => void complete()}>完成分派</Button></div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4" aria-label="分派摘要">
        {[['模块', summary.modules], ['功能用例', summary.total], ['已分派', summary.assigned], ['需处理例外', summary.exceptions]].map(([label, value]) => <div key={label} className="rounded-md border bg-muted/20 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>)}
      </div>

      <div className="flex items-center justify-between gap-2 border-b pb-2 text-xs text-muted-foreground"><span>模块默认负责人会覆盖该模块下全部用例，单条调整会标记为例外。</span><div className="flex gap-1"><Button type="button" variant="ghost" size="sm" disabled={!groups.length} onClick={() => setExpandedModules(groups.map(group => group.module))}>全部展开</Button><Button type="button" variant="ghost" size="sm" disabled={!groups.length} onClick={() => setExpandedModules([])}>全部收起</Button></div></div>

      {groups.map(group => {
        const expanded = expandedModules.includes(group.module) || !group.defaultUserId;
        const visibleItems = expanded ? group.items : group.exceptionItems;
        return <article className="rounded-md border bg-card" key={group.module}>
          <div className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="flex min-w-0 items-start gap-2"><div className="mt-0.5 rounded bg-muted p-1.5"><Layers3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></div><div className="min-w-0"><h3 className="truncate font-medium">{group.module}</h3><p className="mt-1 text-xs text-muted-foreground">{group.items.length} 条用例 · 已分派 {group.assignedCount} · {group.defaultUserId ? `覆盖 ${group.exceptionItems.length} 条` : '尚未设置模块默认负责人'}</p></div></div><div className="flex flex-wrap items-center gap-2">{group.defaultUserId && group.exceptionItems.length ? <Badge variant="secondary">例外 {group.exceptionItems.length}</Badge> : null}{assigneeOptions(group.defaultUserId, '选择负责人', userId => assignModule(group.module, group.items, userId), `模块 ${group.module} 默认负责人`)}</div></div>
          <div className="flex items-center justify-between border-t bg-muted/10 px-3 py-2 text-xs"><span className="text-muted-foreground">{group.defaultUserId && group.exceptionItems.length ? `默认负责人之外有 ${group.exceptionItems.length} 条需要确认` : expanded ? '正在查看用例明细' : '用例已按模块负责人统一分派'}</span><Button type="button" variant="ghost" size="sm" onClick={() => setExpandedModules(current => expanded ? current.filter(module => module !== group.module) : [...current, group.module])}>{expanded ? <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{expanded ? '收起用例' : group.exceptionItems.length ? `查看 ${group.exceptionItems.length} 条例外` : '查看用例'}</Button></div>
          {visibleItems.length ? <div className="space-y-1 border-t p-2">{visibleItems.map(item => <div key={item.id} className={cn('flex items-center justify-between gap-3 rounded px-2 py-2 text-sm', group.defaultUserId && values[item.id] !== group.defaultUserId && 'bg-amber-50/70 dark:bg-amber-950/20')}><span className="min-w-0 truncate">{item.title}</span>{assigneeOptions(values[item.id] ?? '', '未分派', userId => assignCase(group.module, item.id, userId), `用例 ${item.title} 执行人`, true)}</div>)}</div> : null}
        </article>;
      })}
      {!groups.length ? <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">确认范围后暂无功能用例可分派。</p> : null}
    </section>
  );
}
