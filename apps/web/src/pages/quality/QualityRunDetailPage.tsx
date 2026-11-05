import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, getFlowxApiBaseUrl } from '../../api';
import { useAdoptProject } from '../../project-scope-context';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { launchFlowxLocal, probeFlowxLocal } from '../../lib/flowx-local-bridge';
import type { Bug, TestRun } from '../../types';
import { QualityArtifactButton } from './QualityArtifactButton';
import { QualityReportsPanel } from './QualityReportsPanel';
import { QualityCreateRunDialog } from './QualityCreateRunDialog';
import { useQualityResource } from './use-quality-resource';
import { LoadingState, RefreshButton, runStatusLabels, statusBadgeVariant } from './quality-ui';

const resultLabels: Record<string, string> = { ...runStatusLabels, PENDING: '待执行', SKIPPED: '已跳过' };
export function QualityRunDetailPage() {
  const { id = '' } = useParams();
  return <QualityRunDetailContent key={id} id={id} />;
}
function QualityRunDetailContent({ id }: { id: string }) {
  const resource = useQualityResource(id, api.getTestRun, (run) => run.status === 'ACTIVE');
  const run = resource.data;
  const toast = useToast();
  const navigate = useNavigate();
  const [target, setTarget] = useState('all');
  const [result, setResult] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [launchTarget, setLaunchTarget] = useState('');
  const [ide, setIde] = useState<'codex' | 'cursor' | 'workbuddy'>('codex');
  const [reason, setReason] = useState('');
  const [linkCase, setLinkCase] = useState<NonNullable<TestRun['cases']>[number]>();
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [bugId, setBugId] = useState('');
  const [regressionBugId, setRegressionBugId] = useState('');
  const [regressionRequest, setRegressionRequest] =
    useState<Awaited<ReturnType<typeof api.getTestRequest>>>();
  const request = run?.testPlan?.testRequest;
  useAdoptProject(request?.projectId);
  async function action(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await work();
      if (success) toast.success(success);
      await resource.reload({ silent: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    if (!run || !launchTarget) return;
    setBusy(true);
    setMessage('');
    try {
      if (!(await probeFlowxLocal())) {
        setMessage('未检测到 flowx-local。请在设置 → 本地 Agent 安装并启动本地服务，然后重试。');
        return;
      }
      const { ticket, loopbackPort } = await api.issueQualityLocalLaunchTicket(id, {
        targetId: launchTarget,
        preferredIde: ide,
      });
      await launchFlowxLocal(
        { ticket, ide, apiBaseUrl: getFlowxApiBaseUrl(), purpose: 'quality-test' },
        loopbackPort,
      );
      setMessage('IDE 已打开，等待实际测试进度回传。');
      await resource.reload({ silent: true });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : '本地启动失败';
      setMessage(`${text}。请检查本地登录、项目仓库映射与代码版本，修复后重试。`);
    } finally {
      setBusy(false);
    }
  }
  async function openBug(row: NonNullable<TestRun['cases']>[number]) {
    if (!request) return;
    setLinkCase(row);
    setBugId(row.result?.bugId ?? '');
    try {
      setBugs(
        (await api.getBugs({ workspaceId: request.workspaceId })).filter(
          (bug) => bug.projectId === request.projectId,
        ),
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '加载缺陷失败');
    }
  }
  async function startRegression(sourceBugId: string) {
    if (!request) return;
    await action(async () => {
      setRegressionRequest(await api.getTestRequest(request.id));
      setRegressionBugId(sourceBugId);
    });
  }
  if (!run && resource.loading) return <LoadingState />;
  if (!run)
    return (
      <EmptyState
        title={
          resource.error instanceof ApiError && resource.error.status === 403
            ? '无权访问执行轮次'
            : '加载执行轮次失败'
        }
        description={resource.error?.message ?? '请重试加载执行详情。'}
        action={<Button onClick={() => void resource.reload()}>重试</Button>}
      />
    );
  const rows = (run.cases ?? []).filter(
    (row) =>
      (target === 'all' || row.targetId === target) &&
      (result === 'all' || (row.result?.result ?? 'PENDING') === result),
  );
  const local = run.executionMode === 'LOCAL';
  const hasLease = run.executions?.some(
    (item) => item.status === 'RUNNING' && Date.parse(item.leaseExpiresAt ?? '') > Date.now(),
  );
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="测试与质量 · 执行详情"
        title={run.name}
        description={`${run.runType === 'REGRESSION' ? '缺陷回归' : run.runType === 'LOCAL_SMOKE' ? '本地冒烟' : '功能初测'} · ${local ? '本地执行' : '历史执行'} · 第 ${run.revision ?? 0} 版`}
        actions={
          <>
            <RefreshButton loading={resource.refreshing} onClick={() => void resource.reload()} />
            {request ? (
              <Button variant="outline" asChild>
                <Link to={`/quality/test-requests/${request.id}?tab=runs`}>返回提测</Link>
              </Button>
            ) : null}
          </>
        }
      />
      {resource.error ? <p role="alert">刷新失败，保留已有结果：{resource.error.message}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={statusBadgeVariant(run.status)}>{resultLabels[run.status] ?? run.status}</Badge>
        <span className="text-sm">
          已回传 {(run.cases ?? []).filter((row) => row.result).length} / {run.cases?.length ?? 0} 项
        </span>
        <span className="text-sm text-muted-foreground">执行完成与测试通过分别记录，失败结果仍可归档。</span>
      </div>
      {local && run.status === 'ACTIVE' ? (
        <section aria-label="本地启动" className="rounded-md border p-4 space-y-3">
          <h2 className="font-semibold">下一步：在本地执行测试</h2>
          <div className="flex flex-wrap gap-3">
            <select
              aria-label="启动目标端"
              value={launchTarget}
              onChange={(e) => setLaunchTarget(e.target.value)}
              className="rounded border bg-background p-2"
            >
              <option value="">选择目标端</option>
              {run.targets?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="本地 IDE"
              className="rounded border bg-background p-2"
              value={ide}
              onChange={(e) => setIde(e.target.value as typeof ide)}
            >
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
              <option value="workbuddy">WorkBuddy</option>
            </select>
            <Button disabled={busy || !launchTarget} onClick={() => void launch()}>
              在本地打开测试任务
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {message || '按目标端领取未完成用例；打开 IDE 后，由本地 Agent 真实执行并回传证据。'}
          </p>
          {message ? (
            <Link to="/local-agent" className="text-sm text-primary underline">
              打开本地 Agent 设置
            </Link>
          ) : null}
        </section>
      ) : null}
      <section aria-label="用例执行明细" className="space-y-3">
        <div className="flex flex-wrap justify-between gap-3">
          <h2 className="font-semibold">逐例执行结果</h2>
          <div className="flex gap-2">
            <select
              aria-label="按目标端筛选"
              className="rounded border bg-background p-2 text-sm"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="all">全部目标端</option>
              {run.targets?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="按结果筛选"
              className="rounded border bg-background p-2 text-sm"
              value={result}
              onChange={(e) => setResult(e.target.value)}
            >
              <option value="all">全部结果</option>
              {['PENDING', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'].map((value) => (
                <option key={value} value={value}>
                  {resultLabels[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {rows.map((row) => (
          <article className="rounded-md border p-4 space-y-3" key={row.id}>
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{row.snapshot.title}</h3>
              <div className="flex gap-2">
                <Badge variant="outline">
                  {run.targets?.find((item) => item.id === row.targetId)?.name ?? '未记录目标端'}
                </Badge>
                <Badge variant={statusBadgeVariant(row.result?.result ?? 'PENDING')}>
                  {resultLabels[row.result?.result ?? 'PENDING'] ?? row.result?.result}
                </Badge>
                <Badge variant="outline">{row.snapshot.priority}</Badge>
              </div>
            </div>
            {row.snapshot.precondition ? <p className="text-sm">前置：{row.snapshot.precondition}</p> : null}
            {row.snapshot.testData ? <p className="text-sm">测试数据：{row.snapshot.testData}</p> : null}
            <ol className="list-decimal pl-5 text-sm text-muted-foreground">
              {row.snapshot.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            <div className="grid gap-3 md:grid-cols-2">
              <p className="text-sm">预期：{row.snapshot.expected}</p>
              <p className="text-sm">
                实际：{row.result?.actualResult || (row.activeLease ? '已领取，等待回传' : '尚未执行')}
              </p>
            </div>
            {row.result?.remark ? <p className="text-sm">备注：{row.result.remark}</p> : null}
            <div className="flex flex-wrap gap-2">
              {row.result?.evidence?.artifactIds?.map((artifactId, index) => (
                <QualityArtifactButton key={artifactId} artifactId={artifactId} name={`证据 ${index + 1}`}>
                  查看证据 {index + 1}
                </QualityArtifactButton>
              ))}
              {['FAILED', 'BLOCKED'].includes(row.result?.result ?? '') && !row.result?.bugId ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void openBug(row)}>
                  关联 / 创建缺陷
                </Button>
              ) : null}
            </div>
            {row.result?.bug ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link to={`/bugs/${row.result.bug.id}`} className="text-primary underline">
                  缺陷：{row.result.bug.title}
                </Link>
                {row.result.bug.fixWorkflowRun?.status.toLowerCase() === 'done' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void startRegression(row.result!.bug!.id)}
                  >
                    创建独立回归轮次
                  </Button>
                ) : (
                  <span className="text-muted-foreground">修复工作流完成后可创建独立回归轮次</span>
                )}
              </div>
            ) : null}
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-muted-foreground">当前筛选没有执行项。</p> : null}
      </section>
      <section aria-label="执行与租约" className="space-y-3">
        <h2 className="font-semibold">执行人、环境与领取范围</h2>
        {(run.executions ?? []).map((execution) => (
          <article className="rounded-md border p-4 space-y-2 text-sm" key={execution.id}>
            <p className="font-medium">
              {execution.claimedByUser?.displayName ?? '未记录执行人'} ·{' '}
              {run.targets?.find((item) => item.id === execution.targetId)?.name} · {execution.status}
            </p>
            <p>
              领取范围：
              {execution.claimedCaseIds
                ?.map((caseId) => run.cases?.find((row) => row.id === caseId)?.snapshot.title ?? caseId)
                .join('、') || '未记录'}
            </p>
            <p>
              设备：{execution.deviceId || '未记录'} · 租约截止：
              {execution.leaseExpiresAt
                ? new Date(execution.leaseExpiresAt).toLocaleString('zh-CN')
                : '未记录'}
            </p>
            <p>
              环境：
              {Object.entries(execution.environment ?? {})
                .filter(
                  ([key, value]) =>
                    ['os', 'browser', 'runtime', 'device', 'name'].includes(key) && typeof value === 'string',
                )
                .map(([key, value]) => `${key}: ${value}`)
                .join('；') || '未记录'}
            </p>
            <p className="break-all">
              实际测试版本：
              {execution.testedRevisions
                ?.map((value) => `${value.workflowRepositoryId} / ${value.branch} / ${value.headSha}`)
                .join('；') || '未回传'}
            </p>
            {execution.summary ? <p>{execution.summary}</p> : null}
            {local && execution.status === 'RUNNING' && execution.executionSessionId ? (
              <div className="space-y-2">
                <Input
                  aria-label={`控制原因 ${execution.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="释放 / 取消原因"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api.controlQualityExecution(execution.executionSessionId!, 'heartbeat', {
                            leaseSeconds: 1800,
                          }),
                        '租约已续期',
                      )
                    }
                  >
                    续租
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void action(
                        () =>
                          api.controlQualityExecution(execution.executionSessionId!, 'release', {
                            reason: reason.trim(),
                          }),
                        '已释放剩余范围，已回传结果保留',
                      )
                    }
                  >
                    释放剩余范围
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void action(async () => {
                        const result = await api.controlQualityExecution(
                          execution.executionSessionId!,
                          'cancel',
                          { reason: reason.trim() },
                        );
                        setMessage(
                          result.deviceStopped
                            ? '设备任务已停止'
                            : '服务端会话已取消；设备进程可能仍在运行，请在设备端确认停止。',
                        );
                      })
                    }
                  >
                    取消会话
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  仅原领取人可控制会话；租约过期或服务端取消不表示设备进程已停止。
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      <section className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold">轮次归档与报告</h2>
        <p className="text-sm text-muted-foreground">
          阶段报告记录当前事实；结束轮次保留失败、跳过和未测项，无有效租约后可生成最终报告。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void action(
                () =>
                  api.createQualityRunReport(id, { idempotencyKey: crypto.randomUUID(), mode: 'PROGRESS' }),
                '阶段报告已生成',
              )
            }
          >
            生成阶段报告
          </Button>
          {local && run.status === 'ACTIVE' ? (
            <Button
              disabled={busy || hasLease}
              variant="outline"
              onClick={() =>
                void action(
                  () =>
                    api.finishQualityRun(id, {
                      revision: run.revision ?? 0,
                      reason: '按已回传事实结束轮次，未测项保留',
                    }),
                  '轮次已结束',
                )
              }
            >
              结束轮次
            </Button>
          ) : null}
          <Button
            disabled={busy || run.status === 'ACTIVE' || hasLease}
            onClick={() =>
              void action(
                () => api.createQualityRunReport(id, { idempotencyKey: crypto.randomUUID(), mode: 'FINAL' }),
                '最终报告已生成',
              )
            }
          >
            生成最终报告
          </Button>
        </div>
        {request ? (
          <QualityReportsPanel key={`${id}:${run.revision ?? 0}`} requestId={request.id} runs={[run]} />
        ) : null}
      </section>
      <Dialog
        open={Boolean(linkCase)}
        onOpenChange={(open) => {
          if (!open) setLinkCase(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联缺陷</DialogTitle>
            <DialogDescription>关联缺陷不会修改执行结果，修复完成后使用独立回归轮次验证。</DialogDescription>
          </DialogHeader>
          <select
            aria-label="选择已有缺陷"
            className="rounded border bg-background p-2"
            value={bugId}
            onChange={(e) => setBugId(e.target.value)}
          >
            <option value="">选择已有缺陷</option>
            {bugs.map((bug) => (
              <option key={bug.id} value={bug.id}>
                {bug.title}
              </option>
            ))}
          </select>
          <Button
            disabled={busy || !bugId}
            onClick={() =>
              void action(async () => {
                if (linkCase) await api.linkQualityCaseBug(id, linkCase.id, bugId);
                setLinkCase(undefined);
              }, '缺陷已关联')
            }
          >
            确认关联
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (!request || !linkCase) return;
                const bug = await api.createBug({
                  workspaceId: request.workspaceId,
                  projectId: request.projectId,
                  title: linkCase.snapshot.title,
                  description: `测试失败：${linkCase.result?.actualResult ?? ''}`,
                  expectedBehavior: linkCase.snapshot.expected,
                  actualBehavior: linkCase.result?.actualResult ?? undefined,
                  reproductionSteps: linkCase.snapshot.steps,
                });
                await api.linkQualityCaseBug(id, linkCase.id, bug.id);
                setLinkCase(undefined);
              }, '已创建并关联缺陷')
            }
          >
            根据本条结果创建缺陷
          </Button>
        </DialogContent>
      </Dialog>
      {regressionRequest ? (
        <QualityCreateRunDialog
          request={regressionRequest}
          open={Boolean(regressionBugId)}
          onOpenChange={(open) => {
            if (!open) setRegressionBugId('');
          }}
          sourceBugId={regressionBugId}
          initialCases={(run.cases ?? [])
            .filter((row) => row.result?.bugId === regressionBugId)
            .map((row) => ({
              snapshotId: row.snapshot.id,
              targetKeys: [run.targets?.find((item) => item.id === row.targetId)?.key ?? ''].filter(Boolean),
            }))}
          onCreated={(created) => navigate(`/quality/test-runs/${created.id}`)}
        />
      ) : null}
    </div>
  );
}
