import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { formatBeijingDateTime } from '../utils/datetime';
import type { Briefing, BriefingPeriod, DailyCodeReview, Project } from '../types';

type BriefingsView = 'briefings' | 'code-reviews';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function periodLabel(period: BriefingPeriod | string | undefined) {
  return period === 'WEEKLY' ? '周报' : '日报';
}

function briefingRangeLabel(briefing: Briefing) {
  if (briefing.period === 'WEEKLY') {
    const scopeRange =
      typeof briefing.scope === 'object' && briefing.scope && 'rangeLabel' in briefing.scope
        ? String((briefing.scope as { rangeLabel?: unknown }).rangeLabel ?? '')
        : '';
    if (scopeRange) {
      return scopeRange;
    }
    if (briefing.periodStart && briefing.periodEnd) {
      const start = briefing.periodStart.slice(0, 10);
      const end = new Date(new Date(briefing.periodEnd).getTime() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return `${start} 至 ${end}`;
    }
  }
  return briefing.date.slice(0, 10);
}

export function BriefingsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [codeReviews, setCodeReviews] = useState<DailyCodeReview[]>([]);
  const [activeView, setActiveView] = useState<BriefingsView>('briefings');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [period, setPeriod] = useState<BriefingPeriod>('DAILY');
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingReview, setGeneratingReview] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  async function loadProjects() {
    const projectList = await api.getProjects();
    setProjects(projectList);
    const nextProjectId = selectedProjectId || projectList[0]?.id || '';
    setSelectedProjectId(nextProjectId);
    if (nextProjectId) {
      const [projectBriefings, projectCodeReviews] = await Promise.all([
        api.getProjectBriefings(nextProjectId),
        api.listProjectDailyCodeReviews(nextProjectId),
      ]);
      setBriefings(projectBriefings);
      setCodeReviews(projectCodeReviews);
    }
  }

  async function refresh(projectId = selectedProjectId, options?: { silent?: boolean }) {
    if (!projectId) {
      return;
    }
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [projectBriefings, projectCodeReviews] = await Promise.all([
        api.getProjectBriefings(projectId),
        api.listProjectDailyCodeReviews(projectId),
      ]);
      setBriefings(projectBriefings);
      setCodeReviews(projectCodeReviews);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载简报失败');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    setLoading(true);
    loadProjects()
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载项目失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const hasGeneratingBriefing = briefings.some((briefing) => briefing.status === 'GENERATING');
    const hasGeneratingReview = codeReviews.some((review) => review.status === 'GENERATING');
    if (!hasGeneratingBriefing && !hasGeneratingReview) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh(selectedProjectId, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedProjectId, briefings, codeReviews]);

  async function handleGenerate() {
    if (!selectedProjectId) {
      toast.error('请先选择项目');
      return;
    }
    setGenerating(true);
    try {
      const briefing = await api.generateProjectBriefing(selectedProjectId, {
        period,
        date,
        regenerate: true,
      });
      await refresh(selectedProjectId);
      toast.success(
        briefing.status === 'GENERATING'
          ? period === 'WEEKLY'
            ? '周报已开始生成'
            : '简报已开始生成'
          : period === 'WEEKLY'
            ? '周报已生成'
            : '简报已生成',
      );
      navigate(`/briefings/${briefing.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成简报失败');
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateReview() {
    if (!selectedProjectId) {
      toast.error('请先选择项目');
      return;
    }
    setGeneratingReview(true);
    try {
      const review = await api.generateProjectDailyCodeReview(selectedProjectId, {
        date,
        regenerate: true,
      });
      await refresh(selectedProjectId);
      toast.success(
        review.status === 'GENERATING'
          ? '每日 Code Review 已开始生成'
          : '每日 Code Review 已生成',
      );
      navigate(`/daily-code-reviews/${review.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成 Code Review 失败');
    } finally {
      setGeneratingReview(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Briefings"
        title="项目简报与 Code Review"
        description="按项目生成每日研发简报和 Code Review，查看历史记录并跟踪发送状态。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/settings/briefing-sources">数据源</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/settings/delivery-targets">投递目标</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        <MetricCard label="项目数" value={projects.length} />
        <MetricCard label="当前简报" value={briefings.length} />
        <MetricCard label="Code Review" value={codeReviews.length} />
      </div>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Generate"
            title={activeView === 'code-reviews' ? '生成 Code Review' : '生成简报'}
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              variant={activeView === 'briefings' ? 'default' : 'outline'}
              onClick={() => setActiveView('briefings')}
            >
              简报
            </Button>
            <Button
              variant={activeView === 'code-reviews' ? 'default' : 'outline'}
              onClick={() => setActiveView('code-reviews')}
            >
              Code Review
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-muted/70 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5 sm:max-w-xs">
                <label className="text-xs font-medium text-muted-foreground">项目</label>
                <Select
                  value={selectedProjectId || undefined}
                  onValueChange={(value) => {
                    setSelectedProjectId(value);
                    void refresh(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择项目" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">类型</label>
                {activeView === 'briefings' ? (
                  <Select value={period} onValueChange={(value) => setPeriod(value as BriefingPeriod)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">日报</SelectItem>
                      <SelectItem value="WEEKLY">周报</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input className="w-full" value="日报" disabled />
                )}
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-[168px]">
                <label className="text-xs font-medium text-muted-foreground">
                  {period === 'WEEKLY' ? '周内日期' : '日期'}
                </label>
                <Input
                  type="date"
                  className="w-full"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="hidden text-xs font-medium text-muted-foreground sm:invisible sm:block" aria-hidden>
                  操作
                </span>
                <Button
                  className="h-10 w-full sm:w-auto"
                  onClick={activeView === 'code-reviews' ? handleGenerateReview : handleGenerate}
                  disabled={
                    !selectedProjectId ||
                    (activeView === 'code-reviews' ? generatingReview : generating)
                  }
                >
                  {activeView === 'code-reviews'
                    ? generatingReview
                      ? '生成中...'
                      : '生成 Code Review'
                    : generating
                      ? '生成中...'
                      : period === 'WEEKLY'
                        ? '生成周报'
                        : '生成简报'}
                </Button>
              </div>
            </div>
            {selectedProject ? (
              <p className="mt-3 text-sm text-muted-foreground">
                工作区：<span className="font-medium text-foreground">{selectedProject.workspace.name}</span>
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="History"
            title={activeView === 'code-reviews' ? 'Code Review 历史' : '简报历史'}
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : activeView === 'code-reviews' ? (
            codeReviews.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">审查单元</th>
                      <th className="px-4 py-3 font-medium">生成时间</th>
                      <th className="px-4 py-3 font-medium">发送时间</th>
                      <th className="px-4 py-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codeReviews.map((review) => (
                      <tr key={review.id} className="border-t border-border">
                        <td className="px-4 py-3">{review.date.slice(0, 10)}</td>
                        <td className="px-4 py-3"><Badge variant="secondary">{review.status}</Badge></td>
                        <td className="px-4 py-3">{review.unitsJson?.length ?? 0}</td>
                        <td className="px-4 py-3">{formatBeijingDateTime(review.generatedAt)}</td>
                        <td className="px-4 py-3">
                          {review.sentAt ? formatBeijingDateTime(review.sentAt) : '未发送'}
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/daily-code-reviews/${review.id}`}>查看详情</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="暂无 Code Review"
                description="选择项目和日期后生成第一份每日 Code Review。"
              />
            )
          ) : briefings.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">类型</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">事件</th>
                    <th className="px-4 py-3 font-medium">生成时间</th>
                    <th className="px-4 py-3 font-medium">发送时间</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {briefings.map((briefing) => (
                    <tr key={briefing.id} className="border-t border-border">
                      <td className="px-4 py-3">{briefingRangeLabel(briefing)}</td>
                      <td className="px-4 py-3">{periodLabel(briefing.period)}</td>
                      <td className="px-4 py-3"><Badge variant="secondary">{briefing.status}</Badge></td>
                      <td className="px-4 py-3">{briefing.eventCount}</td>
                      <td className="px-4 py-3">{formatBeijingDateTime(briefing.generatedAt)}</td>
                      <td className="px-4 py-3">
                        {briefing.sentAt ? formatBeijingDateTime(briefing.sentAt) : '未发送'}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/briefings/${briefing.id}`}>查看详情</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="暂无简报" description="选择项目和日期后生成第一份简报。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
