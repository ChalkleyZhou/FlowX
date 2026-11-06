import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { useToast } from '../../components/ui/toast';
import type { QualitySupersession, TestRun, TestedRepositoryRevision } from '../../types';
import { QualityArtifactButton } from './QualityArtifactButton';
import { useQualityPage } from './use-quality-page';
import { ListPagination } from '../../components/ListPagination';

export function QualityReportsPanel({ requestId, runs: _runs }: { requestId: string; runs: TestRun[] }) {
  const [page, setPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const reports = useQualityPage(`${requestId}:${page}`, () => api.getQualityReports(requestId, { page, pageSize: 10 }), true, setPage);
  const runResult = useQualityPage(`${requestId}:${runPage}`, () => api.getTestRuns(requestId, { page: runPage, pageSize: 10 }), true, setRunPage);
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<TestedRepositoryRevision[]>([]);
  const [supersessions, setSupersessions] = useState<QualitySupersession[]>([]);
  const [mode, setMode] = useState<'PROGRESS' | 'FINAL'>('PROGRESS');
  const [busy, setBusy] = useState(false);
  const formal = runResult.items;
  const [baselinePage, setBaselinePage] = useState(1);
  const [replacementPage, setReplacementPage] = useState(1);
  const baselineResult = useQualityPage(`${requestId}:${baselinePage}:${selected.join(',')}`, () => api.getQualityReportBaselines(requestId, { page: baselinePage, pageSize: 10, selectedRunIds: selected }), Boolean(selected.length), setBaselinePage);
  const replacements = useQualityPage(`${requestId}:${replacementPage}:${selected.join(',')}`, () => api.getQualityReportSupersessions(requestId, { page: replacementPage, pageSize: 10, selectedRunIds: selected }), Boolean(selected.length), setReplacementPage);
  const replacementOptions = replacements.items;
  async function generate() {
    setBusy(true);
    try {
      await api.createQualityRequestReport(requestId, {
        idempotencyKey: crypto.randomUUID(),
        mode,
        runIds: selected,
        baseline,
        supersessions,
      });
      await reports.refresh();
      toast.success('任务汇总报告已生成');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '生成报告失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="测试报告" className="space-y-5">
      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold">生成任务汇总</h2>
        <p className="text-sm text-muted-foreground">
          显式选择轮次、同一代码基线与回归替代范围。失败和未测会保留在报告中，阶段报告不会结束轮次。
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">参与轮次</legend>
            {formal.map((run) => (
              <label className="flex gap-2 text-sm" key={run.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(run.id)}
                  onChange={(e) => {
                    setSelected((ids) =>
                      e.target.checked ? [...ids, run.id] : ids.filter((id) => id !== run.id),
                    );
                    setBaseline([]); setBaselinePage(1); setReplacementPage(1);
                    setSupersessions([]);
                  }}
                />
                {run.name} · {run.status}
              </label>
            ))}
            <ListPagination page={runPage} total={runResult.total} pageSize={10} onPageChange={setRunPage} />
            {!formal.length ? <p className="text-sm text-muted-foreground">暂无正式测试轮次</p> : null}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">汇总代码基线</legend>
            {baselineResult.items.map((value) => (
              <label
                className="flex gap-2 break-all text-sm"
                key={`${value.workflowRepositoryId}:${value.headSha}`}
              >
                <input
                  type="checkbox"
                  checked={baseline.some((item) => JSON.stringify(item) === JSON.stringify(value))}
                  onChange={(e) =>
                    setBaseline((items) =>
                      e.target.checked
                        ? [
                            ...items.filter(
                              (item) => item.workflowRepositoryId !== value.workflowRepositoryId,
                            ),
                            value,
                          ]
                        : items.filter((item) => JSON.stringify(item) !== JSON.stringify(value)),
                    )
                  }
                />
                {value.workflowRepositoryId} · {value.branch} · {value.headSha}
              </label>
            ))}
            <ListPagination page={baselinePage} total={baselineResult.total} pageSize={10} onPageChange={setBaselinePage} />
          </fieldset>
        </div>
        {replacements.total ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">确认回归替代（原失败历史保留）</legend>
            {replacementOptions.map((relation) => (
              <label
                className="flex gap-2 text-sm"
                key={`${relation.testRunCaseIds[0]}:${relation.regressionRunId}`}
              >
                <input
                  type="checkbox"
                  checked={supersessions.some(
                    (item) =>
                      item.testRunCaseIds[0] === relation.testRunCaseIds[0] &&
                      item.regressionRunId === relation.regressionRunId,
                  )}
                  onChange={(e) =>
                    setSupersessions((items) =>
                      e.target.checked
                        ? [
                            ...items.filter((item) => item.testRunCaseIds[0] !== relation.testRunCaseIds[0]),
                            {
                              previousRunId: relation.previousRunId,
                              regressionRunId: relation.regressionRunId,
                              testRunCaseIds: relation.testRunCaseIds,
                            },
                          ]
                        : items.filter((item) => item.testRunCaseIds[0] !== relation.testRunCaseIds[0]),
                    )
                  }
                />
                {relation.label}
              </label>
            ))}
            <ListPagination page={replacementPage} total={replacements.total} pageSize={10} onPageChange={setReplacementPage} />
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            报告类型{' '}
            <select
              aria-label="报告类型"
              className="rounded border bg-background p-2"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'PROGRESS' | 'FINAL')}
            >
              <option value="PROGRESS">阶段报告（截至当前，可能未完成）</option>
              <option value="FINAL">最终报告（要求轮次已结束）</option>
            </select>
          </label>
          <Button disabled={busy || !selected.length || !baseline.length} onClick={() => void generate()}>
            生成任务汇总报告
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">报告历史</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={reports.refreshing}
          onClick={() => void reports.refresh()}
        >
          刷新报告
        </Button>
      </div>
      {reports.error ? <p role="alert">报告加载失败：{reports.error}</p> : null}
      {reports.loading ? (
        <p role="status">报告加载中…</p>
      ) : reports.items.length ? (
        reports.items.map((report) => {
          return (
            <article key={report.id} className="rounded-md border p-4 space-y-2">
              <div className="flex flex-wrap justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">
                    {report.kind === 'RUN' ? '轮次报告' : '任务汇总报告'} · 第 {report.revision} 版
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {report.mode === 'PROGRESS' ? '阶段报告 · 截至当前' : '最终报告'}
                    </Badge>
                    <Badge variant="outline">{report.summary?.conclusion}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(report.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <QualityArtifactButton
                    artifactId={report.artifactId}
                    name={report.artifact?.name ?? '测试报告.html'}
                  >
                    在线查看
                  </QualityArtifactButton>
                  <QualityArtifactButton
                    artifactId={report.artifactId}
                    name={report.artifact?.name ?? '测试报告.html'}
                    download
                  >
                    下载 HTML
                  </QualityArtifactButton>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                通过 {report.summary?.passed} / 总数 {report.summary?.total} · 失败{' '}
                {report.summary?.failed} · 阻塞 {report.summary?.blocked} · 跳过{' '}
                {report.summary?.skipped} · 未测 {report.summary?.pending}
              </p>
              {report.runId ? (
                <Link className="text-sm text-primary underline" to={`/quality/test-runs/${report.runId}`}>
                  追溯执行轮次
                </Link>
              ) : null}
              {report.supersessionCount ? (
                <p className="text-xs">已确认 {report.supersessionCount} 项回归替代关系</p>
              ) : null}
            </article>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">暂无测试报告；失败或阻塞结果同样可以生成报告。</p>
      )}
      <ListPagination page={page} total={reports.total} pageSize={10} onPageChange={setPage} />
    </section>
  );
}
