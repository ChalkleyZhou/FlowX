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
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { formatBeijingDateTime } from '../utils/datetime';
import type { DailyCodeReview, Project } from '../types';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function CodeReviewsPage() {
  const [searchParams] = useSearchParams();
  const selectedProjectId = useScopedProjectId();
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviews, setReviews] = useState<DailyCodeReview[]>([]);
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
      setReviews(await api.listProjectDailyCodeReviews(projectId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载代码审查失败');
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
      setReviews([]);
      return;
    }
    void refresh(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const hasGenerating = reviews.some((review) => review.status === 'GENERATING');
    if (!hasGenerating) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh(selectedProjectId, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedProjectId, reviews]);

  async function handleGenerate() {
    if (!selectedProjectId) {
      toast.error('请先选择项目');
      return;
    }
    setGenerating(true);
    try {
      const review = await api.generateProjectDailyCodeReview(selectedProjectId, {
        date,
        regenerate: true,
      });
      await refresh(selectedProjectId);
      toast.success(
        review.status === 'GENERATING'
          ? '每日代码审查已开始生成'
          : '每日代码审查已生成',
      );
      navigate(`/daily-code-reviews/${review.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成代码审查失败');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="代码审查"
        title="代码审查"
        description="按项目 review skill 驱动每日代码审查，查看历史记录并跟踪发送状态。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/settings/code-review-sources">代码审查数据源</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/settings/delivery-targets">投递目标</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 md:grid-cols-2">
        <MetricCard label="项目数" value={projects.length} />
        <MetricCard label="代码审查" value={reviews.length} />
      </div>

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Generate" title="生成代码审查" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="rounded-md border border-border bg-muted/70 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5 sm:max-w-xs">
                <span className="text-xs font-medium text-muted-foreground">项目</span>
                <p className="flex h-10 items-center text-sm font-medium">{selectedProject?.name ?? '未选择项目'}</p>
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-[168px]">
                <label className="text-xs font-medium text-muted-foreground">日期</label>
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
                  disabled={!selectedProjectId || generating}
                >
                  {generating ? '生成中...' : '生成代码审查'}
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
          <SectionHeader eyebrow="History" title="代码审查历史" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {!selectedProjectId ? (
            <ProjectRequiredState />
          ) : loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : reviews.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
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
                  {reviews.map((review) => (
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
              title="暂无代码审查"
              description="选择项目和日期后生成第一份每日代码审查。默认会审查该项目所属工作区的全部仓库；可在「代码审查数据源」中排除个别仓库。"
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/settings/code-review-sources">管理排除项</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
