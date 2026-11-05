import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Plus } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { withCurrentProject } from '../../project-scope';
import { useAdoptProject, useProjectScopeOptional } from '../../project-scope-context';
import { EmptyState } from '../../components/EmptyState';
import { MetricCard } from '../../components/MetricCard';
import { PageHeader } from '../../components/PageHeader';
import { SectionHeader } from '../../components/SectionHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { QualityCreateRunDialog } from './QualityCreateRunDialog';
import { QualityReportsPanel } from './QualityReportsPanel';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { LoadingState, RefreshButton, runStatusLabels, statusBadgeVariant } from './quality-ui';

const TARGET_OPTIONS = [
  { key: 'web', name: 'Web' },
  { key: 'api', name: 'API' },
  { key: 'ios', name: 'iOS' },
  { key: 'android', name: 'Android' },
];

function useDetailResource<T>(id: string, fetcher: (id: string) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);

  // 刷新保留已加载数据；只接受当前组件最新一次请求的结果。
  const reload = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!mounted.current || pending.current) return;
    pending.current = true;
    const current = ++sequence.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const result = await fetcher(id);
      if (mounted.current && current === sequence.current) setData(result);
    } catch (cause) {
      if (!silent && mounted.current && current === sequence.current) {
        setError(cause instanceof Error ? cause : new Error('请求失败，请重试'));
      }
    } finally {
      if (mounted.current && current === sequence.current) { setLoading(false); pending.current = false; }
    }
  }, [id, fetcher]);

  useEffect(() => {
    mounted.current = true;
    pending.current = false;
    void reload();
    return () => { mounted.current = false; sequence.current += 1; };
  }, [reload]);

  return { data, error, loading, reload, setData };
}

function LoadError({ error, retained, loading, label, retry }: {
  error: Error; retained: boolean; loading: boolean; label: string; retry: () => void;
}) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
    <span>{label}加载失败：{error.message}{retained ? '。保留上次加载的数据，尚未更新。' : ''}</span>
    <Button variant="outline" size="sm" disabled={loading} onClick={retry}>重试{label}</Button>
  </div>;
}

export function QualityRequestDetailPage() {
  const { id = '' } = useParams();
  // 路由切换时隔离数据、弹框和请求生命周期，避免旧提测回包覆盖新提测。
  return <QualityRequestDetailContent key={id} id={id} />;
}

function QualityRequestDetailContent({ id }: { id: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const detail = useDetailResource(id, api.getTestRequest);
  const smoke = useDetailResource(id, api.getLocalSmokeRuns);
  const formal = useDetailResource(id, api.getTestRuns);
  const submission = useDetailResource(id, api.getSubmissionReport);
  const request = detail.data;
  const scope = useProjectScopeOptional();
  useAdoptProject(request?.projectId);
  const requestListHref = withCurrentProject('/quality/test-requests', request?.projectId ?? scope?.projectId ?? null);
  const runs = smoke.data ?? [];
  const report = submission.data;
  const refreshing = detail.loading || smoke.loading || submission.loading;
  const [formalDialog, setFormalDialog] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runName, setRunName] = useState('本地冒烟');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['web', 'api']);

  async function refresh(options: { silent?: boolean } = {}) {
    await Promise.all([detail.reload(options), smoke.reload(options), submission.reload(options), formal.reload(options)]);
  }
  const active = (formal.data ?? []).some(run => run.status === 'ACTIVE') || runs.some(run => run.status === 'ACTIVE');
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { void refresh({ silent: true }); }, 5000);
    return () => window.clearInterval(timer);
  }, [active, detail.reload, smoke.reload, submission.reload, formal.reload]);

  const totals = useMemo(() => {
    const cases = runs.flatMap((run) => run.cases ?? []);
    return {
      targets: runs.flatMap((run) => run.targets ?? []).length,
      completed: cases.filter((item) => item.result).length,
      total: cases.length,
      executions: runs.flatMap((run) => run.executions ?? []).length,
    };
  }, [runs]);

  async function prepare() {
    if (!request) return;
    setPreparing(true);
    try {
      const prepared = await api.prepareTestRequest(id, { scopeRevision: request.scopeRevision });
      detail.setData(prepared);
      toast.success(prepared.status === 'DRAFT' ? '冻结范围已确认，请继续完成冒烟门禁' : '提测准备已完成，可以创建功能测试轮次');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '提测准备失败，请检查已确认设计和研发交付');
    } finally { setPreparing(false); }
  }

  async function createRun() {
    if (!selectedTargets.length) {
      toast.error('请至少选择一个目标端');
      return;
    }
    setCreating(true);
    try {
      await api.createLocalSmokeRun(id, {
        name: runName.trim() || '本地冒烟',
        targets: TARGET_OPTIONS.filter((target) => selectedTargets.includes(target.key)).map(
          (target) => ({ ...target, required: true, expectedRevisions: [] }),
        ),
      });
      toast.success('本地冒烟轮次已创建');
      setDialogOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建本地冒烟失败');
    } finally {
      setCreating(false);
    }
  }

  async function finalize(runId: string) {
    setFinalizingId(runId);
    try {
      await api.finalizeLocalSmokeRun(runId);
      toast.success('提测报告已生成');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '冒烟门禁尚未通过');
    } finally {
      setFinalizingId(null);
    }
  }

  async function downloadReport() {
    if (!report) return;
    try {
      const blob = await api.fetchArtifactContent(report.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = report.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '报告下载失败');
    }
  }

  if (!request && detail.loading) return <LoadingState />;
  if (!request) {
    const status = detail.error instanceof ApiError ? detail.error.status : undefined;
    const title = status === 404 ? '提测不存在'
      : status === 403 ? '无权访问提测'
      : detail.error instanceof TypeError ? '网络连接失败'
      : '加载提测详情失败';
    return <EmptyState title={title} description={detail.error?.message ?? '请重试加载提测详情。'} action={(
      <div className="flex gap-2">
        <Button asChild variant="outline"><Link to={requestListHref}>返回提测列表</Link></Button>
        <Button onClick={() => void detail.reload()}>重试详情</Button>
      </div>
    )} />;
  }

  const canCreateFormal = request.testPlan?.status === 'READY' && request.scopeGenerationStatus === 'COMPLETED'
    && ['READY', 'IN_TEST', 'PASSED', 'FAILED', 'BLOCKED'].includes(request.status)
    && request.testPlan.snapshots.some(snapshot => snapshot.kind !== 'SMOKE');
  const formalRuns = (formal.data ?? request.testPlan?.runs ?? []).filter(run => run.runType !== 'LOCAL_SMOKE');
  const activeFormal = formalRuns.some(run => run.status === 'ACTIVE');
  const flowStep = request.scopeGenerationStatus !== 'COMPLETED'
    ? 0
    : request.status === 'DRAFT'
      ? 1
      : !formalRuns.length
        ? 2
        : activeFormal
          ? 3
          : 4;
  const flowSteps = [
    { label: '准备测试范围', detail: request.scopeGenerationStatus === 'COMPLETED' ? '测试设计已确认' : '选择并处理测试用例' },
    { label: '冻结测试范围', detail: request.status === 'DRAFT' ? '确认快照和测试口径' : '范围已冻结' },
    { label: '设置执行', detail: formalRuns.length ? `${formalRuns.length} 个执行轮次` : '选择执行方式和执行人' },
    { label: '执行与报告', detail: activeFormal ? '执行中，等待逐例结果' : formalRuns.length ? '可查看执行结果和报告' : '完成执行后生成报告' },
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${request.project.name} · ${request.projectVersion.name}`}
        title={request.title}
        description={request.scopeSummary || '测试范围尚未完成'}
        actions={(
          <>
            <Button asChild variant="outline" size="icon" title="返回提测列表" aria-label="返回提测列表">
              <Link to={requestListHref}><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>
            </Button>
            <RefreshButton loading={refreshing} onClick={() => void refresh()} />
            {report ? (
              <Button variant="outline" onClick={() => void downloadReport()}>
                <Download aria-hidden="true" className="h-4 w-4" />下载报告
              </Button>
            ) : null}
            <Button disabled={!canCreateFormal} onClick={() => setFormalDialog(true)}>创建功能测试轮次</Button>
            <Button variant="outline" disabled={!['DRAFT', 'READY'].includes(request.status) || !request.testPlan?.snapshots.some(snapshot => snapshot.kind === 'SMOKE')} onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />创建冒烟轮次
            </Button>
          </>
        )}
      />

      <section aria-label="测试任务流程" className="rounded-md border border-border bg-card p-4 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">测试任务流程</h2>
            <p className="mt-1 text-sm text-muted-foreground">围绕同一条需求完成范围冻结、执行分配、结果回传和报告归档。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {flowStep === 0 && request.testDesignId ? <Button size="sm" asChild><Link to={`/quality/test-designs/${request.testDesignId}`}>准备测试范围</Link></Button> : null}
            {flowStep === 1 ? <Button size="sm" disabled={preparing || !request.testDesignId} onClick={() => void prepare()}>冻结测试范围</Button> : null}
            {flowStep === 2 ? <Button size="sm" disabled={!canCreateFormal} onClick={() => setFormalDialog(true)}>设置执行</Button> : null}
            {flowStep === 3 ? <Button size="sm" variant="outline" asChild><Link to={`/quality/test-runs/${formalRuns.find(run => run.status === 'ACTIVE')?.id ?? formalRuns[0]?.id}`}>进入执行详情：{formalRuns.find(run => run.status === 'ACTIVE')?.name ?? formalRuns[0]?.name}</Link></Button> : null}
            {flowStep === 4 ? <Button size="sm" variant="outline" onClick={() => setParams(current => { const next = new URLSearchParams(current); next.set('tab', 'reports'); return next; }, { replace: true })}>查看测试报告</Button> : null}
          </div>
        </div>
        <ol className="mt-4 grid gap-2 md:grid-cols-4">
          {flowSteps.map((step, index) => (
            <li key={step.label} className={`rounded-md border p-3 ${index <= flowStep ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20'}`}>
              <div className="flex items-center gap-2 text-sm font-medium"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs">{index + 1}</span>{step.label}</div>
              <p className="mt-2 text-xs text-muted-foreground">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <Tabs value={['overview', 'scope', 'runs', 'bugs', 'reports'].includes(tab) ? tab : 'overview'} onValueChange={value => setParams(current => { const next = new URLSearchParams(current); next.set('tab', value); return next; }, { replace: true })}>
        <TabsList aria-label="提测详情页签"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="scope">测试范围</TabsTrigger><TabsTrigger value="runs">执行轮次</TabsTrigger><TabsTrigger value="bugs">缺陷</TabsTrigger><TabsTrigger value="reports">测试报告</TabsTrigger></TabsList>
        <TabsContent value="overview"><section className="rounded-md border p-4 space-y-3"><h2 className="font-semibold">下一步</h2><p className="text-sm">{request.scopeGenerationStatus !== 'COMPLETED' ? '先确认测试设计，完成测试范围。' : request.status === 'DRAFT' ? '冻结范围已确认，完成本地冒烟并汇总通过门禁后可创建正式功能测试轮次。' : !(formal.data ?? []).some(run => run.runType !== 'LOCAL_SMOKE') ? '范围已冻结，创建功能测试轮次并明确适用端。' : active ? '进入执行轮次查看逐例进度与待回传范围。' : '执行已结束，可生成轮次或任务汇总报告。'}</p><div className="flex flex-wrap gap-2">{request.scopeGenerationStatus !== 'COMPLETED' ? <Button size="sm" disabled={preparing || !request.testDesignId} onClick={() => void prepare()}>确认冻结范围并完成提测准备</Button> : null}{request.testDesignId ? <Button variant="outline" size="sm" asChild><Link to={`/quality/test-designs/${request.testDesignId}`}>查看测试设计</Link></Button> : null}{request.requirementLinks.map(link => <Button key={link.requirement.id} variant="outline" size="sm" asChild><Link to={`/requirements/${link.requirement.id}`}>{link.requirement.title}</Link></Button>)}</div><p className="text-xs text-muted-foreground">范围 {request.testPlan?.snapshots.filter(snapshot => snapshot.kind !== 'SMOKE').length ?? 0} 条功能用例 · 正式轮次 {(formal.data ?? []).filter(run => run.runType !== 'LOCAL_SMOKE').length} 个。冒烟门禁与正式测试结论分别记录。</p></section></TabsContent>
        <TabsContent value="scope"><section className="space-y-3"><h2 className="font-semibold">已冻结的测试范围</h2>{request.testPlan?.snapshots.map(snapshot => <article key={snapshot.id} className="rounded-md border p-4 space-y-2"><p className="font-medium">{snapshot.title} <Badge variant="outline">{snapshot.kind === 'SMOKE' ? '冒烟' : '功能'} · {snapshot.priority}</Badge></p><p className="text-sm">适用端：{snapshot.targetKeys?.join('、') || '未确认，创建轮次时需明确选择'}</p><p className="text-xs text-muted-foreground">{snapshot.selectionReason || snapshot.selectedBy} · 来源版本 {snapshot.sourceVersion ?? '生成用例'}</p><ol className="list-decimal pl-5 text-sm">{snapshot.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><p className="text-sm">预期：{snapshot.expected}</p></article>)}{!request.testPlan?.snapshots.length ? <p className="text-sm text-muted-foreground">暂无冻结快照，请先确认测试设计。</p> : null}</section></TabsContent>
        <TabsContent value="runs"><section className="space-y-3"><h2 className="font-semibold">功能测试与回归轮次</h2>{formal.error ? <LoadError error={formal.error} retained={Boolean(formal.data)} loading={formal.loading} label="正式轮次" retry={() => void formal.reload()} /> : null}{(formal.data ?? request.testPlan?.runs ?? []).filter(run => run.runType !== 'LOCAL_SMOKE').map(run => <article className="rounded-md border p-4" key={run.id}><div className="flex justify-between gap-3"><Link className="font-medium text-primary hover:underline" to={`/quality/test-runs/${run.id}`}>{run.name}</Link><Badge variant={statusBadgeVariant(run.status)}>{runStatusLabels[run.status] ?? run.status}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{run.runType === 'REGRESSION' ? '缺陷回归' : '功能初测'} · {run.executionMode === 'LOCAL' ? '本地执行' : '历史执行'} · {run.cases?.filter(row => row.result).length ?? 0}/{run.cases?.length ?? 0} 项已回传</p></article>)}</section></TabsContent>
        <TabsContent value="bugs"><section className="space-y-3"><h2 className="font-semibold">失败、阻塞项与关联缺陷</h2>{(formal.data ?? []).flatMap(run => (run.cases ?? []).filter(row => ['FAILED', 'BLOCKED'].includes(row.result?.result ?? '')).map(row => <article className="rounded-md border p-4 space-y-2" key={row.id}><p className="font-medium">{row.snapshot.title}</p><p className="text-sm text-muted-foreground">{row.result?.actualResult || '未记录实际结果'}</p>{row.result?.bug ? <Link className="text-sm text-primary underline" to={`/bugs/${row.result.bug.id}`}>{row.result.bug.title}</Link> : <p className="text-sm">尚未关联缺陷</p>}<p><Link className="text-sm text-primary underline" to={`/quality/test-runs/${run.id}`}>进入执行详情关联缺陷或创建独立回归</Link></p></article>))}{!(formal.data ?? []).some(run => run.cases?.some(row => ['FAILED', 'BLOCKED'].includes(row.result?.result ?? ''))) ? <p className="text-sm text-muted-foreground">暂无失败或阻塞项，异常用例将在此集中展示。</p> : null}</section></TabsContent>
        <TabsContent value="reports"><QualityReportsPanel requestId={id} runs={formal.data ?? []} /></TabsContent>
      </Tabs>
      {tab === 'overview' || tab === 'runs' ? <>
      {detail.error ? <LoadError error={detail.error} retained loading={detail.loading} label="详情" retry={() => void detail.reload()} /> : null}
      {submission.error ? <LoadError error={submission.error} retained={submission.data !== undefined} loading={submission.loading} label="报告" retry={() => void submission.reload()} /> : null}
      {!submission.error && !report ? <p role="status" className="text-sm text-muted-foreground">{submission.loading ? '报告加载中…' : '暂无提测报告，完成冒烟后可汇总生成。'}</p> : null}
      {smoke.error ? <LoadError error={smoke.error} retained={smoke.data !== undefined} loading={smoke.loading} label="轮次" retry={() => void smoke.reload()} /> : null}
      {smoke.data === undefined && smoke.loading ? <p role="status" className="text-sm text-muted-foreground">冒烟轮次加载中…</p> : null}

      {smoke.data !== undefined ? <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="冒烟轮次" value={runs.length} />
        <MetricCard label="目标端" value={totals.targets} />
        <MetricCard label="覆盖进度" value={`${totals.completed}/${totals.total}`} />
        <MetricCard label="参与执行" value={totals.executions} />
      </div>

      {runs.length ? (
        <div className="space-y-5">
          {runs.map((run) => (
            <Card key={run.id} className="rounded-md border-border bg-card shadow-none">
              <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-start md:justify-between">
                <SectionHeader
                  eyebrow="Local Smoke"
                  title={run.name}
                  description={`报告版本 ${run.reportRevision ?? 0} · ${run.executions?.length ?? 0} 次执行`}
                />
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild><Link to={`/quality/test-runs/${run.id}`}>执行详情</Link></Button>
                  <Badge variant={statusBadgeVariant(run.status)}>{runStatusLabels[run.status] ?? run.status}</Badge>
                  {run.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      disabled={finalizingId === run.id}
                      onClick={() => void finalize(run.id)}
                    >
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4" />汇总并生成报告
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(run.targets ?? []).map((target) => (
                    <Badge key={target.id} variant={statusBadgeVariant(target.status)}>
                      {target.name} · {runStatusLabels[target.status] ?? (target.status === 'PENDING' ? '待执行' : target.status)}
                    </Badge>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-muted/60 text-left text-muted-foreground">
                      <tr><th className="p-3">目标端</th><th className="p-3">冒烟用例</th><th className="p-3">优先级</th><th className="p-3">结论</th><th className="p-3">实际结果</th></tr>
                    </thead>
                    <tbody>
                      {(run.cases ?? []).map((item) => {
                        const target = run.targets?.find((candidate) => candidate.id === item.targetId);
                        return (
                          <tr key={item.id} className="border-t border-border">
                            <td className="p-3 font-medium">{target?.name ?? '-'}</td>
                            <td className="p-3">{item.snapshot.title}</td>
                            <td className="p-3">{item.snapshot.priority}</td>
                            <td className="p-3"><Badge variant={statusBadgeVariant(item.result?.result ?? 'PENDING')}>{runStatusLabels[item.result?.result ?? 'PENDING'] ?? item.result?.result ?? '待执行'}</Badge></td>
                            <td className="max-w-[320px] p-3 text-muted-foreground">{item.result?.actualResult || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {(run.executions ?? []).length ? (
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                    {(run.executions ?? []).map((execution) => {
                      const target = run.targets?.find((item) => item.id === execution.targetId);
                      const claimed = execution.claimedCaseIds;
                      const titles = Array.isArray(claimed) ? claimed.map((caseId) =>
                        run.cases?.find((item) => item.id === caseId)?.snapshot.title ?? caseId) : [];
                      const active = execution.status === 'RUNNING';
                      const lease = execution.leaseExpiresAt ? Date.parse(execution.leaseExpiresAt) : NaN;
                      const leaseLabel = !active ? '领取已结束' : !Number.isFinite(lease)
                        ? '租约信息未记录' : lease > Date.now() ? '租约有效' : '租约已到期';
                      const status = ({ RUNNING: '等待回传', COMPLETED: '已完成回传', STALE: '结果版本已过期',
                        FAILED: '执行失败', CANCELLED: '已取消' } as Record<string, string>)[execution.status] ?? execution.status;
                      return <div key={execution.id} className="w-full rounded-md border border-border p-3">
                        <p className="font-medium text-foreground">{target?.name ?? '未记录目标端'} · {execution.claimedByUser?.displayName ?? '未记录执行人'} · {status}</p>
                        <p>领取范围：{titles.join('、') || '未记录领取用例'} · {leaseLabel}</p>
                        {active && Number.isFinite(lease) ? <p>租约截止：{new Date(lease).toLocaleString('zh-CN')}；租约到期不代表原设备任务已停止。</p> : null}
                        {execution.summary ? <p>回传结论：{execution.summary}</p> : null}
                        <p>设备：{execution.deviceId || '未记录设备'}</p>
                      </div>;
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无本地冒烟轮次" description="创建轮次后，本地开发者可以按目标端认领并回传结果。" />
      )}

      </> : null}

      </> : null}
      <QualityCreateRunDialog open={formalDialog} onOpenChange={setFormalDialog} request={request} onCreated={run => navigate(`/quality/test-runs/${run.id}`)} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建本地冒烟轮次</DialogTitle>
            <DialogDescription>选择需要覆盖的目标端；服务端会按冒烟用例生成独立覆盖矩阵。</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>轮次名称</span>
            <Input value={runName} onChange={(event) => setRunName(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {TARGET_OPTIONS.map((target) => (
              <label key={target.key} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm">
                <input
                  type="checkbox"
                  checked={selectedTargets.includes(target.key)}
                  onChange={(event) =>
                    setSelectedTargets((current) =>
                      event.target.checked
                        ? [...current, target.key]
                        : current.filter((key) => key !== target.key),
                    )
                  }
                />
                <span>{target.name}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button disabled={creating} onClick={() => void createRun()}>创建轮次</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
