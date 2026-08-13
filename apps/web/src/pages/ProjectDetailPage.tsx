import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ProjectBriefingConfigPanel } from '../components/ProjectBriefingConfigPanel';
import { ProjectCodeReviewConfigPanel } from '../components/ProjectCodeReviewConfigPanel';
import { ProjectVersionsPanel } from '../components/ProjectVersionsPanel';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { Project } from '../types';
import { formatAssignmentSummary, formatScheduleRange } from '../utils/business-days';
import { formatPlanningStatus, formatPriority } from '../utils/label-utils';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const toast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [versionFilter, setVersionFilter] = useState('__all__');

  async function refresh() {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      setProject(await api.getProject(projectId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载项目失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const filteredRequirements = useMemo(() => {
    const rows = project?.requirements ?? [];
    if (versionFilter === '__all__') {
      return rows;
    }
    if (versionFilter === '__unversioned__') {
      return rows.filter((requirement) => !requirement.versionId);
    }
    return rows.filter((requirement) => requirement.versionId === versionFilter);
  }, [project?.requirements, versionFilter]);

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">缺少项目 ID。</p>;
  }

  if (loading && !project) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm text-muted-foreground">项目不存在或无法加载。</p>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        description={project.description?.trim() || '管理项目下的需求与人员排期。'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="default" asChild>
              <Link to={`/schedule?projectId=${projectId}`}>在排期中查看</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/projects">返回项目列表</Link>
            </Button>
          </div>
        )}
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <Badge variant="outline">{project.workspace.name}</Badge>
        {project.code ? <Badge variant="secondary">{project.code}</Badge> : null}
        {project.currentVersion ? <Badge variant="secondary">{project.currentVersion.name}</Badge> : null}
        <Badge variant="default">{project.requirements?.length ?? 0} 条需求</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ProjectBriefingConfigPanel projectId={projectId} />
        <ProjectCodeReviewConfigPanel projectId={projectId} />
      </div>

      <div className="mt-5">
        <ProjectVersionsPanel
          projectId={projectId}
          currentVersionId={project.currentVersionId}
          onChanged={refresh}
        />
      </div>

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeader eyebrow="Requirements" title="需求列表" />
            <Select value={versionFilter} onValueChange={setVersionFilter}>
              <SelectTrigger className="w-44" aria-label="按版本筛选">
                <SelectValue placeholder="全部版本" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部版本</SelectItem>
                <SelectItem value="__unversioned__">未挂版本</SelectItem>
                {(project.versions ?? []).map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    {version.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {filteredRequirements.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">需求</th>
                    <th className="px-4 py-3 font-medium">版本</th>
                    <th className="px-4 py-3 font-medium">排期状态</th>
                    <th className="px-4 py-3 font-medium">优先级</th>
                    <th className="px-4 py-3 font-medium">人员</th>
                    <th className="px-4 py-3 font-medium">周期</th>
                    <th className="px-4 py-3 font-medium">人天</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequirements.map((requirement) => (
                    <tr key={requirement.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          to={`/requirements/${requirement.id}`}
                          className="text-foreground no-underline hover:text-primary"
                        >
                          {requirement.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{requirement.version?.name ?? ''}</td>
                      <td className="px-4 py-3">{formatPlanningStatus(requirement.planningStatus)}</td>
                      <td className="px-4 py-3">{formatPriority(requirement.priority)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatAssignmentSummary(requirement.assignments)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatScheduleRange(
                          requirement.scheduleSummary?.scheduleStart,
                          requirement.scheduleSummary?.scheduleEnd,
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {requirement.scheduleSummary?.totalEstimatedDays ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="default" size="sm" asChild>
                            <Link to={`/requirements/${requirement.id}`}>详情</Link>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/requirements/${requirement.id}#scheduling`}>排期</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">该项目下还没有需求。</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
