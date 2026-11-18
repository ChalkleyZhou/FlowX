import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { ExecutionPlanPanel } from '../components/ExecutionPlanPanel';
import { DetailHeader } from '../components/DetailHeader';
import { ContextPanel } from '../components/ContextPanel';
import { RequirementChangesPanel } from '../components/RequirementChangesPanel';
import { RequirementChangesSummary } from '../components/RequirementChangesSummary';
import { WorkItemEditDialog } from '../components/WorkItemEditDialog';
import { WorkItemMetaPanel } from '../components/WorkItemMetaPanel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { WorkItem } from '../types';
import { formatPriority, formatWorkItemStatus } from '../utils/label-utils';

function TextField({ label, value, multiline = false }: { label: string; value?: string | null; multiline?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <p className={multiline ? 'whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground' : 'text-sm text-muted-foreground'}>
        {value?.trim() || '未填写'}
      </p>
    </div>
  );
}

function businessDays(start: string, end: string) {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  let total = 0;
  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

function ScheduleSummary({ workItem }: { workItem: WorkItem }) {
  const summary = useMemo(() => {
    const assignments = workItem.assignments ?? [];
    if (assignments.length === 0) return null;
    const starts = assignments.map(item => item.plannedStartDate).sort();
    const ends = assignments.map(item => item.plannedEndDate).sort();
    const totalDays = assignments.reduce((total, item) => total + (item.estimatedDays ?? businessDays(item.plannedStartDate, item.plannedEndDate)), 0);
    return { count: assignments.length, start: starts[0], end: ends.at(-1), totalDays };
  }, [workItem.assignments]);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-semibold">排期摘要</div>
          <Link className="text-sm text-primary hover:underline" to={`/schedule?workItemId=${workItem.id}`}>查看排期</Link>
        </div>
        {summary ? (
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">排期人员</dt><dd>{summary.count} 人</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">计划区间</dt><dd>{summary.start} – {summary.end}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">预计人天</dt><dd>{summary.totalDays || '未估算'}</dd></div>
          </dl>
        ) : <p className="text-sm text-muted-foreground">尚未安排排期。</p>}
      </CardContent>
    </Card>
  );
}

/** 统一工作项详情；需求与 Issue 的执行计划、状态和交付链路从同一入口维护。 */
export function WorkItemDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const toast = useToast();
  const [workItem, setWorkItem] = useState<WorkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      setWorkItem(await api.getWorkItem(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载工作项失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  const state = location.state as { returnTo?: unknown } | null;
  const returnTo = typeof state?.returnTo === 'string' && state.returnTo.startsWith('/') && !state.returnTo.startsWith('//')
    ? state.returnTo
    : '/work-items';

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
  const isRequirement = workItem.kind === 'REQUIREMENT';
  const latestPlan = workItem.executionPlans?.[0];

  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        eyebrow="Work Item"
        title={workItem.title}
        description={`${label}内容与交付信息集中在此维护。`}
        badges={[
          { key: 'kind', label, variant: 'default' },
          { key: 'displayCode', label: workItem.displayCode ?? workItem.id, variant: 'outline' },
          { key: 'status', label: formatWorkItemStatus(workItem.status), variant: 'outline' },
          { key: 'priority', label: formatPriority(workItem.priority), variant: 'secondary' },
          ...(workItem.version ? [{ key: 'version', label: workItem.version.name, variant: 'outline' as const }] : []),
        ]}
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to={returnTo}>返回列表</Link></Button><Button variant="outline" onClick={() => setEditOpen(true)}>编辑内容</Button>{latestPlan?.status === 'CONFIRMED' && !latestPlan.workflowRunId ? <Button disabled={starting} onClick={() => void startWorkflow()}>{starting ? '启动中...' : '启动工作流'}</Button> : null}</div>}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {isRequirement ? (
            <ContextPanel eyebrow="Requirement content" title="需求内容" description="先阅读需求正文，再查看右侧的负责人、优先级、版本和修改项。">
              <div className="space-y-5">
                <TextField label="需求描述" value={workItem.description} multiline />
                <div className="grid gap-5 md:grid-cols-2">
                  <TextField label="验收标准" value={workItem.acceptanceCriteria} multiline />
                  <TextField label="功能模块" value={workItem.functionalModule} multiline />
                  <TextField label="风险 & 影响" value={workItem.riskImpact} multiline />
                  <TextField label="产品需求文档" value={workItem.productRequirementDocument} multiline />
                </div>
                <TextField label="备注" value={workItem.remark} multiline />
              </div>
            </ContextPanel>
          ) : (
            <ContextPanel eyebrow={workItem.kind === 'BUG' ? 'Bug content' : 'Issue content'} title={workItem.kind === 'BUG' ? '缺陷内容' : '问题内容'}>
              <div className="space-y-5">
                <TextField label="描述" value={workItem.description} multiline />
                <div className="grid gap-5 md:grid-cols-2">
                  <TextField label="严重程度" value={workItem.severity} />
                  <TextField label="分支" value={workItem.branchName} />
                  <TextField label="期望行为" value={workItem.expectedBehavior} multiline />
                  <TextField label="实际行为" value={workItem.actualBehavior} multiline />
                </div>
                <TextField label="备注" value={workItem.remark} multiline />
              </div>
            </ContextPanel>
          )}

          <ExecutionPlanPanel workItem={workItem} onChanged={load} />

          {isRequirement ? (
            <div id="requirement-changes">
              <RequirementChangesPanel requirementId={workItem.id} open={changesOpen} onOpenChange={setChangesOpen} onChanged={load} />
            </div>
          ) : null}
        </div>

        <aside className="space-y-5">
          <WorkItemMetaPanel workItem={workItem} onSaved={updated => setWorkItem(current => current ? { ...current, ...updated } : current)} />
          {isRequirement ? <RequirementChangesSummary requirementId={workItem.id} onCreateChange={() => { setChangesOpen(true); document.getElementById('requirement-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} onViewAll={() => document.getElementById('requirement-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /> : null}
          {isRequirement ? <ScheduleSummary workItem={workItem} /> : null}
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="text-base font-semibold">执行概览</div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">执行计划</span><Badge variant="outline">{latestPlan?.strategy ?? '未建立'}</Badge></div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">执行项</span><span>{latestPlan?.items.length ?? 0}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">负责人</span><span>{workItem.ownerUser?.displayName ?? '未指定'}</span></div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <WorkItemEditDialog workItem={workItem} open={editOpen} onOpenChange={setEditOpen} onSaved={updated => { setWorkItem(updated); setEditOpen(false); toast.success('工作项已更新'); }} />
    </div>
  );
}
