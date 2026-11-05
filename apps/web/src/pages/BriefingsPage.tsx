import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useScopedProjectId } from '../project-scope-context';
import { EmptyState } from '../components/EmptyState';
import { ProjectRequiredState } from '../components/ProjectRequiredState';
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
import {
  readBriefingsPagePreferences,
  writeBriefingsPagePreferences,
} from '../utils/briefings-page-preferences';
import { formatBeijingDateTime } from '../utils/datetime';
import type { Briefing, BriefingPeriod, Project, ProjectFeed } from '../types';

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
  const [searchParams] = useSearchParams();
  const selectedProjectId = useScopedProjectId();
  const [projects, setProjects] = useState<Project[]>([]);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [feeds, setFeeds] = useState<ProjectFeed[]>([]);
  const [feedId, setFeedId] = useState('');
  const [period, setPeriod] = useState<BriefingPeriod>(
    () => readBriefingsPagePreferences().period ?? 'DAILY',
  );
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  async function loadProjects() {
    setProjects(await api.getProjects());
  }

  async function refresh(projectId = selectedProjectId, options?: { silent?: boolean }) {
    if (!projectId) {
      return;
    }
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [nextBriefings, nextFeeds] = await Promise.all([
        api.getProjectBriefings(projectId),
        api.listBriefingFeeds(projectId),
      ]);
      setBriefings(nextBriefings);
      setFeeds(nextFeeds);
      setFeedId((current) => (
        nextFeeds.some((feed) => feed.id === current) ? current : nextFeeds[0]?.id ?? ''
      ));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载简报失败');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadProjects().catch((error) => toast.error(error instanceof Error ? error.message : '加载项目失败'));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setBriefings([]);
      return;
    }
    void refresh(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const hasGeneratingBriefing = briefings.some((briefing) => briefing.status === 'GENERATING');
    if (!hasGeneratingBriefing) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh(selectedProjectId, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedProjectId, briefings]);

  async function handleGenerate() {
    if (!selectedProjectId || !feedId) {
      toast.error(selectedProjectId ? '请先在项目设置中创建简报' : '请先选择项目');
      return;
    }
    setGenerating(true);
    try {
      const briefing = await api.generateBriefingFeed(feedId, {
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

  return (
    <>
      <PageHeader
        eyebrow="Briefings"
        title="项目简报"
        description="按项目生成每日/每周研发简报，查看历史记录并跟踪发送状态。"
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

      <div className="grid gap-5 md:grid-cols-2">
        <MetricCard label="当前简报" value={selectedProjectId ? briefings.length : 0} />
        <MetricCard label="已发送" value={selectedProjectId ? briefings.filter((item) => item.sentAt).length : 0} />
      </div>

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Generate" title="生成简报" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="rounded-md border border-border bg-muted/70 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5 sm:max-w-xs">
                <span className="text-xs font-medium text-muted-foreground">项目</span>
                <p className="flex h-10 items-center text-sm font-medium">{selectedProject?.name ?? '未选择项目'}</p>
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-[180px]">
                <label className="text-xs font-medium text-muted-foreground">简报</label>
                <Select value={feedId} onValueChange={setFeedId} disabled={feeds.length === 0}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={feeds.length === 0 ? '尚未创建' : '选择简报'} />
                  </SelectTrigger>
                  <SelectContent>
                    {feeds.map((feed) => (
                      <SelectItem key={feed.id} value={feed.id}>{feed.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">类型</label>
                <Select
                  value={period}
                  onValueChange={(value) => {
                    const nextPeriod = value as BriefingPeriod;
                    setPeriod(nextPeriod);
                    writeBriefingsPagePreferences({ period: nextPeriod });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">日报</SelectItem>
                    <SelectItem value="WEEKLY">周报</SelectItem>
                  </SelectContent>
                </Select>
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
                  onClick={handleGenerate}
                  disabled={!selectedProjectId || !feedId || generating}
                >
                  {generating ? '生成中...' : period === 'WEEKLY' ? '生成周报' : '生成简报'}
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

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="History" title="简报历史" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {!selectedProjectId ? (
            <ProjectRequiredState />
          ) : loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : briefings.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">简报</th>
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
                      <td className="px-4 py-3">{briefing.feed?.name ?? '未命名'}</td>
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
            <EmptyState title="暂无简报" description="在项目设置中创建简报并勾选仓库后，选择这一份再生成。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
