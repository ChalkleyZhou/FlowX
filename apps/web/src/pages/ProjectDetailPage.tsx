import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ProjectBriefingConfigPanel } from '../components/ProjectBriefingConfigPanel';
import { ProjectCodeReviewConfigPanel } from '../components/ProjectCodeReviewConfigPanel';
import { ProjectRequiredState } from '../components/ProjectRequiredState';
import { ProjectVersionsPanel } from '../components/ProjectVersionsPanel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { Project } from '../types';
import { useScopedProjectId } from '../project-scope-context';

export function ProjectDetailPage() {
  const { projectId: routeProjectId } = useParams();
  const [searchParams] = useSearchParams();
  const projectId = useScopedProjectId() || routeProjectId || '';
  const toast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

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

  if (!projectId) {
    return <ProjectRequiredState />;
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
        description={project.description?.trim() || '维护当前项目的版本、简报和代码审查配置。'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to={`/schedule?projectId=${projectId}`}>在排期中查看</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/projects">全部项目</Link>
            </Button>
          </div>
        )}
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <Badge variant="outline">{project.workspace.name}</Badge>
        {project.code ? <Badge variant="secondary">{project.code}</Badge> : null}
        {project.currentVersion ? <Badge variant="secondary">{project.currentVersion.name}</Badge> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ProjectBriefingConfigPanel projectId={projectId} />
        <ProjectCodeReviewConfigPanel projectId={projectId} />
      </div>

      <div id="project-versions" className="mt-5 scroll-mt-5">
        <ProjectVersionsPanel
          projectId={projectId}
          currentVersionId={project.currentVersionId}
          onChanged={refresh}
        />
      </div>
    </>
  );
}
