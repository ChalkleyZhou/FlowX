import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
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
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import type { ArtifactSummary, TestRequest, TestRun } from '../../types';
import { LoadingState, RefreshButton, runStatusLabels, statusBadgeVariant } from './quality-ui';

const TARGET_OPTIONS = [
  { key: 'web', name: 'Web' },
  { key: 'api', name: 'API' },
  { key: 'ios', name: 'iOS' },
  { key: 'android', name: 'Android' },
];

export function QualityRequestDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [request, setRequest] = useState<TestRequest | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [report, setReport] = useState<ArtifactSummary | null>(null);
  const [runName, setRunName] = useState('本地冒烟');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['web', 'api']);

  async function refresh(silent = false) {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [nextRequest, nextRuns, nextReport] = await Promise.all([
        api.getTestRequest(id),
        api.getLocalSmokeRuns(id),
        api.getSubmissionReport(id),
      ]);
      setRequest(nextRequest);
      setRuns(nextRuns);
      setReport(nextReport);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载提测详情失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  const totals = useMemo(() => {
    const cases = runs.flatMap((run) => run.cases ?? []);
    return {
      targets: runs.flatMap((run) => run.targets ?? []).length,
      completed: cases.filter((item) => item.result).length,
      total: cases.length,
      executions: runs.flatMap((run) => run.executions ?? []).length,
    };
  }, [runs]);

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
      await refresh(true);
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
      await refresh(true);
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

  if (loading) return <LoadingState />;
  if (!request) return <EmptyState title="提测不存在" description="该提测可能已删除或无权访问。" />;

  return (
    <>
      <PageHeader
        eyebrow={`${request.project.name} · ${request.projectVersion.name}`}
        title={request.title}
        description={request.scopeSummary || '测试范围尚未完成'}
        actions={(
          <>
            <Button asChild variant="outline" size="icon" title="返回提测列表" aria-label="返回提测列表">
              <Link to="/quality/test-requests"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>
            </Button>
            <RefreshButton loading={refreshing} onClick={() => void refresh(true)} />
            {report ? (
              <Button variant="outline" onClick={() => void downloadReport()}>
                <Download aria-hidden="true" className="h-4 w-4" />下载报告
              </Button>
            ) : null}
            <Button onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />创建冒烟轮次
            </Button>
          </>
        )}
      />

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
                      {target.name} · {runStatusLabels[target.status] ?? target.status}
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
                            <td className="p-3"><Badge variant={statusBadgeVariant(item.result?.result ?? 'PENDING')}>{item.result?.result ?? '待执行'}</Badge></td>
                            <td className="max-w-[320px] p-3 text-muted-foreground">{item.result?.actualResult || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {(run.executions ?? []).length ? (
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                    {(run.executions ?? []).map((execution) => (
                      <span key={execution.id}>{execution.claimedByUser?.displayName ?? '未知执行人'} · {execution.deviceId || '未记录设备'} · {execution.status}</span>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无本地冒烟轮次" description="创建轮次后，本地开发者可以按目标端认领并回传结果。" />
      )}

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
