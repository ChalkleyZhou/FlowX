import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import type { Briefing, Project } from '../types';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function BriefingsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

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
      setBriefings(await api.getProjectBriefings(nextProjectId));
    }
  }

  async function refresh(projectId = selectedProjectId) {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      setBriefings(await api.getProjectBriefings(projectId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载简报失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadProjects()
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载项目失败'))
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerate() {
    if (!selectedProjectId) {
      toast.error('请先选择项目');
      return;
    }
    setGenerating(true);
    try {
      await api.generateProjectBriefing(selectedProjectId, { date });
      await refresh(selectedProjectId);
      toast.success('简报已生成');
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
        description="按项目所属工作区的 GitLab 数据源生成每日研发简报，并跟踪发送状态。"
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
        <MetricCard label="事件总数" value={briefings.reduce((sum, item) => sum + item.eventCount, 0)} />
      </div>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Generate" title="生成简报" />
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 p-5 pt-0">
          <div className="min-w-[220px]">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">项目</label>
            <Select
              value={selectedProjectId || undefined}
              onValueChange={(value) => {
                setSelectedProjectId(value);
                void refresh(value);
              }}
            >
              <SelectTrigger>
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
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">日期</label>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <Button onClick={handleGenerate} disabled={!selectedProjectId || generating}>
            {generating ? '生成中...' : '生成简报'}
          </Button>
          {selectedProject ? (
            <Badge variant="outline">工作区：{selectedProject.workspace.name}</Badge>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="History" title="简报历史" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : briefings.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">事件</th>
                    <th className="px-4 py-3 font-medium">发送</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {briefings.map((briefing) => (
                    <tr key={briefing.id} className="border-t border-border">
                      <td className="px-4 py-3">{briefing.date.slice(0, 10)}</td>
                      <td className="px-4 py-3"><Badge variant="secondary">{briefing.status}</Badge></td>
                      <td className="px-4 py-3">{briefing.eventCount}</td>
                      <td className="px-4 py-3">{briefing.sentAt ? '已发送' : '未发送'}</td>
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

