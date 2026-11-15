import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { ListPagination } from '../../components/ListPagination';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import type { QualityCaseSelection, WorkItem, TestDesign, WorkflowRun } from '../../types';
import { QualityScopePanel } from './QualityScopePanel';
import { LoadingState } from './quality-ui';

export function QualityPreparationPage() {
  const [params] = useSearchParams();
  const workItemId = params.get('workItemId') ?? '';
  return <QualityPreparationContent key={workItemId} workItemId={workItemId} />;
}
function sourceReady(run: WorkflowRun) {
  return (
    run.status.toUpperCase() === 'DONE' ||
    run.stageExecutions?.some((stage) => stage.stage === 'SPEC_PLAN' && stage.status === 'COMPLETED')
  );
}
function QualityPreparationContent({ workItemId }: { workItemId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [workItem, setWorkItem] = useState<WorkItem>();
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [existing, setExisting] = useState<TestDesign>();
  const [selection, setSelection] = useState<QualityCaseSelection>({ libraryIds: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      if (!workItemId) {
        setLoading(false);
        return;
      }
      try {
        const item = await api.getWorkItem(workItemId);
        const [allRuns, designs] = await Promise.all([
          api.getWorkflowRuns({ workItemId, page: runPage, pageSize: 10, excludeSuperseded: true }),
          api.getTestDesigns({
            workItemId, page: 1, pageSize: 1,
            projectId: item.projectId,
            projectVersionId: item.versionId ?? undefined,
          }),
        ]);
        if (!active) return;
        const lastPage = Math.max(1, allRuns.totalPages);
        if (runPage > lastPage) { setRunPage(lastPage); return; }
        const linked = allRuns.items;
        setRunTotal(allRuns.total);
        setWorkItem(item);
        setRuns(linked);
        setSelected(current => current.length ? current : linked.filter(sourceReady).map(run => run.id));
        setExisting(designs.items[0]);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '加载测试准备失败');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [workItemId, runPage]);
  async function create() {
    if (
      !workItem?.project?.workspace ||
      !workItem.versionId ||
      !selected.length ||
      !selection.libraryIds.length
    )
      return;
    setBusy(true);
    try {
      const design = await api.createTestDesign({
        workspaceId: workItem.project.workspace.id,
        projectId: workItem.project.id,
        projectVersionId: workItem.versionId,
        workItemIds: [workItem.id],
        workflowRunIds: selected,
        caseSelection: selection,
      });
      navigate(`/quality/test-designs/${design.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '创建测试设计失败');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <LoadingState />;
  if (!workItem)
    return (
      <EmptyState
        title="请从工作项开始准备测试"
        description={error || '从工作项详情点击“准备测试”，项目、版本和工作项会自动带入。'}
        action={
          <Button asChild>
            <Link to="/work-items">选择需求</Link>
          </Button>
        }
      />
    );
  const submitParams = new URLSearchParams({
    create: '1',
    projectId: workItem.projectId,
    projectVersionId: workItem.versionId ?? '',
    workItemId: workItem.id,
    ...(selected[0] ? { workflowRunId: selected[0] } : {}),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="测试与质量"
        title="准备测试"
        description={`${workItem.project?.name ?? '当前项目'} · ${workItem.version?.name ?? '当前工作项版本'} · ${workItem.title}`}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/work-items/${workItem.id}`}>返回工作项</Link>
          </Button>
        }
      />
      <ol className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-4">
        <li className="font-medium text-primary">1 确认工作项与用例库</li>
        <li>2 生成建议与人工补选</li>
        <li>3 确认设计并提测</li>
        <li>4 本地执行与报告</li>
      </ol>
      {!workItem.versionId ? (
        <p role="alert" className="text-sm">
          当前工作项尚未指定版本，请先
          <Link to={`/work-items/${workItem.id}`} className="text-primary underline">
            编辑工作项并选择版本
          </Link>
          。
        </p>
      ) : null}
      {existing ? (
        <section className="rounded-md border p-5 space-y-3">
          <h2 className="font-semibold">已有测试设计 · 第 {existing.revision} 版</h2>
          <p className="text-sm text-muted-foreground">继续当前工作项的测试设计，保留已有选例与处理结果。</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/quality/test-designs/${existing.id}`}>继续已有测试设计</Link>
            </Button>
            {existing.testRequest ? (
              <Button asChild variant="outline">
                <Link to={`/quality/test-requests/${existing.testRequest.id}`}>查看已有提测</Link>
              </Button>
            ) : existing.status === 'CONFIRMED' ? (
              <Button asChild variant="outline">
                <Link to={`/quality/test-requests?${submitParams}`}>继续发起提测</Link>
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-md border p-4 space-y-3">
            <h2 className="font-semibold">关联研发工作流</h2>
            <p className="text-sm text-muted-foreground">
              测试设计需要已确认的工作项、设计与 Spec & Plan；实际提测还需研发完成。
            </p>
            {runs.map((run) => (
              <label key={run.id} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!sourceReady(run)}
                  checked={selected.includes(run.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked ? [...ids, run.id] : ids.filter((id) => id !== run.id),
                    )
                  }
                />
                <Link to={`/workflow-runs/${run.id}`} className="text-primary underline">
                  {run.id}
                </Link>{' '}
                · {run.status}
              </label>
            ))}
            <ListPagination page={runPage} total={runTotal} pageSize={10} onPageChange={setRunPage} />
            {!runs.length ? (
              <p className="text-sm">
                暂无研发流程，请先
                <Link className="text-primary underline" to={`/work-items/${workItem.id}`}>
                  启动研发工作流
                </Link>
                。
              </p>
            ) : null}
          </section>
          {workItem.project?.workspace ? (
            <QualityScopePanel
              workspaceId={workItem.project!.workspace!.id}
              projectId={workItem.projectId}
              onSelectionChange={setSelection}
            />
          ) : null}
          <Button
            disabled={busy || !workItem.versionId || !selected.length || !selection.libraryIds.length}
            onClick={() => void create()}
          >
            创建测试设计并选例
          </Button>
        </>
      )}
    </div>
  );
}
