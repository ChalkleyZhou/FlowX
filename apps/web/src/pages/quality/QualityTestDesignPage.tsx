import { useEffect, useState } from 'react';
import { Check, Play, RefreshCw } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import type { TestDesign, TestDesignCandidate } from '../../types';
import { LoadingState, statusBadgeVariant } from './quality-ui';

const statusLabels: Record<string, string> = {
  NOT_STARTED: '未开始',
  GENERATING: '生成中',
  WAITING_REVIEW: '待处理',
  WAITING_CONFIRMATION: '待确认',
  CONFIRMED: '已确认',
  STALE: '已过期',
  GENERATION_FAILED: '生成失败',
};

const actionLabels: Record<TestDesignCandidate['action'], string> = {
  REUSE: '复用现有用例',
  OPTIMIZE: '优化现有用例',
  CREATE: '新增项目用例',
  EXCLUDE: '不纳入本次范围',
};

export function QualityTestDesignPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [design, setDesign] = useState<TestDesign | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noSmokeReason, setNoSmokeReason] = useState('');
  const [noCaseReason, setNoCaseReason] = useState('');

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      setDesign(await api.getTestDesign(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载测试设计失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  async function generate() {
    if (!id) return;
    setBusy(true);
    try {
      setDesign(await api.generateTestDesign(id));
      toast.success('测试用例和冒烟候选已生成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成测试设计失败');
    } finally {
      setBusy(false);
    }
  }

  async function resolveCandidate(
    candidate: TestDesignCandidate,
    resolution: 'ACCEPTED' | 'REJECTED',
    action?: TestDesignCandidate['action'],
  ) {
    if (!id || !design) return;
    try {
      await api.updateTestDesignCandidate(id, candidate.id, {
        revision: design.revision,
        resolution,
        ...(action ? { action } : {}),
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新候选失败');
    }
  }

  async function confirm() {
    if (!id || !design) return;
    setBusy(true);
    try {
      const result = await api.confirmTestDesign(id, {
        revision: design.revision,
        coverageChecks: [{ key: 'candidate-resolution', passed: design.candidates.every((item) => item.resolution !== 'PENDING') }],
        uncoveredItems: design.uncoveredItems ?? [],
        noCaseReason: design.candidates.some((item) => item.resolution === 'ACCEPTED') ? undefined : noCaseReason,
        noSmokeReason: design.smokeCases.length ? undefined : noSmokeReason,
      });
      setDesign(result);
      toast.success('测试设计已确认，可以用于提测');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认测试设计失败');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSmoke() {
    if (!id || !design || !design.smokeCases.length) return;
    setBusy(true);
    try {
      const result = await api.updateTestDesignSmoke(id, {
        revision: design.revision,
        cases: design.smokeCases.map((item) => ({ ...item, resolution: 'ACCEPTED' })),
      });
      setDesign(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认冒烟用例失败');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;
  if (!design) return <EmptyState title="测试设计不存在" description="请检查链接或返回提测管理。" />;

  const pendingCount = design.candidates.filter((item) => item.resolution === 'PENDING').length;
  const smokePending = design.smokeCases.some((item) => item.resolution !== 'ACCEPTED');
  const hasAcceptedCases = design.candidates.some((item) => item.resolution === 'ACCEPTED' && item.action !== 'EXCLUDE');
  const reviewable = design.status === 'WAITING_REVIEW' || design.status === 'WAITING_CONFIRMATION';
  const confirmationIncomplete = !reviewable || pendingCount > 0 || smokePending || (!hasAcceptedCases && !noCaseReason.trim()) || (!design.smokeCases.length && !noSmokeReason.trim());
  const frozen = Boolean(design.testRequest);

  return (
    <>
      <PageHeader
        eyebrow="测试与质量"
        title="测试设计"
        description={`第 ${design.revision} 版 · 候选 ${design.candidates.length} 条 · 冒烟 ${design.smokeCases.length} 条`}
        actions={(
          <>
            <Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />刷新</Button>
            <Button onClick={() => void generate()} disabled={busy || design.status === 'GENERATING' || frozen}><Play className="h-4 w-4" />{design.status === 'CONFIRMED' || design.status === 'STALE' ? '刷新影响分析' : '生成候选'}</Button>
          </>
        )}
      />

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">当前状态</p>
            <div className="mt-1 flex items-center gap-2"><Badge variant={statusBadgeVariant(design.status)}>{statusLabels[design.status] ?? design.status}</Badge><span className="text-sm text-muted-foreground">待处理 {pendingCount} 条</span></div>
          </div>
          <Button onClick={() => void confirm()} disabled={busy || confirmationIncomplete || design.status === 'CONFIRMED'}><Check className="h-4 w-4" />确认测试设计</Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <section aria-label="功能测试候选" className="space-y-3">
            <h2 className="text-base font-semibold">功能测试候选</h2>
            {design.candidates.length ? design.candidates.map((candidate) => (
              <div key={candidate.id} className="flex flex-col gap-3 rounded-md border border-border p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{candidate.proposedCase.title}</p>
                    <Badge variant="outline">{actionLabels[candidate.action]}</Badge>
                    {candidate.sourceDefinition?.library ? <Badge variant="secondary">{candidate.sourceDefinition.library.projectId ? '项目库' : 'Workspace 共享库'}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{candidate.matchReason ?? '暂无匹配说明'}</p>
                  <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
                    {candidate.sourceDefinition ? <CaseSummary label="现有用例" testCase={candidate.sourceDefinition} /> : null}
                    <CaseSummary label={candidate.sourceDefinition ? '建议结果' : '生成用例'} testCase={candidate.proposedCase} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">{candidate.resolution === 'PENDING' ? '待处理' : candidate.resolution === 'ACCEPTED' ? '已接受' : '已排除'}</Badge>
                  {candidate.resolution === 'PENDING' && candidate.action === 'EXCLUDE' ? (
                    <>
                      <Button size="sm" onClick={() => void resolveCandidate(candidate, 'ACCEPTED')}>确认不纳入</Button>
                      {candidate.sourceDefinitionId ? <Button size="sm" variant="outline" onClick={() => void resolveCandidate(candidate, 'ACCEPTED', 'REUSE')}>改为复用</Button> : null}
                    </>
                  ) : null}
                  {candidate.resolution === 'PENDING' && candidate.action !== 'EXCLUDE' ? <><Button size="sm" onClick={() => void resolveCandidate(candidate, 'ACCEPTED')}>接受</Button><Button size="sm" variant="outline" onClick={() => void resolveCandidate(candidate, 'REJECTED')}>排除</Button></> : null}
                </div>
              </div>
            )) : <div className="space-y-2"><EmptyState title="暂无功能候选" description="确认时需要填写无功能用例原因。" /><Input value={noCaseReason} onChange={(event) => setNoCaseReason(event.target.value)} placeholder="无功能用例原因" /></div>}
          </section>

          <section aria-label="本次冒烟用例" className="space-y-3 border-t border-border pt-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-base font-semibold">本次冒烟用例</h2>{design.smokeCases.length ? <Button variant="outline" size="sm" onClick={() => void confirmSmoke()} disabled={busy || !smokePending}><Check className="h-4 w-4" />确认冒烟</Button> : null}</div>
            {design.smokeCases.length ? design.smokeCases.map((item) => <div key={item.id} className="rounded-md border border-border p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{item.title}</p><Badge variant="outline">{item.resolution === 'ACCEPTED' ? '已确认' : '待确认'}</Badge></div><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{item.steps.map((step) => <li key={step}>{step}</li>)}</ol><p className="mt-2 text-sm">预期：{item.expected}</p></div>) : <div className="space-y-2"><p className="text-sm text-muted-foreground">本次未生成冒烟用例，请填写原因。</p><Input value={noSmokeReason} onChange={(event) => setNoSmokeReason(event.target.value)} placeholder="无冒烟场景原因" /></div>}
          </section>
        </CardContent>
      </Card>
    </>
  );
}

function CaseSummary({
  label,
  testCase,
}: {
  label: string;
  testCase: { title: string; precondition?: string | null; steps: string[]; expected: string };
}) {
  return (
    <div className="min-w-0 border-l-2 border-border pl-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{testCase.title}</p>
      {testCase.precondition ? <p className="mt-1 text-muted-foreground">前置：{testCase.precondition}</p> : null}
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
        {testCase.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
      </ol>
      <p className="mt-1">预期：{testCase.expected}</p>
    </div>
  );
}
