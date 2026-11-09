import { useState } from 'react';
import { Play, RefreshCw, ArrowRight, CheckCircle2, CircleDashed, AlertCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useQualityPage } from './use-quality-page';
import { ONLINE_AI_UNAVAILABLE_MESSAGE, useOnlineAiProviders } from '../../online-ai';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { useToast } from '../../components/ui/toast';
import { useQualityResource } from './use-quality-resource';
import { LoadingState, statusBadgeVariant } from './quality-ui';
import type { TestDesign } from '../../types';

const statusLabels: Record<string, string> = {
  NOT_STARTED: '等待分析',
  GENERATING: 'AI 分析中',
  WAITING_REVIEW: '分析完成，等待发起提测',
  WAITING_CONFIRMATION: '分析完成，等待发起提测',
  CONFIRMED: '已进入提测流程',
  STALE: '分析已过期',
  GENERATION_FAILED: '分析失败',
};

export function QualityTestDesignPage() {
  const { id = '' } = useParams<{ id: string }>();
  return <QualityTestDesignContent key={id} id={id} />;
}

function QualityTestDesignContent({ id }: { id: string }) {
  const toast = useToast();
  const onlineAi = useOnlineAiProviders();
  const resource = useQualityResource(id, api.getTestDesign, design => design.status === 'GENERATING', 2000);
  const workflows = useQualityPage(`${id}:workflows`, () => api.getTestDesignWorkflows(id, { page: 1, pageSize: 100 }));
  const design = resource.data;
  const load = resource.reload;
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!id) return;
    setBusy(true);
    try {
      resource.setData(await api.generateTestDesign(id));
      toast.success('已开始 AI 分析，页面会自动刷新结果');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 AI 分析失败');
    } finally {
      setBusy(false);
    }
  }

  if (resource.loading && !design) return <LoadingState />;
  if (!design) return <EmptyState title="AI 测试分析不存在" description="请检查链接或返回提测管理。" />;

  const summary = design.summary;
  const candidateCount = summary?.candidateCount ?? 0;
  const smokeCount = summary?.smokeCount ?? 0;
  const source = design.sourceSummary ?? {};
  const hasSource = (key: string) => Array.isArray(source[key]) ? (source[key] as unknown[]).length > 0 : Boolean(source[key]);
  const hasRequest = Boolean(design.testRequest);
  const canStartRequest = ['WAITING_REVIEW', 'WAITING_CONFIRMATION', 'CONFIRMED'].includes(design.status) && !hasRequest;
  const analyzing = design.status === 'GENERATING' || design.status === 'NOT_STARTED';
  const createParams = new URLSearchParams({
    create: '1',
    projectId: design.projectId,
    projectVersionId: design.projectVersionId,
    ...(design.requirements?.[0]?.requirement.id ? { requirementId: design.requirements[0].requirement.id } : {}),
    ...(workflows.items[0]?.workflowRun.id ? { workflowRunId: workflows.items[0].workflowRun.id } : {}),
  });
  const nextHref = hasRequest
    ? `/quality/test-requests/${design.testRequest?.id}`
    : `/quality/test-requests?${createParams}`;

  const sources = [
    { label: '需求', detail: design.requirements?.length ? `${design.requirements.length} 条需求` : '已关联需求', ready: Boolean(design.requirements?.length) || hasSource('requirementIds') },
    { label: '技术方案', detail: '研发工作流设计产物', ready: hasSource('designs') },
    { label: 'Spec & Plan', detail: '研发执行计划', ready: hasSource('specPlans') },
    { label: '研发提交记录', detail: workflows.items.length ? `${workflows.items.length} 条已关联工作流` : '已关联研发工作流', ready: Boolean(workflows.items.length) || hasSource('workflowRunIds') },
    { label: '代码变更', detail: typeof source.changeSummary === 'string' && source.changeSummary ? '已读取代码差异摘要' : '随研发交付记录读取', ready: Boolean(source.changeSummary) },
    { label: '代码库上下文', detail: '用于补充影响范围和组件关系', ready: hasSource('designs') || hasSource('specPlans') },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="测试与质量"
        title="AI 测试分析"
        description={`${design.requirements?.[0]?.requirement.title ?? '当前需求'} · 第 ${design.revision} 版 AI 分析`}
        actions={(
          <>
            <Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className="h-4 w-4" />刷新</Button>
            {onlineAi && !onlineAi.onlineAvailable ? <p role="status" className="text-sm text-muted-foreground">{ONLINE_AI_UNAVAILABLE_MESSAGE}</p> : null}
            {!hasRequest && design.status !== 'CONFIRMED' ? <Button variant="outline" onClick={() => void generate()} disabled={busy || analyzing || (onlineAi !== null && !onlineAi.onlineAvailable)}><Play className="h-4 w-4" />重新分析</Button> : null}
          </>
        )}
      />

      <ol aria-label="提测流程" className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-4">
        {['AI 分析', '发起提测', '范围确认与分派', '执行与报告'].map((label, index) => <li key={label} className={`rounded-md px-3 py-2 ${index === 0 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}><span className="mr-1">{index + 1}</span>{label}</li>)}
      </ol>

      <Card className="rounded-md border-border bg-card shadow-none">
        <CardHeader><h2 className="font-semibold">这次 AI 看了什么</h2><p className="text-sm text-muted-foreground">范围会在发起提测后生成，当前页面只展示分析依据。</p></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map(item => <div key={item.label} className="rounded-md border bg-muted/10 p-3"><div className="flex items-center gap-2 font-medium">{item.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />}{item.label}</div><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div>)}
        </CardContent>
      </Card>

      <Card className="rounded-md border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3"><div><h2 className="font-semibold">分析结果</h2><p className="mt-1 text-sm text-muted-foreground">这里看结果规模；具体删改和分派进入提测详情完成。</p></div><Badge variant={statusBadgeVariant(design.status)}>{statusLabels[design.status] ?? design.status}</Badge></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Metric label="功能候选" value={candidateCount} />
          <Metric label="冒烟用例" value={smokeCount} />
          <Metric label="未覆盖验收点" value={design.uncoveredItems?.length ?? 0} />
        </CardContent>
      </Card>

      {design.uncoveredItems?.length ? <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4"><div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 text-amber-600" />有验收点暂未覆盖</div><ul className="mt-2 list-disc pl-5 text-sm">{design.uncoveredItems.slice(0, 5).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">进入提测详情后可直接删除不需要的范围，或补充人工用例。</p></section> : null}
      {design.status === 'GENERATION_FAILED' ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{design.generationError ?? '本次 AI 分析失败，请重新分析。'}<p className="mt-1 text-xs">排查编号：{design.id}</p></div> : null}

      <section aria-label="下一步操作" className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-primary/5 p-4"><div><h2 className="font-semibold">下一步</h2><p className="mt-1 text-sm text-muted-foreground">{hasRequest ? '提测已创建，去详情页删除范围、确认并分派。' : analyzing ? 'AI 正在分析，完成后再发起提测。' : '发起提测后，AI 会生成默认范围，你只需要删除不满意的用例。'}</p></div>{hasRequest || canStartRequest ? <Button asChild disabled={analyzing}><Link to={nextHref}>{hasRequest ? '查看提测详情' : '发起提测'}<ArrowRight className="h-4 w-4" /></Link></Button> : <Button disabled>{design.status === 'GENERATION_FAILED' ? '请重新分析' : '等待 AI 分析完成'}</Button>}</section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border bg-muted/10 p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
