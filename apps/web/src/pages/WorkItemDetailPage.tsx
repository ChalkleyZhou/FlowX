import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { ExecutionPlanPanel } from '../components/ExecutionPlanPanel';
import { DetailHeader } from '../components/DetailHeader';
import { ContextPanel } from '../components/ContextPanel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { WorkItem } from '../types';

const statusOptions = ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

/** 统一工作项详情；需求与 Issue 的执行计划、状态和交付链路从同一入口维护。 */
export function WorkItemDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [workItem, setWorkItem] = useState<WorkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', remark: '', status: 'ACTIVE', priority: 'MEDIUM' });

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const next = await api.getWorkItem(id);
      setWorkItem(next);
      setDraft({ title: next.title, description: next.description, remark: next.remark, status: next.status, priority: next.priority });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载工作项失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  async function save() {
    if (!workItem || !draft.title.trim()) return;
    setSaving(true);
    try {
      const updated = await api.updateWorkItem(workItem.id, { ...draft, updatedAt: workItem.updatedAt });
      setWorkItem(current => current ? { ...current, ...updated } : updated);
      toast.success('工作项已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新工作项失败');
    } finally {
      setSaving(false);
    }
  }

  async function startWorkflow() {
    if (!workItem || starting) return;
    setStarting(true);
    try {
      await api.startWorkItemWorkflow(workItem.id);
      toast.success('工作流已启动');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动工作流失败');
    } finally {
      setStarting(false);
    }
  }

  if (!id) return null;
  if (loading && !workItem) return <div className="flex min-h-40 items-center justify-center"><Spinner className="h-7 w-7" /></div>;
  if (!workItem) return <Card><CardContent className="space-y-3 p-5"><p>工作项不存在或加载失败。</p><Button variant="outline" onClick={() => void load()}>重试</Button></CardContent></Card>;

  const label = workItem.kind === 'REQUIREMENT' ? '需求' : workItem.kind === 'BUG' ? '缺陷' : '问题';
  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        eyebrow="Work Item"
        title={workItem.title}
        description={workItem.description}
        badges={[
          { key: 'kind', label, variant: 'default' },
          { key: 'displayCode', label: workItem.displayCode ?? workItem.id, variant: 'outline' },
          { key: 'status', label: workItem.status, variant: 'outline' },
          { key: 'priority', label: workItem.priority, variant: 'secondary' },
          ...(workItem.version ? [{ key: 'version', label: workItem.version.name, variant: 'outline' as const }] : []),
        ]}
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to={workItem.project?.id && workItem.versionId ? `/projects/${workItem.project.id}/versions/${workItem.versionId}/work-items` : '/dashboard'}>返回版本工作项</Link></Button>{workItem.executionPlans?.[0]?.status === 'CONFIRMED' && !workItem.executionPlans[0].workflowRunId ? <Button disabled={starting} onClick={() => void startWorkflow()}>{starting ? '启动中...' : '启动工作流'}</Button> : null}</div>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ContextPanel eyebrow="Work Item" title="基本信息" description="需求、问题和缺陷共享同一工作项生命周期；类型只决定补充字段和专属能力。">
          <div className="space-y-4">
            <Input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="标题" />
            <Textarea rows={6} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="描述" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={draft.status} onValueChange={value => setDraft(current => ({ ...current, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select>
              <Input value={draft.priority} onChange={event => setDraft(current => ({ ...current, priority: event.target.value }))} placeholder="优先级" />
            </div>
            <Textarea rows={3} value={draft.remark} onChange={event => setDraft(current => ({ ...current, remark: event.target.value }))} placeholder="备注" />
            <div className="flex justify-end"><Button disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? '保存中...' : '保存'}</Button></div>
          </div>
        </ContextPanel>
        <Card><CardContent className="space-y-3 p-5"><div className="text-sm font-semibold">执行概览</div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">执行计划</span><Badge variant="outline">{workItem.executionPlans?.[0]?.strategy ?? '未建立'}</Badge></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">执行项</span><span>{workItem.executionPlans?.[0]?.items.length ?? 0}</span></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">负责人</span><span>{workItem.ownerUser?.displayName ?? '未指定'}</span></div></CardContent></Card>
      </div>

      <ExecutionPlanPanel workItem={workItem} onChanged={load} />

      {workItem.kind === 'REQUIREMENT' ? <ContextPanel eyebrow="Requirement fields" title="需求补充信息" description="需求专属字段仍属于同一 WorkItem，只在需求类型下展示。"><div className="grid gap-4 text-sm md:grid-cols-2"><div><div className="mb-1 text-muted-foreground">验收标准</div><p className="whitespace-pre-line">{workItem.acceptanceCriteria || '未填写'}</p></div><div><div className="mb-1 text-muted-foreground">功能模块</div><p>{workItem.functionalModule || '未填写'}</p></div><div><div className="mb-1 text-muted-foreground">风险&影响</div><p className="whitespace-pre-line">{workItem.riskImpact || '未填写'}</p></div><div><div className="mb-1 text-muted-foreground">产品需求文档</div><p className="whitespace-pre-line">{workItem.productRequirementDocument || '未填写'}</p></div></div></ContextPanel> : <ContextPanel eyebrow={workItem.kind === 'BUG' ? 'Bug fields' : 'Issue fields'} title={workItem.kind === 'BUG' ? '缺陷补充信息' : '问题补充信息'} description="类型专属字段仍属于同一 WorkItem，只在对应类型下展示。"><div className="grid gap-4 text-sm md:grid-cols-2"><div><div className="mb-1 text-muted-foreground">严重程度</div><p>{workItem.severity || '未填写'}</p></div><div><div className="mb-1 text-muted-foreground">分支</div><p>{workItem.branchName || '未填写'}</p></div><div><div className="mb-1 text-muted-foreground">期望行为</div><p className="whitespace-pre-line">{workItem.expectedBehavior || '未填写'}</p></div><div><div className="mb-1 text-muted-foreground">实际行为</div><p className="whitespace-pre-line">{workItem.actualBehavior || '未填写'}</p></div></div></ContextPanel>}
    </div>
  );
}
